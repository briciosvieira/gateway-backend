import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import type { ApiErrorResponse } from '../../src/common/interfaces/api-error-response.interface';
import type { ApiResponse } from '../../src/common/interfaces/api-response.interface';
import type { Client, RequestLog, User } from '../../generated/prisma/client';
import { RequestLogResult, RoleCode } from '../../generated/prisma/client';
import { createTestClient } from '../helpers/factories/client.factory';
import { createTestUser } from '../helpers/factories/user.factory';
import { signTestAccessToken } from '../helpers/jwt.helper';
import { randomIpv4 } from '../helpers/random-data.helper';
import { authorizedGet } from '../helpers/request.helper';
import { createTestApp } from '../helpers/test-app.helper';
import { TestDatabase } from '../helpers/test-database.helper';

interface DashboardOverviewResponse {
  totalClients: number;
  activeClients: number;
  totalApiKeys: number;
  activeApiKeys: number;
  totalRoutes: number;
  activeRoutes: number;
  totalRequests: number;
  requestsInPeriod: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number;
  errorRate: number;
  averageResponseTime: number;
  maxResponseTime: number;
  averageAttempts: number;
}

interface ChartPointResponse {
  label: string;
  requests: number;
  success: number;
  error: number;
}

interface TopClientItemResponse {
  clientId: string;
  name: string;
  code: string;
  requests: number;
  errors: number;
  averageResponseTime: number;
}

interface TopRouteItemResponse {
  routeId: string;
  name: string;
  slug: string;
  method: string;
  requests: number;
  errors: number;
  averageResponseTime: number;
}

interface StatusDistributionItemResponse {
  statusCode: number;
  total: number;
}

interface TopErrorItemResponse {
  errorCode: string;
  total: number;
}

interface TopSourceIpItemResponse {
  sourceIp: string;
  requests: number;
}

interface RecentRequestItemResponse {
  requestId: string;
  client: { id: string; name: string; code: string } | null;
  route: { id: string; name: string; slug: string } | null;
  statusCode: number;
  durationMs: number;
  createdAt: string;
}

