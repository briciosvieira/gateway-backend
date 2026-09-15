import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, AuditEntity, GatewayHttpMethod } from '../../../generated/prisma/client';
import { GatewayRoutesService } from '../../../src/modules/gateway-routes/gateway-routes.service';
import type { AuditLogsService } from '../../../src/modules/audit-logs/audit-logs.service';
import type { ChangeGatewayRouteStatusDto } from '../../../src/modules/gateway-routes/dto/change-gateway-route-status.dto';
import type { CreateGatewayRouteDto } from '../../../src/modules/gateway-routes/dto/create-gateway-route.dto';
import type { UpdateGatewayRouteDto } from '../../../src/modules/gateway-routes/dto/update-gateway-route.dto';
import { buildGatewayPublicPath } from '../../../src/modules/gateway-routes/utils/gateway-route-slug.util';
import { activeClientFixture, inactiveClientFixture } from '../../fixtures/clients.fixture';
import {
  activeGatewayRouteFixture,
  inactiveGatewayRouteFixture,
  noApiKeyGatewayRouteFixture,
} from '../../fixtures/gateway-routes.fixture';
import {
  authenticatedAdminFixture,
  authenticatedOperatorFixture,
} from '../../fixtures/users.fixture';
import {
  createMockPrismaService,
  mockTransactionArray,
  resetMockPrismaService,
} from '../../helpers/prisma-mock.helper';
import type { MockPrismaService } from '../../helpers/prisma-mock.helper';

