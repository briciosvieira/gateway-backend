import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import type { ApiErrorResponse } from '../../src/common/interfaces/api-error-response.interface';
import type { ApiResponse } from '../../src/common/interfaces/api-response.interface';
import {
  AuditAction,
  AuditEntity,
  GatewayHttpMethod,
  RoleCode,
  type Client,
} from '../../generated/prisma/client';
import { createTestClient } from '../helpers/factories/client.factory';
import { createTestGatewayRoute } from '../helpers/factories/gateway-route.factory';
import { createTestUser } from '../helpers/factories/user.factory';
import { signTestAccessToken } from '../helpers/jwt.helper';
import { randomSlug, randomUUID } from '../helpers/random-data.helper';
import {
  authorizedDelete,
  authorizedGet,
  authorizedPatch,
  authorizedPost,
} from '../helpers/request.helper';
import { createTestApp } from '../helpers/test-app.helper';
import { TestDatabase } from '../helpers/test-database.helper';

interface GatewayRouteResponseData {
  id: string;
  clientId: string;
  name: string;
  slug: string;
  description: string | null;
  destinationUrl: string;
  method: GatewayHttpMethod;
  timeoutMs: number;
  retryCount: number;
  active: boolean;
  requiresApiKey: boolean;
  createdAt: string;
  updatedAt: string;
  client: {
    id: string;
    name: string;
    code: string;
    active: boolean;
  };
  publicPath: string;
}

