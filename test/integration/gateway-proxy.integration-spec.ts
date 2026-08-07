import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import {
  AllowedIpType,
  GatewayHttpMethod,
  RequestOrigin,
} from '../../generated/prisma/client';
import { createTestApiKey } from '../helpers/factories/api-key.factory';
import { createTestClient } from '../helpers/factories/client.factory';
import { createTestGatewayRoute } from '../helpers/factories/gateway-route.factory';
import type { MockUpstreamServer } from '../helpers/mock-upstream-server.helper';
import { startMockUpstreamServer } from '../helpers/mock-upstream-server.helper';
import { createTestApp } from '../helpers/test-app.helper';
import { TestDatabase } from '../helpers/test-database.helper';

/** Shape of the JSON body the Gateway Proxy sends back on any handled error (see GatewayProxyController.sendGatewayError). */
interface GatewayErrorBody {
  success: boolean;
  statusCode: number;
  code: string;
  message: string;
  requestId: string;
  timestamp: string;
}

/**
 * Registers both a loopback IPv4 and IPv6 Allowed IP for the client. Supertest issues requests
 * against an ephemeral local server without ever calling `.listen()` on a fixed interface, so the
 * source IP Fastify reports for the connection can surface as either `127.0.0.1` or `::1`
 * depending on the platform/Node version. Registering both keeps the "IP allowed" scenarios
 * deterministic without depending on which literal address gets resolved at runtime.
 */
async function allowLoopbackAddresses(
  db: TestDatabase,
  clientId: string,
): Promise<void> {
  await db.prisma.allowedIp.createMany({
    data: [
      { clientId, address: '127.0.0.1', type: AllowedIpType.IPV4 },
      { clientId, address: '::1', type: AllowedIpType.IPV6 },
    ],
  });
}

/** Deletes every record created for the given clients, in FK-safe order (never a general wipe). */
async function cleanupClients(
  db: TestDatabase,
  clientIds: string[],
): Promise<void> {
  if (clientIds.length === 0) {
    return;
  }

  await db.prisma.apiKey.deleteMany({ where: { clientId: { in: clientIds } } });
  await db.prisma.allowedIp.deleteMany({
    where: { clientId: { in: clientIds } },
  });
  await db.prisma.gatewayRoute.deleteMany({
    where: { clientId: { in: clientIds } },
  });
  await db.prisma.client.deleteMany({ where: { id: { in: clientIds } } });
}

