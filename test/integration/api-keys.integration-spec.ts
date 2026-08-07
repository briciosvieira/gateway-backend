import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import type { ApiErrorResponse } from '../../src/common/interfaces/api-error-response.interface';
import type { ApiResponse } from '../../src/common/interfaces/api-response.interface';
import { AuditAction, AuditEntity, RoleCode, type Client } from '../../generated/prisma/client';
import { createTestApiKey } from '../helpers/factories/api-key.factory';
import { createTestClient } from '../helpers/factories/client.factory';
import { createTestUser } from '../helpers/factories/user.factory';
import { signTestAccessToken } from '../helpers/jwt.helper';
import { randomUUID } from '../helpers/random-data.helper';
import {
  authorizedDelete,
  authorizedGet,
  authorizedPatch,
  authorizedPost,
} from '../helpers/request.helper';
import { createTestApp } from '../helpers/test-app.helper';
import { TestDatabase } from '../helpers/test-database.helper';

interface ApiKeyResponseData {
  id: string;
  clientId: string;
  name: string;
  prefix: string;
  active: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
  client: {
    id: string;
    name: string;
    code: string;
    active: boolean;
  };
}

interface CreateApiKeyResponseData {
  apiKey: ApiKeyResponseData;
  key: string;
  warning: string;
}

interface RegenerateApiKeyResponseData extends CreateApiKeyResponseData {
  previousApiKeyRevoked: boolean;
}