interface GatewayRouteListResponseData {
  items: GatewayRouteResponseData[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const UPSTREAM_URL = 'http://upstream.example.test/webhook';

describe('GatewayRoutes (integration)', () => {
  let app: NestFastifyApplication;
  let db: TestDatabase;
  let adminToken: string;
  let adminUserId: string;
  let client: Client;
  let inactiveClient: Client;
  const createdGatewayRouteIds: string[] = [];

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

    client = await createTestClient(db, { active: true });
    inactiveClient = await createTestClient(db, { active: false });
  });

  afterAll(async () => {
    if (createdGatewayRouteIds.length > 0) {
      await db.prisma.gatewayRoute.deleteMany({
        where: { id: { in: createdGatewayRouteIds } },
      });
    }

    await db.prisma.client.deleteMany({
      where: { id: { in: [client.id, inactiveClient.id] } },
    });

    await db.prisma.user.deleteMany({ where: { id: adminUserId } });

    await app.close();
    await db.disconnect();
  });

  it('creates a gateway route and computes the public path', async () => {
    const slug = randomSlug();

    const response = await authorizedPost(app, '/api/v1/gateway-routes', adminToken, {
      name: 'Integration Route',
      slug,
      destinationUrl: UPSTREAM_URL,
      method: GatewayHttpMethod.POST,
      clientId: client.id,
    });

    expect(response.status).toBe(201);

    const body = response.body as ApiResponse<GatewayRouteResponseData>;
    createdGatewayRouteIds.push(body.data.id);

    expect(body.data.slug).toBe(slug);
    expect(body.data.publicPath).toBe(`/gateway${slug}`);
    expect(body.data.clientId).toBe(client.id);
    expect(body.data.active).toBe(true);
    expect(body.data.requiresApiKey).toBe(true);
  });

  it('rejects a slug containing whitespace', async () => {
    const response = await authorizedPost(app, '/api/v1/gateway-routes', adminToken, {
      name: 'Invalid Slug Route',
      slug: '/invalid slug',
      destinationUrl: UPSTREAM_URL,
      method: GatewayHttpMethod.POST,
      clientId: client.id,
    });

    expect(response.status).toBe(400);
  });

  it('rejects a slug colliding with a reserved administrative prefix', async () => {
    const response = await authorizedPost(app, '/api/v1/gateway-routes', adminToken, {
      name: 'Reserved Slug Route',
      slug: '/auth/callback',
      destinationUrl: UPSTREAM_URL,
      method: GatewayHttpMethod.POST,
      clientId: client.id,
    });

    expect(response.status).toBe(400);

    const body = response.body as ApiErrorResponse;
    expect(body.message).toBe('The provided slug is invalid.');
  });

  it('returns 409 when the slug already exists', async () => {
    const slug = randomSlug();
    const existingRoute = await createTestGatewayRoute(db, client.id, { slug });
    createdGatewayRouteIds.push(existingRoute.id);

    const response = await authorizedPost(app, '/api/v1/gateway-routes', adminToken, {
      name: 'Duplicate Slug Route',
      slug,
      destinationUrl: UPSTREAM_URL,
      method: GatewayHttpMethod.POST,
      clientId: client.id,
    });

    expect(response.status).toBe(409);
  });

  it('returns 400 when the client is inactive', async () => {
    const response = await authorizedPost(app, '/api/v1/gateway-routes', adminToken, {
      name: 'Inactive Client Route',
      slug: randomSlug(),
      destinationUrl: UPSTREAM_URL,
      method: GatewayHttpMethod.POST,
      clientId: inactiveClient.id,
    });

    expect(response.status).toBe(400);

    const body = response.body as ApiErrorResponse;
    expect(body.message).toBe('Client is inactive.');
  });

  it('rejects a destination URL with a disallowed protocol', async () => {
    const response = await authorizedPost(app, '/api/v1/gateway-routes', adminToken, {
      name: 'Bad Protocol Route',
      slug: randomSlug(),
      destinationUrl: 'ftp://upstream.example.test/file',
      method: GatewayHttpMethod.POST,
      clientId: client.id,
    });

    expect(response.status).toBe(400);
  });

  it('rejects a destination URL containing embedded credentials', async () => {
    const response = await authorizedPost(app, '/api/v1/gateway-routes', adminToken, {
      name: 'Credentials Route',
      slug: randomSlug(),
      destinationUrl: 'http://user:pass@upstream.example.test/webhook',
      method: GatewayHttpMethod.POST,
      clientId: client.id,
    });

    expect(response.status).toBe(400);
  });

  it('lists gateway routes filtered by client', async () => {
    const route = await createTestGatewayRoute(db, client.id);
    createdGatewayRouteIds.push(route.id);

    const response = await authorizedGet(
      app,
      `/api/v1/gateway-routes?clientId=${client.id}`,
      adminToken,
    );

    expect(response.status).toBe(200);

    const body = response.body as ApiResponse<GatewayRouteListResponseData>;
    expect(body.data.items.some((item) => item.id === route.id)).toBe(true);
  });

  it('gets a gateway route by id', async () => {
    const route = await createTestGatewayRoute(db, client.id);
    createdGatewayRouteIds.push(route.id);

    const response = await authorizedGet(
      app,
      `/api/v1/gateway-routes/${route.id}`,
      adminToken,
    );

    expect(response.status).toBe(200);

    const body = response.body as ApiResponse<GatewayRouteResponseData>;
    expect(body.data.id).toBe(route.id);
    expect(body.data.publicPath).toBe(`/gateway${route.slug}`);
  });

  it('updates a gateway route', async () => {
    const route = await createTestGatewayRoute(db, client.id, {
      name: 'Old Route Name',
    });
    createdGatewayRouteIds.push(route.id);

    const response = await authorizedPatch(
      app,
      `/api/v1/gateway-routes/${route.id}`,
      adminToken,
      {
        name: 'New Route Name',
        destinationUrl: 'http://upstream.example.test/updated',
        timeoutMs: 45000,
      },
    );

    expect(response.status).toBe(200);

    const body = response.body as ApiResponse<GatewayRouteResponseData>;
    expect(body.data.name).toBe('New Route Name');
    expect(body.data.destinationUrl).toBe('http://upstream.example.test/updated');
    expect(body.data.timeoutMs).toBe(45000);
  });

  it('activates and deactivates a gateway route', async () => {
    const route = await createTestGatewayRoute(db, client.id, { active: true });
    createdGatewayRouteIds.push(route.id);

    const deactivateResponse = await authorizedPatch(
      app,
      `/api/v1/gateway-routes/${route.id}/status`,
      adminToken,
      { active: false },
    );

    expect(deactivateResponse.status).toBe(200);
    const deactivateBody = deactivateResponse.body as ApiResponse<GatewayRouteResponseData>;
    expect(deactivateBody.data.active).toBe(false);

    const activateResponse = await authorizedPatch(
      app,
      `/api/v1/gateway-routes/${route.id}/status`,
      adminToken,
      { active: true },
    );

    expect(activateResponse.status).toBe(200);
    const activateBody = activateResponse.body as ApiResponse<GatewayRouteResponseData>;
    expect(activateBody.data.active).toBe(true);
  });

  it('returns 401 when no token is provided', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/gateway-routes');

    expect(response.status).toBe(401);
  });

