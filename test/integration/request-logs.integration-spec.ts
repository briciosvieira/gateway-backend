import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import type { ApiErrorResponse } from '../../src/common/interfaces/api-error-response.interface';
import type { ApiResponse } from '../../src/common/interfaces/api-response.interface';
import type { Client, RequestLog, User } from '../../generated/prisma/client';
import { RequestLogResult, RequestOrigin, RoleCode } from '../../generated/prisma/client';
import { createTestClient } from '../helpers/factories/client.factory';
import { createTestUser } from '../helpers/factories/user.factory';
import { signTestAccessToken } from '../helpers/jwt.helper';
import { randomIpv4, randomUUID } from '../helpers/random-data.helper';
import { authorizedGet } from '../helpers/request.helper';
import { createTestApp } from '../helpers/test-app.helper';
import { TestDatabase } from '../helpers/test-database.helper';

interface RequestLogListItem {
  id: string;
  requestId: string;
  attemptedAt: string;
  requestOrigin: RequestOrigin | null;
  sourceHost: string | null;
  clientId: string | null;
  sourceIp: string;
  method: string;
  publicPath: string;
  publicEndpoint: string | null;
  destinationHost: string | null;
  destinationIp: string | null;
  statusCode: number;
  durationMs: number;
  attempts: number;
  result: RequestLogResult;
  errorCode: string | null;
}

interface RequestLogDetailItem extends RequestLogListItem {
  destinationUrl: string | null;
  upstreamStatusCode: number | null;
  requestHeaders: unknown;
  requestQuery: unknown;
  requestBody: unknown;
  responseHeaders: unknown;
  responseBody: unknown;
}

interface RequestLogListResponse {
  items: RequestLogListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  filters: Record<string, unknown>;
}

function buildQueryString(params: Record<string, string | number | undefined>): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      searchParams.set(key, String(value));
    }
  }

  const query = searchParams.toString();

  return query.length > 0 ? `?${query}` : '';
}

