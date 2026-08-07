import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Client, GatewayRoute } from '../../generated/prisma/client';
import { AuditAction, AuditEntity, RoleCode } from '../../generated/prisma/client';
import {
  decryptHeaderValue,
  parseHeaderEncryptionKey,
} from '../../src/modules/route-headers/utils/route-header-encryption.util';
import { createTestClient } from '../helpers/factories/client.factory';
import { createTestGatewayRoute } from '../helpers/factories/gateway-route.factory';
import { createTestUser } from '../helpers/factories/user.factory';
import { signTestAccessToken } from '../helpers/jwt.helper';
import {
  authorizedDelete,
  authorizedGet,
  authorizedPatch,
  authorizedPost,
} from '../helpers/request.helper';
import { createTestApp } from '../helpers/test-app.helper';
import { TestDatabase } from '../helpers/test-database.helper';

const MASKED_VALUE = '********';

interface ApiSuccessResponse<T> {
  success: true;
  message: string;
  data: T;
  requestId: string;
  timestamp: string;
}

interface ApiErrorResponseBody {
  success: false;
  statusCode: number;
  message: string | string[];
  error: string;
  path: string;
  method: string;
  requestId: string;
  timestamp: string;
}

interface RouteHeaderBody {
  id: string;
  gatewayRouteId: string;
  name: string;
  sensitive: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  value: string;
}