interface DashboardHealthResponse {
  gatewayStatus: 'healthy' | 'unhealthy';
  database: 'healthy' | 'unhealthy';
  uptimeSeconds: number;
  version: string;
  environment: string;
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

describe('Dashboard (integration)', () => {
  let app: NestFastifyApplication;
  let db: TestDatabase;

  let adminUser: User;
  let operatorUser: User;
  let viewerUser: User;
  let auditorUser: User;

  let adminToken: string;
  let operatorToken: string;
  let viewerToken: string;
  let auditorToken: string;

  let dashboardClient: Client;

  let sharedIp: string;
  let log1: RequestLog;
  let log2: RequestLog;
  let log3: RequestLog;
  let log4: RequestLog;

  beforeAll(async () => {
    db = new TestDatabase();
    await db.connect();
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

    const { user: createdOperator } = await createTestUser(db, { roleCode: RoleCode.OPERATOR });
    operatorUser = createdOperator;
    operatorToken = signTestAccessToken({
      id: operatorUser.id,
      username: operatorUser.username,
      email: operatorUser.email,
      role: RoleCode.OPERATOR,
      roleLevel: 50,
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

    const { user: createdAuditor } = await createTestUser(db, { roleCode: RoleCode.AUDITOR });
    auditorUser = createdAuditor;
    auditorToken = signTestAccessToken({
      id: auditorUser.id,
      username: auditorUser.username,
      email: auditorUser.email,
      role: RoleCode.AUDITOR,
      roleLevel: 10,
      firstLogin: false,
    });

    dashboardClient = await createTestClient(db, { name: 'Dashboard Metrics Client' });
    sharedIp = randomIpv4();

    log1 = await db.prisma.requestLog.create({
      data: {
        requestId: `dash-req-1-${Date.now()}`,
        attemptedAt: new Date('2026-08-07T00:00:01.000Z'),
        clientId: dashboardClient.id,
        sourceIp: sharedIp,
        method: 'GET',
        publicPath: '/api/v1/gateway/orders',
        statusCode: 200,
        durationMs: 100,
        attempts: 1,
        result: RequestLogResult.SUCCESS,
      },
    });

    log2 = await db.prisma.requestLog.create({
      data: {
        requestId: `dash-req-2-${Date.now()}`,
        attemptedAt: new Date('2026-08-07T00:00:02.000Z'),
        clientId: dashboardClient.id,
        sourceIp: randomIpv4(),
        method: 'POST',
        publicPath: '/api/v1/gateway/orders',
        statusCode: 201,
        durationMs: 150,
        attempts: 1,
        result: RequestLogResult.SUCCESS,
      },
    });

    log3 = await db.prisma.requestLog.create({
      data: {
        requestId: `dash-req-3-${Date.now()}`,
        attemptedAt: new Date('2026-08-07T00:00:03.000Z'),
        clientId: dashboardClient.id,
        sourceIp: sharedIp,
        method: 'GET',
        publicPath: '/api/v1/gateway/orders',
        statusCode: 500,
        durationMs: 400,
        attempts: 2,
        result: RequestLogResult.ERROR,
        errorCode: 'UPSTREAM_TIMEOUT',
      },
    });

    log4 = await db.prisma.requestLog.create({
      data: {
        requestId: `dash-req-4-${Date.now()}`,
        attemptedAt: new Date('2026-08-07T00:00:04.000Z'),
        clientId: dashboardClient.id,
        sourceIp: randomIpv4(),
        method: 'POST',
        publicPath: '/api/v1/gateway/orders',
        statusCode: 502,
        durationMs: 380,
        attempts: 3,
        result: RequestLogResult.ERROR,
        errorCode: 'UPSTREAM_TIMEOUT',
      },
    });
  });

  afterAll(async () => {
    await db.prisma.requestLog.deleteMany({
      where: { id: { in: [log1.id, log2.id, log3.id, log4.id] } },
    });
    await db.prisma.client.deleteMany({ where: { id: dashboardClient.id } });
    await db.prisma.user.deleteMany({
      where: { id: { in: [adminUser.id, operatorUser.id, viewerUser.id, auditorUser.id] } },
    });

    await app.close();
    await db.disconnect();
  });

  describe('GET /api/v1/dashboard/overview', () => {
    it('returns aggregated counters for the period', async () => {
      const query = buildQueryString({ period: 'last30days' });
      const response = await authorizedGet(app, `/api/v1/dashboard/overview${query}`, adminToken);

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<DashboardOverviewResponse>;

      expect(body.data.totalClients).toBeGreaterThanOrEqual(1);
      expect(body.data.requestsInPeriod).toBeGreaterThanOrEqual(4);
      expect(body.data.successfulRequests).toBeGreaterThanOrEqual(2);
      expect(body.data.failedRequests).toBeGreaterThanOrEqual(2);
      expect(body.data.successRate).toBeGreaterThanOrEqual(0);
      expect(body.data.successRate).toBeLessThanOrEqual(100);
      expect(body.data.averageResponseTime).toBeGreaterThanOrEqual(0);
    });

    it('returns 400 when period is custom without startDate/endDate', async () => {
      const query = buildQueryString({ period: 'custom' });
      const response = await authorizedGet(app, `/api/v1/dashboard/overview${query}`, adminToken);

      expect(response.status).toBe(400);
      const body = response.body as ApiErrorResponse;
      expect(body.success).toBe(false);
    });

    it('returns 401 without a token', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/dashboard/overview');

      expect(response.status).toBe(401);
    });

    it.each([
      ['ADMIN', () => adminToken],
      ['OPERATOR', () => operatorToken],
      ['VIEWER', () => viewerToken],
      ['AUDITOR', () => auditorToken],
    ])('allows the %s role to read the overview', async (_roleName, getToken) => {
      const query = buildQueryString({ period: 'last30days' });
      const response = await authorizedGet(
        app,
        `/api/v1/dashboard/overview${query}`,
        getToken(),
      );

      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/v1/dashboard/requests-over-time', () => {
    it('returns a bucketed time series covering the created logs', async () => {
      const query = buildQueryString({ period: 'last30days' });
      const response = await authorizedGet(
        app,
        `/api/v1/dashboard/requests-over-time${query}`,
        adminToken,
      );

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<ChartPointResponse[]>;

      expect(Array.isArray(body.data)).toBe(true);

      const totalRequests = body.data.reduce((sum, point) => sum + point.requests, 0);
      expect(totalRequests).toBeGreaterThanOrEqual(4);
    });
  });

  describe('GET /api/v1/dashboard/top-clients', () => {
    it('ranks the dashboard client by request volume', async () => {
      const query = buildQueryString({ period: 'last30days', limit: 50 });
      const response = await authorizedGet(app, `/api/v1/dashboard/top-clients${query}`, adminToken);

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<TopClientItemResponse[]>;
      const entry = body.data.find((item) => item.clientId === dashboardClient.id);

      expect(entry).toBeDefined();
      expect(entry?.requests).toBeGreaterThanOrEqual(4);
      expect(entry?.errors).toBeGreaterThanOrEqual(2);
    });
  });

  describe('GET /api/v1/dashboard/top-routes', () => {
    it('returns a ranked list shaped as TopRouteItem[]', async () => {
      const query = buildQueryString({ period: 'last30days', limit: 50 });
      const response = await authorizedGet(app, `/api/v1/dashboard/top-routes${query}`, adminToken);

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<TopRouteItemResponse[]>;

      expect(Array.isArray(body.data)).toBe(true);

      for (const item of body.data) {
        expect(typeof item.routeId).toBe('string');
        expect(typeof item.requests).toBe('number');
      }
    });
  });

  describe('GET /api/v1/dashboard/status-distribution', () => {
    it('groups request counts by status code', async () => {
      const query = buildQueryString({ period: 'last30days' });
      const response = await authorizedGet(
        app,
        `/api/v1/dashboard/status-distribution${query}`,
        adminToken,
      );

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<StatusDistributionItemResponse[]>;

      const status200 = body.data.find((item) => item.statusCode === 200);
      const status500 = body.data.find((item) => item.statusCode === 500);

      expect(status200?.total).toBeGreaterThanOrEqual(1);
      expect(status500?.total).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /api/v1/dashboard/top-errors', () => {
    it('ranks the most frequent error codes', async () => {
      const query = buildQueryString({ period: 'last30days', limit: 50 });
      const response = await authorizedGet(app, `/api/v1/dashboard/top-errors${query}`, adminToken);

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<TopErrorItemResponse[]>;
      const entry = body.data.find((item) => item.errorCode === 'UPSTREAM_TIMEOUT');

      expect(entry).toBeDefined();
      expect(entry?.total).toBeGreaterThanOrEqual(2);
    });
  });

  describe('GET /api/v1/dashboard/top-source-ips', () => {
    it('ranks source IPs by request volume', async () => {
      const query = buildQueryString({ period: 'last30days', limit: 50 });
      const response = await authorizedGet(
        app,
        `/api/v1/dashboard/top-source-ips${query}`,
        adminToken,
      );

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<TopSourceIpItemResponse[]>;
      const entry = body.data.find((item) => item.sourceIp === sharedIp);

      expect(entry).toBeDefined();
      expect(entry?.requests).toBeGreaterThanOrEqual(2);
    });
  });

  describe('GET /api/v1/dashboard/recent-requests', () => {
    it('includes recently created request logs', async () => {
      const query = buildQueryString({ period: 'last30days' });
      const response = await authorizedGet(
        app,
        `/api/v1/dashboard/recent-requests${query}`,
        adminToken,
      );

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<RecentRequestItemResponse[]>;
      const requestIds = body.data.map((item) => item.requestId);

      const hasAtLeastOneOfOurLogs = [
        log1.requestId,
        log2.requestId,
        log3.requestId,
        log4.requestId,
      ].some((requestId) => requestIds.includes(requestId));

      expect(hasAtLeastOneOfOurLogs).toBe(true);
    });
  });

  describe('GET /api/v1/dashboard/health', () => {
    it('always reports a healthy gateway, regardless of period', async () => {
      const response = await authorizedGet(app, '/api/v1/dashboard/health', adminToken);

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<DashboardHealthResponse>;

      expect(body.data.gatewayStatus).toBe('healthy');
      expect(body.data.database).toBe('healthy');
      expect(typeof body.data.uptimeSeconds).toBe('number');
      expect(typeof body.data.version).toBe('string');
      expect(typeof body.data.environment).toBe('string');
    });

    it('returns 401 without a token', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/dashboard/health');

      expect(response.status).toBe(401);
    });

    it.each([
      ['ADMIN', () => adminToken],
      ['OPERATOR', () => operatorToken],
      ['VIEWER', () => viewerToken],
      ['AUDITOR', () => auditorToken],
    ])('allows the %s role to read health', async (_roleName, getToken) => {
      const response = await authorizedGet(app, '/api/v1/dashboard/health', getToken());

      expect(response.status).toBe(200);
    });
  });
});
