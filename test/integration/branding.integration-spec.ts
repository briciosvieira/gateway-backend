import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import type { ApiErrorResponse } from '../../src/common/interfaces/api-error-response.interface';
import type { ApiResponse } from '../../src/common/interfaces/api-response.interface';
import {
  AuditAction,
  AuditEntity,
  RoleCode,
} from '../../generated/prisma/client';
import { createTestUser } from '../helpers/factories/user.factory';
import { signTestAccessToken } from '../helpers/jwt.helper';
import { createTestApp } from '../helpers/test-app.helper';
import { TestDatabase } from '../helpers/test-database.helper';

interface BrandingResource {
  applicationName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  brandImageUrl: string | null;
  updatedAt: string | null;
}

const pngBuffer = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);
const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);
const icoBuffer = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01]);
const validSvgBuffer = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="#111"/></svg>',
  'utf8',
);
const maliciousSvgBuffer = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  'utf8',
);

function uploadBrandingAsset(
  app: NestFastifyApplication,
  token: string,
  assetPath: 'logo' | 'favicon' | 'brand-image',
  buffer: Buffer,
  filename: string,
  contentType: string,
) {
  return request(app.getHttpServer())
    .post(`/api/v1/branding/${assetPath}`)
    .set('Authorization', `Bearer ${token}`)
    .attach('file', buffer, {
      filename,
      contentType,
    });
}