interface ApiKeyListResponseData {
  items: ApiKeyResponseData[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const FULL_KEY_PATTERN = /^ghlf_[0-9a-f]{8}_.+$/;

describe('ApiKeys (integration)', () => {
  let app: NestFastifyApplication;
  let db: TestDatabase;
  let adminToken: string;
  let adminUserId: string;
  let client: Client;
  let inactiveClient: Client;
  const createdApiKeyIds: string[] = [];

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
    if (createdApiKeyIds.length > 0) {
      await db.prisma.apiKey.deleteMany({
        where: { id: { in: createdApiKeyIds } },
      });
    }

    await db.prisma.client.deleteMany({
      where: { id: { in: [client.id, inactiveClient.id] } },
    });

    await db.prisma.user.deleteMany({ where: { id: adminUserId } });

    await app.close();
    await db.disconnect();
  });

  it('creates an API Key and returns the full key without the hash', async () => {
    const response = await authorizedPost(app, '/api/v1/api-keys', adminToken, {
      name: 'Integration Key',
      clientId: client.id,
    });

    expect(response.status).toBe(201);

    const body = response.body as ApiResponse<CreateApiKeyResponseData>;
    createdApiKeyIds.push(body.data.apiKey.id);

    expect(body.data.key).toMatch(FULL_KEY_PATTERN);
    expect(body.data.apiKey).not.toHaveProperty('keyHash');
    expect(body.data.apiKey.clientId).toBe(client.id);
    expect(body.data.apiKey.active).toBe(true);
    expect(body.data.warning).toBeTruthy();
  });

  it('returns 404 when the client does not exist', async () => {
    const response = await authorizedPost(app, '/api/v1/api-keys', adminToken, {
      name: 'Orphan Key',
      clientId: randomUUID(),
    });

    expect(response.status).toBe(404);

    const body = response.body as ApiErrorResponse;
    expect(body.success).toBe(false);
    expect(body.message).toBe('Client was not found.');
  });

  it('returns 400 when the client is inactive', async () => {
    const response = await authorizedPost(app, '/api/v1/api-keys', adminToken, {
      name: 'Inactive Client Key',
      clientId: inactiveClient.id,
    });

    expect(response.status).toBe(400);

    const body = response.body as ApiErrorResponse;
    expect(body.message).toBe('Client is inactive.');
  });

  it('lists API Keys filtered by client', async () => {
    const { apiKey } = await createTestApiKey(db, client.id);
    createdApiKeyIds.push(apiKey.id);

    const response = await authorizedGet(
      app,
      `/api/v1/api-keys?clientId=${client.id}`,
      adminToken,
    );

    expect(response.status).toBe(200);

    const body = response.body as ApiResponse<ApiKeyListResponseData>;
    expect(body.data.items.some((item) => item.id === apiKey.id)).toBe(true);
    expect(body.data.pagination.total).toBeGreaterThanOrEqual(1);
  });

  it('gets an API Key by id', async () => {
    const { apiKey } = await createTestApiKey(db, client.id);
    createdApiKeyIds.push(apiKey.id);

    const response = await authorizedGet(
      app,
      `/api/v1/api-keys/${apiKey.id}`,
      adminToken,
    );

    expect(response.status).toBe(200);

    const body = response.body as ApiResponse<ApiKeyResponseData>;
    expect(body.data.id).toBe(apiKey.id);
    expect(body.data.client.id).toBe(client.id);
  });

  it('updates the API Key name', async () => {
    const { apiKey } = await createTestApiKey(db, client.id, { name: 'Old Name' });
    createdApiKeyIds.push(apiKey.id);

    const response = await authorizedPatch(
      app,
      `/api/v1/api-keys/${apiKey.id}`,
      adminToken,
      { name: 'New Name' },
    );

    expect(response.status).toBe(200);

    const body = response.body as ApiResponse<ApiKeyResponseData>;
    expect(body.data.name).toBe('New Name');
  });

  it('revokes an API Key and is idempotent when called again', async () => {
    const { apiKey } = await createTestApiKey(db, client.id);
    createdApiKeyIds.push(apiKey.id);

    const firstResponse = await authorizedPost(
      app,
      `/api/v1/api-keys/${apiKey.id}/revoke`,
      adminToken,
    );

    expect(firstResponse.status).toBe(200);

    const firstBody = firstResponse.body as ApiResponse<ApiKeyResponseData>;
    expect(firstBody.data.active).toBe(false);
    expect(firstBody.data.revokedAt).not.toBeNull();

    const secondResponse = await authorizedPost(
      app,
      `/api/v1/api-keys/${apiKey.id}/revoke`,
      adminToken,
    );

    expect(secondResponse.status).toBe(200);

    const secondBody = secondResponse.body as ApiResponse<ApiKeyResponseData>;
    expect(secondBody.data.active).toBe(false);
  });

  it('rejects reactivating a revoked API Key', async () => {
    const { apiKey } = await createTestApiKey(db, client.id);
    createdApiKeyIds.push(apiKey.id);

    await authorizedPost(app, `/api/v1/api-keys/${apiKey.id}/revoke`, adminToken);

    const response = await authorizedPatch(
      app,
      `/api/v1/api-keys/${apiKey.id}/status`,
      adminToken,
      { active: true },
    );

    expect(response.status).toBe(400);

    const body = response.body as ApiErrorResponse;
    expect(body.message).toBe('A revoked API Key cannot be reactivated.');
  });

  it('regenerates an API Key and revokes the previous one by default', async () => {
    const { apiKey } = await createTestApiKey(db, client.id);
    createdApiKeyIds.push(apiKey.id);

    const response = await authorizedPost(
      app,
      `/api/v1/api-keys/${apiKey.id}/regenerate`,
      adminToken,
      {},
    );

    expect(response.status).toBe(201);

    const body = response.body as ApiResponse<RegenerateApiKeyResponseData>;
    createdApiKeyIds.push(body.data.apiKey.id);

    expect(body.data.apiKey.id).not.toBe(apiKey.id);
    expect(body.data.key).toMatch(FULL_KEY_PATTERN);
    expect(body.data.previousApiKeyRevoked).toBe(true);

    const oldKeyResponse = await authorizedGet(
      app,
      `/api/v1/api-keys/${apiKey.id}`,
      adminToken,
    );
    const oldKeyBody = oldKeyResponse.body as ApiResponse<ApiKeyResponseData>;
    expect(oldKeyBody.data.active).toBe(false);
  });

  it('regenerates an API Key keeping the previous one active when revokePrevious is false', async () => {
    const { apiKey } = await createTestApiKey(db, client.id);
    createdApiKeyIds.push(apiKey.id);

    const response = await authorizedPost(
      app,
      `/api/v1/api-keys/${apiKey.id}/regenerate`,
      adminToken,
      { revokePrevious: false },
    );

    expect(response.status).toBe(201);

    const body = response.body as ApiResponse<RegenerateApiKeyResponseData>;
    createdApiKeyIds.push(body.data.apiKey.id);
    expect(body.data.previousApiKeyRevoked).toBe(false);

    const oldKeyResponse = await authorizedGet(
      app,
      `/api/v1/api-keys/${apiKey.id}`,
      adminToken,
    );
    const oldKeyBody = oldKeyResponse.body as ApiResponse<ApiKeyResponseData>;
    expect(oldKeyBody.data.active).toBe(true);
  });

  it('returns 401 when no token is provided', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/api-keys');

    expect(response.status).toBe(401);
  });