  describe('requiresApiKey', () => {
    const createdGatewayRouteIdsForRequiresApiKey: string[] = [];
    const createdUserIdsForRequiresApiKey: string[] = [];
    let operatorToken: string;

    beforeAll(async () => {
      const { user: operatorUser } = await createTestUser(db, { roleCode: RoleCode.OPERATOR });
      createdUserIdsForRequiresApiKey.push(operatorUser.id);
      operatorToken = signTestAccessToken({
        id: operatorUser.id,
        username: operatorUser.username,
        email: operatorUser.email,
        role: RoleCode.OPERATOR,
        roleLevel: 50,
        firstLogin: false,
      });
    });

    afterAll(async () => {
      if (createdGatewayRouteIdsForRequiresApiKey.length > 0) {
        await db.prisma.gatewayRoute.deleteMany({
          where: { id: { in: createdGatewayRouteIdsForRequiresApiKey } },
        });
      }

      if (createdUserIdsForRequiresApiKey.length > 0) {
        await db.prisma.user.deleteMany({
          where: { id: { in: createdUserIdsForRequiresApiKey } },
        });
      }
    });

    it('allows ADMIN to create a gateway route with requiresApiKey=false', async () => {
      const response = await authorizedPost(app, '/api/v1/gateway-routes', adminToken, {
        name: 'Public Route',
        slug: randomSlug(),
        destinationUrl: UPSTREAM_URL,
        method: GatewayHttpMethod.POST,
        clientId: client.id,
        requiresApiKey: false,
      });

      expect(response.status).toBe(201);

      const body = response.body as ApiResponse<GatewayRouteResponseData>;
      createdGatewayRouteIdsForRequiresApiKey.push(body.data.id);
      expect(body.data.requiresApiKey).toBe(false);
    });

    it('returns 403 when an OPERATOR tries to create a gateway route with requiresApiKey=false', async () => {
      const response = await authorizedPost(app, '/api/v1/gateway-routes', operatorToken, {
        name: 'Operator Public Route',
        slug: randomSlug(),
        destinationUrl: UPSTREAM_URL,
        method: GatewayHttpMethod.POST,
        clientId: client.id,
        requiresApiKey: false,
      });

      expect(response.status).toBe(403);

      const body = response.body as ApiErrorResponse;
      expect(body.code).toBe('REQUIRES_API_KEY_ADMIN_ONLY');
    });

    it('allows ADMIN to toggle requiresApiKey from true to false and back, recording an audit log each time', async () => {
      const route = await createTestGatewayRoute(db, client.id, { requiresApiKey: true });
      createdGatewayRouteIdsForRequiresApiKey.push(route.id);

      const disableResponse = await authorizedPatch(
        app,
        `/api/v1/gateway-routes/${route.id}`,
        adminToken,
        { requiresApiKey: false },
      );

      expect(disableResponse.status).toBe(200);
      const disableBody = disableResponse.body as ApiResponse<GatewayRouteResponseData>;
      expect(disableBody.data.requiresApiKey).toBe(false);

      const disableAudit = await db.prisma.auditLog.findFirst({
        where: {
          entityId: route.id,
          description: { contains: 'API Key requirement disabled' },
        },
      });
      expect(disableAudit).not.toBeNull();

      const enableResponse = await authorizedPatch(
        app,
        `/api/v1/gateway-routes/${route.id}`,
        adminToken,
        { requiresApiKey: true },
      );

      expect(enableResponse.status).toBe(200);
      const enableBody = enableResponse.body as ApiResponse<GatewayRouteResponseData>;
      expect(enableBody.data.requiresApiKey).toBe(true);

      const enableAudit = await db.prisma.auditLog.findFirst({
        where: {
          entityId: route.id,
          description: { contains: 'API Key requirement enabled' },
        },
      });
      expect(enableAudit).not.toBeNull();
    });

    it('returns 403 when an OPERATOR tries to change requiresApiKey from true to false', async () => {
      const route = await createTestGatewayRoute(db, client.id, { requiresApiKey: true });
      createdGatewayRouteIdsForRequiresApiKey.push(route.id);

      const response = await authorizedPatch(
        app,
        `/api/v1/gateway-routes/${route.id}`,
        operatorToken,
        { requiresApiKey: false },
      );

      expect(response.status).toBe(403);

      const body = response.body as ApiErrorResponse;
      expect(body.code).toBe('REQUIRES_API_KEY_ADMIN_ONLY');

      const stillTrue = await db.prisma.gatewayRoute.findUnique({ where: { id: route.id } });
      expect(stillTrue?.requiresApiKey).toBe(true);
    });

    it('allows an OPERATOR to update other fields on a requiresApiKey=false route without altering it', async () => {
      const route = await createTestGatewayRoute(db, client.id, { requiresApiKey: false });
      createdGatewayRouteIdsForRequiresApiKey.push(route.id);

      const response = await authorizedPatch(
        app,
        `/api/v1/gateway-routes/${route.id}`,
        operatorToken,
        { name: 'Renamed by operator' },
      );

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<GatewayRouteResponseData>;
      expect(body.data.name).toBe('Renamed by operator');
      expect(body.data.requiresApiKey).toBe(false);
    });
  });