interface RouteHeaderListData {
  items: RouteHeaderBody[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  filters: Record<string, unknown>;
}

describe('RouteHeaders (integration)', () => {
  let app: NestFastifyApplication;
  let db: TestDatabase;
  let adminToken: string;
  let client: Client;
  let activeRoute: GatewayRoute;
  let inactiveRoute: GatewayRoute;
  let encryptionKey: Buffer;

  beforeAll(async () => {
    db = new TestDatabase();
    await db.connect();
    app = await createTestApp();

    const { user } = await createTestUser(db, { roleCode: RoleCode.ADMIN });
    adminToken = signTestAccessToken({
      id: user.id,
      username: user.username,
      email: user.email,
      role: RoleCode.ADMIN,
      roleLevel: 100,
      firstLogin: false,
    });

    client = await createTestClient(db);
    activeRoute = await createTestGatewayRoute(db, client.id, { active: true });
    inactiveRoute = await createTestGatewayRoute(db, client.id, { active: false });

    const hexKey = process.env.HEADER_ENCRYPTION_KEY;

    if (!hexKey) {
      throw new Error('HEADER_ENCRYPTION_KEY is not configured in the test environment.');
    }

    encryptionKey = parseHeaderEncryptionKey(hexKey);
  });

  afterAll(async () => {
    const routeIds = [activeRoute.id, inactiveRoute.id];

    const remainingHeaders = await db.prisma.routeHeader.findMany({
      where: { gatewayRouteId: { in: routeIds } },
      select: { id: true },
    });

    await db.prisma.auditLog.deleteMany({
      where: { entityId: { in: remainingHeaders.map((header) => header.id) } },
    });
    await db.prisma.routeHeader.deleteMany({ where: { gatewayRouteId: { in: routeIds } } });
    await db.prisma.gatewayRoute.deleteMany({ where: { id: { in: routeIds } } });
    await db.prisma.client.deleteMany({ where: { id: client.id } });

    await app.close();
    await db.disconnect();
  });

  it('creates a non-sensitive header and returns the decrypted value, never exposing valueEncrypted', async () => {
    const plainValue = 'plain-value-123';

    const response = await authorizedPost(app, '/api/v1/route-headers', adminToken, {
      gatewayRouteId: activeRoute.id,
      name: 'X-Plain-Header',
      value: plainValue,
      sensitive: false,
    });

    expect(response.status).toBe(201);

    const header = (response.body as ApiSuccessResponse<RouteHeaderBody>).data;

    expect(header.name).toBe('X-Plain-Header');
    expect(header.sensitive).toBe(false);
    expect(header.value).toBe(plainValue);
    expect(Object.keys(header)).not.toContain('valueEncrypted');

    const dbRecord = await db.prisma.routeHeader.findUniqueOrThrow({
      where: { id: header.id },
    });

    expect(dbRecord.valueEncrypted).not.toBe(plainValue);
    expect(decryptHeaderValue(dbRecord.valueEncrypted, encryptionKey)).toBe(plainValue);
  });

  it('creates a sensitive header, masks the value in the response and still stores it encrypted', async () => {
    const secretValue = 'super-secret-token-456';

    const response = await authorizedPost(app, '/api/v1/route-headers', adminToken, {
      gatewayRouteId: activeRoute.id,
      name: 'X-Secret-Header',
      value: secretValue,
      sensitive: true,
    });

    expect(response.status).toBe(201);

    const header = (response.body as ApiSuccessResponse<RouteHeaderBody>).data;

    expect(header.sensitive).toBe(true);
    expect(header.value).toBe(MASKED_VALUE);
    expect(header.value).not.toBe(secretValue);
    expect(Object.keys(header)).not.toContain('valueEncrypted');

    const dbRecord = await db.prisma.routeHeader.findUniqueOrThrow({
      where: { id: header.id },
    });

    expect(decryptHeaderValue(dbRecord.valueEncrypted, encryptionKey)).toBe(secretValue);
  });

  it.each(['Host', 'Content-Length'])(
    'rejects the forbidden header name "%s" with 400',
    async (forbiddenName) => {
      const response = await authorizedPost(app, '/api/v1/route-headers', adminToken, {
        gatewayRouteId: activeRoute.id,
        name: forbiddenName,
        value: 'irrelevant-value',
      });

      expect(response.status).toBe(400);
      expect((response.body as ApiErrorResponseBody).success).toBe(false);
    },
  );

  it('returns 404 when the gateway route does not exist', async () => {
    const response = await authorizedPost(app, '/api/v1/route-headers', adminToken, {
      gatewayRouteId: randomUUID(),
      name: 'X-Orphan-Header',
      value: 'orphan-value',
    });

    expect(response.status).toBe(404);
  });

  it('returns 400 when the gateway route is inactive', async () => {
    const response = await authorizedPost(app, '/api/v1/route-headers', adminToken, {
      gatewayRouteId: inactiveRoute.id,
      name: 'X-Inactive-Target',
      value: 'inactive-value',
    });

    expect(response.status).toBe(400);
  });

  it('returns 409 when the (normalized) header name already exists for the gateway route', async () => {
    const first = await authorizedPost(app, '/api/v1/route-headers', adminToken, {
      gatewayRouteId: activeRoute.id,
      name: 'X-Duplicate-Header',
      value: 'first-value',
    });

    expect(first.status).toBe(201);

    const second = await authorizedPost(app, '/api/v1/route-headers', adminToken, {
      gatewayRouteId: activeRoute.id,
      name: 'x-duplicate-header',
      value: 'second-value',
    });

    expect(second.status).toBe(409);
  });

  it('lists headers for a gateway route with pagination', async () => {
    const routeForListing = await createTestGatewayRoute(db, client.id);

    const created1 = await authorizedPost(app, '/api/v1/route-headers', adminToken, {
      gatewayRouteId: routeForListing.id,
      name: 'X-List-Header-One',
      value: 'value-one',
    });
    const created2 = await authorizedPost(app, '/api/v1/route-headers', adminToken, {
      gatewayRouteId: routeForListing.id,
      name: 'X-List-Header-Two',
      value: 'value-two',
    });

    expect(created1.status).toBe(201);
    expect(created2.status).toBe(201);

    const header1Id = (created1.body as ApiSuccessResponse<RouteHeaderBody>).data.id;
    const header2Id = (created2.body as ApiSuccessResponse<RouteHeaderBody>).data.id;

    const response = await authorizedGet(
      app,
      `/api/v1/route-headers?gatewayRouteId=${routeForListing.id}&sortBy=headerName&sortOrder=asc`,
      adminToken,
    );

    expect(response.status).toBe(200);

    const listData = (response.body as ApiSuccessResponse<RouteHeaderListData>).data;

    expect(listData.pagination.total).toBe(2);
    expect(listData.items).toHaveLength(2);
    expect(listData.items.map((item) => item.name)).toEqual([
      'X-List-Header-One',
      'X-List-Header-Two',
    ]);

    await db.prisma.auditLog.deleteMany({
      where: { entityId: { in: [header1Id, header2Id] } },
    });
    await db.prisma.routeHeader.deleteMany({ where: { gatewayRouteId: routeForListing.id } });
    await db.prisma.gatewayRoute.delete({ where: { id: routeForListing.id } });
  });

  it('gets a single header by id', async () => {
    const created = await authorizedPost(app, '/api/v1/route-headers', adminToken, {
      gatewayRouteId: activeRoute.id,
      name: 'X-FindOne-Target',
      value: 'find-one-value',
    });

    expect(created.status).toBe(201);

    const headerId = (created.body as ApiSuccessResponse<RouteHeaderBody>).data.id;

    const response = await authorizedGet(app, `/api/v1/route-headers/${headerId}`, adminToken);

    expect(response.status).toBe(200);

    const header = (response.body as ApiSuccessResponse<RouteHeaderBody>).data;

    expect(header.id).toBe(headerId);
    expect(header.value).toBe('find-one-value');
  });

  it('updates the header value and the new value decrypts correctly', async () => {
    const created = await authorizedPost(app, '/api/v1/route-headers', adminToken, {
      gatewayRouteId: activeRoute.id,
      name: 'X-Update-Target',
      value: 'initial-value',
    });

    expect(created.status).toBe(201);

    const headerId = (created.body as ApiSuccessResponse<RouteHeaderBody>).data.id;

    const updateResponse = await authorizedPatch(
      app,
      `/api/v1/route-headers/${headerId}`,
      adminToken,
      { value: 'updated-value-789' },
    );

    expect(updateResponse.status).toBe(200);

    const updatedHeader = (updateResponse.body as ApiSuccessResponse<RouteHeaderBody>).data;

    expect(updatedHeader.value).toBe('updated-value-789');

    const dbRecord = await db.prisma.routeHeader.findUniqueOrThrow({
      where: { id: headerId },
    });

    expect(decryptHeaderValue(dbRecord.valueEncrypted, encryptionKey)).toBe('updated-value-789');
  });

  it('deactivates and reactivates a header', async () => {
    const created = await authorizedPost(app, '/api/v1/route-headers', adminToken, {
      gatewayRouteId: activeRoute.id,
      name: 'X-Status-Toggle',
      value: 'toggle-value',
    });

    expect(created.status).toBe(201);

    const headerId = (created.body as ApiSuccessResponse<RouteHeaderBody>).data.id;

    const deactivateResponse = await authorizedPatch(
      app,
      `/api/v1/route-headers/${headerId}/status`,
      adminToken,
      { active: false },
    );

    expect(deactivateResponse.status).toBe(200);
    expect((deactivateResponse.body as ApiSuccessResponse<RouteHeaderBody>).data.active).toBe(
      false,
    );

    const activateResponse = await authorizedPatch(
      app,
      `/api/v1/route-headers/${headerId}/status`,
      adminToken,
      { active: true },
    );

    expect(activateResponse.status).toBe(200);
    expect((activateResponse.body as ApiSuccessResponse<RouteHeaderBody>).data.active).toBe(true);
  });

  it('returns 401 when no token is provided', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/route-headers');

    expect(response.status).toBe(401);
  });

  describe('DELETE /route-headers/:id', () => {
    const createdUserIdsForDelete: string[] = [];

    afterAll(async () => {
      if (createdUserIdsForDelete.length > 0) {
        await db.prisma.user.deleteMany({
          where: { id: { in: createdUserIdsForDelete } },
        });
        createdUserIdsForDelete.length = 0;
      }
    });

    it('deletes an existing header, removes it from the database and records a safe audit log', async () => {
      const secretValue = 'delete-target-secret-value';

      const created = await authorizedPost(app, '/api/v1/route-headers', adminToken, {
        gatewayRouteId: activeRoute.id,
        name: 'X-Delete-Target',
        value: secretValue,
        sensitive: true,
      });

      expect(created.status).toBe(201);

      const headerId = (created.body as ApiSuccessResponse<RouteHeaderBody>).data.id;

      const response = await authorizedDelete(
        app,
        `/api/v1/route-headers/${headerId}`,
        adminToken,
      );

      expect(response.status).toBe(204);

      const found = await db.prisma.routeHeader.findUnique({ where: { id: headerId } });
      expect(found).toBeNull();

      const auditLog = await db.prisma.auditLog.findFirst({
        where: { entityId: headerId, action: AuditAction.DELETE },
      });

      expect(auditLog).not.toBeNull();
      expect(auditLog?.entity).toBe(AuditEntity.ROUTE_HEADER);

      const serializedPreviousValue = JSON.stringify(auditLog?.previousValue);
      expect(serializedPreviousValue).not.toContain(secretValue);
      expect(serializedPreviousValue).not.toContain('valueEncrypted');

      const previousValue = auditLog?.previousValue as Record<string, unknown>;
      expect(Object.keys(previousValue)).not.toContain('value');
      expect(Object.keys(previousValue)).not.toContain('valueEncrypted');
      expect(previousValue).toEqual({
        gatewayRouteId: activeRoute.id,
        headerName: 'X-Delete-Target',
        sensitive: true,
        active: true,
      });

      await db.prisma.auditLog.deleteMany({ where: { entityId: headerId } });
    });

    it('returns 404 when the route header does not exist', async () => {
      const response = await authorizedDelete(
        app,
        `/api/v1/route-headers/${randomUUID()}`,
        adminToken,
      );

      expect(response.status).toBe(404);
    });

    it('returns 401 when no token is provided', async () => {
      const created = await authorizedPost(app, '/api/v1/route-headers', adminToken, {
        gatewayRouteId: activeRoute.id,
        name: 'X-Unauthorized-Delete',
        value: 'irrelevant-value',
      });

      expect(created.status).toBe(201);

      const headerId = (created.body as ApiSuccessResponse<RouteHeaderBody>).data.id;

      try {
        const response = await request(app.getHttpServer()).delete(
          `/api/v1/route-headers/${headerId}`,
        );

        expect(response.status).toBe(401);
      } finally {
        await db.prisma.auditLog.deleteMany({ where: { entityId: headerId } });
        await db.prisma.routeHeader.delete({ where: { id: headerId } });
      }
    });

    it('returns 403 when the authenticated user is not an ADMIN', async () => {
      const created = await authorizedPost(app, '/api/v1/route-headers', adminToken, {
        gatewayRouteId: activeRoute.id,
        name: 'X-Forbidden-Delete',
        value: 'irrelevant-value',
      });

      expect(created.status).toBe(201);

      const headerId = (created.body as ApiSuccessResponse<RouteHeaderBody>).data.id;

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

      try {
        const response = await authorizedDelete(
          app,
          `/api/v1/route-headers/${headerId}`,
          operatorToken,
        );

        expect(response.status).toBe(403);
      } finally {
        await db.prisma.auditLog.deleteMany({ where: { entityId: headerId } });
        await db.prisma.routeHeader.delete({ where: { id: headerId } });
      }
    });
  });
});