  describe('DELETE /api-keys/:id', () => {
    const createdUserIds: string[] = [];

    afterAll(async () => {
      if (createdUserIds.length > 0) {
        await db.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
        createdUserIds.length = 0;
      }
    });

    it('deletes an existing API Key, removing it from the database', async () => {
      const { apiKey } = await createTestApiKey(db, client.id);

      const response = await authorizedDelete(
        app,
        `/api/v1/api-keys/${apiKey.id}`,
        adminToken,
      );

      expect(response.status).toBe(204);

      const found = await db.prisma.apiKey.findUnique({ where: { id: apiKey.id } });
      expect(found).toBeNull();
    });

    it('creates a DELETE audit log entry that never exposes the key prefix', async () => {
      const { apiKey } = await createTestApiKey(db, client.id);

      const response = await authorizedDelete(
        app,
        `/api/v1/api-keys/${apiKey.id}`,
        adminToken,
      );

      expect(response.status).toBe(204);

      const auditLog = await db.prisma.auditLog.findFirst({
        where: { entityId: apiKey.id, action: AuditAction.DELETE },
      });

      expect(auditLog).not.toBeNull();
      expect(auditLog?.entity).toBe(AuditEntity.API_KEY);

      // Security rule: the prefix must never leak into audit trail payloads.
      const serializedAuditLog =
        JSON.stringify(auditLog?.previousValue ?? null) + (auditLog?.description ?? '');

      expect(serializedAuditLog).not.toContain(apiKey.prefix);
      expect(serializedAuditLog.toLowerCase()).not.toContain('prefix');
    });

    it('returns 404 when the API Key does not exist', async () => {
      const response = await authorizedDelete(
        app,
        `/api/v1/api-keys/${randomUUID()}`,
        adminToken,
      );

      expect(response.status).toBe(404);

      const body = response.body as ApiErrorResponse;
      expect(body.success).toBe(false);
    });

    it('returns 401 when no token is provided', async () => {
      const { apiKey } = await createTestApiKey(db, client.id);
      createdApiKeyIds.push(apiKey.id);

      const response = await request(app.getHttpServer()).delete(
        `/api/v1/api-keys/${apiKey.id}`,
      );

      expect(response.status).toBe(401);
    });

    it('returns 403 when the authenticated user is not an ADMIN', async () => {
      const { apiKey } = await createTestApiKey(db, client.id);
      createdApiKeyIds.push(apiKey.id);

      const { user: operatorUser } = await createTestUser(db, {
        roleCode: RoleCode.OPERATOR,
      });
      createdUserIds.push(operatorUser.id);
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
        `/api/v1/api-keys/${apiKey.id}`,
        operatorToken,
      );

      expect(response.status).toBe(403);
    });
  });
});
