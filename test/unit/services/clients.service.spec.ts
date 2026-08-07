import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ClientsService } from '../../../src/modules/clients/clients.service';
import type { AuditLogsService } from '../../../src/modules/audit-logs/audit-logs.service';
import {
  activeClientFixture,
  buildClientFixture,
  inactiveClientFixture,
} from '../../fixtures/clients.fixture';
import { authenticatedAdminFixture } from '../../fixtures/users.fixture';
import {
  createMockPrismaService,
  mockTransactionArray,
  resetMockPrismaService,
} from '../../helpers/prisma-mock.helper';
import type { MockPrismaService } from '../../helpers/prisma-mock.helper';

describe('ClientsService', () => {
  let service: ClientsService;
  let prisma: MockPrismaService;
  let auditLogsService: { create: jest.Mock };

  const requestContext = { sourceIp: '203.0.113.10', requestId: 'req-1' };

  beforeEach(() => {
    prisma = createMockPrismaService();
    auditLogsService = { create: jest.fn().mockResolvedValue(undefined) };

    service = new ClientsService(
      prisma,
      auditLogsService as unknown as AuditLogsService,
    );
  });

  afterEach(() => {
    resetMockPrismaService(prisma);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('creates a client and returns it', async () => {
      prisma.client.findUnique.mockResolvedValue(null);
      prisma.client.create.mockResolvedValue(activeClientFixture);

      const result = await service.create(authenticatedAdminFixture, requestContext, {
        name: activeClientFixture.name,
      });

      expect(result).toEqual(activeClientFixture);
    });

    it('generates the code automatically from the name (accents, spaces and symbols stripped)', async () => {
      prisma.client.findUnique.mockResolvedValue(null);
      prisma.client.create.mockResolvedValue(activeClientFixture);

      await service.create(authenticatedAdminFixture, requestContext, {
        name: '  ACME   Comércio & Serviços  ',
      });

      expect(prisma.client.findUnique).toHaveBeenCalledWith({
        where: { code: 'acme-comercio-servicos' },
      });
      const createCall = prisma.client.create.mock.calls[0][0] as {
        data: { code: string };
      };
      expect(createCall.data.code).toBe('acme-comercio-servicos');
    });

    it('throws BadRequestException when the name has no letters or digits to derive a code from', async () => {
      await expect(
        service.create(authenticatedAdminFixture, requestContext, { name: '!!!' }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.client.findUnique).not.toHaveBeenCalled();
      expect(prisma.client.create).not.toHaveBeenCalled();
    });

    it('throws ConflictException with code CLIENT_CODE_ALREADY_EXISTS when the generated code already exists', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);

      await expect(
        service.create(authenticatedAdminFixture, requestContext, {
          name: activeClientFixture.name,
        }),
      ).rejects.toThrow(ConflictException);

      expect(prisma.client.create).not.toHaveBeenCalled();
    });

    it('records an audit log with the created client data', async () => {
      prisma.client.findUnique.mockResolvedValue(null);
      prisma.client.create.mockResolvedValue(activeClientFixture);

      await service.create(authenticatedAdminFixture, requestContext, {
        name: activeClientFixture.name,
      });

      expect(auditLogsService.create).toHaveBeenCalledWith({
        userId: authenticatedAdminFixture.id,
        action: 'CREATE',
        entity: 'CLIENT',
        entityId: activeClientFixture.id,
        newValue: {
          name: activeClientFixture.name,
          code: activeClientFixture.code,
          description: activeClientFixture.description,
          contactName: activeClientFixture.contactName,
          contactEmail: activeClientFixture.contactEmail,
          active: activeClientFixture.active,
        },
        sourceIp: requestContext.sourceIp,
        requestId: requestContext.requestId,
        description: `Client ${activeClientFixture.code} was created.`,
      });
    });
  });

  describe('findAll', () => {
    it('returns paginated items with computed totalPages', async () => {
      mockTransactionArray(prisma, [[activeClientFixture], 1]);

      const result = await service.findAll({
        page: 1,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      } as never);

      expect(result.items).toEqual([activeClientFixture]);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
    });

    it('returns totalPages 0 when there are no results', async () => {
      mockTransactionArray(prisma, [[], 0]);

      const result = await service.findAll({
        page: 1,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      } as never);

      expect(result.pagination.totalPages).toBe(0);
    });

    it('computes totalPages by rounding up when total is not a multiple of limit', async () => {
      mockTransactionArray(prisma, [[activeClientFixture], 11]);

      const result = await service.findAll({
        page: 1,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      } as never);

      expect(result.pagination.totalPages).toBe(2);
    });

    it.each(['name', 'code', 'createdAt', 'updatedAt'] as const)(
      'applies the %s sort field without throwing',
      async (sortBy) => {
        mockTransactionArray(prisma, [[activeClientFixture], 1]);

        await expect(
          service.findAll({
            page: 1,
            limit: 10,
            sortBy,
            sortOrder: 'asc',
          } as never),
        ).resolves.toBeDefined();
      },
    );

    it.each([
      { active: true },
      { name: 'partner' },
      { code: 'PARTNER' },
      { contactName: 'Jane' },
      { contactEmail: 'jane@example.com' },
      { search: 'partner' },
    ])('resolves when filtering by %j', async (filter) => {
      mockTransactionArray(prisma, [[activeClientFixture], 1]);

      await expect(
        service.findAll({
          page: 1,
          limit: 10,
          sortBy: 'createdAt',
          sortOrder: 'desc',
          ...filter,
        } as never),
      ).resolves.toBeDefined();
    });

    it('echoes every filter back in the response, defaulting absent ones to null', async () => {
      mockTransactionArray(prisma, [[], 0]);

      const result = await service.findAll({
        page: 1,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      } as never);

      expect(result.filters).toEqual({
        search: null,
        name: null,
        code: null,
        contactName: null,
        contactEmail: null,
        active: null,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });
    });
  });

  describe('findOne', () => {
    it('returns the client when found', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);

      await expect(service.findOne(activeClientFixture.id)).resolves.toEqual(
        activeClientFixture,
      );
    });

    it('throws NotFoundException when not found', async () => {
      prisma.client.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('updates partial fields and returns the updated client', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);
      const updatedClient = buildClientFixture({ name: 'Renamed Client' });
      prisma.client.update.mockResolvedValue(updatedClient);

      const result = await service.update(
        authenticatedAdminFixture,
        requestContext,
        activeClientFixture.id,
        { name: 'Renamed Client' },
      );

      expect(result).toEqual(updatedClient);
      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: activeClientFixture.id },
        data: { name: 'Renamed Client' },
        select: expect.any(Object),
      });
    });

    it('never checks for code conflicts or includes code in the update payload, since it is immutable', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);
      const updatedClient = buildClientFixture({ name: 'Renamed Client' });
      prisma.client.update.mockResolvedValue(updatedClient);

      await service.update(authenticatedAdminFixture, requestContext, activeClientFixture.id, {
        name: 'Renamed Client',
      });

      expect(prisma.client.findFirst).not.toHaveBeenCalled();
      const updateCall = prisma.client.update.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(updateCall.data).not.toHaveProperty('code');
    });

    it('throws NotFoundException when the client does not exist', async () => {
      prisma.client.findUnique.mockResolvedValue(null);

      await expect(
        service.update(authenticatedAdminFixture, requestContext, 'missing', {
          name: 'x',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.client.update).not.toHaveBeenCalled();
    });

    it('records an audit log with previous and new values', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);
      const updatedClient = buildClientFixture({ name: 'Renamed Client' });
      prisma.client.update.mockResolvedValue(updatedClient);

      await service.update(
        authenticatedAdminFixture,
        requestContext,
        activeClientFixture.id,
        {
          name: 'Renamed Client',
        },
      );

      expect(auditLogsService.create).toHaveBeenCalledWith({
        userId: authenticatedAdminFixture.id,
        action: 'UPDATE',
        entity: 'CLIENT',
        entityId: updatedClient.id,
        previousValue: {
          name: activeClientFixture.name,
          code: activeClientFixture.code,
          description: activeClientFixture.description,
          contactName: activeClientFixture.contactName,
          contactEmail: activeClientFixture.contactEmail,
          active: activeClientFixture.active,
        },
        newValue: {
          name: updatedClient.name,
          code: updatedClient.code,
          description: updatedClient.description,
          contactName: updatedClient.contactName,
          contactEmail: updatedClient.contactEmail,
          active: updatedClient.active,
        },
        sourceIp: requestContext.sourceIp,
        requestId: requestContext.requestId,
        description: `Client ${updatedClient.code} was updated.`,
      });
    });
  });

  describe('changeStatus', () => {
    it('returns the current record unchanged when the status is already the target value', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);

      const result = await service.changeStatus(
        authenticatedAdminFixture,
        requestContext,
        activeClientFixture.id,
        { active: true },
      );

      expect(result).toEqual(activeClientFixture);
      expect(prisma.client.update).not.toHaveBeenCalled();
      expect(auditLogsService.create).not.toHaveBeenCalled();
    });

    it('activates an inactive client and records an ACTIVATE audit log', async () => {
      prisma.client.findUnique.mockResolvedValue(inactiveClientFixture);
      const activatedClient = buildClientFixture({
        id: inactiveClientFixture.id,
        code: inactiveClientFixture.code,
        active: true,
      });
      prisma.client.update.mockResolvedValue(activatedClient);

      const result = await service.changeStatus(
        authenticatedAdminFixture,
        requestContext,
        inactiveClientFixture.id,
        { active: true },
      );

      expect(result).toEqual(activatedClient);
      expect(auditLogsService.create).toHaveBeenCalledWith({
        userId: authenticatedAdminFixture.id,
        action: 'ACTIVATE',
        entity: 'CLIENT',
        entityId: activatedClient.id,
        previousValue: { active: inactiveClientFixture.active },
        newValue: { active: activatedClient.active },
        sourceIp: requestContext.sourceIp,
        requestId: requestContext.requestId,
        description: `Client ${activatedClient.code} was activated.`,
      });
    });

    it('deactivates an active client and records a DEACTIVATE audit log', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);
      const deactivatedClient = buildClientFixture({ active: false });
      prisma.client.update.mockResolvedValue(deactivatedClient);

      const result = await service.changeStatus(
        authenticatedAdminFixture,
        requestContext,
        activeClientFixture.id,
        { active: false },
      );

      expect(result).toEqual(deactivatedClient);
      expect(auditLogsService.create).toHaveBeenCalledWith({
        userId: authenticatedAdminFixture.id,
        action: 'DEACTIVATE',
        entity: 'CLIENT',
        entityId: deactivatedClient.id,
        previousValue: { active: activeClientFixture.active },
        newValue: { active: deactivatedClient.active },
        sourceIp: requestContext.sourceIp,
        requestId: requestContext.requestId,
        description: `Client ${deactivatedClient.code} was deactivated.`,
      });
    });

    it('throws NotFoundException when the client does not exist', async () => {
      prisma.client.findUnique.mockResolvedValue(null);

      await expect(
        service.changeStatus(
          authenticatedAdminFixture,
          requestContext,
          'missing',
          {
            active: true,
          },
        ),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.client.update).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes the client and records a DELETE audit log when there are no dependencies', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);
      prisma.apiKey.count.mockResolvedValue(0);
      prisma.allowedIp.count.mockResolvedValue(0);
      prisma.gatewayRoute.count.mockResolvedValue(0);

      await service.remove(authenticatedAdminFixture, requestContext, activeClientFixture.id);

      expect(prisma.client.delete).toHaveBeenCalledWith({
        where: { id: activeClientFixture.id },
      });
      expect(auditLogsService.create).toHaveBeenCalledWith({
        userId: authenticatedAdminFixture.id,
        action: 'DELETE',
        entity: 'CLIENT',
        entityId: activeClientFixture.id,
        previousValue: {
          name: activeClientFixture.name,
          code: activeClientFixture.code,
          active: activeClientFixture.active,
        },
        sourceIp: requestContext.sourceIp,
        requestId: requestContext.requestId,
        description: `Client ${activeClientFixture.code} was deleted.`,
      });
    });

    it('throws NotFoundException when the client does not exist', async () => {
      prisma.client.findUnique.mockResolvedValue(null);

      await expect(
        service.remove(authenticatedAdminFixture, requestContext, 'missing'),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.client.delete).not.toHaveBeenCalled();
    });

    it.each([
      { apiKeyCount: 1, allowedIpCount: 0, gatewayRouteCount: 0 },
      { apiKeyCount: 0, allowedIpCount: 1, gatewayRouteCount: 0 },
      { apiKeyCount: 0, allowedIpCount: 0, gatewayRouteCount: 1 },
    ])(
      'throws ConflictException with code CLIENT_HAS_DEPENDENCIES when dependencies exist (%j)',
      async ({ apiKeyCount, allowedIpCount, gatewayRouteCount }) => {
        prisma.client.findUnique.mockResolvedValue(activeClientFixture);
        prisma.apiKey.count.mockResolvedValue(apiKeyCount);
        prisma.allowedIp.count.mockResolvedValue(allowedIpCount);
        prisma.gatewayRoute.count.mockResolvedValue(gatewayRouteCount);

        await expect(
          service.remove(authenticatedAdminFixture, requestContext, activeClientFixture.id),
        ).rejects.toThrow(ConflictException);

        expect(prisma.client.delete).not.toHaveBeenCalled();
        expect(auditLogsService.create).not.toHaveBeenCalled();
      },
    );

    it('never includes sensitive fields in the audit payload', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);
      prisma.apiKey.count.mockResolvedValue(0);
      prisma.allowedIp.count.mockResolvedValue(0);
      prisma.gatewayRoute.count.mockResolvedValue(0);

      await service.remove(authenticatedAdminFixture, requestContext, activeClientFixture.id);

      const auditPayload = auditLogsService.create.mock.calls[0][0];
      expect(auditPayload).not.toHaveProperty('contactEmail');
    });
  });
});
