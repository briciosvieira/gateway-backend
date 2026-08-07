import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { GatewayHttpMethod, RoleCode } from '../../generated/prisma/client';
import { createTestApp } from '../helpers/test-app.helper';
import { TestDatabase } from '../helpers/test-database.helper';
import { createTestUser } from '../helpers/factories/user.factory';
import {
  randomIpv4,
  randomSlug,
  randomStrongPassword,
  randomSuffix,
} from '../helpers/random-data.helper';
import {
  startMockUpstreamServer,
} from '../helpers/mock-upstream-server.helper';
import type { MockUpstreamServer } from '../helpers/mock-upstream-server.helper';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  requestId: string;
}

interface LoginData {
  accessToken: string;
}

interface ClientData {
  id: string;
  code: string;
}

interface ApiKeyCreateData {
  apiKey: { id: string };
  key: string;
}

interface GatewayRouteData {
  id: string;
  slug: string;
  publicPath: string;
}

/**
 * Full end-to-end journey: boot the real application, provision every
 * resource through the real admin API (never touching the database
 * directly), drive traffic through the public Gateway Proxy against a local
 * mock upstream, and confirm the result surfaces correctly in Dashboard,
 * Request Logs and Audit Logs. This is deliberately a narrow "happy path +
 * the handful of failure modes explicitly requested" story — exhaustive
 * branch coverage per module already lives in test/integration.
 */
