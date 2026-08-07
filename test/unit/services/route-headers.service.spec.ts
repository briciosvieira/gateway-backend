import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { AuditAction, AuditEntity } from '../../../generated/prisma/client';
import type { RouteHeader } from '../../../generated/prisma/client';
import { RouteHeadersService } from '../../../src/modules/route-headers/route-headers.service';
import type { AuditLogsService } from '../../../src/modules/audit-logs/audit-logs.service';
import {
  encryptHeaderValue,
  parseHeaderEncryptionKey,
} from '../../../src/modules/route-headers/utils/route-header-encryption.util';
import type { FindRouteHeadersQueryDto } from '../../../src/modules/route-headers/dto/find-route-headers-query.dto';
import {
  buildRouteHeaderFixture,
  nonSensitiveRouteHeaderFixture,
  sensitiveRouteHeaderFixture,
} from '../../fixtures/route-headers.fixture';
import {
  activeGatewayRouteFixture,
  inactiveGatewayRouteFixture,
} from '../../fixtures/gateway-routes.fixture';
import { authenticatedAdminFixture } from '../../fixtures/users.fixture';
import {
  createMockPrismaService,
  mockTransactionArray,
  resetMockPrismaService,
} from '../../helpers/prisma-mock.helper';
import type { MockPrismaService } from '../../helpers/prisma-mock.helper';

const ENCRYPTION_KEY_HEX = '0'.repeat(64);
const encryptionKey = parseHeaderEncryptionKey(ENCRYPTION_KEY_HEX);

// The fixture's `valueEncrypted` is a placeholder that cannot be decrypted with a real
// AES-GCM key. Tests that exercise the decrypt path (non-sensitive headers returned via
// `toSafeRouteHeader`) need a genuinely encrypted value produced with the same key the
// mocked ConfigService returns.
const nonSensitiveHeaderWithRealValue: RouteHeader = {
  ...nonSensitiveRouteHeaderFixture,
  valueEncrypted: encryptHeaderValue('fixture-header-value', encryptionKey),
};

function buildQuery(
  overrides: Partial<FindRouteHeadersQueryDto> = {},
): FindRouteHeadersQueryDto {
  return {
    page: 1,
    limit: 20,
    sortBy: 'createdAt',
    sortOrder: 'desc',
    ...overrides,
  };
}

