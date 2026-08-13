import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AllowedIpType, Prisma } from '../../../generated/prisma/client';
import { AllowedIpsService } from '../../../src/modules/allowed-ips/allowed-ips.service';
import type { AllowedHostnameResolverService } from '../../../src/modules/allowed-ips/allowed-hostname-resolver.service';
import type { AuditLogsService } from '../../../src/modules/audit-logs/audit-logs.service';
import {
  activeAllowedIpFixture,
  buildAllowedIpFixture,
  hostnameAllowedIpFixture,
} from '../../fixtures/allowed-ips.fixture';
import { activeClientFixture, inactiveClientFixture } from '../../fixtures/clients.fixture';
import { authenticatedAdminFixture } from '../../fixtures/users.fixture';
import {
  createMockPrismaService,
  mockTransactionArray,
  resetMockPrismaService,
} from '../../helpers/prisma-mock.helper';
import type { MockPrismaService } from '../../helpers/prisma-mock.helper';

describe('AllowedIpsService', () => {
  let service: AllowedIpsService;
  let prisma: MockPrismaService;
  let auditLogsService: { create: jest.Mock };
  let allowedHostnameResolverService: { invalidate: jest.Mock };

  const requestContext = { sourceIp: '203.0.113.10', requestId: 'req-1' };

  beforeEach(() => {
    prisma = createMockPrismaService();
    auditLogsService = { create: jest.fn().mockResolvedValue(undefined) };
    allowedHostnameResolverService = { invalidate: jest.fn() };

    service = new AllowedIpsService(
      prisma,
      auditLogsService as unknown as AuditLogsService,
      allowedHostnameResolverService as unknown as AllowedHostnameResolverService,
    );
  });

  afterEach(() => {
    resetMockPrismaService(prisma);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('creates an allowed IP for an active client', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);
      prisma.allowedIp.findUnique.mockResolvedValue(null);
      prisma.allowedIp.create.mockResolvedValue(activeAllowedIpFixture);

      const result = await service.create(authenticatedAdminFixture, requestContext, {
        clientId: activeClientFixture.id,
        address: '203.0.113.50',
      });

      expect(result).toEqual(activeAllowedIpFixture);
      expect(auditLogsService.create).toHaveBeenCalledTimes(1);
      const auditPayload = auditLogsService.create.mock.calls[0][0];
      expect(auditPayload.description).toContain(activeAllowedIpFixture.address);
      expect(auditPayload.description).toContain(activeClientFixture.code);
    });

    it('throws NotFoundException when the client does not exist', async () => {
      prisma.client.findUnique.mockResolvedValue(null);

      await expect(
        service.create(authenticatedAdminFixture, requestContext, {
          clientId: 'missing-client',
          address: '203.0.113.50',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.allowedIp.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the client is inactive', async () => {
      prisma.client.findUnique.mockResolvedValue(inactiveClientFixture);

      await expect(
        service.create(authenticatedAdminFixture, requestContext, {
          clientId: inactiveClientFixture.id,
          address: '203.0.113.50',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.allowedIp.create).not.toHaveBeenCalled();
    });

    it('propagates the exception thrown by the address parser for an invalid address', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);

      await expect(
        service.create(authenticatedAdminFixture, requestContext, {
          clientId: activeClientFixture.id,
          address: 'not an ip or hostname!',
        }),
      ).rejects.toThrow('The provided IP address, CIDR network or hostname is invalid.');

      expect(prisma.allowedIp.create).not.toHaveBeenCalled();
    });

    it('creates an allowed hostname for an active client', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);
      prisma.allowedIp.findUnique.mockResolvedValue(null);
      prisma.allowedIp.create.mockResolvedValue(hostnameAllowedIpFixture);

      const result = await service.create(authenticatedAdminFixture, requestContext, {
        clientId: activeClientFixture.id,
        address: 'API.Cliente.COM.br',
      });

      expect(result).toEqual(hostnameAllowedIpFixture);
      expect(prisma.allowedIp.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            address: 'api.cliente.com.br',
            type: AllowedIpType.HOSTNAME,
          }),
        }),
      );
    });

    it('converts a PrismaClientValidationError on create into a coherent BadRequestException instead of a raw 500', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);
      prisma.allowedIp.findUnique.mockResolvedValue(null);
      prisma.allowedIp.create.mockRejectedValue(
        new Prisma.PrismaClientValidationError(
          "Invalid value for argument `type`. Expected AllowedIpType.",
          { clientVersion: '7.9.1' },
        ),
      );

      await expect(
        service.create(authenticatedAdminFixture, requestContext, {
          clientId: activeClientFixture.id,
          address: 'wdcnet.com.br',
        }),
      ).rejects.toMatchObject({
        response: { code: 'ALLOWED_IP_TYPE_NOT_SUPPORTED' },
      });
    });

    it('converts a P2002 PrismaClientKnownRequestError on create into ConflictException with ALLOWED_IP_ALREADY_EXISTS', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);
      prisma.allowedIp.findUnique.mockResolvedValue(null);
      prisma.allowedIp.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed.', {
          code: 'P2002',
          clientVersion: '7.9.1',
        }),
      );

      await expect(
        service.create(authenticatedAdminFixture, requestContext, {
          clientId: activeClientFixture.id,
          address: '203.0.113.77',
        }),
      ).rejects.toMatchObject({
        response: { code: 'ALLOWED_IP_ALREADY_EXISTS' },
      });
    });

    it('never leaks a raw Prisma error message to the caller on an unexpected persistence failure', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);
      prisma.allowedIp.findUnique.mockResolvedValue(null);
      prisma.allowedIp.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('relation "allowed_ips" does not exist', {
          code: 'P2021',
          clientVersion: '7.9.1',
        }),
      );

      await expect(
        service.create(authenticatedAdminFixture, requestContext, {
          clientId: activeClientFixture.id,
          address: '203.0.113.78',
        }),
      ).rejects.toMatchObject({
        response: { code: 'ALLOWED_IP_PERSISTENCE_FAILED' },
      });
    });

    it('throws ConflictException when the address is already allowed for the client', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);
      prisma.allowedIp.findUnique.mockResolvedValue(activeAllowedIpFixture);

      await expect(
        service.create(authenticatedAdminFixture, requestContext, {
          clientId: activeClientFixture.id,
          address: activeAllowedIpFixture.address,
        }),
      ).rejects.toThrow(ConflictException);

      expect(prisma.allowedIp.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('returns paginated items with computed totalPages', async () => {
      mockTransactionArray(prisma, [[activeAllowedIpFixture], 1]);

      const result = await service.findAll({
        page: 1,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });

      expect(result.items).toEqual([activeAllowedIpFixture]);
      expect(result.pagination).toEqual({ page: 1, limit: 10, total: 1, totalPages: 1 });
    });

    it('returns totalPages 0 when there are no results', async () => {
      mockTransactionArray(prisma, [[], 0]);

      const result = await service.findAll({
        page: 1,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });

      expect(result.pagination.totalPages).toBe(0);
    });

    it.each(['address', 'createdAt', 'updatedAt'] as const)(
      'applies the %s sort field without throwing',
      async (sortBy) => {
        mockTransactionArray(prisma, [[activeAllowedIpFixture], 1]);

        await expect(
          service.findAll({ page: 1, limit: 10, sortBy, sortOrder: 'asc' } as never),
        ).resolves.toBeDefined();
      },
    );

    it.each([
      { active: true },
      { clientId: activeAllowedIpFixture.clientId },
      { type: 'IPV4' },
      { search: '203.0.113.10' },
    ])('resolves when filtering by %j', async (filter) => {
      mockTransactionArray(prisma, [[activeAllowedIpFixture], 1]);

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
            active: 3,
            inactive: 1,
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
          active: 3,
          inactive: 1,
        },
      ]);
      expect(result.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
      expect(prisma.allowedIp.findMany).not.toHaveBeenCalled();
      expect(prisma.allowedIp.count).not.toHaveBeenCalled();
    });

    it('returns totalPages 0 when no client matches the aggregated filters', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([] as never).mockResolvedValueOnce([{ total: 0 }] as never);

      const result = await service.findClientsSummary({
        page: 1,
        limit: 20,
        search: 'missing',
        status: 'inactive',
        sortBy: 'inactive',
        sortOrder: 'desc',
      } as never);

      expect(result.items).toEqual([]);
      expect(result.pagination.totalPages).toBe(0);
    });
  });

  describe('findOne', () => {
    it('returns the allowed IP when found', async () => {
      prisma.allowedIp.findUnique.mockResolvedValue(activeAllowedIpFixture);

      await expect(service.findOne(activeAllowedIpFixture.id)).resolves.toEqual(
        activeAllowedIpFixture,
      );
    });

    it('throws NotFoundException when not found', async () => {
      prisma.allowedIp.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates the description without checking for address conflicts when the address is unchanged', async () => {
      prisma.allowedIp.findUnique.mockResolvedValue(activeAllowedIpFixture);
      prisma.allowedIp.update.mockResolvedValue({
        ...activeAllowedIpFixture,
        description: 'Updated description',
      });

      const result = await service.update(
        authenticatedAdminFixture,
        requestContext,
        activeAllowedIpFixture.id,
        { description: 'Updated description' },
      );

      expect(result.description).toBe('Updated description');
      expect(prisma.allowedIp.findUnique).toHaveBeenCalledTimes(1);
      expect(auditLogsService.create).toHaveBeenCalledTimes(1);
    });

    it('does not check for conflicts when the new address normalizes to the current address', async () => {
      prisma.allowedIp.findUnique.mockResolvedValue(activeAllowedIpFixture);
      prisma.allowedIp.update.mockResolvedValue(activeAllowedIpFixture);

      await service.update(
        authenticatedAdminFixture,
        requestContext,
        activeAllowedIpFixture.id,
        { address: activeAllowedIpFixture.address },
      );

      expect(prisma.allowedIp.findUnique).toHaveBeenCalledTimes(1);
    });

    it('updates the address when the new address has no conflict', async () => {
      prisma.allowedIp.findUnique
        .mockResolvedValueOnce(activeAllowedIpFixture)
        .mockResolvedValueOnce(null);
      prisma.allowedIp.update.mockResolvedValue({
        ...activeAllowedIpFixture,
        address: '203.0.113.99',
      });

      const result = await service.update(
        authenticatedAdminFixture,
        requestContext,
        activeAllowedIpFixture.id,
        { address: '203.0.113.99' },
      );

      expect(result.address).toBe('203.0.113.99');
      expect(prisma.allowedIp.findUnique).toHaveBeenCalledTimes(2);
      expect(prisma.allowedIp.update).toHaveBeenCalledTimes(1);
    });

    it('throws ConflictException when the new address is already allowed for the client', async () => {
      const conflictingAllowedIp = buildAllowedIpFixture({
        id: 'other-allowed-ip-id',
        address: '203.0.113.99',
      });
      prisma.allowedIp.findUnique
        .mockResolvedValueOnce(activeAllowedIpFixture)
        .mockResolvedValueOnce(conflictingAllowedIp);

      await expect(
        service.update(authenticatedAdminFixture, requestContext, activeAllowedIpFixture.id, {
          address: '203.0.113.99',
        }),
      ).rejects.toThrow(ConflictException);

      expect(prisma.allowedIp.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the allowed IP does not exist', async () => {
      prisma.allowedIp.findUnique.mockResolvedValue(null);

      await expect(
        service.update(authenticatedAdminFixture, requestContext, 'missing', {
          description: 'x',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('invalidates the hostname cache when a HOSTNAME address is changed to something else', async () => {
      prisma.allowedIp.findUnique
        .mockResolvedValueOnce(hostnameAllowedIpFixture)
        .mockResolvedValueOnce(null);
      prisma.allowedIp.update.mockResolvedValue({
        ...hostnameAllowedIpFixture,
        address: 'novo.cliente.com.br',
      });

      await service.update(authenticatedAdminFixture, requestContext, hostnameAllowedIpFixture.id, {
        address: 'novo.cliente.com.br',
      });

      expect(allowedHostnameResolverService.invalidate).toHaveBeenCalledWith(
        hostnameAllowedIpFixture.address,
      );
    });

    it('does not invalidate any cache when a HOSTNAME address is updated to the same value', async () => {
      prisma.allowedIp.findUnique.mockResolvedValue(hostnameAllowedIpFixture);
      prisma.allowedIp.update.mockResolvedValue(hostnameAllowedIpFixture);

      await service.update(authenticatedAdminFixture, requestContext, hostnameAllowedIpFixture.id, {
        address: hostnameAllowedIpFixture.address,
      });

      expect(allowedHostnameResolverService.invalidate).not.toHaveBeenCalled();
    });

    it('does not touch the hostname cache when updating a non-HOSTNAME entry', async () => {
      prisma.allowedIp.findUnique
        .mockResolvedValueOnce(activeAllowedIpFixture)
        .mockResolvedValueOnce(null);
      prisma.allowedIp.update.mockResolvedValue({
        ...activeAllowedIpFixture,
        address: '203.0.113.99',
      });

      await service.update(authenticatedAdminFixture, requestContext, activeAllowedIpFixture.id, {
        address: '203.0.113.99',
      });

      expect(allowedHostnameResolverService.invalidate).not.toHaveBeenCalled();
    });
  });

  describe('changeStatus', () => {
    it('returns the current record unchanged when the status is already the target value', async () => {
      const currentAllowedIp = { ...activeAllowedIpFixture, active: true, client: activeClientFixture };
      prisma.allowedIp.findUnique.mockResolvedValue(currentAllowedIp);

      const result = await service.changeStatus(
        authenticatedAdminFixture,
        requestContext,
        activeAllowedIpFixture.id,
        { active: true },
      );

      expect(result).toEqual(currentAllowedIp);
      expect(prisma.allowedIp.update).not.toHaveBeenCalled();
    });

    it('activates an inactive allowed IP whose client is active', async () => {
      const currentAllowedIp = { ...activeAllowedIpFixture, active: false, client: activeClientFixture };
      prisma.allowedIp.findUnique.mockResolvedValue(currentAllowedIp);
      prisma.allowedIp.update.mockResolvedValue({ ...currentAllowedIp, active: true });

      const result = await service.changeStatus(
        authenticatedAdminFixture,
        requestContext,
        activeAllowedIpFixture.id,
        { active: true },
      );

      expect(result.active).toBe(true);
      expect(auditLogsService.create).toHaveBeenCalledTimes(1);
    });

    it('throws BadRequestException when trying to activate an allowed IP of an inactive client', async () => {
      const currentAllowedIp = { ...activeAllowedIpFixture, active: false, client: inactiveClientFixture };
      prisma.allowedIp.findUnique.mockResolvedValue(currentAllowedIp);

      await expect(
        service.changeStatus(authenticatedAdminFixture, requestContext, activeAllowedIpFixture.id, {
          active: true,
        }),
      ).rejects.toThrow('Client is inactive.');

      expect(prisma.allowedIp.update).not.toHaveBeenCalled();
    });

    it('deactivates an active allowed IP without checking the client status', async () => {
      const currentAllowedIp = { ...activeAllowedIpFixture, active: true, client: inactiveClientFixture };
      prisma.allowedIp.findUnique.mockResolvedValue(currentAllowedIp);
      prisma.allowedIp.update.mockResolvedValue({ ...currentAllowedIp, active: false });

      const result = await service.changeStatus(
        authenticatedAdminFixture,
        requestContext,
        activeAllowedIpFixture.id,
        { active: false },
      );

      expect(result.active).toBe(false);
      expect(auditLogsService.create).toHaveBeenCalledTimes(1);
    });

    it('invalidates the hostname cache when deactivating a HOSTNAME entry', async () => {
      const currentAllowedIp = { ...hostnameAllowedIpFixture, active: true, client: activeClientFixture };
      prisma.allowedIp.findUnique.mockResolvedValue(currentAllowedIp);
      prisma.allowedIp.update.mockResolvedValue({ ...currentAllowedIp, active: false });

      await service.changeStatus(
        authenticatedAdminFixture,
        requestContext,
        hostnameAllowedIpFixture.id,
        { active: false },
      );

      expect(allowedHostnameResolverService.invalidate).toHaveBeenCalledWith(
        hostnameAllowedIpFixture.address,
      );
    });

    it('does not invalidate any cache when activating a HOSTNAME entry (resolved on demand)', async () => {
      const currentAllowedIp = { ...hostnameAllowedIpFixture, active: false, client: activeClientFixture };
      prisma.allowedIp.findUnique.mockResolvedValue(currentAllowedIp);
      prisma.allowedIp.update.mockResolvedValue({ ...currentAllowedIp, active: true });

      await service.changeStatus(
        authenticatedAdminFixture,
        requestContext,
        hostnameAllowedIpFixture.id,
        { active: true },
      );

      expect(allowedHostnameResolverService.invalidate).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('deletes the allowed IP and records an audit log', async () => {
      prisma.allowedIp.findUnique.mockResolvedValue(activeAllowedIpFixture);
      prisma.allowedIp.delete.mockResolvedValue(activeAllowedIpFixture);

      await service.remove(authenticatedAdminFixture, requestContext, activeAllowedIpFixture.id);

      expect(prisma.allowedIp.delete).toHaveBeenCalledWith({
        where: { id: activeAllowedIpFixture.id },
      });
      expect(auditLogsService.create).toHaveBeenCalledTimes(1);

      const auditPayload = auditLogsService.create.mock.calls[0][0];
      expect(auditPayload).toMatchObject({
        userId: authenticatedAdminFixture.id,
        action: 'DELETE',
        entity: 'ALLOWED_IP',
        entityId: activeAllowedIpFixture.id,
        previousValue: {
          clientId: activeAllowedIpFixture.clientId,
          address: activeAllowedIpFixture.address,
          type: activeAllowedIpFixture.type,
          active: activeAllowedIpFixture.active,
        },
        sourceIp: requestContext.sourceIp,
        requestId: requestContext.requestId,
      });
      expect(auditPayload.description).toContain(activeAllowedIpFixture.address);
    });

    it('does not include a newValue field in the audit payload', async () => {
      prisma.allowedIp.findUnique.mockResolvedValue(activeAllowedIpFixture);
      prisma.allowedIp.delete.mockResolvedValue(activeAllowedIpFixture);

      await service.remove(authenticatedAdminFixture, requestContext, activeAllowedIpFixture.id);

      const auditPayload = auditLogsService.create.mock.calls[0][0];
      expect(auditPayload).not.toHaveProperty('newValue');
    });

    it('throws NotFoundException when the allowed IP does not exist and never deletes', async () => {
      prisma.allowedIp.findUnique.mockResolvedValue(null);

      await expect(
        service.remove(authenticatedAdminFixture, requestContext, 'missing'),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.allowedIp.delete).not.toHaveBeenCalled();
      expect(auditLogsService.create).not.toHaveBeenCalled();
    });

    it('invalidates the hostname cache when deleting a HOSTNAME entry', async () => {
      prisma.allowedIp.findUnique.mockResolvedValue(hostnameAllowedIpFixture);
      prisma.allowedIp.delete.mockResolvedValue(hostnameAllowedIpFixture);

      await service.remove(authenticatedAdminFixture, requestContext, hostnameAllowedIpFixture.id);

      expect(allowedHostnameResolverService.invalidate).toHaveBeenCalledWith(
        hostnameAllowedIpFixture.address,
      );
    });

    it('does not touch the hostname cache when deleting a non-HOSTNAME entry', async () => {
      prisma.allowedIp.findUnique.mockResolvedValue(activeAllowedIpFixture);
      prisma.allowedIp.delete.mockResolvedValue(activeAllowedIpFixture);

      await service.remove(authenticatedAdminFixture, requestContext, activeAllowedIpFixture.id);

      expect(allowedHostnameResolverService.invalidate).not.toHaveBeenCalled();
    });
  });
});
