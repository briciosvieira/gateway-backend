import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import type { ApiErrorResponse } from '../../src/common/interfaces/api-error-response.interface';
import type { ApiResponse } from '../../src/common/interfaces/api-response.interface';
import type { ChangeClientStatusDto } from '../../src/modules/clients/dto/change-client-status.dto';
import type { CreateClientDto } from '../../src/modules/clients/dto/create-client.dto';
import type { UpdateClientDto } from '../../src/modules/clients/dto/update-client.dto';
import { AuditAction, AuditEntity, RoleCode } from '../../generated/prisma/client';
import { createTestApiKey } from '../helpers/factories/api-key.factory';
import { createTestClient } from '../helpers/factories/client.factory';
import { createTestUser } from '../helpers/factories/user.factory';
import { signTestAccessToken } from '../helpers/jwt.helper';
import { randomSuffix, randomUUID } from '../helpers/random-data.helper';
import {
  authorizedDelete,
  authorizedGet,
  authorizedPatch,
  authorizedPost,
} from '../helpers/request.helper';
import { createTestApp } from '../helpers/test-app.helper';
import { TestDatabase } from '../helpers/test-database.helper';

interface ClientResource {
  id: string;
  name: string;
  code: string;
  description: string | null;
  contactName: string | null;
  contactEmail: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ClientListResource {
  items: ClientResource[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  filters: Record<string, unknown>;
}

describe('Clients (integration)', () => {
  let app: NestFastifyApplication;
  let db: TestDatabase;
  let adminToken: string;

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
  });

  afterAll(async () => {
    await app.close();
    await db.disconnect();
  });

  describe('POST /clients', () => {
    const createdClientIds: string[] = [];

    afterEach(async () => {
      if (createdClientIds.length > 0) {
        await db.prisma.client.deleteMany({
          where: { id: { in: createdClientIds } },
        });
        createdClientIds.length = 0;
      }
    });

    it('creates a client and generates the code automatically from the name', async () => {
      const marker = randomSuffix(8);
      const payload: CreateClientDto = {
        name: `Cliente Cãocóncórdia ${marker}`,
        description: 'Client created by an integration test.',
        contactName: 'Fulano de Tal',
        contactEmail: 'fulano@example.test',
      };

      const response = await authorizedPost(app, '/api/v1/clients', adminToken, payload);

      expect(response.status).toBe(201);

      const body = response.body as ApiResponse<ClientResource>;
      expect(body.data.code).toBe(`cliente-caoconcordia-${marker.toLowerCase()}`);
      expect(body.data.name).toBe(payload.name);
      expect(body.data.active).toBe(true);

      createdClientIds.push(body.data.id);
    });

    it('returns 409 with code CLIENT_CODE_ALREADY_EXISTS when the generated code already exists', async () => {
      const marker = randomSuffix(8);
      const name = `Duplicate Name Test ${marker}`;
      const existingClient = await createTestClient(db, { name });
      createdClientIds.push(existingClient.id);

      const payload: CreateClientDto = { name };

      const response = await authorizedPost(app, '/api/v1/clients', adminToken, payload);

      expect(response.status).toBe(409);

      const body = response.body as ApiErrorResponse;
      expect(body.success).toBe(false);
      expect(body.code).toBe('CLIENT_CODE_ALREADY_EXISTS');
    });

    it('rejects a name that has no letters or digits with 400', async () => {
      const payload: CreateClientDto = { name: '!!!' };

      const response = await authorizedPost(app, '/api/v1/clients', adminToken, payload);

      expect(response.status).toBe(400);
    });
  });

  describe('GET /clients', () => {
    const createdClientIds: string[] = [];

    afterAll(async () => {
      if (createdClientIds.length > 0) {
        await db.prisma.client.deleteMany({
          where: { id: { in: createdClientIds } },
        });
        createdClientIds.length = 0;
      }
    });

    it('lists clients with pagination, returning the created records', async () => {
      const marker = `LIST_MARKER_${randomSuffix(6).toUpperCase()}`;

      for (let index = 0; index < 3; index += 1) {
        const client = await createTestClient(db, {
          name: `${marker} Client ${index}`,
        });
        createdClientIds.push(client.id);
      }

      const response = await authorizedGet(
        app,
        `/api/v1/clients?search=${marker}&page=1&limit=10`,
        adminToken,
      );

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<ClientListResource>;
      expect(body.data.pagination.page).toBe(1);
      expect(body.data.pagination.limit).toBe(10);
      expect(body.data.pagination.total).toBe(3);
      expect(body.data.items).toHaveLength(3);

      const returnedIds = body.data.items.map((item) => item.id);
      for (const id of createdClientIds) {
        expect(returnedIds).toContain(id);
      }
    });
  });

  describe('GET /clients/:id', () => {
    const createdClientIds: string[] = [];

    afterAll(async () => {
      if (createdClientIds.length > 0) {
        await db.prisma.client.deleteMany({
          where: { id: { in: createdClientIds } },
        });
        createdClientIds.length = 0;
      }
    });

    it('returns the client when it exists', async () => {
      const client = await createTestClient(db);
      createdClientIds.push(client.id);

      const response = await authorizedGet(app, `/api/v1/clients/${client.id}`, adminToken);

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<ClientResource>;
      expect(body.data.id).toBe(client.id);
      expect(body.data.code).toBe(client.code);
    });

    it('returns 404 when the client does not exist', async () => {
      const response = await authorizedGet(app, `/api/v1/clients/${randomUUID()}`, adminToken);

      expect(response.status).toBe(404);

      const body = response.body as ApiErrorResponse;
      expect(body.success).toBe(false);
    });
  });

  describe('PATCH /clients/:id', () => {
    const createdClientIds: string[] = [];

    afterAll(async () => {
      if (createdClientIds.length > 0) {
        await db.prisma.client.deleteMany({
          where: { id: { in: createdClientIds } },
        });
        createdClientIds.length = 0;
      }
    });

    it('updates the client name and description', async () => {
      const client = await createTestClient(db);
      createdClientIds.push(client.id);

      const payload: UpdateClientDto = {
        name: 'Cliente Atualizado',
        description: 'Updated by an integration test.',
      };

      const response = await authorizedPatch(
        app,
        `/api/v1/clients/${client.id}`,
        adminToken,
        payload,
      );

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<ClientResource>;
      expect(body.data.name).toBe(payload.name);
      expect(body.data.description).toBe(payload.description);
      expect(body.data.code).toBe(client.code);
    });
  });

  describe('PATCH /clients/:id/status', () => {
    const createdClientIds: string[] = [];

    afterAll(async () => {
      if (createdClientIds.length > 0) {
        await db.prisma.client.deleteMany({
          where: { id: { in: createdClientIds } },
        });
        createdClientIds.length = 0;
      }
    });

    it('deactivates and reactivates the client', async () => {
      const client = await createTestClient(db, { active: true });
      createdClientIds.push(client.id);

      const deactivatePayload: ChangeClientStatusDto = { active: false };
      const deactivateResponse = await authorizedPatch(
        app,
        `/api/v1/clients/${client.id}/status`,
        adminToken,
        deactivatePayload,
      );

      expect(deactivateResponse.status).toBe(200);
      const deactivateBody = deactivateResponse.body as ApiResponse<ClientResource>;
      expect(deactivateBody.data.active).toBe(false);

      const reactivatePayload: ChangeClientStatusDto = { active: true };
      const reactivateResponse = await authorizedPatch(
        app,
        `/api/v1/clients/${client.id}/status`,
        adminToken,
        reactivatePayload,
      );

      expect(reactivateResponse.status).toBe(200);
      const reactivateBody = reactivateResponse.body as ApiResponse<ClientResource>;
      expect(reactivateBody.data.active).toBe(true);
    });
  });

  describe('DELETE /clients/:id', () => {
    const createdClientIds: string[] = [];

    afterAll(async () => {
      if (createdClientIds.length > 0) {
        await db.prisma.client.deleteMany({
          where: { id: { in: createdClientIds } },
        });
        createdClientIds.length = 0;
      }
    });

    it('deletes a client without dependencies and removes it from the database', async () => {
      const client = await createTestClient(db);
      createdClientIds.push(client.id);

      const response = await authorizedDelete(app, `/api/v1/clients/${client.id}`, adminToken);

      expect(response.status).toBe(204);

      const found = await db.prisma.client.findUnique({ where: { id: client.id } });
      expect(found).toBeNull();
    });

    it('creates an audit log entry when the client is deleted', async () => {
      const client = await createTestClient(db);
      createdClientIds.push(client.id);

      const response = await authorizedDelete(app, `/api/v1/clients/${client.id}`, adminToken);

      expect(response.status).toBe(204);

      const auditLog = await db.prisma.auditLog.findFirst({
        where: { entityId: client.id, action: AuditAction.DELETE },
      });

      expect(auditLog).not.toBeNull();
      expect(auditLog?.entity).toBe(AuditEntity.CLIENT);
    });

    it('returns 404 when the client does not exist', async () => {
      const response = await authorizedDelete(app, `/api/v1/clients/${randomUUID()}`, adminToken);

      expect(response.status).toBe(404);

      const body = response.body as ApiErrorResponse;
      expect(body.success).toBe(false);
    });

    it('returns 409 with code CLIENT_HAS_DEPENDENCIES when the client has a linked API key', async () => {
      const client = await createTestClient(db);
      const { apiKey } = await createTestApiKey(db, client.id);

      try {
        const response = await authorizedDelete(app, `/api/v1/clients/${client.id}`, adminToken);

        expect(response.status).toBe(409);

        const body = response.body as ApiErrorResponse;
        expect(body.success).toBe(false);
        expect(body.code).toBe('CLIENT_HAS_DEPENDENCIES');
      } finally {
        await db.prisma.apiKey.delete({ where: { id: apiKey.id } });
        await db.prisma.client.delete({ where: { id: client.id } });
      }
    });

    it('returns 401 when no token is provided', async () => {
      const client = await createTestClient(db);
      createdClientIds.push(client.id);

      const response = await request(app.getHttpServer()).delete(`/api/v1/clients/${client.id}`);

      expect(response.status).toBe(401);
    });

    it('returns 403 when the authenticated user is not an ADMIN', async () => {
      const client = await createTestClient(db);
      createdClientIds.push(client.id);

      const { user: operatorUser } = await createTestUser(db, { roleCode: RoleCode.OPERATOR });
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
        `/api/v1/clients/${client.id}`,
        operatorToken,
      );

      expect(response.status).toBe(403);
    });
  });

  describe('authentication', () => {
    it('returns 401 when no token is provided', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/clients');

      expect(response.status).toBe(401);
    });
  });
});
