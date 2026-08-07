import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import { TrustedCaDispatcherService } from '../../src/modules/trusted-cas/trusted-ca-dispatcher.service';
import {
  AllowedIpType,
  AuditEntity,
  GatewayHttpMethod,
  RoleCode,
} from '../../generated/prisma/client';
import { createTestApiKey } from '../helpers/factories/api-key.factory';
import { createTestClient } from '../helpers/factories/client.factory';
import { createTestGatewayRoute } from '../helpers/factories/gateway-route.factory';
import { createTestUser } from '../helpers/factories/user.factory';
import type { MockSecureUpstreamServer } from '../helpers/mock-secure-upstream-server.helper';
import { startMockSecureUpstreamServer } from '../helpers/mock-secure-upstream-server.helper';
import { signTestAccessToken } from '../helpers/jwt.helper';
import { createTestApp } from '../helpers/test-app.helper';
import { TestDatabase } from '../helpers/test-database.helper';
import { createTestCertificateAuthority } from '../helpers/tls-certificate.helper';

function uploadTrustedCa(
  app: NestFastifyApplication,
  token: string,
  name: string,
  filename: string,
  pemContent: string,
) {
  return request(app.getHttpServer())
    .post('/api/v1/trusted-cas')
    .set('Authorization', `Bearer ${token}`)
    .field('name', name)
    .attach('file', Buffer.from(pemContent, 'utf8'), {
      filename,
      contentType: 'application/x-pem-file',
    });
}

async function allowLoopbackAddresses(db: TestDatabase, clientId: string): Promise<void> {
  await db.prisma.allowedIp.createMany({
    data: [
      { clientId, address: '127.0.0.1', type: AllowedIpType.IPV4 },
      { clientId, address: '::1', type: AllowedIpType.IPV6 },
    ],
  });
}