describe('Branding (integration)', () => {
  let app: NestFastifyApplication;
  let db: TestDatabase;
  let adminToken: string;
  let operatorToken: string;
  let viewerToken: string;
  let auditorToken: string;
  let userIds: string[];

  beforeAll(async () => {
    db = new TestDatabase();
    await db.connect();
    app = await createTestApp();

    const { user: adminUser } = await createTestUser(db, {
      roleCode: RoleCode.ADMIN,
    });
    const { user: operatorUser } = await createTestUser(db, {
      roleCode: RoleCode.OPERATOR,
    });
    const { user: viewerUser } = await createTestUser(db, {
      roleCode: RoleCode.VIEWER,
    });
    const { user: auditorUser } = await createTestUser(db, {
      roleCode: RoleCode.AUDITOR,
    });

    userIds = [adminUser.id, operatorUser.id, viewerUser.id, auditorUser.id];

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
    viewerToken = signTestAccessToken({
      id: viewerUser.id,
      username: viewerUser.username,
      email: viewerUser.email,
      role: RoleCode.VIEWER,
      roleLevel: 20,
      firstLogin: false,
    });
    auditorToken = signTestAccessToken({
      id: auditorUser.id,
      username: auditorUser.username,
      email: auditorUser.email,
      role: RoleCode.AUDITOR,
      roleLevel: 10,
      firstLogin: false,
    });
  });

  afterEach(async () => {
    await db.prisma.auditLog.deleteMany({
      where: {
        entity: AuditEntity.SYSTEM_SETTING,
        entityId: 'site-branding',
      },
    });
    await db.prisma.siteBranding.deleteMany();
  });

  afterAll(async () => {
    await db.prisma.user.deleteMany({
      where: {
        id: { in: userIds },
      },
    });
    await app.close();
    await db.disconnect();
  });

  it('returns the default public branding without authentication and 404s missing assets', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/branding');

    expect(response.status).toBe(200);
    expect((response.body as ApiResponse<BrandingResource>).data).toEqual({
      applicationName: 'Gateway Hub LF',
      logoUrl: null,
      faviconUrl: null,
      brandImageUrl: null,
      updatedAt: null,
    });

    const assetResponse = await request(app.getHttpServer()).get(
      '/api/v1/branding/assets/logo',
    );

    expect(assetResponse.status).toBe(404);
  });

  it('allows ADMIN and OPERATOR to update branding data and upload assets, but not VIEWER/AUDITOR', async () => {
    const adminResponse = await request(app.getHttpServer())
      .patch('/api/v1/branding')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ applicationName: 'Partner Gateway' });

    expect(adminResponse.status).toBe(200);
    expect(
      (adminResponse.body as ApiResponse<BrandingResource>).data
        .applicationName,
    ).toBe('Partner Gateway');

    const operatorResponse = await request(app.getHttpServer())
      .patch('/api/v1/branding')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ applicationName: 'Operator Gateway' });

    expect(operatorResponse.status).toBe(200);
    expect(
      (operatorResponse.body as ApiResponse<BrandingResource>).data
        .applicationName,
    ).toBe('Operator Gateway');

    for (const token of [viewerToken, auditorToken]) {
      const forbiddenResponse = await request(app.getHttpServer())
        .patch('/api/v1/branding')
        .set('Authorization', `Bearer ${token}`)
        .send({ applicationName: 'Should Fail' });

      expect(forbiddenResponse.status).toBe(403);
    }

    const operatorUploadResponse = await uploadBrandingAsset(
      app,
      operatorToken,
      'logo',
      pngBuffer,
      'logo.png',
      'image/png',
    );

    expect(operatorUploadResponse.status).toBe(201);

    const forbiddenUploadResponse = await uploadBrandingAsset(
      app,
      viewerToken,
      'logo',
      pngBuffer,
      'logo.png',
      'image/png',
    );

    expect(forbiddenUploadResponse.status).toBe(403);
  });

  it('allows only ADMIN to remove branding assets — OPERATOR can upload but not reset to default', async () => {
    const uploadResponse = await uploadBrandingAsset(
      app,
      adminToken,
      'logo',
      pngBuffer,
      'logo.png',
      'image/png',
    );

    expect(uploadResponse.status).toBe(201);

    const operatorDeleteResponse = await request(app.getHttpServer())
      .delete('/api/v1/branding/logo')
      .set('Authorization', `Bearer ${operatorToken}`);

    expect(operatorDeleteResponse.status).toBe(403);

    const adminDeleteResponse = await request(app.getHttpServer())
      .delete('/api/v1/branding/logo')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(adminDeleteResponse.status).toBe(200);
    expect(
      (adminDeleteResponse.body as ApiResponse<BrandingResource>).data.logoUrl,
    ).toBeNull();
  });

  it('supports the full branding asset lifecycle with public binary serving, cache headers and audit logs', async () => {
    const updateNameResponse = await request(app.getHttpServer())
      .patch('/api/v1/branding')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ applicationName: 'Partner Gateway' });

    expect(updateNameResponse.status).toBe(200);

    const uploadLogoResponse = await uploadBrandingAsset(
      app,
      adminToken,
      'logo',
      pngBuffer,
      'logo.png',
      'image/png',
    );

    expect(uploadLogoResponse.status).toBe(201);
    const firstLogoUrl = (
      uploadLogoResponse.body as ApiResponse<BrandingResource>
    ).data.logoUrl;
    expect(firstLogoUrl).toContain('/api/v1/branding/assets/logo?v=');

    const publicLogoResponse = await request(app.getHttpServer()).get(
      firstLogoUrl as string,
    );

    expect(publicLogoResponse.status).toBe(200);
    expect(publicLogoResponse.headers['content-type']).toContain('image/png');
    expect(publicLogoResponse.headers).toHaveProperty('etag');
    expect(publicLogoResponse.headers['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    );

    const notModifiedResponse = await request(app.getHttpServer())
      .get(firstLogoUrl as string)
      .set('If-None-Match', publicLogoResponse.headers.etag);

    expect(notModifiedResponse.status).toBe(304);

    const replaceLogoResponse = await uploadBrandingAsset(
      app,
      adminToken,
      'logo',
      jpegBuffer,
      'logo.jpg',
      'image/jpeg',
    );

    expect(replaceLogoResponse.status).toBe(201);
    const secondLogoUrl = (
      replaceLogoResponse.body as ApiResponse<BrandingResource>
    ).data.logoUrl;
    expect(secondLogoUrl).not.toBe(firstLogoUrl);

    const replacedLogoResponse = await request(app.getHttpServer()).get(
      secondLogoUrl as string,
    );
    expect(replacedLogoResponse.status).toBe(200);
    expect(replacedLogoResponse.headers['content-type']).toContain(
      'image/jpeg',
    );

    const uploadFaviconResponse = await uploadBrandingAsset(
      app,
      adminToken,
      'favicon',
      icoBuffer,
      'favicon.ico',
      'image/x-icon',
    );

    expect(uploadFaviconResponse.status).toBe(201);
    expect(
      (uploadFaviconResponse.body as ApiResponse<BrandingResource>).data
        .faviconUrl,
    ).toContain('/api/v1/branding/assets/favicon?v=');

    const uploadBrandImageResponse = await uploadBrandingAsset(
      app,
      adminToken,
      'brand-image',
      validSvgBuffer,
      'brand.svg',
      'image/svg+xml',
    );

    expect(uploadBrandImageResponse.status).toBe(201);

    const invalidSvgResponse = await uploadBrandingAsset(
      app,
      adminToken,
      'brand-image',
      maliciousSvgBuffer,
      'unsafe.svg',
      'image/svg+xml',
    );

    expect(invalidSvgResponse.status).toBe(400);
    expect((invalidSvgResponse.body as ApiErrorResponse).code).toBe(
      'UNSAFE_SVG_NOT_ALLOWED',
    );

    const removeLogoResponse = await request(app.getHttpServer())
      .delete('/api/v1/branding/logo')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(removeLogoResponse.status).toBe(200);
    expect(
      (removeLogoResponse.body as ApiResponse<BrandingResource>).data.logoUrl,
    ).toBeNull();

    const removedLogoAssetResponse = await request(app.getHttpServer()).get(
      '/api/v1/branding/assets/logo',
    );

    expect(removedLogoAssetResponse.status).toBe(404);

    const persistedBranding = await db.prisma.siteBranding.findUniqueOrThrow({
      where: { id: 'site-branding' },
    });
    expect(persistedBranding.applicationName).toBe('Partner Gateway');
    expect(persistedBranding.faviconMimeType).toBe('image/x-icon');
    expect(persistedBranding.brandImageMimeType).toBe('image/svg+xml');

    const auditLogs = await db.prisma.auditLog.findMany({
      where: {
        entity: AuditEntity.SYSTEM_SETTING,
        entityId: 'site-branding',
      },
      orderBy: { createdAt: 'asc' },
    });

    expect(auditLogs.map((item) => item.action)).toEqual([
      AuditAction.UPDATE,
      AuditAction.UPDATE,
      AuditAction.UPDATE,
      AuditAction.UPDATE,
      AuditAction.UPDATE,
      AuditAction.UPDATE,
    ]);
    expect(JSON.stringify(auditLogs)).not.toContain('RIFF1234WEBP');
    expect(JSON.stringify(auditLogs)).not.toContain('<svg');
    expect(JSON.stringify(auditLogs)).not.toContain('iVBOR');
  });

  it('publishes the branding contract in OpenAPI without exposing binary fields in JSON schemas', async () => {
    const response = await request(app.getHttpServer()).get('/docs-json');

    expect(response.status).toBe(200);

    const document = response.body as {
      paths: Record<
        string,
        Record<string, { requestBody?: { content?: Record<string, unknown> } }>
      >;
    };

    expect(document.paths['/api/v1/branding']?.get).toBeDefined();
    expect(
      document.paths['/api/v1/branding/logo']?.post?.requestBody?.content,
    ).toHaveProperty('multipart/form-data');
    expect(document.paths['/api/v1/branding/assets/logo']?.get).toBeDefined();
    expect(JSON.stringify(document)).not.toContain('logoData');
    expect(JSON.stringify(document)).not.toContain('faviconData');
    expect(JSON.stringify(document)).not.toContain('brandImageData');
  });
});
