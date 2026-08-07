import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import type { ApiResponse } from '../../src/common/interfaces/api-response.interface';
import { AllowedIpType, GatewayHttpMethod, RoleCode } from '../../generated/prisma/client';
import { createTestApiKey } from '../helpers/factories/api-key.factory';
import { createTestUser } from '../helpers/factories/user.factory';
import { signTestAccessToken } from '../helpers/jwt.helper';
import { authorizedGet } from '../helpers/request.helper';
import { createTestApp } from '../helpers/test-app.helper';
import { TestDatabase } from '../helpers/test-database.helper';

interface SummaryClient {
  id: string;
  name: string;
  code: string;
  active: boolean;
}

interface SummaryPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface SummaryFilters {
  search: string | null;
  status: 'active' | 'inactive' | null;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

interface ApiKeyClientSummaryItem {
  client: SummaryClient;
  total: number;
  active: number;
  inactive: number;
  revoked: number;
}

interface AllowedIpClientSummaryItem {
  client: SummaryClient;
  total: number;
  active: number;
  inactive: number;
}

interface GatewayRouteClientSummaryItem {
  client: SummaryClient;
  total: number;
  active: number;
  inactive: number;
}

interface PaginatedSummaryResponse<T> {
  items: T[];
  pagination: SummaryPagination;
  filters: SummaryFilters;
}

describe('Client Resource Summaries (integration)', () => {
  let app: NestFastifyApplication;
  let db: TestDatabase;
  let adminToken: string;
  let adminUserId: string;

  beforeAll(async () => {
    db = new TestDatabase();
    await db.connect();
    app = await createTestApp();

    const { user } = await createTestUser(db, { roleCode: RoleCode.ADMIN });
    adminUserId = user.id;
    adminToken = signTestAccessToken({
      id: user.id,
      username: user.username,
      email: user.email,
      role: RoleCode.ADMIN,
      roleLevel: 100,
      firstLogin: false,
    });
  });

  afterAll(async () => {
    await db.prisma.user.deleteMany({ where: { id: adminUserId } });
    await app.close();
    await db.disconnect();
  });

  describe('GET /api-keys/clients-summary', () => {
    const createdClientIds: string[] = [];
    const createdApiKeyIds: string[] = [];

    afterAll(async () => {
      if (createdApiKeyIds.length > 0) {
        await db.prisma.apiKey.deleteMany({ where: { id: { in: createdApiKeyIds } } });
      }

      if (createdClientIds.length > 0) {
        await db.prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
      }
    });

    it('returns only clients with API Keys and computes active, inactive and revoked counts correctly', async () => {
      const prefix = `ak-summary-${randomUUID().slice(0, 8)}`;
      const clients = await Promise.all([
        db.prisma.client.create({
          data: {
            id: '00000000-0000-0000-0000-000000000101',
            name: `${prefix}-A`,
            code: `${prefix.toUpperCase()}_A`,
            active: true,
          },
        }),
        db.prisma.client.create({
          data: {
            id: '00000000-0000-0000-0000-000000000102',
            name: `${prefix}-B`,
            code: `${prefix.toUpperCase()}_B`,
            active: false,
          },
        }),
        db.prisma.client.create({
          data: {
            id: '00000000-0000-0000-0000-000000000103',
            name: `${prefix}-C`,
            code: `${prefix.toUpperCase()}_C`,
            active: true,
          },
        }),
        db.prisma.client.create({
          data: {
            id: '00000000-0000-0000-0000-000000000104',
            name: `${prefix}-D`,
            code: `${prefix.toUpperCase()}_D`,
            active: true,
          },
        }),
      ]);
      createdClientIds.push(...clients.map((client) => client.id));

      const [a1, a2, a3, a4, b1, b2, d1] = await Promise.all([
        createTestApiKey(db, clients[0].id, { active: true }),
        createTestApiKey(db, clients[0].id, { active: true }),
        createTestApiKey(db, clients[0].id, { active: false }),
        createTestApiKey(db, clients[0].id, {
          active: false,
          revokedAt: new Date('2026-08-06T10:00:00.000Z'),
        }),
        createTestApiKey(db, clients[1].id, { active: false }),
        createTestApiKey(db, clients[1].id, {
          active: true,
          expiresAt: new Date('2026-08-06T10:00:00.000Z'),
        }),
        createTestApiKey(db, clients[3].id, { active: true }),
      ]);
      createdApiKeyIds.push(a1.apiKey.id, a2.apiKey.id, a3.apiKey.id, a4.apiKey.id, b1.apiKey.id, b2.apiKey.id, d1.apiKey.id);

      const response = await authorizedGet(
        app,
        `/api/v1/api-keys/clients-summary?search=${encodeURIComponent(prefix)}&sortBy=clientName&sortOrder=asc`,
        adminToken,
      );

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<PaginatedSummaryResponse<ApiKeyClientSummaryItem>>;
      expect(body.data.pagination.total).toBe(3);
      expect(body.data.items.map((item) => item.client.name)).toEqual([
        `${prefix}-A`,
        `${prefix}-B`,
        `${prefix}-D`,
      ]);
      expect(body.data.items).toEqual([
        {
          client: expect.objectContaining({ id: clients[0].id, name: `${prefix}-A` }),
          total: 4,
          active: 2,
          inactive: 1,
          revoked: 1,
        },
        {
          client: expect.objectContaining({ id: clients[1].id, name: `${prefix}-B` }),
          total: 2,
          active: 0,
          inactive: 2,
          revoked: 0,
        },
        {
          client: expect.objectContaining({ id: clients[3].id, name: `${prefix}-D` }),
          total: 1,
          active: 1,
          inactive: 0,
          revoked: 0,
        },
      ]);
      expect(body.data.items.some((item) => item.client.id === clients[2].id)).toBe(false);
    });

    it('applies aggregated status, search and stable ordering correctly', async () => {
      const prefix = `ak-filters-${randomUUID().slice(0, 8)}`;
      const codeClient = await db.prisma.client.create({
        data: {
          id: '00000000-0000-0000-0000-000000000111',
          name: `${prefix}-Code`,
          code: `${prefix.toUpperCase()}_CODE`,
          active: true,
        },
      });
      const inactiveClient = await db.prisma.client.create({
        data: {
          id: '00000000-0000-0000-0000-000000000112',
          name: `${prefix}-Inactive`,
          code: `${prefix.toUpperCase()}_INACTIVE`,
          active: true,
        },
      });
      const tieLowId = await db.prisma.client.create({
        data: {
          id: '00000000-0000-0000-0000-000000000113',
          name: `${prefix}-Tie-Z`,
          code: `${prefix.toUpperCase()}_TIE_Z`,
          active: true,
        },
      });
      const tieHighId = await db.prisma.client.create({
        data: {
          id: '00000000-0000-0000-0000-000000000114',
          name: `${prefix}-Tie-A`,
          code: `${prefix.toUpperCase()}_TIE_A`,
          active: true,
        },
      });
      createdClientIds.push(codeClient.id, inactiveClient.id, tieLowId.id, tieHighId.id);

      const created = await Promise.all([
        createTestApiKey(db, codeClient.id, { active: true }),
        createTestApiKey(db, inactiveClient.id, { active: false }),
        createTestApiKey(db, tieLowId.id, { active: true }),
        createTestApiKey(db, tieLowId.id, { active: false }),
        createTestApiKey(db, tieLowId.id, {
          active: false,
          revokedAt: new Date('2026-08-06T10:00:00.000Z'),
        }),
        createTestApiKey(db, tieHighId.id, { active: true }),
        createTestApiKey(db, tieHighId.id, { active: false }),
        createTestApiKey(db, tieHighId.id, {
          active: false,
          revokedAt: new Date('2026-08-06T10:00:00.000Z'),
        }),
      ]);
      createdApiKeyIds.push(...created.map((entry) => entry.apiKey.id));

      const activeResponse = await authorizedGet(
        app,
        `/api/v1/api-keys/clients-summary?search=${encodeURIComponent(prefix)}&status=active`,
        adminToken,
      );
      const activeBody = activeResponse.body as ApiResponse<
        PaginatedSummaryResponse<ApiKeyClientSummaryItem>
      >;
      expect(activeBody.data.items.map((item) => item.client.id)).toEqual([
        codeClient.id,
        tieHighId.id,
        tieLowId.id,
      ]);

      const inactiveResponse = await authorizedGet(
        app,
        `/api/v1/api-keys/clients-summary?search=${encodeURIComponent(prefix)}&status=inactive`,
        adminToken,
      );
      const inactiveBody = inactiveResponse.body as ApiResponse<
        PaginatedSummaryResponse<ApiKeyClientSummaryItem>
      >;
      expect(inactiveBody.data.items.map((item) => item.client.id)).toEqual([inactiveClient.id]);

      const searchByCodeResponse = await authorizedGet(
        app,
        `/api/v1/api-keys/clients-summary?search=${encodeURIComponent(codeClient.code)}`,
        adminToken,
      );
      const searchByCodeBody = searchByCodeResponse.body as ApiResponse<
        PaginatedSummaryResponse<ApiKeyClientSummaryItem>
      >;
      expect(searchByCodeBody.data.items).toHaveLength(1);
      expect(searchByCodeBody.data.items[0]?.client.id).toBe(codeClient.id);

      const tieResponse = await authorizedGet(
        app,
        `/api/v1/api-keys/clients-summary?search=${encodeURIComponent(`${prefix}-Tie`)}&sortBy=total&sortOrder=desc`,
        adminToken,
      );
      const tieBody = tieResponse.body as ApiResponse<
        PaginatedSummaryResponse<ApiKeyClientSummaryItem>
      >;
      expect(tieBody.data.items.map((item) => item.client.id)).toEqual([
        tieLowId.id,
        tieHighId.id,
      ]);
    });

    it('supports exact pagination after aggregation', async () => {
      const prefix = `ak-page-${randomUUID().slice(0, 8)}`;

      for (let index = 0; index < 25; index += 1) {
        const client = await db.prisma.client.create({
          data: {
            name: `${prefix}-${String(index).padStart(2, '0')}`,
            code: `${prefix.toUpperCase()}_${String(index).padStart(2, '0')}`,
            active: true,
          },
        });
        createdClientIds.push(client.id);

        const created = await createTestApiKey(db, client.id, { active: true });
        createdApiKeyIds.push(created.apiKey.id);
      }

      const pageOneResponse = await authorizedGet(
        app,
        `/api/v1/api-keys/clients-summary?search=${encodeURIComponent(prefix)}&page=1&limit=20&sortBy=clientName&sortOrder=asc`,
        adminToken,
      );
      const pageTwoResponse = await authorizedGet(
        app,
        `/api/v1/api-keys/clients-summary?search=${encodeURIComponent(prefix)}&page=2&limit=20&sortBy=clientName&sortOrder=asc`,
        adminToken,
      );

      const pageOneBody = pageOneResponse.body as ApiResponse<
        PaginatedSummaryResponse<ApiKeyClientSummaryItem>
      >;
      const pageTwoBody = pageTwoResponse.body as ApiResponse<
        PaginatedSummaryResponse<ApiKeyClientSummaryItem>
      >;

      expect(pageOneBody.data.items).toHaveLength(20);
      expect(pageTwoBody.data.items).toHaveLength(5);
      expect(pageOneBody.data.pagination.total).toBe(25);
      expect(pageTwoBody.data.pagination.total).toBe(25);
    });
  });

  describe('GET /allowed-ips/clients-summary', () => {
    const createdClientIds: string[] = [];
    const createdAllowedIpIds: string[] = [];

    afterAll(async () => {
      if (createdAllowedIpIds.length > 0) {
        await db.prisma.allowedIp.deleteMany({ where: { id: { in: createdAllowedIpIds } } });
      }

      if (createdClientIds.length > 0) {
        await db.prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
      }
    });

    it('returns only clients with Allowed IPs and computes aggregated counts correctly', async () => {
      const prefix = `ip-summary-${randomUUID().slice(0, 8)}`;
      const [clientA, clientB, clientC, clientD] = await Promise.all([
        db.prisma.client.create({
          data: {
            id: '00000000-0000-0000-0000-000000000201',
            name: `${prefix}-A`,
            code: `${prefix.toUpperCase()}_A`,
            active: true,
          },
        }),
        db.prisma.client.create({
          data: {
            id: '00000000-0000-0000-0000-000000000202',
            name: `${prefix}-B`,
            code: `${prefix.toUpperCase()}_B`,
            active: true,
          },
        }),
        db.prisma.client.create({
          data: {
            id: '00000000-0000-0000-0000-000000000203',
            name: `${prefix}-C`,
            code: `${prefix.toUpperCase()}_C`,
            active: true,
          },
        }),
        db.prisma.client.create({
          data: {
            id: '00000000-0000-0000-0000-000000000204',
            name: `${prefix}-D`,
            code: `${prefix.toUpperCase()}_D`,
            active: false,
          },
        }),
      ]);
      createdClientIds.push(clientA.id, clientB.id, clientC.id, clientD.id);

      const createdIps = await Promise.all([
        db.prisma.allowedIp.create({
          data: { clientId: clientA.id, address: '10.10.0.1', type: AllowedIpType.IPV4, active: true },
        }),
        db.prisma.allowedIp.create({
          data: { clientId: clientA.id, address: '10.10.0.2', type: AllowedIpType.IPV4, active: true },
        }),
        db.prisma.allowedIp.create({
          data: { clientId: clientA.id, address: '10.10.0.3', type: AllowedIpType.IPV4, active: true },
        }),
        db.prisma.allowedIp.create({
          data: { clientId: clientA.id, address: '10.10.0.4', type: AllowedIpType.IPV4, active: false },
        }),
        db.prisma.allowedIp.create({
          data: { clientId: clientB.id, address: '10.20.0.1', type: AllowedIpType.IPV4, active: false },
        }),
        db.prisma.allowedIp.create({
          data: { clientId: clientB.id, address: '10.20.0.2', type: AllowedIpType.IPV4, active: false },
        }),
        db.prisma.allowedIp.create({
          data: { clientId: clientD.id, address: '10.40.0.1', type: AllowedIpType.IPV4, active: true },
        }),
      ]);
      createdAllowedIpIds.push(...createdIps.map((item) => item.id));

      const response = await authorizedGet(
        app,
        `/api/v1/allowed-ips/clients-summary?search=${encodeURIComponent(prefix)}&sortBy=clientName&sortOrder=asc`,
        adminToken,
      );

      expect(response.status).toBe(200);
      const body = response.body as ApiResponse<
        PaginatedSummaryResponse<AllowedIpClientSummaryItem>
      >;
      expect(body.data.pagination.total).toBe(3);
      expect(body.data.items).toEqual([
        {
          client: expect.objectContaining({ id: clientA.id, name: `${prefix}-A` }),
          total: 4,
          active: 3,
          inactive: 1,
        },
        {
          client: expect.objectContaining({ id: clientB.id, name: `${prefix}-B` }),
          total: 2,
          active: 0,
          inactive: 2,
        },
        {
          client: expect.objectContaining({ id: clientD.id, name: `${prefix}-D` }),
          total: 1,
          active: 1,
          inactive: 0,
        },
      ]);
      expect(body.data.items.some((item) => item.client.id === clientC.id)).toBe(false);
    });

    it('applies aggregated status, search, stable ordering and exact pagination', async () => {
      const prefix = `ip-filters-${randomUUID().slice(0, 8)}`;
      const lowIdClient = await db.prisma.client.create({
        data: {
          id: '00000000-0000-0000-0000-000000000211',
          name: `${prefix}-Tie-Z`,
          code: `${prefix.toUpperCase()}_TIE_Z`,
          active: true,
        },
      });
      const highIdClient = await db.prisma.client.create({
        data: {
          id: '00000000-0000-0000-0000-000000000212',
          name: `${prefix}-Tie-A`,
          code: `${prefix.toUpperCase()}_TIE_A`,
          active: true,
        },
      });
      const inactiveClient = await db.prisma.client.create({
        data: {
          id: '00000000-0000-0000-0000-000000000213',
          name: `${prefix}-Inactive`,
          code: `${prefix.toUpperCase()}_INACTIVE`,
          active: true,
        },
      });
      createdClientIds.push(lowIdClient.id, highIdClient.id, inactiveClient.id);

      const ips = await Promise.all([
        db.prisma.allowedIp.create({
          data: { clientId: lowIdClient.id, address: '10.50.0.1', type: AllowedIpType.IPV4, active: true },
        }),
        db.prisma.allowedIp.create({
          data: { clientId: lowIdClient.id, address: '10.50.0.2', type: AllowedIpType.IPV4, active: false },
        }),
        db.prisma.allowedIp.create({
          data: { clientId: highIdClient.id, address: '10.60.0.1', type: AllowedIpType.IPV4, active: true },
        }),
        db.prisma.allowedIp.create({
          data: { clientId: highIdClient.id, address: '10.60.0.2', type: AllowedIpType.IPV4, active: false },
        }),
        db.prisma.allowedIp.create({
          data: { clientId: inactiveClient.id, address: '10.70.0.1', type: AllowedIpType.IPV4, active: false },
        }),
      ]);
      createdAllowedIpIds.push(...ips.map((item) => item.id));

      const activeResponse = await authorizedGet(
        app,
        `/api/v1/allowed-ips/clients-summary?search=${encodeURIComponent(prefix)}&status=active`,
        adminToken,
      );
      const activeBody = activeResponse.body as ApiResponse<
        PaginatedSummaryResponse<AllowedIpClientSummaryItem>
      >;
      expect(activeBody.data.items.map((item) => item.client.id)).toEqual([
        highIdClient.id,
        lowIdClient.id,
      ]);

      const inactiveResponse = await authorizedGet(
        app,
        `/api/v1/allowed-ips/clients-summary?search=${encodeURIComponent(prefix)}&status=inactive`,
        adminToken,
      );
      const inactiveBody = inactiveResponse.body as ApiResponse<
        PaginatedSummaryResponse<AllowedIpClientSummaryItem>
      >;
      expect(inactiveBody.data.items.map((item) => item.client.id)).toEqual([inactiveClient.id]);

      const codeSearchResponse = await authorizedGet(
        app,
        `/api/v1/allowed-ips/clients-summary?search=${encodeURIComponent(highIdClient.code)}`,
        adminToken,
      );
      const codeSearchBody = codeSearchResponse.body as ApiResponse<
        PaginatedSummaryResponse<AllowedIpClientSummaryItem>
      >;
      expect(codeSearchBody.data.items).toHaveLength(1);
      expect(codeSearchBody.data.items[0]?.client.id).toBe(highIdClient.id);

      const tieResponse = await authorizedGet(
        app,
        `/api/v1/allowed-ips/clients-summary?search=${encodeURIComponent(`${prefix}-Tie`)}&sortBy=total&sortOrder=desc`,
        adminToken,
      );
      const tieBody = tieResponse.body as ApiResponse<
        PaginatedSummaryResponse<AllowedIpClientSummaryItem>
      >;
      expect(tieBody.data.items.map((item) => item.client.id)).toEqual([
        lowIdClient.id,
        highIdClient.id,
      ]);

      const paginationPrefix = `ip-page-${randomUUID().slice(0, 8)}`;
      for (let index = 0; index < 25; index += 1) {
        const client = await db.prisma.client.create({
          data: {
            name: `${paginationPrefix}-${String(index).padStart(2, '0')}`,
            code: `${paginationPrefix.toUpperCase()}_${String(index).padStart(2, '0')}`,
            active: true,
          },
        });
        createdClientIds.push(client.id);

        const allowedIp = await db.prisma.allowedIp.create({
          data: {
            clientId: client.id,
            address: `172.16.${Math.floor(index / 255)}.${(index % 255) + 1}`,
            type: AllowedIpType.IPV4,
            active: true,
          },
        });
        createdAllowedIpIds.push(allowedIp.id);
      }

      const pageOneResponse = await authorizedGet(
        app,
        `/api/v1/allowed-ips/clients-summary?search=${encodeURIComponent(paginationPrefix)}&page=1&limit=20&sortBy=clientName&sortOrder=asc`,
        adminToken,
      );
      const pageTwoResponse = await authorizedGet(
        app,
        `/api/v1/allowed-ips/clients-summary?search=${encodeURIComponent(paginationPrefix)}&page=2&limit=20&sortBy=clientName&sortOrder=asc`,
        adminToken,
      );
      const pageOneBody = pageOneResponse.body as ApiResponse<
        PaginatedSummaryResponse<AllowedIpClientSummaryItem>
      >;
      const pageTwoBody = pageTwoResponse.body as ApiResponse<
        PaginatedSummaryResponse<AllowedIpClientSummaryItem>
      >;
      expect(pageOneBody.data.items).toHaveLength(20);
      expect(pageTwoBody.data.items).toHaveLength(5);
      expect(pageOneBody.data.pagination.total).toBe(25);
      expect(pageTwoBody.data.pagination.total).toBe(25);
    });
  });

  describe('GET /gateway-routes/clients-summary', () => {
    const createdClientIds: string[] = [];
    const createdGatewayRouteIds: string[] = [];

    afterAll(async () => {
      if (createdGatewayRouteIds.length > 0) {
        await db.prisma.gatewayRoute.deleteMany({
          where: { id: { in: createdGatewayRouteIds } },
        });
      }

      if (createdClientIds.length > 0) {
        await db.prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
      }
    });

    it('returns only clients with Gateway Routes and computes aggregated counts correctly', async () => {
      const prefix = `route-summary-${randomUUID().slice(0, 8)}`;
      const [clientA, clientB, clientC, clientD] = await Promise.all([
        db.prisma.client.create({
          data: {
            id: '00000000-0000-0000-0000-000000000301',
            name: `${prefix}-A`,
            code: `${prefix.toUpperCase()}_A`,
            active: true,
          },
        }),
        db.prisma.client.create({
          data: {
            id: '00000000-0000-0000-0000-000000000302',
            name: `${prefix}-B`,
            code: `${prefix.toUpperCase()}_B`,
            active: true,
          },
        }),
        db.prisma.client.create({
          data: {
            id: '00000000-0000-0000-0000-000000000303',
            name: `${prefix}-C`,
            code: `${prefix.toUpperCase()}_C`,
            active: true,
          },
        }),
        db.prisma.client.create({
          data: {
            id: '00000000-0000-0000-0000-000000000304',
            name: `${prefix}-D`,
            code: `${prefix.toUpperCase()}_D`,
            active: false,
          },
        }),
      ]);
      createdClientIds.push(clientA.id, clientB.id, clientC.id, clientD.id);

      const createdRoutes = await Promise.all([
        db.prisma.gatewayRoute.create({
          data: {
            clientId: clientA.id,
            name: `${prefix}-a1`,
            slug: `/${prefix}-a1`,
            destinationUrl: 'http://127.0.0.1:9/a1',
            method: GatewayHttpMethod.GET,
            active: true,
          },
        }),
        db.prisma.gatewayRoute.create({
          data: {
            clientId: clientA.id,
            name: `${prefix}-a2`,
            slug: `/${prefix}-a2`,
            destinationUrl: 'http://127.0.0.1:9/a2',
            method: GatewayHttpMethod.GET,
            active: true,
          },
        }),
        db.prisma.gatewayRoute.create({
          data: {
            clientId: clientA.id,
            name: `${prefix}-a3`,
            slug: `/${prefix}-a3`,
            destinationUrl: 'http://127.0.0.1:9/a3',
            method: GatewayHttpMethod.GET,
            active: true,
          },
        }),
        db.prisma.gatewayRoute.create({
          data: {
            clientId: clientA.id,
            name: `${prefix}-a4`,
            slug: `/${prefix}-a4`,
            destinationUrl: 'http://127.0.0.1:9/a4',
            method: GatewayHttpMethod.GET,
            active: false,
          },
        }),
        db.prisma.gatewayRoute.create({
          data: {
            clientId: clientB.id,
            name: `${prefix}-b1`,
            slug: `/${prefix}-b1`,
            destinationUrl: 'http://127.0.0.1:9/b1',
            method: GatewayHttpMethod.GET,
            active: false,
          },
        }),
        db.prisma.gatewayRoute.create({
          data: {
            clientId: clientB.id,
            name: `${prefix}-b2`,
            slug: `/${prefix}-b2`,
            destinationUrl: 'http://127.0.0.1:9/b2',
            method: GatewayHttpMethod.GET,
            active: false,
          },
        }),
        db.prisma.gatewayRoute.create({
          data: {
            clientId: clientD.id,
            name: `${prefix}-d1`,
            slug: `/${prefix}-d1`,
            destinationUrl: 'http://127.0.0.1:9/d1',
            method: GatewayHttpMethod.GET,
            active: true,
          },
        }),
      ]);
      createdGatewayRouteIds.push(...createdRoutes.map((item) => item.id));

      const response = await authorizedGet(
        app,
        `/api/v1/gateway-routes/clients-summary?search=${encodeURIComponent(prefix)}&sortBy=clientName&sortOrder=asc`,
        adminToken,
      );

      expect(response.status).toBe(200);
      const body = response.body as ApiResponse<
        PaginatedSummaryResponse<GatewayRouteClientSummaryItem>
      >;
      expect(body.data.pagination.total).toBe(3);
      expect(body.data.items).toEqual([
        {
          client: expect.objectContaining({ id: clientA.id, name: `${prefix}-A` }),
          total: 4,
          active: 3,
          inactive: 1,
        },
        {
          client: expect.objectContaining({ id: clientB.id, name: `${prefix}-B` }),
          total: 2,
          active: 0,
          inactive: 2,
        },
        {
          client: expect.objectContaining({ id: clientD.id, name: `${prefix}-D` }),
          total: 1,
          active: 1,
          inactive: 0,
        },
      ]);
      expect(body.data.items.some((item) => item.client.id === clientC.id)).toBe(false);
    });

    it('applies aggregated status, search, stable ordering and exact pagination', async () => {
      const prefix = `route-filters-${randomUUID().slice(0, 8)}`;
      const lowIdClient = await db.prisma.client.create({
        data: {
          id: '00000000-0000-0000-0000-000000000311',
          name: `${prefix}-Tie-Z`,
          code: `${prefix.toUpperCase()}_TIE_Z`,
          active: true,
        },
      });
      const highIdClient = await db.prisma.client.create({
        data: {
          id: '00000000-0000-0000-0000-000000000312',
          name: `${prefix}-Tie-A`,
          code: `${prefix.toUpperCase()}_TIE_A`,
          active: true,
        },
      });
      const inactiveClient = await db.prisma.client.create({
        data: {
          id: '00000000-0000-0000-0000-000000000313',
          name: `${prefix}-Inactive`,
          code: `${prefix.toUpperCase()}_INACTIVE`,
          active: true,
        },
      });
      createdClientIds.push(lowIdClient.id, highIdClient.id, inactiveClient.id);

      const routes = await Promise.all([
        db.prisma.gatewayRoute.create({
          data: {
            clientId: lowIdClient.id,
            name: `${prefix}-l1`,
            slug: `/${prefix}-l1`,
            destinationUrl: 'http://127.0.0.1:9/l1',
            method: GatewayHttpMethod.GET,
            active: true,
          },
        }),
        db.prisma.gatewayRoute.create({
          data: {
            clientId: lowIdClient.id,
            name: `${prefix}-l2`,
            slug: `/${prefix}-l2`,
            destinationUrl: 'http://127.0.0.1:9/l2',
            method: GatewayHttpMethod.GET,
            active: false,
          },
        }),
        db.prisma.gatewayRoute.create({
          data: {
            clientId: highIdClient.id,
            name: `${prefix}-h1`,
            slug: `/${prefix}-h1`,
            destinationUrl: 'http://127.0.0.1:9/h1',
            method: GatewayHttpMethod.GET,
            active: true,
          },
        }),
        db.prisma.gatewayRoute.create({
          data: {
            clientId: highIdClient.id,
            name: `${prefix}-h2`,
            slug: `/${prefix}-h2`,
            destinationUrl: 'http://127.0.0.1:9/h2',
            method: GatewayHttpMethod.GET,
            active: false,
          },
        }),
        db.prisma.gatewayRoute.create({
          data: {
            clientId: inactiveClient.id,
            name: `${prefix}-i1`,
            slug: `/${prefix}-i1`,
            destinationUrl: 'http://127.0.0.1:9/i1',
            method: GatewayHttpMethod.GET,
            active: false,
          },
        }),
      ]);
      createdGatewayRouteIds.push(...routes.map((item) => item.id));

      const activeResponse = await authorizedGet(
        app,
        `/api/v1/gateway-routes/clients-summary?search=${encodeURIComponent(prefix)}&status=active`,
        adminToken,
      );
      const activeBody = activeResponse.body as ApiResponse<
        PaginatedSummaryResponse<GatewayRouteClientSummaryItem>
      >;
      expect(activeBody.data.items.map((item) => item.client.id)).toEqual([
        highIdClient.id,
        lowIdClient.id,
      ]);

      const inactiveResponse = await authorizedGet(
        app,
        `/api/v1/gateway-routes/clients-summary?search=${encodeURIComponent(prefix)}&status=inactive`,
        adminToken,
      );
      const inactiveBody = inactiveResponse.body as ApiResponse<
        PaginatedSummaryResponse<GatewayRouteClientSummaryItem>
      >;
      expect(inactiveBody.data.items.map((item) => item.client.id)).toEqual([inactiveClient.id]);

      const codeSearchResponse = await authorizedGet(
        app,
        `/api/v1/gateway-routes/clients-summary?search=${encodeURIComponent(highIdClient.code)}`,
        adminToken,
      );
      const codeSearchBody = codeSearchResponse.body as ApiResponse<
        PaginatedSummaryResponse<GatewayRouteClientSummaryItem>
      >;
      expect(codeSearchBody.data.items).toHaveLength(1);
      expect(codeSearchBody.data.items[0]?.client.id).toBe(highIdClient.id);

      const tieResponse = await authorizedGet(
        app,
        `/api/v1/gateway-routes/clients-summary?search=${encodeURIComponent(`${prefix}-Tie`)}&sortBy=total&sortOrder=desc`,
        adminToken,
      );
      const tieBody = tieResponse.body as ApiResponse<
        PaginatedSummaryResponse<GatewayRouteClientSummaryItem>
      >;
      expect(tieBody.data.items.map((item) => item.client.id)).toEqual([
        lowIdClient.id,
        highIdClient.id,
      ]);

      const paginationPrefix = `route-page-${randomUUID().slice(0, 8)}`;
      for (let index = 0; index < 25; index += 1) {
        const client = await db.prisma.client.create({
          data: {
            name: `${paginationPrefix}-${String(index).padStart(2, '0')}`,
            code: `${paginationPrefix.toUpperCase()}_${String(index).padStart(2, '0')}`,
            active: true,
          },
        });
        createdClientIds.push(client.id);

        const route = await db.prisma.gatewayRoute.create({
          data: {
            clientId: client.id,
            name: `${paginationPrefix}-route-${index}`,
            slug: `/${paginationPrefix}-route-${index}`,
            destinationUrl: `http://127.0.0.1:9/${paginationPrefix}-${index}`,
            method: GatewayHttpMethod.GET,
            active: true,
          },
        });
        createdGatewayRouteIds.push(route.id);
      }

      const pageOneResponse = await authorizedGet(
        app,
        `/api/v1/gateway-routes/clients-summary?search=${encodeURIComponent(paginationPrefix)}&page=1&limit=20&sortBy=clientName&sortOrder=asc`,
        adminToken,
      );
      const pageTwoResponse = await authorizedGet(
        app,
        `/api/v1/gateway-routes/clients-summary?search=${encodeURIComponent(paginationPrefix)}&page=2&limit=20&sortBy=clientName&sortOrder=asc`,
        adminToken,
      );
      const pageOneBody = pageOneResponse.body as ApiResponse<
        PaginatedSummaryResponse<GatewayRouteClientSummaryItem>
      >;
      const pageTwoBody = pageTwoResponse.body as ApiResponse<
        PaginatedSummaryResponse<GatewayRouteClientSummaryItem>
      >;
      expect(pageOneBody.data.items).toHaveLength(20);
      expect(pageTwoBody.data.items).toHaveLength(5);
      expect(pageOneBody.data.pagination.total).toBe(25);
      expect(pageTwoBody.data.pagination.total).toBe(25);
    });
  });

  it('publishes the three summary endpoints in /docs-json', async () => {
    const response = await request(app.getHttpServer()).get('/docs-json');

    expect(response.status).toBe(200);
    const paths = response.body.paths as Record<string, unknown>;
    const documentedPaths = Object.keys(paths);

    expect(
      documentedPaths.some((path) => path.endsWith('/api-keys/clients-summary')),
    ).toBe(true);
    expect(
      documentedPaths.some((path) => path.endsWith('/allowed-ips/clients-summary')),
    ).toBe(true);
    expect(
      documentedPaths.some((path) => path.endsWith('/gateway-routes/clients-summary')),
    ).toBe(true);
  });
});