describe('Full flow (e2e)', () => {
  let app: NestFastifyApplication;
  let db: TestDatabase;
  let mockUpstream: MockUpstreamServer;
  let adminAccessToken: string;

  const createdClientIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    db = new TestDatabase();
    await db.connect();
    app = await createTestApp();
    mockUpstream = await startMockUpstreamServer();

    const password = randomStrongPassword();
    const { user } = await createTestUser(db, {
      roleCode: RoleCode.ADMIN,
      password,
    });
    createdUserIds.push(user.id);

    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ login: user.username, password })
      .expect(200);

    adminAccessToken = (loginResponse.body as ApiResponse<LoginData>).data.accessToken;
  });

  afterAll(async () => {
    await db.prisma.requestLog.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await db.prisma.routeHeader.deleteMany({
      where: { gatewayRoute: { clientId: { in: createdClientIds } } },
    });
    await db.prisma.apiKey.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await db.prisma.allowedIp.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await db.prisma.gatewayRoute.deleteMany({ where: { clientId: { in: createdClientIds } } });
    await db.prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
    await db.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });

    await mockUpstream.close();
    await app.close();
    await db.disconnect();
  });

  function authed(method: 'get' | 'post' | 'patch') {
    return (url: string) =>
      request(app.getHttpServer())
        [method](url)
        .set('Authorization', `Bearer ${adminAccessToken}`);
  }

  it('runs the entire administrative + gateway journey end to end', async () => {
    // 1. Provision a client through the real admin API — the identifier
    // ("code") is generated automatically from the name, never sent by the caller.
    const clientResponse = await authed('post')('/api/v1/clients')
      .send({ name: `E2E Journey Client ${randomSuffix(8)}` })
      .expect(201);
    const client = (clientResponse.body as ApiResponse<ClientData>).data;
    createdClientIds.push(client.id);

    // 2. Authorize this test process's own source IP so the proxy calls below succeed.
    await authed('post')('/api/v1/allowed-ips')
      .send({ clientId: client.id, address: '127.0.0.1', description: 'e2e loopback' })
      .expect(201);
    await authed('post')('/api/v1/allowed-ips')
      .send({ clientId: client.id, address: '::1', description: 'e2e loopback v6' })
      .expect(201);

    // 3. Issue an API Key.
    const apiKeyResponse = await authed('post')('/api/v1/api-keys')
      .send({ clientId: client.id, name: 'E2E Journey Key' })
      .expect(201);
    const { apiKey, key: fullApiKey } = (apiKeyResponse.body as ApiResponse<ApiKeyCreateData>).data;

    // 4. Create a Gateway Route pointing at the local mock upstream.
    const slug = randomSlug();
    const routeResponse = await authed('post')('/api/v1/gateway-routes')
      .send({
        clientId: client.id,
        name: 'E2E Journey Route',
        slug,
        destinationUrl: `${mockUpstream.url}/e2e-target`,
        method: GatewayHttpMethod.POST,
        timeoutMs: 5000,
        retryCount: 1,
      })
      .expect(201);
    const route = (routeResponse.body as ApiResponse<GatewayRouteData>).data;

    // 5. Attach a Route Header that must reach the upstream decrypted.
    await authed('post')('/api/v1/route-headers')
      .send({ gatewayRouteId: route.id, name: 'x-journey-tenant', value: 'tenant-42', sensitive: false })
      .expect(201);

    // 6. Successful proxy call.
    mockUpstream.setRoute('/e2e-target', { statusCode: 200, body: { received: true } });

    const successResponse = await request(app.getHttpServer())
      .post(route.publicPath)
      .set('X-API-Key', fullApiKey)
      .send({ message: 'hello upstream' })
      .expect(200);

    expect(successResponse.body).toEqual({ received: true });

    // 7. Invalid API Key is rejected before reaching the upstream.
    await request(app.getHttpServer())
      .post(route.publicPath)
      .set('X-API-Key', 'ghlf_00000000_not-a-real-key')
      .send({ message: 'should not pass' })
      .expect(401);

    // 8. Retry: the upstream fails once, then succeeds — the proxy must still return success.
    mockUpstream.setRoute('/e2e-target-retry', {
      statusCode: 200,
      body: { recoveredAfterRetry: true },
      failuresBeforeSuccess: 1,
    });
    const retryRouteResponse = await authed('post')('/api/v1/gateway-routes')
      .send({
        clientId: client.id,
        name: 'E2E Retry Route',
        slug: `${slug}-retry`,
        destinationUrl: `${mockUpstream.url}/e2e-target-retry`,
        method: GatewayHttpMethod.GET,
        timeoutMs: 5000,
        retryCount: 1,
      })
      .expect(201);
    const retryRoute = (retryRouteResponse.body as ApiResponse<GatewayRouteData>).data;

    const retryResponse = await request(app.getHttpServer())
      .get(retryRoute.publicPath)
      .set('X-API-Key', fullApiKey)
      .expect(200);

    expect(retryResponse.body).toEqual({ recoveredAfterRetry: true });
    expect(mockUpstream.getRequestCount('/e2e-target-retry')).toBe(2);

    // 9. Timeout: the upstream is slower than the route's configured timeout.
    mockUpstream.setRoute('/e2e-target-timeout', { statusCode: 200, body: {}, delayMs: 2500 });
    const timeoutRouteResponse = await authed('post')('/api/v1/gateway-routes')
      .send({
        clientId: client.id,
        name: 'E2E Timeout Route',
        slug: `${slug}-timeout`,
        destinationUrl: `${mockUpstream.url}/e2e-target-timeout`,
        method: GatewayHttpMethod.GET,
        timeoutMs: 1000,
        retryCount: 0,
      })
      .expect(201);
    const timeoutRoute = (timeoutRouteResponse.body as ApiResponse<GatewayRouteData>).data;

    const timeoutResponse = await request(app.getHttpServer())
      .get(timeoutRoute.publicPath)
      .set('X-API-Key', fullApiKey)
      .expect(504);

    expect((timeoutResponse.body as { code: string }).code).toBe('UPSTREAM_TIMEOUT');

    // 10. Health endpoint never requires authentication and never touches business data.
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);

    // 11. The successful call above must now be visible in Request Logs.
    const requestLogsResponse = await authed('get')(
      `/api/v1/request-logs?clientId=${client.id}&method=POST&statusCode=200`,
    ).expect(200);
    const requestLogsBody = requestLogsResponse.body as ApiResponse<{
      items: Array<{ statusCode: number; result: string }>;
    }>;
    expect(requestLogsBody.data.items.length).toBeGreaterThan(0);
    expect(requestLogsBody.data.items[0].result).toBe('SUCCESS');

    // 12. The Dashboard overview must reflect at least the traffic generated above.
    const overviewResponse = await authed('get')('/api/v1/dashboard/overview?period=today').expect(
      200,
    );
    const overview = (
      overviewResponse.body as ApiResponse<{ totalRequests: number; requestsInPeriod: number }>
    ).data;
    expect(overview.totalRequests).toBeGreaterThan(0);
    expect(overview.requestsInPeriod).toBeGreaterThan(0);

    // 13. Every administrative action above must be reflected in Audit Logs.
    const auditLogsResponse = await authed('get')(
      `/api/v1/audit-logs?entityId=${client.id}&entity=CLIENT&action=CREATE`,
    ).expect(200);
    const auditLogsBody = auditLogsResponse.body as ApiResponse<{ items: unknown[] }>;
    expect(auditLogsBody.data.items.length).toBeGreaterThan(0);

    // Keep the api-key id referenced so linting never flags it as unused if the
    // assertions above change — it also documents that key creation succeeded.
    expect(apiKey.id).toBeTruthy();
  }, 20000);
});