describe('Gateway Proxy + Trusted CAs (integration)', () => {
  let app: NestFastifyApplication;
  let db: TestDatabase;
  let adminToken: string;
  let adminUserId: string;
  let secureServerA: MockSecureUpstreamServer;
  let secureServerB: MockSecureUpstreamServer;
  let secureServerUnknown: MockSecureUpstreamServer;

  const certificateAuthorityA = createTestCertificateAuthority({
    commonName: 'Gateway Hub LF TLS Root CA A',
    hosts: ['127.0.0.1', 'localhost'],
  });
  const certificateAuthorityB = createTestCertificateAuthority({
    commonName: 'Gateway Hub LF TLS Root CA B',
    hosts: ['127.0.0.1', 'localhost'],
  });
  const certificateAuthorityUnknown = createTestCertificateAuthority({
    commonName: 'Gateway Hub LF TLS Unknown Root CA',
    hosts: ['127.0.0.1', 'localhost'],
  });

  beforeAll(async () => {
    db = new TestDatabase();
    await db.connect();
    app = await createTestApp();

    const { user: adminUser } = await createTestUser(db, { roleCode: RoleCode.ADMIN });

    adminUserId = adminUser.id;
    adminToken = signTestAccessToken({
      id: adminUser.id,
      username: adminUser.username,
      email: adminUser.email,
      role: RoleCode.ADMIN,
      roleLevel: 100,
      firstLogin: false,
    });

    secureServerA = await startMockSecureUpstreamServer({
      certificatePem: certificateAuthorityA.certificatePem,
      privateKeyPem: certificateAuthorityA.privateKeyPem,
    });
    secureServerB = await startMockSecureUpstreamServer({
      certificatePem: certificateAuthorityB.certificatePem,
      privateKeyPem: certificateAuthorityB.privateKeyPem,
    });
    secureServerUnknown = await startMockSecureUpstreamServer({
      certificatePem: certificateAuthorityUnknown.certificatePem,
      privateKeyPem: certificateAuthorityUnknown.privateKeyPem,
    });
  });

  afterEach(async () => {
    await db.prisma.routeHeader.deleteMany();
    await db.prisma.requestLog.deleteMany();
    await db.prisma.auditLog.deleteMany({
      where: { entity: AuditEntity.TRUSTED_CA },
    });
    await db.prisma.trustedCa.deleteMany();
    await db.prisma.apiKey.deleteMany();
    await db.prisma.allowedIp.deleteMany();
    await db.prisma.gatewayRoute.deleteMany();
    await db.prisma.client.deleteMany();
    await app.get(TrustedCaDispatcherService).invalidateDispatcher();
  });

  afterAll(async () => {
    await secureServerA.close();
    await secureServerB.close();
    await secureServerUnknown.close();
    await db.prisma.user.deleteMany({ where: { id: adminUserId } });
    await app.close();
    await db.disconnect();
  });

  it('starts rejecting an internal HTTPS upstream, succeeds after CA upload, and stops trusting it after deactivate/delete without restart', async () => {
    const client = await createTestClient(db);
    const { fullKey } = await createTestApiKey(db, client.id);
    const route = await createTestGatewayRoute(db, client.id, {
      destinationUrl: `${secureServerA.url}/tls-a`,
      method: GatewayHttpMethod.GET,
      retryCount: 0,
    });

    await allowLoopbackAddresses(db, client.id);
    secureServerA.setRoute('/tls-a', {
      statusCode: 200,
      body: { ok: 'tls-a' },
    });

    const beforeUpload = await request(app.getHttpServer())
      .get(`/gateway${route.slug}`)
      .set('X-API-Key', fullKey);

    expect(beforeUpload.status).toBe(502);
    expect(beforeUpload.body.code).toBe('UPSTREAM_UNAVAILABLE');

    const uploadResponse = await uploadTrustedCa(
      app,
      adminToken,
      'Gateway Hub LF TLS Root CA A',
      'tls-root-ca-a.pem',
      certificateAuthorityA.certificatePem,
    );

    expect(uploadResponse.status).toBe(201);
    const trustedCaId = uploadResponse.body.data.id as string;

    const afterUpload = await request(app.getHttpServer())
      .get(`/gateway${route.slug}`)
      .set('X-API-Key', fullKey);

    expect(afterUpload.status).toBe(200);
    expect(afterUpload.body).toEqual({ ok: 'tls-a' });

    const unknownCaResponse = await createTestGatewayRoute(db, client.id, {
      destinationUrl: `${secureServerUnknown.url}/tls-unknown`,
      method: GatewayHttpMethod.GET,
      retryCount: 0,
      slug: `${route.slug}-unknown`,
    });

    secureServerUnknown.setRoute('/tls-unknown', {
      statusCode: 200,
      body: { ok: 'unknown' },
    });

    const stillUnknown = await request(app.getHttpServer())
      .get(`/gateway${unknownCaResponse.slug}`)
      .set('X-API-Key', fullKey);

    expect(stillUnknown.status).toBe(502);
    expect(stillUnknown.body.code).toBe('UPSTREAM_UNAVAILABLE');

    const deactivateResponse = await request(app.getHttpServer())
      .patch(`/api/v1/trusted-cas/${trustedCaId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: false });

    expect(deactivateResponse.status).toBe(200);

    const afterDeactivate = await request(app.getHttpServer())
      .get(`/gateway${route.slug}`)
      .set('X-API-Key', fullKey);

    expect(afterDeactivate.status).toBe(502);
    expect(afterDeactivate.body.code).toBe('UPSTREAM_UNAVAILABLE');

    const reactivateResponse = await request(app.getHttpServer())
      .patch(`/api/v1/trusted-cas/${trustedCaId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: true });

    expect(reactivateResponse.status).toBe(200);

    const afterReactivate = await request(app.getHttpServer())
      .get(`/gateway${route.slug}`)
      .set('X-API-Key', fullKey);

    expect(afterReactivate.status).toBe(200);
    expect(afterReactivate.body).toEqual({ ok: 'tls-a' });

    const deleteResponse = await request(app.getHttpServer())
      .delete(`/api/v1/trusted-cas/${trustedCaId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(deleteResponse.status).toBe(204);

    const afterDelete = await request(app.getHttpServer())
      .get(`/gateway${route.slug}`)
      .set('X-API-Key', fullKey);

    expect(afterDelete.status).toBe(502);
    expect(afterDelete.body.code).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('supports multiple active internal CAs and only removes trust for the one that was deactivated', async () => {
    const client = await createTestClient(db);
    const { fullKey } = await createTestApiKey(db, client.id);
    const routeA = await createTestGatewayRoute(db, client.id, {
      destinationUrl: `${secureServerA.url}/tls-a-multi`,
      method: GatewayHttpMethod.GET,
      retryCount: 0,
      slug: `/tls-a-multi-${client.code.toLowerCase()}`,
    });
    const routeB = await createTestGatewayRoute(db, client.id, {
      destinationUrl: `${secureServerB.url}/tls-b-multi`,
      method: GatewayHttpMethod.GET,
      retryCount: 0,
      slug: `/tls-b-multi-${client.code.toLowerCase()}`,
    });

    await allowLoopbackAddresses(db, client.id);
    secureServerA.setRoute('/tls-a-multi', {
      statusCode: 200,
      body: { ok: 'tls-a-multi' },
    });
    secureServerB.setRoute('/tls-b-multi', {
      statusCode: 200,
      body: { ok: 'tls-b-multi' },
    });

    const uploadA = await uploadTrustedCa(
      app,
      adminToken,
      'Gateway Hub LF TLS Root CA A',
      'tls-root-ca-a.pem',
      certificateAuthorityA.certificatePem,
    );
    const uploadB = await uploadTrustedCa(
      app,
      adminToken,
      'Gateway Hub LF TLS Root CA B',
      'tls-root-ca-b.pem',
      certificateAuthorityB.certificatePem,
    );

    expect(uploadA.status).toBe(201);
    expect(uploadB.status).toBe(201);

    const trustedCaAId = uploadA.body.data.id as string;

    const responseA = await request(app.getHttpServer())
      .get(`/gateway${routeA.slug}`)
      .set('X-API-Key', fullKey);
    const responseB = await request(app.getHttpServer())
      .get(`/gateway${routeB.slug}`)
      .set('X-API-Key', fullKey);

    expect(responseA.status).toBe(200);
    expect(responseB.status).toBe(200);

    const deactivateA = await request(app.getHttpServer())
      .patch(`/api/v1/trusted-cas/${trustedCaAId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: false });

    expect(deactivateA.status).toBe(200);

    const afterDeactivateA = await request(app.getHttpServer())
      .get(`/gateway${routeA.slug}`)
      .set('X-API-Key', fullKey);
    const afterDeactivateB = await request(app.getHttpServer())
      .get(`/gateway${routeB.slug}`)
      .set('X-API-Key', fullKey);

    expect(afterDeactivateA.status).toBe(502);
    expect(afterDeactivateA.body.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(afterDeactivateB.status).toBe(200);
    expect(afterDeactivateB.body).toEqual({ ok: 'tls-b-multi' });
  });
});