describe('Request Logs (integration)', () => {
  let app: NestFastifyApplication;
  let db: TestDatabase;

  let adminUser: User;
  let viewerUser: User;
  let adminToken: string;
  let viewerToken: string;

  let clientA: Client;
  let clientB: Client;

  let logA1: RequestLog;
  let logA2: RequestLog;
  let logA3: RequestLog;
  let logB1: RequestLog;

  beforeAll(async () => {
    db = new TestDatabase();
    await db.connect();
    await db.cleanDatabase();
    app = await createTestApp();

    const { user: createdAdmin } = await createTestUser(db, { roleCode: RoleCode.ADMIN });
    adminUser = createdAdmin;
    adminToken = signTestAccessToken({
      id: adminUser.id,
      username: adminUser.username,
      email: adminUser.email,
      role: RoleCode.ADMIN,
      roleLevel: 100,
      firstLogin: false,
    });

    const { user: createdViewer } = await createTestUser(db, { roleCode: RoleCode.VIEWER });
    viewerUser = createdViewer;
    viewerToken = signTestAccessToken({
      id: viewerUser.id,
      username: viewerUser.username,
      email: viewerUser.email,
      role: RoleCode.VIEWER,
      roleLevel: 20,
      firstLogin: false,
    });

    const uniqueSuffix = randomUUID();

    clientA = await createTestClient(db, { name: `Request Logs Client A ${uniqueSuffix}` });
    clientB = await createTestClient(db, { name: `Request Logs Client B ${uniqueSuffix}` });

    logA1 = await db.prisma.requestLog.create({
      data: {
        requestId: `test-req-${randomUUID()}`,
        attemptedAt: new Date('2026-08-06T23:58:32.000Z'),
        requestOrigin: RequestOrigin.PUBLIC,
        sourceHost: 'hub.wdcpartners.com.br',
        clientId: clientA.id,
        sourceIp: randomIpv4(),
        method: 'GET',
        publicPath: '/api/v1/gateway/orders',
        publicEndpoint: 'https://hub.wdcpartners.com.br/api/v1/gateway/orders',
        destinationHost: 'orders.internal.test',
        destinationUrl: 'https://orders.internal.test/orders',
        destinationIp: '10.120.0.248',
        statusCode: 200,
        upstreamStatusCode: 200,
        durationMs: 120,
        attempts: 1,
        result: RequestLogResult.SUCCESS,
        createdAt: new Date('2026-08-07T13:00:00.000Z'),
      },
    });

    logA2 = await db.prisma.requestLog.create({
      data: {
        requestId: `test-req-${randomUUID()}`,
        attemptedAt: new Date('2026-08-07T00:55:42.000Z'),
        requestOrigin: RequestOrigin.INTERNAL,
        sourceHost: 'gatewayhub.intranet.wdcnet',
        clientId: clientA.id,
        sourceIp: randomIpv4(),
        method: 'POST',
        publicPath: '/api/v1/gateway/orders',
        publicEndpoint: 'https://gatewayhub.intranet.wdcnet/api/v1/gateway/orders',
        destinationHost: 'orders.internal.test',
        destinationUrl: 'https://orders.internal.test/orders',
        destinationIp: '10.120.0.248',
        statusCode: 500,
        upstreamStatusCode: 500,
        durationMs: 340,
        attempts: 2,
        result: RequestLogResult.ERROR,
        errorCode: 'UPSTREAM_TIMEOUT',
        errorMessage: 'Upstream did not respond in time.',
        requestHeaders: { authorization: '********', 'x-api-key': '********' },
        requestQuery: { access_token: '********' },
        requestBody: { password: '********', payload: 'visible' },
        responseHeaders: { 'content-type': 'application/json' },
        responseBody: { token: '********', ok: false },
        createdAt: new Date('2026-08-07T12:00:00.000Z'),
      },
    });

    logA3 = await db.prisma.requestLog.create({
      data: {
        requestId: `test-req-${randomUUID()}`,
        attemptedAt: new Date('2026-08-07T00:55:57.000Z'),
        requestOrigin: RequestOrigin.PUBLIC,
        sourceHost: 'hub.wdcpartners.com.br',
        clientId: clientA.id,
        sourceIp: randomIpv4(),
        method: 'GET',
        publicPath: '/api/v1/gateway/orders',
        publicEndpoint: 'https://hub.wdcpartners.com.br/api/v1/gateway/orders',
        destinationHost: 'orders.internal.test',
        destinationUrl: 'https://orders.internal.test/orders/latest',
        destinationIp: '10.120.0.249',
        statusCode: 202,
        upstreamStatusCode: 202,
        durationMs: 30,
        attempts: 1,
        result: RequestLogResult.SUCCESS,
        createdAt: new Date('2026-08-07T11:00:00.000Z'),
      },
    });

    logB1 = await db.prisma.requestLog.create({
      data: {
        requestId: `test-req-${randomUUID()}`,
        attemptedAt: new Date('2026-08-07T10:30:00.000Z'),
        clientId: clientB.id,
        sourceIp: randomIpv4(),
        method: 'GET',
        publicPath: '/api/v1/gateway/invoices',
        destinationHost: 'invoices.internal.test',
        statusCode: 404,
        durationMs: 45,
        attempts: 1,
        result: RequestLogResult.ERROR,
        errorCode: 'NOT_FOUND',
        createdAt: new Date('2026-08-07T10:30:00.000Z'),
      },
    });
  });

  afterAll(async () => {
    await db.prisma.requestLog.deleteMany({
      where: {
        id: {
          in: [logA1?.id, logA2?.id, logA3?.id, logB1?.id].filter(
            (value): value is string => Boolean(value),
          ),
        },
      },
    });
    await db.prisma.client.deleteMany({
      where: {
        id: {
          in: [clientA?.id, clientB?.id].filter((value): value is string => Boolean(value)),
        },
      },
    });
    await db.prisma.user.deleteMany({
      where: {
        id: {
          in: [adminUser?.id, viewerUser?.id].filter((value): value is string => Boolean(value)),
        },
      },
    });

    await app.close();
    await db.disconnect();
  });

  describe('GET /api/v1/request-logs', () => {
    it('lists request logs and omits requestHeaders/requestBody from list items', async () => {
      const query = buildQueryString({ clientId: clientA.id, limit: 50 });
      const response = await authorizedGet(app, `/api/v1/request-logs${query}`, adminToken);

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<RequestLogListResponse>;
      const requestIds = body.data.items.map((item) => item.requestId);

      expect(requestIds).toEqual(
        expect.arrayContaining([logA1.requestId, logA2.requestId, logA3.requestId]),
      );
      expect(requestIds).not.toContain(logB1.requestId);
      expect(body.data.pagination.total).toBeGreaterThanOrEqual(3);

      for (const item of body.data.items) {
        expect(item).toHaveProperty('attemptedAt');
        expect(item).toHaveProperty('requestOrigin');
        expect(item).toHaveProperty('destinationHost');
        expect(item).not.toHaveProperty('requestHeaders');
        expect(item).not.toHaveProperty('requestBody');
        expect(item).not.toHaveProperty('responseBody');
      }
    });

    it('filters by clientId', async () => {
      const query = buildQueryString({ clientId: clientB.id, limit: 50 });
      const response = await authorizedGet(app, `/api/v1/request-logs${query}`, adminToken);

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<RequestLogListResponse>;
      const requestIds = body.data.items.map((item) => item.requestId);

      expect(requestIds).toContain(logB1.requestId);
      expect(requestIds).not.toContain(logA1.requestId);
      expect(requestIds).not.toContain(logA2.requestId);
    });

    it('filters by result', async () => {
      const query = buildQueryString({
        clientId: clientA.id,
        result: RequestLogResult.ERROR,
        limit: 50,
      });
      const response = await authorizedGet(app, `/api/v1/request-logs${query}`, adminToken);

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<RequestLogListResponse>;
      const requestIds = body.data.items.map((item) => item.requestId);

      expect(requestIds).toContain(logA2.requestId);
      expect(requestIds).not.toContain(logA1.requestId);
      expect(requestIds).not.toContain(logA3.requestId);
      for (const item of body.data.items) {
        expect(item.result).toBe(RequestLogResult.ERROR);
      }
    });

    it('filters by method', async () => {
      const query = buildQueryString({ clientId: clientA.id, method: 'POST', limit: 50 });
      const response = await authorizedGet(app, `/api/v1/request-logs${query}`, adminToken);

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<RequestLogListResponse>;
      const requestIds = body.data.items.map((item) => item.requestId);

      expect(requestIds).toContain(logA2.requestId);
      expect(requestIds).not.toContain(logA1.requestId);
      expect(requestIds).not.toContain(logA3.requestId);
    });

    it('filters by requestOrigin', async () => {
      const query = buildQueryString({
        clientId: clientA.id,
        requestOrigin: RequestOrigin.INTERNAL,
        limit: 50,
      });
      const response = await authorizedGet(app, `/api/v1/request-logs${query}`, adminToken);

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<RequestLogListResponse>;
      const requestIds = body.data.items.map((item) => item.requestId);

      expect(requestIds).toContain(logA2.requestId);
      expect(requestIds).not.toContain(logA1.requestId);
      expect(requestIds).not.toContain(logA3.requestId);
    });

    it('filters by destinationHost', async () => {
      const query = buildQueryString({
        destinationHost: 'invoices.internal',
        limit: 50,
      });
      const response = await authorizedGet(app, `/api/v1/request-logs${query}`, adminToken);

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<RequestLogListResponse>;
      const requestIds = body.data.items.map((item) => item.requestId);

      expect(requestIds).toContain(logB1.requestId);
      expect(requestIds).not.toContain(logA1.requestId);
      expect(body.data.items.find((item) => item.requestId === logB1.requestId)?.attemptedAt).toBe(
        '2026-08-07T10:30:00.000Z',
      );
    });

    it('returns zero rows with attemptedAt null after the migration backfill', async () => {
      const result = await db.prisma.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count
        FROM request_logs
        WHERE attempted_at IS NULL
      `;
      const nullAttemptedAtCount = result[0]?.count ?? 0;

      expect(nullAttemptedAtCount).toBe(0);
    });

    it('filters date ranges only by attemptedAt', async () => {
      const query = buildQueryString({
        clientId: clientA.id,
        startDate: '2026-08-07T10:30:00.000Z',
        endDate: '2026-08-07T13:30:00.000Z',
        limit: 50,
      });
      const response = await authorizedGet(app, `/api/v1/request-logs${query}`, adminToken);

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<RequestLogListResponse>;

      expect(body.data.items).toHaveLength(0);
    });

    it('sorts by attemptedAt desc across a day boundary using the real database order', async () => {
      const query = buildQueryString({
        clientId: clientA.id,
        sortBy: 'attemptedAt',
        sortOrder: 'desc',
        limit: 50,
      });
      const response = await authorizedGet(app, `/api/v1/request-logs${query}`, adminToken);

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<RequestLogListResponse>;
      const orderedRequestIds = body.data.items.map((item) => item.requestId);

      expect(orderedRequestIds.indexOf(logA3.requestId)).toBeLessThan(
        orderedRequestIds.indexOf(logA2.requestId),
      );
      expect(orderedRequestIds.indexOf(logA2.requestId)).toBeLessThan(
        orderedRequestIds.indexOf(logA1.requestId),
      );
    });

    it('sorts by attemptedAt asc across a day boundary using the real database order', async () => {
      const query = buildQueryString({
        clientId: clientA.id,
        sortBy: 'attemptedAt',
        sortOrder: 'asc',
        limit: 50,
      });
      const response = await authorizedGet(app, `/api/v1/request-logs${query}`, adminToken);

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<RequestLogListResponse>;
      const orderedRequestIds = body.data.items.map((item) => item.requestId);

      expect(orderedRequestIds.indexOf(logA1.requestId)).toBeLessThan(
        orderedRequestIds.indexOf(logA2.requestId),
      );
      expect(orderedRequestIds.indexOf(logA2.requestId)).toBeLessThan(
        orderedRequestIds.indexOf(logA3.requestId),
      );
    });

    it('returns 400 when startDate is after endDate', async () => {
      const query = buildQueryString({
        startDate: '2026-08-10T00:00:00.000Z',
        endDate: '2026-08-01T00:00:00.000Z',
      });
      const response = await authorizedGet(app, `/api/v1/request-logs${query}`, adminToken);

      expect(response.status).toBe(400);
      const body = response.body as ApiErrorResponse;
      expect(body.success).toBe(false);
    });

    it('returns 401 without a token', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/request-logs');

      expect(response.status).toBe(401);
    });

    it('returns 403 for a VIEWER role', async () => {
      const response = await authorizedGet(app, '/api/v1/request-logs', viewerToken);

      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/v1/request-logs/by-request-id/:requestId', () => {
    it('returns the full detail including request/response bodies', async () => {
      const response = await authorizedGet(
        app,
        `/api/v1/request-logs/by-request-id/${logA2.requestId}`,
        adminToken,
      );

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<RequestLogDetailItem>;

      expect(body.data.requestId).toBe(logA2.requestId);
      expect(body.data.errorCode).toBe('UPSTREAM_TIMEOUT');
      expect(body.data).toHaveProperty('requestHeaders');
      expect(body.data).toHaveProperty('requestBody');
      expect(body.data).toHaveProperty('responseHeaders');
      expect(body.data).toHaveProperty('responseBody');
      expect(body.data.destinationUrl).toBe('https://orders.internal.test/orders');
      expect(body.data.upstreamStatusCode).toBe(500);
      expect(body.data.requestHeaders).toEqual({
        authorization: '********',
        'x-api-key': '********',
      });
      expect(body.data.requestQuery).toEqual({ access_token: '********' });
      expect(body.data.requestBody).toEqual({
        password: '********',
        payload: 'visible',
      });
      expect(body.data.responseBody).toEqual({ token: '********', ok: false });
    });

    it('returns 404 for an unknown requestId', async () => {
      const response = await authorizedGet(
        app,
        `/api/v1/request-logs/by-request-id/does-not-exist-${randomUUID()}`,
        adminToken,
      );

      expect(response.status).toBe(404);
    });

    it('returns 403 for a VIEWER role', async () => {
      const response = await authorizedGet(
        app,
        `/api/v1/request-logs/by-request-id/${logA1.requestId}`,
        viewerToken,
      );

      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/v1/request-logs/:id', () => {
    it('returns the full detail for a known id', async () => {
      const response = await authorizedGet(app, `/api/v1/request-logs/${logA1.id}`, adminToken);

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<RequestLogDetailItem>;

      expect(body.data.id).toBe(logA1.id);
      expect(body.data.attemptedAt).toBe('2026-08-06T23:58:32.000Z');
      expect(body.data).toHaveProperty('requestHeaders');
      expect(body.data).toHaveProperty('requestBody');
    });

    it('returns 404 for an id that does not exist', async () => {
      const response = await authorizedGet(app, `/api/v1/request-logs/${randomUUID()}`, adminToken);

      expect(response.status).toBe(404);
    });

    it('returns 401 without a token', async () => {
      const response = await request(app.getHttpServer()).get(
        `/api/v1/request-logs/${logA1.id}`,
      );

      expect(response.status).toBe(401);
    });

    it('returns 403 for a VIEWER role', async () => {
      const response = await authorizedGet(app, `/api/v1/request-logs/${logA1.id}`, viewerToken);

      expect(response.status).toBe(403);
    });
  });
});