  describe('DELETE /gateway-routes/:id', () => {
    const createdGatewayRouteIdsForDelete: string[] = [];
    const createdUserIdsForDelete: string[] = [];

    afterAll(async () => {
      if (createdGatewayRouteIdsForDelete.length > 0) {
        await db.prisma.gatewayRoute.deleteMany({
          where: { id: { in: createdGatewayRouteIdsForDelete } },
        });
        createdGatewayRouteIdsForDelete.length = 0;
      }

      if (createdUserIdsForDelete.length > 0) {
        await db.prisma.user.deleteMany({
          where: { id: { in: createdUserIdsForDelete } },
        });
        createdUserIdsForDelete.length = 0;
      }
    });

    it('deletes a gateway route without route headers and records an audit log', async () => {
      const route = await createTestGatewayRoute(db, client.id);
      createdGatewayRouteIdsForDelete.push(route.id);

      const response = await authorizedDelete(
        app,
        `/api/v1/gateway-routes/${route.id}`,
        adminToken,
      );

      expect(response.status).toBe(204);

      const found = await db.prisma.gatewayRoute.findUnique({ where: { id: route.id } });
      expect(found).toBeNull();

      const auditLog = await db.prisma.auditLog.findFirst({
        where: { entityId: route.id, action: AuditAction.DELETE },
      });

      expect(auditLog).not.toBeNull();
      expect(auditLog?.entity).toBe(AuditEntity.GATEWAY_ROUTE);
    });

    it('returns 404 when the gateway route does not exist', async () => {
      const response = await authorizedDelete(
        app,
        `/api/v1/gateway-routes/${randomUUID()}`,
        adminToken,
      );

      expect(response.status).toBe(404);
    });

    it('returns 409 with code GATEWAY_ROUTE_HAS_DEPENDENCIES when the route has a linked Route Header', async () => {
      const route = await createTestGatewayRoute(db, client.id);

      const headerResponse = await authorizedPost(app, '/api/v1/route-headers', adminToken, {
        gatewayRouteId: route.id,
        name: 'X-Dependency-Header',
        value: 'dependency-value',
      });

      expect(headerResponse.status).toBe(201);

      const headerId = (headerResponse.body as ApiResponse<{ id: string }>).data.id;

      try {
        const response = await authorizedDelete(
          app,
          `/api/v1/gateway-routes/${route.id}`,
          adminToken,
        );

        expect(response.status).toBe(409);

        const body = response.body as ApiErrorResponse;
        expect(body.code).toBe('GATEWAY_ROUTE_HAS_DEPENDENCIES');

        const stillExists = await db.prisma.gatewayRoute.findUnique({
          where: { id: route.id },
        });
        expect(stillExists).not.toBeNull();
      } finally {
        await db.prisma.auditLog.deleteMany({ where: { entityId: headerId } });
        await db.prisma.routeHeader.delete({ where: { id: headerId } });
        await db.prisma.gatewayRoute.delete({ where: { id: route.id } });
      }
    });

    it('returns 401 when no token is provided', async () => {
      const route = await createTestGatewayRoute(db, client.id);
      createdGatewayRouteIdsForDelete.push(route.id);

      const response = await request(app.getHttpServer()).delete(
        `/api/v1/gateway-routes/${route.id}`,
      );

      expect(response.status).toBe(401);
    });

    it('returns 403 when the authenticated user is not an ADMIN', async () => {
      const route = await createTestGatewayRoute(db, client.id);
      createdGatewayRouteIdsForDelete.push(route.id);

      const { user: operatorUser } = await createTestUser(db, { roleCode: RoleCode.OPERATOR });
      createdUserIdsForDelete.push(operatorUser.id);

      const operatorToken = signTestAccessToken({
        id: operatorUser.id,
        username: operatorUser.username,
        email: operatorUser.email,
        role: RoleCode.OPERATOR,
        roleLevel: 50,
        firstLogin: false,
      });

      const response = await authorizedDelete(
        app,
        `/api/v1/gateway-routes/${route.id}`,
        operatorToken,
      );

      expect(response.status).toBe(403);
    });
  });
});
