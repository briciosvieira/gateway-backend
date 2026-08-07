import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import type { ApiErrorResponse } from '../../src/common/interfaces/api-error-response.interface';
import type { ApiResponse } from '../../src/common/interfaces/api-response.interface';
import { TrustedCaDispatcherService } from '../../src/modules/trusted-cas/trusted-ca-dispatcher.service';
import {
  AuditAction,
  AuditEntity,
  RoleCode,
} from '../../generated/prisma/client';
import { createTestUser } from '../helpers/factories/user.factory';
import { signTestAccessToken } from '../helpers/jwt.helper';
import { createTestApp } from '../helpers/test-app.helper';
import { TestDatabase } from '../helpers/test-database.helper';
import { createTestCertificateAuthority } from '../helpers/tls-certificate.helper';

interface TrustedCaResource {
  id: string;
  name: string;
  fingerprintSha256: string;
  subject: string;
  issuer: string;
  serialNumber: string;
  validFrom: string;
  validTo: string;
  isRoot: boolean;
  active: boolean;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

interface TrustedCaListResource {
  items: TrustedCaResource[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  filters: Record<string, unknown>;
}

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

describe('Trusted CAs (integration)', () => {
  let app: NestFastifyApplication;
  let db: TestDatabase;
  let adminToken: string;
  let operatorToken: string;
  let adminUserId: string;
  let operatorUserId: string;

  beforeAll(async () => {
    db = new TestDatabase();
    await db.connect();
    app = await createTestApp();

    const { user: adminUser } = await createTestUser(db, { roleCode: RoleCode.ADMIN });
    const { user: operatorUser } = await createTestUser(db, { roleCode: RoleCode.OPERATOR });

    adminUserId = adminUser.id;
    operatorUserId = operatorUser.id;

    adminToken = signTestAccessToken({
      id: adminUser.id,
      username: adminUser.username,
      email: adminUser.email,
      role: RoleCode.ADMIN,
      roleLevel: 100,
      firstLogin: false,
    });
    operatorToken = signTestAccessToken({
      id: operatorUser.id,
      username: operatorUser.username,
      email: operatorUser.email,
      role: RoleCode.OPERATOR,
      roleLevel: 50,
      firstLogin: false,
    });
  });

  afterEach(async () => {
    await db.prisma.auditLog.deleteMany({
      where: { entity: AuditEntity.TRUSTED_CA },
    });
    await db.prisma.trustedCa.deleteMany();
    await app.get(TrustedCaDispatcherService).invalidateDispatcher();
  });

  afterAll(async () => {
    await db.prisma.user.deleteMany({
      where: { id: { in: [adminUserId, operatorUserId] } },
    });
    await app.close();
    await db.disconnect();
  });

  it('uploads a trusted CA via multipart, stores the PEM internally and never returns certificatePem', async () => {
    const certificateAuthority = createTestCertificateAuthority({
      commonName: 'Gateway Hub LF Integration Root CA',
    });

    const response = await uploadTrustedCa(
      app,
      adminToken,
      'Gateway Hub LF Integration Root CA',
      'integration-root-ca.pem',
      certificateAuthority.certificatePem,
    );

    expect(response.status).toBe(201);

    const body = response.body as ApiResponse<TrustedCaResource>;
    expect(body.data.name).toBe('Gateway Hub LF Integration Root CA');
    expect(body.data.fingerprintSha256).toContain(':');
    expect(body.data).not.toHaveProperty('certificatePem');

    const storedTrustedCa = await db.prisma.trustedCa.findUniqueOrThrow({
      where: { id: body.data.id },
    });

    expect(storedTrustedCa.certificatePem).toContain('BEGIN CERTIFICATE');
    expect(storedTrustedCa.createdById).toBe(adminUserId);
  });

  it('lists, details, updates status and deletes trusted CAs as ADMIN only', async () => {
    const certificateAuthority = createTestCertificateAuthority({
      commonName: 'Gateway Hub LF Admin Root CA',
    });

    const createResponse = await uploadTrustedCa(
      app,
      adminToken,
      'Gateway Hub LF Admin Root CA',
      'admin-root-ca.pem',
      certificateAuthority.certificatePem,
    );

    const createdTrustedCaId = (createResponse.body as ApiResponse<TrustedCaResource>).data.id;

    const listResponse = await request(app.getHttpServer())
      .get('/api/v1/trusted-cas?search=Admin&active=true&validity=valid')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(listResponse.status).toBe(200);
    const listBody = listResponse.body as ApiResponse<TrustedCaListResource>;
    expect(listBody.data.items).toHaveLength(1);
    expect(listBody.data.items[0]?.id).toBe(createdTrustedCaId);

    const detailResponse = await request(app.getHttpServer())
      .get(`/api/v1/trusted-cas/${createdTrustedCaId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(detailResponse.status).toBe(200);
    const detailBody = detailResponse.body as ApiResponse<TrustedCaResource>;
    expect(detailBody.data.id).toBe(createdTrustedCaId);
    expect(detailBody.data).not.toHaveProperty('certificatePem');

    const deactivateResponse = await request(app.getHttpServer())
      .patch(`/api/v1/trusted-cas/${createdTrustedCaId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: false });

    expect(deactivateResponse.status).toBe(200);
    expect((deactivateResponse.body as ApiResponse<TrustedCaResource>).data.active).toBe(false);

    const auditActions = await db.prisma.auditLog.findMany({
      where: { entityId: createdTrustedCaId, entity: AuditEntity.TRUSTED_CA },
      orderBy: { createdAt: 'asc' },
    });

    expect(auditActions.map((item) => item.action)).toEqual([
      AuditAction.CREATE,
      AuditAction.DEACTIVATE,
    ]);
    expect(JSON.stringify(auditActions)).not.toContain('BEGIN CERTIFICATE');

    const deleteResponse = await request(app.getHttpServer())
      .delete(`/api/v1/trusted-cas/${createdTrustedCaId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(deleteResponse.status).toBe(204);
    await expect(
      db.prisma.trustedCa.findUnique({
        where: { id: createdTrustedCaId },
      }),
    ).resolves.toBeNull();
  });

  it('rejects invalid uploads and blocks non-admin access', async () => {
    const invalidResponse = await request(app.getHttpServer())
      .post('/api/v1/trusted-cas')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('name', 'Invalid Trusted CA')
      .attach(
        'file',
        Buffer.from('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----', 'utf8'),
        {
          filename: 'invalid.pem',
          contentType: 'application/x-pem-file',
        },
      );

    expect(invalidResponse.status).toBe(400);
    expect((invalidResponse.body as ApiErrorResponse).code).toBe('PRIVATE_KEY_NOT_ALLOWED');

    const forbiddenResponse = await request(app.getHttpServer())
      .get('/api/v1/trusted-cas')
      .set('Authorization', `Bearer ${operatorToken}`);

    expect(forbiddenResponse.status).toBe(403);
  });

  it('publishes the multipart contract in OpenAPI without exposing certificatePem', async () => {
    const response = await request(app.getHttpServer()).get('/docs-json');

    expect(response.status).toBe(200);

    const document = response.body as {
      paths: Record<string, Record<string, { requestBody?: { content?: Record<string, unknown> } }>>;
    };
    const trustedCasPost = document.paths['/api/v1/trusted-cas']?.post;

    expect(trustedCasPost?.requestBody?.content).toHaveProperty('multipart/form-data');
    expect(JSON.stringify(trustedCasPost)).toContain('"name"');
    expect(JSON.stringify(trustedCasPost)).toContain('"file"');
    expect(JSON.stringify(trustedCasPost)).not.toContain('certificatePem');
  });
});
