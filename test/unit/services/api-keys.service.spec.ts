import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { ApiKeysService } from '../../../src/modules/api-keys/api-keys.service';
import type { AuditLogsService } from '../../../src/modules/audit-logs/audit-logs.service';
import { activeApiKeyFixture, revokedApiKeyFixture } from '../../fixtures/api-keys.fixture';
import { activeClientFixture, inactiveClientFixture } from '../../fixtures/clients.fixture';
import { authenticatedAdminFixture } from '../../fixtures/users.fixture';
import {
  createMockPrismaService,
  mockTransactionArray,
  resetMockPrismaService,
} from '../../helpers/prisma-mock.helper';
import type { MockPrismaService } from '../../helpers/prisma-mock.helper';

describe('ApiKeysService', () => {
  let service: ApiKeysService;
  let prisma: MockPrismaService;
  let auditLogsService: { create: jest.Mock };
  let configService: { get: jest.Mock };

  const requestContext = { sourceIp: '203.0.113.10', requestId: 'req-1' };

  beforeEach(() => {
    prisma = createMockPrismaService();
    auditLogsService = { create: jest.fn().mockResolvedValue(undefined) };
    configService = { get: jest.fn().mockReturnValue('test-pepper') };

    service = new ApiKeysService(
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
    it('creates an API Key for an active client and returns the full key once', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);
      prisma.apiKey.create.mockResolvedValue(activeApiKeyFixture);

      const result = await service.create(authenticatedAdminFixture, requestContext, {
        clientId: activeClientFixture.id,
        name: 'Integration Key',
      });

      expect(result.apiKey).toEqual(activeApiKeyFixture);
      expect(result.key).toMatch(/^ghlf_[0-9a-f]{8}_.+$/);
      expect(result.warning).toContain('It will not be displayed again.');
    });

    it('records an audit log without ever including the API Key prefix', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);
      prisma.apiKey.create.mockResolvedValue(activeApiKeyFixture);

      await service.create(authenticatedAdminFixture, requestContext, {
        clientId: activeClientFixture.id,
        name: 'Integration Key',
      });

      const auditPayload = auditLogsService.create.mock.calls[0][0];

      expect(JSON.stringify(auditPayload)).not.toContain('prefix');
      expect(JSON.stringify(auditPayload)).not.toContain(activeApiKeyFixture.prefix);
      expect(auditPayload.description).toContain(activeApiKeyFixture.name);
    });

    it('throws NotFoundException when the client does not exist', async () => {
      prisma.client.findUnique.mockResolvedValue(null);

      await expect(
        service.create(authenticatedAdminFixture, requestContext, {
          clientId: 'missing-client',
          name: 'Key',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the client is inactive', async () => {
      prisma.client.findUnique.mockResolvedValue(inactiveClientFixture);

      await expect(
        service.create(authenticatedAdminFixture, requestContext, {
          clientId: inactiveClientFixture.id,
          name: 'Key',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for a past expiresAt', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);

      await expect(
        service.create(authenticatedAdminFixture, requestContext, {
          clientId: activeClientFixture.id,
          name: 'Key',
          expiresAt: '2020-01-01T00:00:00.000Z',
        }),
      ).rejects.toThrow('expiresAt must be a future date.');
    });

    it('throws when API_KEY_PEPPER is not configured', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);
      configService.get.mockReturnValue(undefined);

      await expect(
        service.create(authenticatedAdminFixture, requestContext, {
          clientId: activeClientFixture.id,
          name: 'Key',
        }),
      ).rejects.toThrow('API_KEY_PEPPER is not configured.');
    });
  });

  describe('findAll', () => {
    it('returns paginated items with computed totalPages', async () => {
      mockTransactionArray(prisma, [[activeApiKeyFixture], 1]);

      const result = await service.findAll({
        page: 1,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      } as never);

      expect(result.items).toEqual([activeApiKeyFixture]);
      expect(result.pagination).toEqual({ page: 1, limit: 10, total: 1, totalPages: 1 });
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

    it.each(['name', 'createdAt', 'updatedAt', 'expiresAt', 'lastUsedAt'] as const)(
      'applies the %s sort field without throwing',
      async (sortBy) => {
        mockTransactionArray(prisma, [[activeApiKeyFixture], 1]);

        await expect(
          service.findAll({ page: 1, limit: 10, sortBy, sortOrder: 'asc' } as never),
        ).resolves.toBeDefined();
      },
    );

    it.each([
      { active: true },
      { clientId: activeClientFixture.id },
      { prefix: 'ghlf_' },
      { search: 'Integration' },
      { expiresFrom: '2026-01-01T00:00:00.000Z' },
      { expiresTo: '2027-01-01T00:00:00.000Z' },
      { expiresFrom: '2026-01-01T00:00:00.000Z', expiresTo: '2027-01-01T00:00:00.000Z' },
    ])('resolves when filtering by %j', async (filter) => {
      mockTransactionArray(prisma, [[activeApiKeyFixture], 1]);

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
  });

  describe('findClientsSummary', () => {
    it('returns aggregated client rows using exactly two raw queries', async () => {
      prisma.$queryRaw
        .mockResolvedValueOnce([
          {
            clientId: activeClientFixture.id,
            clientName: activeClientFixture.name,
            clientCode: activeClientFixture.code,
            clientActive: activeClientFixture.active,
            total: 4,
            active: 2,
            inactive: 1,
            revoked: 1,
          },
        ] as never)
        .mockResolvedValueOnce([{ total: 1 }] as never);

      const result = await service.findClientsSummary({
        page: 1,
        limit: 20,
        sortBy: 'clientName',
        sortOrder: 'asc',
      } as never);

      expect(result.items).toEqual([
        {
          client: {
            id: activeClientFixture.id,
            name: activeClientFixture.name,
            code: activeClientFixture.code,
            active: activeClientFixture.active,
          },
          total: 4,
          active: 2,
          inactive: 1,
          revoked: 1,
        },
      ]);
      expect(result.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
      expect(result.filters).toEqual({
        search: null,
        status: null,
        sortBy: 'clientName',
        sortOrder: 'asc',
      });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
      expect(prisma.apiKey.findMany).not.toHaveBeenCalled();
      expect(prisma.apiKey.count).not.toHaveBeenCalled();
    });

    it('returns totalPages 0 when no client matches the aggregated filters', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([] as never).mockResolvedValueOnce([{ total: 0 }] as never);

      const result = await service.findClientsSummary({
        page: 1,
        limit: 20,
        search: 'missing',
        status: 'inactive',
        sortBy: 'revoked',
        sortOrder: 'desc',
      } as never);

      expect(result.items).toEqual([]);
      expect(result.pagination.totalPages).toBe(0);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    });
  });

  describe('findOne', () => {
    it('returns the API Key when found', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(activeApiKeyFixture);

      await expect(service.findOne(activeApiKeyFixture.id)).resolves.toEqual(activeApiKeyFixture);
    });

    it('throws NotFoundException when not found', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates the name and records an audit log without the prefix', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(activeApiKeyFixture);
      prisma.apiKey.update.mockResolvedValue({ ...activeApiKeyFixture, name: 'Renamed' });

      const result = await service.update(authenticatedAdminFixture, requestContext, activeApiKeyFixture.id, {
        name: 'Renamed',
      });

      expect(result.name).toBe('Renamed');
      const auditPayload = auditLogsService.create.mock.calls[0][0];
      expect(JSON.stringify(auditPayload)).not.toContain(activeApiKeyFixture.prefix);
    });

    it('throws NotFoundException when the API Key does not exist', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(null);

      await expect(
        service.update(authenticatedAdminFixture, requestContext, 'missing', { name: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('changeStatus', () => {
    it('returns the current record unchanged when the status is already the target value', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(activeApiKeyFixture);

      const result = await service.changeStatus(
        authenticatedAdminFixture,
        requestContext,
        activeApiKeyFixture.id,
        { active: true },
      );

      expect(result).toEqual(activeApiKeyFixture);
      expect(prisma.apiKey.update).not.toHaveBeenCalled();
    });

    it('activates an inactive, non-revoked, non-expired key of an active client', async () => {
      const inactiveKey = { ...activeApiKeyFixture, active: false, client: activeClientFixture };
      prisma.apiKey.findUnique.mockResolvedValue(inactiveKey);
      prisma.apiKey.update.mockResolvedValue({ ...inactiveKey, active: true });

      const result = await service.changeStatus(
        authenticatedAdminFixture,
        requestContext,
        activeApiKeyFixture.id,
        { active: true },
      );

      expect(result.active).toBe(true);
    });

    it('throws BadRequestException when trying to reactivate a revoked key', async () => {
      prisma.apiKey.findUnique.mockResolvedValue({ ...revokedApiKeyFixture, active: false });

      await expect(
        service.changeStatus(authenticatedAdminFixture, requestContext, revokedApiKeyFixture.id, {
          active: true,
        }),
      ).rejects.toThrow('A revoked API Key cannot be reactivated.');
    });

    it('throws BadRequestException when trying to activate an expired key', async () => {
      prisma.apiKey.findUnique.mockResolvedValue({
        ...activeApiKeyFixture,
        active: false,
        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
      });

      await expect(
        service.changeStatus(authenticatedAdminFixture, requestContext, activeApiKeyFixture.id, {
          active: true,
        }),
      ).rejects.toThrow('An expired API Key cannot be activated.');
    });

    it('throws BadRequestException when the client is inactive', async () => {
      const keyWithInactiveClient = {
        ...activeApiKeyFixture,
        active: false,
        client: inactiveClientFixture,
      };
      prisma.apiKey.findUnique.mockResolvedValue(keyWithInactiveClient);

      await expect(
        service.changeStatus(authenticatedAdminFixture, requestContext, activeApiKeyFixture.id, {
          active: true,
        }),
      ).rejects.toThrow('Client is inactive.');
    });
  });

  describe('revoke', () => {
    it('revokes an active key', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(activeApiKeyFixture);
      prisma.apiKey.update.mockResolvedValue({
        ...activeApiKeyFixture,
        active: false,
        revokedAt: new Date(),
      });

      const result = await service.revoke(authenticatedAdminFixture, requestContext, activeApiKeyFixture.id);

      expect(result.active).toBe(false);
      expect(result.revokedAt).not.toBeNull();
    });

    it('is idempotent for an already-revoked key', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(revokedApiKeyFixture);

      const result = await service.revoke(
        authenticatedAdminFixture,
        requestContext,
        revokedApiKeyFixture.id,
      );

      expect(result).toEqual(revokedApiKeyFixture);
      expect(prisma.apiKey.update).not.toHaveBeenCalled();
    });
  });

  describe('regenerate', () => {
    it('creates a new key and revokes the previous one by default', async () => {
      prisma.apiKey.findUnique.mockResolvedValueOnce(activeApiKeyFixture);
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);
      const newKeyRecord = { ...activeApiKeyFixture, id: 'new-key-id', prefix: 'ghlf_newkey01' };
      prisma.apiKey.create.mockResolvedValue(newKeyRecord);
      // revoke() internally re-fetches the current key by id.
      prisma.apiKey.findUnique.mockResolvedValueOnce(activeApiKeyFixture);
      prisma.apiKey.update.mockResolvedValue({
        ...activeApiKeyFixture,
        active: false,
        revokedAt: new Date(),
      });

      const result = await service.regenerate(
        authenticatedAdminFixture,
        requestContext,
        activeApiKeyFixture.id,
        {},
      );

      expect(result.apiKey).toEqual(newKeyRecord);
      expect(result.previousApiKeyRevoked).toBe(true);
      expect(result.key).toMatch(/^ghlf_[0-9a-f]{8}_.+$/);
    });

    it('does not revoke the previous key when revokePrevious is false', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(activeApiKeyFixture);
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);
      prisma.apiKey.create.mockResolvedValue({ ...activeApiKeyFixture, id: 'new-key-id' });

      const result = await service.regenerate(
        authenticatedAdminFixture,
        requestContext,
        activeApiKeyFixture.id,
        { revokePrevious: false },
      );

      expect(result.previousApiKeyRevoked).toBe(false);
      expect(prisma.apiKey.update).not.toHaveBeenCalled();
    });

    it('never leaks the prefix in the regeneration audit payload', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(activeApiKeyFixture);
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);
      prisma.apiKey.create.mockResolvedValue({ ...activeApiKeyFixture, id: 'new-key-id' });

      await service.regenerate(authenticatedAdminFixture, requestContext, activeApiKeyFixture.id, {
        revokePrevious: false,
      });

      const auditPayload = auditLogsService.create.mock.calls[0][0];
      expect(JSON.stringify(auditPayload)).not.toContain(activeApiKeyFixture.prefix);
    });
  });

  describe('remove', () => {
    it('deletes the API Key and records an audit log', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(activeApiKeyFixture);
      prisma.apiKey.delete.mockResolvedValue(activeApiKeyFixture);

      await service.remove(authenticatedAdminFixture, requestContext, activeApiKeyFixture.id);

      expect(prisma.apiKey.delete).toHaveBeenCalledWith({
        where: { id: activeApiKeyFixture.id },
      });

      const auditPayload = auditLogsService.create.mock.calls[0][0];
      expect(auditPayload.action).toBe('DELETE');
      expect(auditPayload.entity).toBe('API_KEY');
    });

    it('throws NotFoundException when the API Key does not exist and never calls delete', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(null);

      await expect(
        service.remove(authenticatedAdminFixture, requestContext, 'missing'),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.apiKey.delete).not.toHaveBeenCalled();
    });

    it('never includes the API Key prefix in the audit payload', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(activeApiKeyFixture);
      prisma.apiKey.delete.mockResolvedValue(activeApiKeyFixture);

      await service.remove(authenticatedAdminFixture, requestContext, activeApiKeyFixture.id);

      const auditPayload = auditLogsService.create.mock.calls[0][0];
      expect(JSON.stringify(auditPayload)).not.toContain('prefix');
      expect(JSON.stringify(auditPayload)).not.toContain(activeApiKeyFixture.prefix);
    });

    it('does not pass newValue in the audit payload', async () => {
      prisma.apiKey.findUnique.mockResolvedValue(activeApiKeyFixture);
      prisma.apiKey.delete.mockResolvedValue(activeApiKeyFixture);

      await service.remove(authenticatedAdminFixture, requestContext, activeApiKeyFixture.id);

      const auditPayload = auditLogsService.create.mock.calls[0][0];
      expect(auditPayload.newValue).toBeUndefined();
      expect(auditPayload.previousValue).toEqual({
        name: activeApiKeyFixture.name,
        clientId: activeApiKeyFixture.clientId,
        active: activeApiKeyFixture.active,
      });
    });
  });
});