describe('RouteHeadersService', () => {
  let service: RouteHeadersService;
  let prisma: MockPrismaService;
  let auditLogsService: { create: jest.Mock };
  let configService: { get: jest.Mock };

  const requestContext = { sourceIp: '203.0.113.10', requestId: 'req-1' };

  beforeEach(() => {
    prisma = createMockPrismaService();
    auditLogsService = { create: jest.fn().mockResolvedValue(undefined) };
    configService = { get: jest.fn().mockReturnValue(ENCRYPTION_KEY_HEX) };

    service = new RouteHeadersService(
      prisma,
      configService as unknown as ConfigService,
      auditLogsService as unknown as AuditLogsService,
    );
  });

  afterEach(() => {
    resetMockPrismaService(prisma);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('creates a non-sensitive header and returns the decrypted value without valueEncrypted', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(
        activeGatewayRouteFixture,
      );
      prisma.routeHeader.findUnique.mockResolvedValue(null);
      const createdHeader: RouteHeader = {
        ...nonSensitiveRouteHeaderFixture,
        valueEncrypted: encryptHeaderValue('header-value-123', encryptionKey),
      };
      prisma.routeHeader.create.mockResolvedValue(createdHeader);

      const result = await service.create(
        authenticatedAdminFixture,
        requestContext,
        {
          gatewayRouteId: activeGatewayRouteFixture.id,
          name: 'x-custom-header',
          value: 'header-value-123',
          sensitive: false,
        },
      );

      expect(result.value).toBe('header-value-123');
      expect(result).not.toHaveProperty('valueEncrypted');
      expect(prisma.routeHeader.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            gatewayRouteId: activeGatewayRouteFixture.id,
            name: 'X-Custom-Header',
            sensitive: false,
            active: true,
          }),
        }),
      );
    });

    it('creates a sensitive header and returns the masked value without valueEncrypted', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(
        activeGatewayRouteFixture,
      );
      prisma.routeHeader.findUnique.mockResolvedValue(null);
      prisma.routeHeader.create.mockResolvedValue(sensitiveRouteHeaderFixture);

      const result = await service.create(
        authenticatedAdminFixture,
        requestContext,
        {
          gatewayRouteId: activeGatewayRouteFixture.id,
          name: 'x-api-secret',
          value: 'super-secret-value',
          sensitive: true,
        },
      );

      expect(result.value).toBe('********');
      expect(result).not.toHaveProperty('valueEncrypted');
    });

    it('throws NotFoundException when the gateway route does not exist', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(null);

      await expect(
        service.create(authenticatedAdminFixture, requestContext, {
          gatewayRouteId: 'missing-route',
          name: 'x-custom-header',
          value: 'value',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.routeHeader.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the gateway route is inactive', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(
        inactiveGatewayRouteFixture,
      );

      await expect(
        service.create(authenticatedAdminFixture, requestContext, {
          gatewayRouteId: inactiveGatewayRouteFixture.id,
          name: 'x-custom-header',
          value: 'value',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.routeHeader.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the header name is already configured for the route', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(
        activeGatewayRouteFixture,
      );
      prisma.routeHeader.findUnique.mockResolvedValue(
        nonSensitiveRouteHeaderFixture,
      );

      await expect(
        service.create(authenticatedAdminFixture, requestContext, {
          gatewayRouteId: activeGatewayRouteFixture.id,
          name: 'x-custom-header',
          value: 'value',
        }),
      ).rejects.toThrow(ConflictException);

      expect(prisma.routeHeader.create).not.toHaveBeenCalled();
    });

    it('records an audit log that never contains the plaintext or encrypted header value', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(
        activeGatewayRouteFixture,
      );
      prisma.routeHeader.findUnique.mockResolvedValue(null);
      const secretValue = 'top-secret-plaintext-value';
      const encryptedValue = encryptHeaderValue(secretValue, encryptionKey);
      const createdHeader: RouteHeader = {
        ...nonSensitiveRouteHeaderFixture,
        valueEncrypted: encryptedValue,
      };
      prisma.routeHeader.create.mockResolvedValue(createdHeader);

      await service.create(authenticatedAdminFixture, requestContext, {
        gatewayRouteId: activeGatewayRouteFixture.id,
        name: 'x-custom-header',
        value: secretValue,
        sensitive: false,
      });

      const auditPayload = auditLogsService.create.mock.calls[0][0];
      const serializedAuditPayload = JSON.stringify(auditPayload);

      expect(serializedAuditPayload).not.toContain(secretValue);
      expect(serializedAuditPayload).not.toContain(encryptedValue);
      expect(auditPayload.newValue).toEqual({
        gatewayRouteId: createdHeader.gatewayRouteId,
        headerName: createdHeader.name,
        sensitive: createdHeader.sensitive,
        active: createdHeader.active,
      });
    });
  });

  describe('findAll', () => {
    it('returns paginated items mapped through the safe projection', async () => {
      const encryptedValue = encryptHeaderValue('list-value', encryptionKey);
      const header: RouteHeader = {
        ...nonSensitiveRouteHeaderFixture,
        valueEncrypted: encryptedValue,
      };
      mockTransactionArray(prisma, [[header, sensitiveRouteHeaderFixture], 2]);

      const result = await service.findAll(buildQuery());

      expect(result.items).toHaveLength(2);
      expect(result.items[0]).not.toHaveProperty('valueEncrypted');
      expect(result.items[0].value).toBe('list-value');
      expect(result.items[1].value).toBe('********');
      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
      });
    });

    it('returns totalPages 0 when there are no results', async () => {
      mockTransactionArray(prisma, [[], 0]);

      const result = await service.findAll(buildQuery());

      expect(result.items).toEqual([]);
      expect(result.pagination.totalPages).toBe(0);
    });

    it('echoes the applied filters back in the response', async () => {
      mockTransactionArray(prisma, [[], 0]);

      const result = await service.findAll(
        buildQuery({
          search: 'api',
          gatewayRouteId: activeGatewayRouteFixture.id,
          headerName: 'X-Api-Key',
          active: true,
          sensitive: false,
        }),
      );

      expect(result.filters).toEqual({
        search: 'api',
        gatewayRouteId: activeGatewayRouteFixture.id,
        headerName: 'X-Api-Key',
        active: true,
        sensitive: false,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });
    });

    it('returns null filters when no optional filters were provided', async () => {
      mockTransactionArray(prisma, [[], 0]);

      const result = await service.findAll(buildQuery());

      expect(result.filters).toEqual({
        search: null,
        gatewayRouteId: null,
        headerName: null,
        active: null,
        sensitive: null,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });
    });

    it('builds a where clause scoped by gatewayRouteId, headerName, active and sensitive', async () => {
      mockTransactionArray(prisma, [[], 0]);

      await service.findAll(
        buildQuery({
          gatewayRouteId: activeGatewayRouteFixture.id,
          headerName: 'X-Api-Key',
          active: true,
          sensitive: false,
        }),
      );

      expect(prisma.routeHeader.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            gatewayRouteId: activeGatewayRouteFixture.id,
            name: { contains: 'X-Api-Key', mode: 'insensitive' },
            active: true,
            sensitive: false,
          },
        }),
      );
    });

    it('builds an OR search clause across header name and gateway route fields when search is provided', async () => {
      mockTransactionArray(prisma, [[], 0]);

      await service.findAll(buildQuery({ search: 'api' }));

      expect(prisma.routeHeader.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { name: { contains: 'api', mode: 'insensitive' } },
              {
                gatewayRoute: {
                  name: { contains: 'api', mode: 'insensitive' },
                },
              },
              {
                gatewayRoute: {
                  slug: { contains: 'api', mode: 'insensitive' },
                },
              },
            ],
          },
        }),
      );
    });

    it.each<[FindRouteHeadersQueryDto['sortBy'], string]>([
      ['headerName', 'name'],
      ['createdAt', 'createdAt'],
      ['updatedAt', 'updatedAt'],
    ])('orders by %s using the %s column', async (sortBy, column) => {
      mockTransactionArray(prisma, [[], 0]);

      await service.findAll(buildQuery({ sortBy, sortOrder: 'asc' }));

      expect(prisma.routeHeader.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { [column]: 'asc' },
        }),
      );
    });
  });

  describe('findOne', () => {
    it('returns the safe projection when the header exists', async () => {
      const encryptedValue = encryptHeaderValue('single-value', encryptionKey);
      prisma.routeHeader.findUnique.mockResolvedValue({
        ...nonSensitiveRouteHeaderFixture,
        valueEncrypted: encryptedValue,
      });

      const result = await service.findOne(nonSensitiveRouteHeaderFixture.id);

      expect(result.value).toBe('single-value');
      expect(result).not.toHaveProperty('valueEncrypted');
    });

    it('throws NotFoundException when the header does not exist', async () => {
      prisma.routeHeader.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('re-encrypts the value when dto.value is provided', async () => {
      const currentHeader: RouteHeader = {
        ...nonSensitiveRouteHeaderFixture,
        valueEncrypted: encryptHeaderValue('old-value', encryptionKey),
      };
      prisma.routeHeader.findUnique.mockResolvedValue(currentHeader);
      const updatedHeader: RouteHeader = {
        ...currentHeader,
        valueEncrypted: encryptHeaderValue('new-value', encryptionKey),
      };
      prisma.routeHeader.update.mockResolvedValue(updatedHeader);

      const result = await service.update(
        authenticatedAdminFixture,
        requestContext,
        currentHeader.id,
        { value: 'new-value' },
      );

      expect(result.value).toBe('new-value');
      const updateCallArgs = prisma.routeHeader.update.mock.calls[0][0];
      expect(updateCallArgs.data).toHaveProperty('valueEncrypted');
      expect(updateCallArgs.data.valueEncrypted).not.toBe(
        currentHeader.valueEncrypted,
      );
    });

    it('does not touch valueEncrypted when dto.value is not provided', async () => {
      prisma.routeHeader.findUnique.mockResolvedValue(
        nonSensitiveRouteHeaderFixture,
      );
      prisma.routeHeader.update.mockResolvedValue({
        ...nonSensitiveRouteHeaderFixture,
        sensitive: true,
      });

      await service.update(
        authenticatedAdminFixture,
        requestContext,
        nonSensitiveRouteHeaderFixture.id,
        {
          sensitive: true,
        },
      );

      const updateCallArgs = prisma.routeHeader.update.mock.calls[0][0];
      expect(updateCallArgs.data).not.toHaveProperty('valueEncrypted');
      expect(updateCallArgs.data).not.toHaveProperty('name');
      expect(updateCallArgs.data.sensitive).toBe(true);
    });

    it('renames the header when the new name has no conflict', async () => {
      prisma.routeHeader.findUnique.mockResolvedValueOnce(
        nonSensitiveHeaderWithRealValue,
      );
      prisma.routeHeader.findUnique.mockResolvedValueOnce(null);
      const renamedHeader: RouteHeader = {
        ...nonSensitiveHeaderWithRealValue,
        name: 'X-Renamed-Header',
      };
      prisma.routeHeader.update.mockResolvedValue(renamedHeader);

      const result = await service.update(
        authenticatedAdminFixture,
        requestContext,
        nonSensitiveHeaderWithRealValue.id,
        { name: 'x-renamed-header' },
      );

      expect(result.name).toBe('X-Renamed-Header');
      expect(prisma.routeHeader.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'X-Renamed-Header' }),
        }),
      );
    });

    it('throws ConflictException when renaming to a name already used by another header on the same route', async () => {
      prisma.routeHeader.findUnique.mockResolvedValueOnce(
        nonSensitiveRouteHeaderFixture,
      );
      prisma.routeHeader.findUnique.mockResolvedValueOnce(
        buildRouteHeaderFixture({
          id: 'other-header-id',
          name: 'X-Taken-Header',
        }),
      );

      await expect(
        service.update(
          authenticatedAdminFixture,
          requestContext,
          nonSensitiveRouteHeaderFixture.id,
          {
            name: 'x-taken-header',
          },
        ),
      ).rejects.toThrow(ConflictException);

      expect(prisma.routeHeader.update).not.toHaveBeenCalled();
    });

    it('does not check for a conflict when the normalized name is unchanged', async () => {
      prisma.routeHeader.findUnique.mockResolvedValueOnce(
        nonSensitiveHeaderWithRealValue,
      );
      prisma.routeHeader.update.mockResolvedValue(
        nonSensitiveHeaderWithRealValue,
      );

      await service.update(
        authenticatedAdminFixture,
        requestContext,
        nonSensitiveHeaderWithRealValue.id,
        { name: nonSensitiveHeaderWithRealValue.name },
      );

      expect(prisma.routeHeader.findUnique).toHaveBeenCalledTimes(1);
    });

    it('throws NotFoundException when the header does not exist', async () => {
      prisma.routeHeader.findUnique.mockResolvedValue(null);

      await expect(
        service.update(
          authenticatedAdminFixture,
          requestContext,
          'missing-id',
          { sensitive: true },
        ),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.routeHeader.update).not.toHaveBeenCalled();
    });

    it('records an audit log that never contains the plaintext or encrypted header value', async () => {
      const currentHeader: RouteHeader = {
        ...nonSensitiveRouteHeaderFixture,
        valueEncrypted: encryptHeaderValue('old-secret-value', encryptionKey),
      };
      prisma.routeHeader.findUnique.mockResolvedValue(currentHeader);
      const newEncryptedValue = encryptHeaderValue(
        'new-secret-value',
        encryptionKey,
      );
      const updatedHeader: RouteHeader = {
        ...currentHeader,
        valueEncrypted: newEncryptedValue,
      };
      prisma.routeHeader.update.mockResolvedValue(updatedHeader);

      await service.update(
        authenticatedAdminFixture,
        requestContext,
        currentHeader.id,
        {
          value: 'new-secret-value',
        },
      );

      const auditPayload = auditLogsService.create.mock.calls[0][0];
      const serializedAuditPayload = JSON.stringify(auditPayload);

      expect(serializedAuditPayload).not.toContain('old-secret-value');
      expect(serializedAuditPayload).not.toContain('new-secret-value');
      expect(serializedAuditPayload).not.toContain(
        currentHeader.valueEncrypted,
      );
      expect(serializedAuditPayload).not.toContain(newEncryptedValue);
    });
  });

  describe('changeStatus', () => {
    it('returns the current record unchanged when the status already matches', async () => {
      prisma.routeHeader.findUnique.mockResolvedValue(
        nonSensitiveHeaderWithRealValue,
      );

      const result = await service.changeStatus(
        authenticatedAdminFixture,
        requestContext,
        nonSensitiveHeaderWithRealValue.id,
        { active: true },
      );

      expect(result.active).toBe(true);
      expect(prisma.routeHeader.update).not.toHaveBeenCalled();
    });

    it('activates an inactive header', async () => {
      const inactiveHeader: RouteHeader = {
        ...nonSensitiveHeaderWithRealValue,
        active: false,
      };
      prisma.routeHeader.findUnique.mockResolvedValue(inactiveHeader);
      prisma.routeHeader.update.mockResolvedValue({
        ...inactiveHeader,
        active: true,
      });

      const result = await service.changeStatus(
        authenticatedAdminFixture,
        requestContext,
        inactiveHeader.id,
        { active: true },
      );

      expect(result.active).toBe(true);
      expect(prisma.routeHeader.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { active: true } }),
      );
    });

    it('deactivates an active header', async () => {
      prisma.routeHeader.findUnique.mockResolvedValue(
        nonSensitiveHeaderWithRealValue,
      );
      prisma.routeHeader.update.mockResolvedValue({
        ...nonSensitiveHeaderWithRealValue,
        active: false,
      });

      const result = await service.changeStatus(
        authenticatedAdminFixture,
        requestContext,
        nonSensitiveHeaderWithRealValue.id,
        { active: false },
      );

      expect(result.active).toBe(false);
      expect(prisma.routeHeader.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { active: false } }),
      );
    });

    it('throws NotFoundException when the header does not exist', async () => {
      prisma.routeHeader.findUnique.mockResolvedValue(null);

      await expect(
        service.changeStatus(
          authenticatedAdminFixture,
          requestContext,
          'missing-id',
          { active: true },
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes the route header and records a DELETE audit log with the previous value', async () => {
      prisma.routeHeader.findUnique.mockResolvedValue(
        nonSensitiveHeaderWithRealValue,
      );
      prisma.routeHeader.delete.mockResolvedValue(
        nonSensitiveHeaderWithRealValue,
      );

      await service.remove(
        authenticatedAdminFixture,
        requestContext,
        nonSensitiveHeaderWithRealValue.id,
      );

      expect(prisma.routeHeader.delete).toHaveBeenCalledWith({
        where: { id: nonSensitiveHeaderWithRealValue.id },
      });
      expect(auditLogsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: authenticatedAdminFixture.id,
          action: AuditAction.DELETE,
          entity: AuditEntity.ROUTE_HEADER,
          entityId: nonSensitiveHeaderWithRealValue.id,
          previousValue: {
            gatewayRouteId: nonSensitiveHeaderWithRealValue.gatewayRouteId,
            headerName: nonSensitiveHeaderWithRealValue.name,
            sensitive: nonSensitiveHeaderWithRealValue.sensitive,
            active: nonSensitiveHeaderWithRealValue.active,
          },
          sourceIp: requestContext.sourceIp,
          requestId: requestContext.requestId,
        }),
      );
    });

    it('throws NotFoundException when the header does not exist and never deletes', async () => {
      prisma.routeHeader.findUnique.mockResolvedValue(null);

      await expect(
        service.remove(authenticatedAdminFixture, requestContext, 'missing-id'),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.routeHeader.delete).not.toHaveBeenCalled();
      expect(auditLogsService.create).not.toHaveBeenCalled();
    });

    it('records an audit log that never contains the plaintext or encrypted header value, and omits newValue', async () => {
      const secretValue = 'about-to-be-deleted-secret-value';
      const encryptedValue = encryptHeaderValue(secretValue, encryptionKey);
      const headerToDelete: RouteHeader = {
        ...nonSensitiveRouteHeaderFixture,
        valueEncrypted: encryptedValue,
      };
      prisma.routeHeader.findUnique.mockResolvedValue(headerToDelete);
      prisma.routeHeader.delete.mockResolvedValue(headerToDelete);

      await service.remove(
        authenticatedAdminFixture,
        requestContext,
        headerToDelete.id,
      );

      const auditPayload = auditLogsService.create.mock.calls[0][0];
      const serializedAuditPayload = JSON.stringify(auditPayload);

      expect(serializedAuditPayload).not.toContain(secretValue);
      expect(serializedAuditPayload).not.toContain(encryptedValue);
      expect(auditPayload).not.toHaveProperty('newValue');
    });
  });
});