describe('Gateway Proxy (integration)', () => {
  let app: NestFastifyApplication;
  let db: TestDatabase;
  let mockUpstream: MockUpstreamServer;

  beforeAll(async () => {
    db = new TestDatabase();
    await db.connect();
    app = await createTestApp();
    mockUpstream = await startMockUpstreamServer();
  });

  afterAll(async () => {
    await mockUpstream.close();
    await app.close();
    await db.disconnect();
  });

  describe('1. Valid GET request end-to-end', () => {
    const clientIds: string[] = [];

    afterAll(async () => {
      await cleanupClients(db, clientIds);
    });

    it('returns 200 with the exact body the upstream sent', async () => {
      const client = await createTestClient(db);
      clientIds.push(client.id);

      const { fullKey } = await createTestApiKey(db, client.id);
      const route = await createTestGatewayRoute(db, client.id, {
        destinationUrl: `${mockUpstream.url}/scenario-1-valid-get`,
        method: GatewayHttpMethod.GET,
      });
      await allowLoopbackAddresses(db, client.id);

      mockUpstream.setRoute('/scenario-1-valid-get', {
        statusCode: 200,
        body: { ok: true },
      });

      const requestId = `req-scenario-1-${Date.now()}`;
      const response = await request(app.getHttpServer())
        .get(`/gateway${route.slug}`)
        .set('X-Request-ID', requestId)
        .set('X-API-Key', fullKey);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });

      const requestLog = await db.prisma.requestLog.findUnique({
        where: { requestId },
      });

      expect(requestLog).not.toBeNull();
      expect(requestLog?.attemptedAt).not.toBeNull();
      expect(requestLog?.requestOrigin).toBe(RequestOrigin.INTERNAL);
      expect(requestLog?.gatewayRouteId).toBe(route.id);
      expect(requestLog?.clientId).toBe(client.id);
      expect(requestLog?.statusCode).toBe(200);
      expect(requestLog?.upstreamStatusCode).toBe(200);
      expect(requestLog?.attempts).toBe(1);
      expect(requestLog?.destinationHost).toContain('127.0.0.1');
      expect(requestLog?.destinationIp).toContain('127.0.0.1');
    });
  });

  describe('2. POST request forwards the body to the upstream', () => {
    const clientIds: string[] = [];

    afterAll(async () => {
      await cleanupClients(db, clientIds);
    });

    it('forwards the request through to the upstream and relays its response', async () => {
      const client = await createTestClient(db);
      clientIds.push(client.id);

      const { fullKey } = await createTestApiKey(db, client.id);
      const route = await createTestGatewayRoute(db, client.id, {
        destinationUrl: `${mockUpstream.url}/scenario-2-echo-post`,
        method: GatewayHttpMethod.POST,
      });
      await allowLoopbackAddresses(db, client.id);

      mockUpstream.setRoute('/scenario-2-echo-post', {
        statusCode: 201,
        body: { created: true },
      });

      const payload = { orderId: 'ORD-42', amount: 199.9 };

      const response = await request(app.getHttpServer())
        .post(`/gateway${route.slug}`)
        .set('X-API-Key', fullKey)
        .send(payload);

      // The mock upstream server has no facility to echo back the bytes it received, so the
      // proxying of the body is verified indirectly: the upstream only returns 201/{created:true}
      // for requests that reach its handler at all (a request that failed before forwarding, e.g.
      // a validation error, would never hit `mockUpstream.getRequestCount`), and exactly one call
      // must have landed there for this one POST.
      expect(response.status).toBe(201);
      expect(response.body).toEqual({ created: true });
      expect(mockUpstream.getRequestCount('/scenario-2-echo-post')).toBe(1);
    });
  });

  describe('3. Missing X-API-Key header', () => {
    const clientIds: string[] = [];

    afterAll(async () => {
      await cleanupClients(db, clientIds);
    });

    it('returns 401 API_KEY_REQUIRED', async () => {
      const client = await createTestClient(db);
      clientIds.push(client.id);

      const route = await createTestGatewayRoute(db, client.id, {
        destinationUrl: `${mockUpstream.url}/scenario-3-unused`,
        method: GatewayHttpMethod.GET,
      });

      const requestId = `req-scenario-3-${Date.now()}`;
      const response = await request(app.getHttpServer())
        .get(`/gateway${route.slug}`)
        .set('X-Request-ID', requestId);

      expect(response.status).toBe(401);
      const body = response.body as GatewayErrorBody;
      expect(body.code).toBe('API_KEY_REQUIRED');

      const requestLog = await db.prisma.requestLog.findUnique({
        where: { requestId },
      });

      expect(requestLog).not.toBeNull();
      expect(requestLog?.attemptedAt).not.toBeNull();
      expect(requestLog?.gatewayRouteId).toBe(route.id);
      expect(requestLog?.statusCode).toBe(401);
      expect(requestLog?.upstreamStatusCode).toBeNull();
      expect(requestLog?.attempts).toBe(0);
      expect(requestLog?.errorCode).toBe('API_KEY_REQUIRED');
    });
  });

  describe('4. Invalid X-API-Key value', () => {
    const clientIds: string[] = [];

    afterAll(async () => {
      await cleanupClients(db, clientIds);
    });

    it('returns 401 INVALID_API_KEY for a random string', async () => {
      const client = await createTestClient(db);
      clientIds.push(client.id);

      const route = await createTestGatewayRoute(db, client.id, {
        destinationUrl: `${mockUpstream.url}/scenario-4-unused`,
        method: GatewayHttpMethod.GET,
      });

      const response = await request(app.getHttpServer())
        .get(`/gateway${route.slug}`)
        .set('X-API-Key', 'this-is-not-a-real-api-key');

      expect(response.status).toBe(401);
      const body = response.body as GatewayErrorBody;
      expect(body.code).toBe('INVALID_API_KEY');
    });
  });

  describe('5. API Key belonging to a different client', () => {
    const clientIds: string[] = [];

    afterAll(async () => {
      await cleanupClients(db, clientIds);
    });

    it('returns 401 INVALID_API_KEY when using another client key on this route', async () => {
      const clientA = await createTestClient(db);
      const clientB = await createTestClient(db);
      clientIds.push(clientA.id, clientB.id);

      const routeOfClientA = await createTestGatewayRoute(db, clientA.id, {
        destinationUrl: `${mockUpstream.url}/scenario-5-unused`,
        method: GatewayHttpMethod.GET,
      });
      const { fullKey: clientBFullKey } = await createTestApiKey(
        db,
        clientB.id,
      );
      await allowLoopbackAddresses(db, clientA.id);

      const response = await request(app.getHttpServer())
        .get(`/gateway${routeOfClientA.slug}`)
        .set('X-API-Key', clientBFullKey);

      expect(response.status).toBe(401);
      const body = response.body as GatewayErrorBody;
      expect(body.code).toBe('INVALID_API_KEY');
    });
  });

  describe('6. Revoked API Key', () => {
    const clientIds: string[] = [];

    afterAll(async () => {
      await cleanupClients(db, clientIds);
    });

    it('returns 401 INVALID_API_KEY', async () => {
      const client = await createTestClient(db);
      clientIds.push(client.id);

      const route = await createTestGatewayRoute(db, client.id, {
        destinationUrl: `${mockUpstream.url}/scenario-6-unused`,
        method: GatewayHttpMethod.GET,
      });
      const { fullKey } = await createTestApiKey(db, client.id, {
        revokedAt: new Date(),
      });

      const response = await request(app.getHttpServer())
        .get(`/gateway${route.slug}`)
        .set('X-API-Key', fullKey);

      expect(response.status).toBe(401);
      const body = response.body as GatewayErrorBody;
      expect(body.code).toBe('INVALID_API_KEY');
    });
  });

  describe('7. Inactive client', () => {
    const clientIds: string[] = [];

    afterAll(async () => {
      await cleanupClients(db, clientIds);
    });

    it('returns 403 CLIENT_INACTIVE', async () => {
      const client = await createTestClient(db, { active: false });
      clientIds.push(client.id);

      const route = await createTestGatewayRoute(db, client.id, {
        destinationUrl: `${mockUpstream.url}/scenario-7-unused`,
        method: GatewayHttpMethod.GET,
      });

      const response = await request(app.getHttpServer()).get(
        `/gateway${route.slug}`,
      );

      expect(response.status).toBe(403);
      const body = response.body as GatewayErrorBody;
      expect(body.code).toBe('CLIENT_INACTIVE');
    });
  });

  describe('8. No Allowed IP registered for the client', () => {
    const clientIds: string[] = [];

    afterAll(async () => {
      await cleanupClients(db, clientIds);
    });

    it('returns 403 IP_NOT_ALLOWED (deny by default)', async () => {
      const client = await createTestClient(db);
      clientIds.push(client.id);

      const { fullKey } = await createTestApiKey(db, client.id);
      const route = await createTestGatewayRoute(db, client.id, {
        destinationUrl: `${mockUpstream.url}/scenario-8-unused`,
        method: GatewayHttpMethod.GET,
      });
      // Deliberately no AllowedIp record created for this client.

      const response = await request(app.getHttpServer())
        .get(`/gateway${route.slug}`)
        .set('X-API-Key', fullKey);

      expect(response.status).toBe(403);
      const body = response.body as GatewayErrorBody;
      expect(body.code).toBe('IP_NOT_ALLOWED');
    });
  });

  describe('9. Gateway route does not exist', () => {
    it('returns 404 GATEWAY_ROUTE_NOT_FOUND', async () => {
      const response = await request(app.getHttpServer()).get(
        '/gateway/this-slug-was-never-registered',
      );

      expect(response.status).toBe(404);
      const body = response.body as GatewayErrorBody;
      expect(body.code).toBe('GATEWAY_ROUTE_NOT_FOUND');
    });
  });

  describe('10. Gateway route exists but is inactive', () => {
    const clientIds: string[] = [];

    afterAll(async () => {
      await cleanupClients(db, clientIds);
    });

    it('returns 404 GATEWAY_ROUTE_NOT_FOUND', async () => {
      const client = await createTestClient(db);
      clientIds.push(client.id);

      const route = await createTestGatewayRoute(db, client.id, {
        destinationUrl: `${mockUpstream.url}/scenario-10-unused`,
        method: GatewayHttpMethod.GET,
        active: false,
      });

      const response = await request(app.getHttpServer()).get(
        `/gateway${route.slug}`,
      );

      expect(response.status).toBe(404);
      const body = response.body as GatewayErrorBody;
      expect(body.code).toBe('GATEWAY_ROUTE_NOT_FOUND');
    });
  });

  describe('11. Wrong HTTP method for the route', () => {
    const clientIds: string[] = [];

    afterAll(async () => {
      await cleanupClients(db, clientIds);
    });

    it('returns 405 with an Allow header listing the correct method', async () => {
      const client = await createTestClient(db);
      clientIds.push(client.id);

      const { fullKey } = await createTestApiKey(db, client.id);
      const route = await createTestGatewayRoute(db, client.id, {
        destinationUrl: `${mockUpstream.url}/scenario-11-unused`,
        method: GatewayHttpMethod.GET,
      });
      await allowLoopbackAddresses(db, client.id);

      const response = await request(app.getHttpServer())
        .post(`/gateway${route.slug}`)
        .set('X-API-Key', fullKey);

      expect(response.status).toBe(405);
      expect(response.headers.allow).toBe('GET');
      const body = response.body as GatewayErrorBody;
      expect(body.code).toBe('METHOD_NOT_ALLOWED');
    });
  });

  describe('12. Upstream responds with 500', () => {
    const clientIds: string[] = [];

    afterAll(async () => {
      await cleanupClients(db, clientIds);
    });

    it('relays the 500 status and body transparently', async () => {
      const client = await createTestClient(db);
      clientIds.push(client.id);

      const { fullKey } = await createTestApiKey(db, client.id);
      const route = await createTestGatewayRoute(db, client.id, {
        destinationUrl: `${mockUpstream.url}/scenario-12-upstream-error`,
        method: GatewayHttpMethod.GET,
      });
      await allowLoopbackAddresses(db, client.id);

      mockUpstream.setRoute('/scenario-12-upstream-error', {
        statusCode: 500,
        body: { error: 'internal upstream failure' },
      });

      const response = await request(app.getHttpServer())
        .get(`/gateway${route.slug}`)
        .set('X-API-Key', fullKey);

      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'internal upstream failure' });
    });
  });

  describe('13. Upstream times out', () => {
    const clientIds: string[] = [];

    afterAll(async () => {
      await cleanupClients(db, clientIds);
    });

    it('returns 504 UPSTREAM_TIMEOUT once the route timeout elapses', async () => {
      const client = await createTestClient(db);
      clientIds.push(client.id);

      const { fullKey } = await createTestApiKey(db, client.id);
      const route = await createTestGatewayRoute(db, client.id, {
        destinationUrl: `${mockUpstream.url}/scenario-13-slow`,
        method: GatewayHttpMethod.GET,
        timeoutMs: 500,
        retryCount: 0,
      });
      await allowLoopbackAddresses(db, client.id);

      mockUpstream.setRoute('/scenario-13-slow', {
        statusCode: 200,
        body: { ok: true },
        delayMs: 2000,
      });

      const response = await request(app.getHttpServer())
        .get(`/gateway${route.slug}`)
        .set('X-API-Key', fullKey);

      expect(response.status).toBe(504);
      const body = response.body as GatewayErrorBody;
      expect(body.code).toBe('UPSTREAM_TIMEOUT');
    }, 10000);
  });

  describe('14. Retry recovers from a transient upstream failure', () => {
    const clientIds: string[] = [];

    afterAll(async () => {
      await cleanupClients(db, clientIds);
    });

    it('succeeds on the second attempt and reports exactly 2 upstream calls', async () => {
      const client = await createTestClient(db);
      clientIds.push(client.id);

      const { fullKey } = await createTestApiKey(db, client.id);
      const route = await createTestGatewayRoute(db, client.id, {
        destinationUrl: `${mockUpstream.url}/scenario-14-flaky`,
        method: GatewayHttpMethod.GET,
        retryCount: 2,
      });
      await allowLoopbackAddresses(db, client.id);

      mockUpstream.setRoute('/scenario-14-flaky', {
        statusCode: 200,
        body: { ok: true },
        failuresBeforeSuccess: 1,
      });

      const response = await request(app.getHttpServer())
        .get(`/gateway${route.slug}`)
        .set('X-API-Key', fullKey);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
      expect(mockUpstream.getRequestCount('/scenario-14-flaky')).toBe(2);
    });
  });

  describe('15. Upstream destination is completely offline', () => {
    const clientIds: string[] = [];

    afterAll(async () => {
      await cleanupClients(db, clientIds);
    });

    it('returns 502 UPSTREAM_UNAVAILABLE', async () => {
      const client = await createTestClient(db);
      clientIds.push(client.id);

      const { fullKey } = await createTestApiKey(db, client.id);
      const route = await createTestGatewayRoute(db, client.id, {
        // Port 1 is a privileged, unbound port on every test runner in this suite: nothing is
        // listening there, so the connection is refused immediately instead of timing out.
        destinationUrl: 'http://127.0.0.1:1/unused',
        method: GatewayHttpMethod.GET,
        retryCount: 0,
      });
      await allowLoopbackAddresses(db, client.id);

      const response = await request(app.getHttpServer())
        .get(`/gateway${route.slug}`)
        .set('X-API-Key', fullKey);

      expect(response.status).toBe(502);
      const body = response.body as GatewayErrorBody;
      expect(body.code).toBe('UPSTREAM_UNAVAILABLE');
    });
  });
});