describe('GatewayRoutesService', () => {
  let service: GatewayRoutesService;
  let prisma: MockPrismaService;
  let auditLogsService: { create: jest.Mock };

  const requestContext = { sourceIp: '203.0.113.10', requestId: 'req-1' };

  const createDto: CreateGatewayRouteDto = {
    name: 'Fixture Route',
    slug: '/fixture-route',
    destinationUrl: 'http://upstream.internal.test/webhook',
    method: GatewayHttpMethod.POST,
    clientId: activeClientFixture.id,
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    auditLogsService = { create: jest.fn().mockResolvedValue(undefined) };

    service = new GatewayRoutesService(prisma, auditLogsService as unknown as AuditLogsService);
  });

  afterEach(() => {
    resetMockPrismaService(prisma);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('creates a gateway route for an active client and returns it with the computed publicPath', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);
      prisma.gatewayRoute.findUnique.mockResolvedValue(null);
      prisma.gatewayRoute.create.mockResolvedValue(activeGatewayRouteFixture);

      const result = await service.create(authenticatedAdminFixture, requestContext, createDto);

      expect(result).toEqual({
        ...activeGatewayRouteFixture,
        publicPath: buildGatewayPublicPath(activeGatewayRouteFixture.slug),
      });
      expect(auditLogsService.create).toHaveBeenCalledTimes(1);
    });

    it('creates the gateway route with default timeoutMs and retryCount when not provided in the dto', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);
      prisma.gatewayRoute.findUnique.mockResolvedValue(null);
      prisma.gatewayRoute.create.mockResolvedValue(activeGatewayRouteFixture);

      const dtoWithoutDefaults: CreateGatewayRouteDto = {
        name: 'Fixture Route',
        slug: '/fixture-route',
        destinationUrl: 'http://upstream.internal.test/webhook',
        method: GatewayHttpMethod.POST,
        clientId: activeClientFixture.id,
      };

      await service.create(authenticatedAdminFixture, requestContext, dtoWithoutDefaults);

      expect(prisma.gatewayRoute.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ timeoutMs: 30000, retryCount: 0 }),
        }),
      );
    });

    it('defaults requiresAllowedIp to true when not provided in the dto', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);
      prisma.gatewayRoute.findUnique.mockResolvedValue(null);
      prisma.gatewayRoute.create.mockResolvedValue(activeGatewayRouteFixture);

      await service.create(authenticatedAdminFixture, requestContext, createDto);

      expect(prisma.gatewayRoute.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ requiresAllowedIp: true }),
        }),
      );
    });

    it('persists requiresAllowedIp: false without requiring ADMIN (no permission gate on this field)', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);
      prisma.gatewayRoute.findUnique.mockResolvedValue(null);
      prisma.gatewayRoute.create.mockResolvedValue({
        ...activeGatewayRouteFixture,
        requiresAllowedIp: false,
      });

      const result = await service.create(authenticatedOperatorFixture, requestContext, {
        ...createDto,
        requiresAllowedIp: false,
      });

      expect(result.requiresAllowedIp).toBe(false);
      expect(prisma.gatewayRoute.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ requiresAllowedIp: false }),
        }),
      );
    });

    it('throws NotFoundException when the client does not exist', async () => {
      prisma.client.findUnique.mockResolvedValue(null);

      await expect(
        service.create(authenticatedAdminFixture, requestContext, {
          ...createDto,
          clientId: 'missing-client',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the client is inactive', async () => {
      prisma.client.findUnique.mockResolvedValue(inactiveClientFixture);

      await expect(
        service.create(authenticatedAdminFixture, requestContext, {
          ...createDto,
          clientId: inactiveClientFixture.id,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when a gateway route with the same slug already exists', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);
      prisma.gatewayRoute.findUnique.mockResolvedValue(activeGatewayRouteFixture);

      await expect(
        service.create(authenticatedAdminFixture, requestContext, createDto),
      ).rejects.toThrow(ConflictException);
    });

    it('creates the gateway route with requiresApiKey=true by default when not provided', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);
      prisma.gatewayRoute.findUnique.mockResolvedValue(null);
      prisma.gatewayRoute.create.mockResolvedValue(activeGatewayRouteFixture);

      await service.create(authenticatedAdminFixture, requestContext, createDto);

      expect(prisma.gatewayRoute.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ requiresApiKey: true }),
        }),
      );
    });

    it('allows ADMIN to create a gateway route with requiresApiKey=false', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);
      prisma.gatewayRoute.findUnique.mockResolvedValue(null);
      prisma.gatewayRoute.create.mockResolvedValue(noApiKeyGatewayRouteFixture);

      const result = await service.create(authenticatedAdminFixture, requestContext, {
        ...createDto,
        requiresApiKey: false,
      });

      expect(result.requiresApiKey).toBe(false);
      expect(prisma.gatewayRoute.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ requiresApiKey: false }),
        }),
      );
      expect(auditLogsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          newValue: expect.objectContaining({ requiresApiKey: false }),
        }),
      );
    });

    it('throws ForbiddenException when an OPERATOR tries to create a route with requiresApiKey=false', async () => {
      prisma.client.findUnique.mockResolvedValue(activeClientFixture);

      await expect(
        service.create(authenticatedOperatorFixture, requestContext, {
          ...createDto,
          requiresApiKey: false,
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.gatewayRoute.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('returns paginated items mapped with the computed publicPath', async () => {
      mockTransactionArray(prisma, [[activeGatewayRouteFixture], 1]);

      const result = await service.findAll({
        page: 1,
        limit: 10,
        sortBy: 'createdAt',
        sortOrder: 'desc',
      } as never);

      expect(result.items).toEqual([
        {
          ...activeGatewayRouteFixture,
          publicPath: buildGatewayPublicPath(activeGatewayRouteFixture.slug),
        },
      ]);
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

      expect(result.items).toEqual([]);
      expect(result.pagination.totalPages).toBe(0);
    });

    it.each(['name', 'slug', 'createdAt', 'updatedAt', 'timeoutMs'] as const)(
      'applies the %s sort field without throwing',
      async (sortBy) => {
        mockTransactionArray(prisma, [[activeGatewayRouteFixture], 1]);

        await expect(
          service.findAll({ page: 1, limit: 10, sortBy, sortOrder: 'asc' } as never),
        ).resolves.toBeDefined();
      },
    );

    it.each([
      { active: true },
      { clientId: activeGatewayRouteFixture.clientId },
      { method: 'POST' },
      { search: 'send-whatsapp' },
    ])('resolves when filtering by %j', async (filter) => {
      mockTransactionArray(prisma, [[activeGatewayRouteFixture], 1]);

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
            total: 2,
            active: 2,
            inactive: 0,
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
          total: 2,
          active: 2,
          inactive: 0,
        },
      ]);
      expect(result.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
      expect(prisma.gatewayRoute.findMany).not.toHaveBeenCalled();
      expect(prisma.gatewayRoute.count).not.toHaveBeenCalled();
    });

    it('returns totalPages 0 when no client matches the aggregated filters', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([] as never).mockResolvedValueOnce([{ total: 0 }] as never);

      const result = await service.findClientsSummary({
        page: 1,
        limit: 20,
        search: 'missing',
        status: 'inactive',
        sortBy: 'total',
        sortOrder: 'desc',
      } as never);

      expect(result.items).toEqual([]);
      expect(result.pagination.totalPages).toBe(0);
    });
  });

  describe('findOne', () => {
    it('returns the gateway route with the computed publicPath when found', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(activeGatewayRouteFixture);

      await expect(service.findOne(activeGatewayRouteFixture.id)).resolves.toEqual({
        ...activeGatewayRouteFixture,
        publicPath: buildGatewayPublicPath(activeGatewayRouteFixture.slug),
      });
    });

    it('throws NotFoundException when not found', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates fields without touching the slug when it is not provided in the dto', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(activeGatewayRouteFixture);
      prisma.gatewayRoute.update.mockResolvedValue({
        ...activeGatewayRouteFixture,
        name: 'Renamed Route',
      });

      const dto: UpdateGatewayRouteDto = { name: 'Renamed Route' };

      const result = await service.update(
        authenticatedAdminFixture,
        requestContext,
        activeGatewayRouteFixture.id,
        dto,
      );

      expect(result.name).toBe('Renamed Route');
      expect(result.publicPath).toBe(buildGatewayPublicPath(activeGatewayRouteFixture.slug));
      expect(prisma.gatewayRoute.findUnique).toHaveBeenCalledTimes(1);
    });

    it('updates the slug when it changes and there is no conflict', async () => {
      prisma.gatewayRoute.findUnique
        .mockResolvedValueOnce(activeGatewayRouteFixture)
        .mockResolvedValueOnce(null);
      prisma.gatewayRoute.update.mockResolvedValue({
        ...activeGatewayRouteFixture,
        slug: '/new-slug',
      });

      const dto: UpdateGatewayRouteDto = { slug: '/new-slug' };

      const result = await service.update(
        authenticatedAdminFixture,
        requestContext,
        activeGatewayRouteFixture.id,
        dto,
      );

      expect(result.slug).toBe('/new-slug');
      expect(result.publicPath).toBe(buildGatewayPublicPath('/new-slug'));
      expect(prisma.gatewayRoute.findUnique).toHaveBeenCalledTimes(2);
    });

    it('throws ConflictException when the new slug conflicts with an existing route', async () => {
      prisma.gatewayRoute.findUnique
        .mockResolvedValueOnce(activeGatewayRouteFixture)
        .mockResolvedValueOnce(inactiveGatewayRouteFixture);

      const dto: UpdateGatewayRouteDto = { slug: inactiveGatewayRouteFixture.slug };

      await expect(
        service.update(authenticatedAdminFixture, requestContext, activeGatewayRouteFixture.id, dto),
      ).rejects.toThrow(ConflictException);
      expect(prisma.gatewayRoute.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the gateway route does not exist', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(null);

      await expect(
        service.update(authenticatedAdminFixture, requestContext, 'missing', { name: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('allows ADMIN to change requiresApiKey from true to false and records a dedicated audit log', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(activeGatewayRouteFixture);
      prisma.gatewayRoute.update.mockResolvedValue({
        ...activeGatewayRouteFixture,
        requiresApiKey: false,
      });

      const result = await service.update(
        authenticatedAdminFixture,
        requestContext,
        activeGatewayRouteFixture.id,
        { requiresApiKey: false },
      );

      expect(result.requiresApiKey).toBe(false);
      expect(auditLogsService.create).toHaveBeenCalledTimes(2);
      expect(auditLogsService.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          description: expect.stringContaining('API Key requirement disabled'),
          previousValue: expect.objectContaining({ requiresApiKey: true }),
          newValue: expect.objectContaining({ requiresApiKey: false }),
        }),
      );
    });

    it('allows ADMIN to change requiresApiKey from false to true and records a dedicated audit log', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(noApiKeyGatewayRouteFixture);
      prisma.gatewayRoute.update.mockResolvedValue({
        ...noApiKeyGatewayRouteFixture,
        requiresApiKey: true,
      });

      const result = await service.update(
        authenticatedAdminFixture,
        requestContext,
        noApiKeyGatewayRouteFixture.id,
        { requiresApiKey: true },
      );

      expect(result.requiresApiKey).toBe(true);
      expect(auditLogsService.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          description: expect.stringContaining('API Key requirement enabled'),
          previousValue: expect.objectContaining({ requiresApiKey: false }),
          newValue: expect.objectContaining({ requiresApiKey: true }),
        }),
      );
    });

    it('throws ForbiddenException when an OPERATOR tries to change requiresApiKey from true to false', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(activeGatewayRouteFixture);

      await expect(
        service.update(
          authenticatedOperatorFixture,
          requestContext,
          activeGatewayRouteFixture.id,
          { requiresApiKey: false },
        ),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.gatewayRoute.update).not.toHaveBeenCalled();
    });

    it('does not require ADMIN when an OPERATOR updates other fields without touching requiresApiKey', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(noApiKeyGatewayRouteFixture);
      prisma.gatewayRoute.update.mockResolvedValue({
        ...noApiKeyGatewayRouteFixture,
        name: 'Renamed by operator',
      });

      const result = await service.update(
        authenticatedOperatorFixture,
        requestContext,
        noApiKeyGatewayRouteFixture.id,
        { name: 'Renamed by operator' },
      );

      expect(result.name).toBe('Renamed by operator');
      expect(prisma.gatewayRoute.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ requiresApiKey: expect.anything() }),
        }),
      );
    });

    it('does not throw when a non-ADMIN sends requiresApiKey equal to the current value', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(activeGatewayRouteFixture);
      prisma.gatewayRoute.update.mockResolvedValue(activeGatewayRouteFixture);

      await expect(
        service.update(
          authenticatedOperatorFixture,
          requestContext,
          activeGatewayRouteFixture.id,
          { requiresApiKey: true },
        ),
      ).resolves.toBeDefined();
    });

    it('updates requiresAllowedIp when provided, without requiring ADMIN', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(activeGatewayRouteFixture);
      prisma.gatewayRoute.update.mockResolvedValue({
        ...activeGatewayRouteFixture,
        requiresAllowedIp: false,
      });

      const result = await service.update(
        authenticatedOperatorFixture,
        requestContext,
        activeGatewayRouteFixture.id,
        { requiresAllowedIp: false },
      );

      expect(result.requiresAllowedIp).toBe(false);
      expect(prisma.gatewayRoute.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ requiresAllowedIp: false }),
        }),
      );
    });

    it('leaves requiresAllowedIp untouched when omitted from the update dto', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(activeGatewayRouteFixture);
      prisma.gatewayRoute.update.mockResolvedValue({
        ...activeGatewayRouteFixture,
        name: 'Renamed Route',
      });

      await service.update(authenticatedAdminFixture, requestContext, activeGatewayRouteFixture.id, {
        name: 'Renamed Route',
      });

      expect(prisma.gatewayRoute.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({ requiresAllowedIp: expect.anything() }),
        }),
      );
    });
  });

  describe('changeStatus', () => {
    it('returns the current record unchanged when the status is already the target value', async () => {
      const routeWithClient = { ...activeGatewayRouteFixture, client: activeClientFixture };
      prisma.gatewayRoute.findUnique.mockResolvedValue(routeWithClient);

      const dto: ChangeGatewayRouteStatusDto = { active: true };

      const result = await service.changeStatus(
        authenticatedAdminFixture,
        requestContext,
        activeGatewayRouteFixture.id,
        dto,
      );

      expect(result).toEqual({
        ...routeWithClient,
        publicPath: buildGatewayPublicPath(routeWithClient.slug),
      });
      expect(prisma.gatewayRoute.update).not.toHaveBeenCalled();
    });

    it('activates an inactive route when its client is active', async () => {
      const inactiveRouteWithActiveClient = {
        ...inactiveGatewayRouteFixture,
        client: activeClientFixture,
      };
      prisma.gatewayRoute.findUnique.mockResolvedValue(inactiveRouteWithActiveClient);
      prisma.gatewayRoute.update.mockResolvedValue({
        ...inactiveRouteWithActiveClient,
        active: true,
      });

      const dto: ChangeGatewayRouteStatusDto = { active: true };

      const result = await service.changeStatus(
        authenticatedAdminFixture,
        requestContext,
        inactiveGatewayRouteFixture.id,
        dto,
      );

      expect(result.active).toBe(true);
      expect(result.publicPath).toBe(buildGatewayPublicPath(inactiveRouteWithActiveClient.slug));
    });

    it('throws BadRequestException when activating a route whose client is inactive', async () => {
      const inactiveRouteWithInactiveClient = {
        ...inactiveGatewayRouteFixture,
        client: inactiveClientFixture,
      };
      prisma.gatewayRoute.findUnique.mockResolvedValue(inactiveRouteWithInactiveClient);

      const dto: ChangeGatewayRouteStatusDto = { active: true };

      await expect(
        service.changeStatus(
          authenticatedAdminFixture,
          requestContext,
          inactiveGatewayRouteFixture.id,
          dto,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.gatewayRoute.update).not.toHaveBeenCalled();
    });

    it('deactivates an active route regardless of the client status', async () => {
      const activeRouteWithClient = { ...activeGatewayRouteFixture, client: activeClientFixture };
      prisma.gatewayRoute.findUnique.mockResolvedValue(activeRouteWithClient);
      prisma.gatewayRoute.update.mockResolvedValue({
        ...activeRouteWithClient,
        active: false,
      });

      const dto: ChangeGatewayRouteStatusDto = { active: false };

      const result = await service.changeStatus(
        authenticatedAdminFixture,
        requestContext,
        activeGatewayRouteFixture.id,
        dto,
      );

      expect(result.active).toBe(false);
    });
  });

  describe('remove', () => {
    it('deletes the gateway route and records an audit log when it has no route headers', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(activeGatewayRouteFixture);
      prisma.routeHeader.count.mockResolvedValue(0);
      prisma.gatewayRoute.delete.mockResolvedValue(activeGatewayRouteFixture);

      await service.remove(
        authenticatedAdminFixture,
        requestContext,
        activeGatewayRouteFixture.id,
      );

      expect(prisma.routeHeader.count).toHaveBeenCalledWith({
        where: { gatewayRouteId: activeGatewayRouteFixture.id },
      });
      expect(prisma.gatewayRoute.delete).toHaveBeenCalledWith({
        where: { id: activeGatewayRouteFixture.id },
      });
      expect(auditLogsService.create).toHaveBeenCalledTimes(1);
      expect(auditLogsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditAction.DELETE,
          entity: AuditEntity.GATEWAY_ROUTE,
          entityId: activeGatewayRouteFixture.id,
          previousValue: {
            clientId: activeGatewayRouteFixture.clientId,
            name: activeGatewayRouteFixture.name,
            slug: activeGatewayRouteFixture.slug,
            method: activeGatewayRouteFixture.method,
            active: activeGatewayRouteFixture.active,
            requiresApiKey: activeGatewayRouteFixture.requiresApiKey,
            requiresAllowedIp: activeGatewayRouteFixture.requiresAllowedIp,
          },
        }),
      );
    });

    it('does not pass a newValue in the audit log payload', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(activeGatewayRouteFixture);
      prisma.routeHeader.count.mockResolvedValue(0);
      prisma.gatewayRoute.delete.mockResolvedValue(activeGatewayRouteFixture);

      await service.remove(
        authenticatedAdminFixture,
        requestContext,
        activeGatewayRouteFixture.id,
      );

      const auditPayload = auditLogsService.create.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(auditPayload).not.toHaveProperty('newValue');
    });

    it('throws NotFoundException when the gateway route does not exist and never deletes it', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(null);

      await expect(
        service.remove(authenticatedAdminFixture, requestContext, 'missing'),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.gatewayRoute.delete).not.toHaveBeenCalled();
    });

    it('throws ConflictException with GATEWAY_ROUTE_HAS_DEPENDENCIES when it still has route headers', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(activeGatewayRouteFixture);
      prisma.routeHeader.count.mockResolvedValue(2);

      await expect(
        service.remove(authenticatedAdminFixture, requestContext, activeGatewayRouteFixture.id),
      ).rejects.toThrow(ConflictException);

      try {
        await service.remove(
          authenticatedAdminFixture,
          requestContext,
          activeGatewayRouteFixture.id,
        );
      } catch (error) {
        expect((error as ConflictException).getResponse()).toEqual({
          message:
            'Gateway route cannot be deleted while it still has Route Headers. Remove those first.',
          code: 'GATEWAY_ROUTE_HAS_DEPENDENCIES',
        });
      }

      expect(prisma.gatewayRoute.delete).not.toHaveBeenCalled();
      expect(auditLogsService.create).not.toHaveBeenCalled();
    });
  });
});
