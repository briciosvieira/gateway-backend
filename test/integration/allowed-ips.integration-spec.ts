import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import request from 'supertest';
import type { ApiErrorResponse } from '../../src/common/interfaces/api-error-response.interface';
import type { ApiResponse } from '../../src/common/interfaces/api-response.interface';
import type { ChangeAllowedIpStatusDto } from '../../src/modules/allowed-ips/dto/change-allowed-ip-status.dto';
import type { CreateAllowedIpDto } from '../../src/modules/allowed-ips/dto/create-allowed-ip.dto';
import type { UpdateAllowedIpDto } from '../../src/modules/allowed-ips/dto/update-allowed-ip.dto';
import { AllowedIpType, AuditAction, AuditEntity, RoleCode } from '../../generated/prisma/client';
import { createTestClient } from '../helpers/factories/client.factory';
import { createTestUser } from '../helpers/factories/user.factory';
import { signTestAccessToken } from '../helpers/jwt.helper';
import { randomIpv4, randomUUID } from '../helpers/random-data.helper';
import {
  authorizedDelete,
  authorizedGet,
  authorizedPatch,
  authorizedPost,
} from '../helpers/request.helper';
import { createTestApp } from '../helpers/test-app.helper';
import { TestDatabase } from '../helpers/test-database.helper';

interface AllowedIpClientSummary {
  id: string;
  name: string;
  code: string;
  active: boolean;
}

interface AllowedIpResource {
  id: string;
  clientId: string;
  address: string;
  type: AllowedIpType;
  description: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  client: AllowedIpClientSummary;
}

interface AllowedIpListResource {
  items: AllowedIpResource[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  filters: Record<string, unknown>;
}

describe('Allowed IPs (integration)', () => {
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

  describe('POST /allowed-ips', () => {
    const createdAllowedIpIds: string[] = [];
    const createdClientIds: string[] = [];

    afterEach(async () => {
      if (createdAllowedIpIds.length > 0) {
        await db.prisma.allowedIp.deleteMany({
          where: { id: { in: createdAllowedIpIds } },
        });
        createdAllowedIpIds.length = 0;
      }

      if (createdClientIds.length > 0) {
        await db.prisma.client.deleteMany({
          where: { id: { in: createdClientIds } },
        });
        createdClientIds.length = 0;
      }
    });

    it('creates a simple IPv4 allowed address', async () => {
      const client = await createTestClient(db);
      createdClientIds.push(client.id);

      const address = randomIpv4();
      const payload: CreateAllowedIpDto = {
        address,
        clientId: client.id,
        description: 'Server used by the integration test.',
      };

      const response = await authorizedPost(app, '/api/v1/allowed-ips', adminToken, payload);

      expect(response.status).toBe(201);

      const body = response.body as ApiResponse<AllowedIpResource>;
      expect(body.data.address).toBe(address);
      expect(body.data.type).toBe(AllowedIpType.IPV4);
      expect(body.data.clientId).toBe(client.id);
      expect(body.data.active).toBe(true);

      createdAllowedIpIds.push(body.data.id);
    });

    it('creates a CIDR network and normalizes it to the network address', async () => {
      const client = await createTestClient(db);
      createdClientIds.push(client.id);

      const payload: CreateAllowedIpDto = {
        address: '10.0.0.10/24',
        clientId: client.id,
      };

      const response = await authorizedPost(app, '/api/v1/allowed-ips', adminToken, payload);

      expect(response.status).toBe(201);

      const body = response.body as ApiResponse<AllowedIpResource>;
      expect(body.data.address).toBe('10.0.0.0/24');
      expect(body.data.type).toBe(AllowedIpType.CIDR_IPV4);

      createdAllowedIpIds.push(body.data.id);
    });

    it('returns 400 when the address is invalid', async () => {
      const client = await createTestClient(db);
      createdClientIds.push(client.id);

      const payload: CreateAllowedIpDto = {
        address: 'not-a-valid-address',
        clientId: client.id,
      };

      const response = await authorizedPost(app, '/api/v1/allowed-ips', adminToken, payload);

      expect(response.status).toBe(400);

      const body = response.body as ApiErrorResponse;
      expect(body.success).toBe(false);
    });

    it('returns 409 when the address is already allowed for the same client', async () => {
      const client = await createTestClient(db);
      createdClientIds.push(client.id);

      const address = randomIpv4();
      const payload: CreateAllowedIpDto = { address, clientId: client.id };

      const firstResponse = await authorizedPost(app, '/api/v1/allowed-ips', adminToken, payload);
      expect(firstResponse.status).toBe(201);
      const firstBody = firstResponse.body as ApiResponse<AllowedIpResource>;
      createdAllowedIpIds.push(firstBody.data.id);

      const secondResponse = await authorizedPost(
        app,
        '/api/v1/allowed-ips',
        adminToken,
        payload,
      );

      expect(secondResponse.status).toBe(409);
      const secondBody = secondResponse.body as ApiErrorResponse;
      expect(secondBody.success).toBe(false);
    });

    it('returns 400 when the client is inactive', async () => {
      const inactiveClient = await createTestClient(db, { active: false });
      createdClientIds.push(inactiveClient.id);

      const payload: CreateAllowedIpDto = {
        address: randomIpv4(),
        clientId: inactiveClient.id,
      };

      const response = await authorizedPost(app, '/api/v1/allowed-ips', adminToken, payload);

      expect(response.status).toBe(400);

      const body = response.body as ApiErrorResponse;
      expect(body.success).toBe(false);
    });

    it('creates an allowed HOSTNAME entry', async () => {
      const client = await createTestClient(db);
      createdClientIds.push(client.id);

      const payload: CreateAllowedIpDto = {
        address: 'api.cliente.com.br',
        clientId: client.id,
      };

      const response = await authorizedPost(app, '/api/v1/allowed-ips', adminToken, payload);

      expect(response.status).toBe(201);

      const body = response.body as ApiResponse<AllowedIpResource>;
      expect(body.data.address).toBe('api.cliente.com.br');
      expect(body.data.type).toBe(AllowedIpType.HOSTNAME);

      createdAllowedIpIds.push(body.data.id);
    });

    it('normalizes a HOSTNAME to lowercase', async () => {
      const client = await createTestClient(db);
      createdClientIds.push(client.id);

      const payload: CreateAllowedIpDto = {
        address: 'API.Cliente.COM.br',
        clientId: client.id,
      };

      const response = await authorizedPost(app, '/api/v1/allowed-ips', adminToken, payload);

      expect(response.status).toBe(201);

      const body = response.body as ApiResponse<AllowedIpResource>;
      expect(body.data.address).toBe('api.cliente.com.br');

      createdAllowedIpIds.push(body.data.id);
    });

    it.each([
      ['https://api.cliente.com.br', 'protocol'],
      ['http://api.cliente.com.br', 'protocol'],
      ['api.cliente.com.br/webhook', 'path'],
      ['api.cliente.com.br:443', 'port'],
      ['api.cliente.com.br?token=abc', 'query string'],
    ])('returns 400 when the hostname includes a %s (%s)', async (address) => {
      const client = await createTestClient(db);
      createdClientIds.push(client.id);

      const payload: CreateAllowedIpDto = { address, clientId: client.id };

      const response = await authorizedPost(app, '/api/v1/allowed-ips', adminToken, payload);

      expect(response.status).toBe(400);

      const body = response.body as ApiErrorResponse;
      expect(body.success).toBe(false);
    });
  });

  describe('GET /allowed-ips', () => {
    const createdAllowedIpIds: string[] = [];
    const createdClientIds: string[] = [];

    afterAll(async () => {
      if (createdAllowedIpIds.length > 0) {
        await db.prisma.allowedIp.deleteMany({
          where: { id: { in: createdAllowedIpIds } },
        });
        createdAllowedIpIds.length = 0;
      }

      if (createdClientIds.length > 0) {
        await db.prisma.client.deleteMany({
          where: { id: { in: createdClientIds } },
        });
        createdClientIds.length = 0;
      }
    });

    it('lists allowed IPs filtered by client, returning the created records', async () => {
      const client = await createTestClient(db);
      createdClientIds.push(client.id);

      for (let index = 0; index < 3; index += 1) {
        const allowedIp = await db.prisma.allowedIp.create({
          data: {
            clientId: client.id,
            address: randomIpv4(),
            type: AllowedIpType.IPV4,
            active: true,
          },
        });
        createdAllowedIpIds.push(allowedIp.id);
      }

      const response = await authorizedGet(
        app,
        `/api/v1/allowed-ips?clientId=${client.id}&page=1&limit=10`,
        adminToken,
      );

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<AllowedIpListResource>;
      expect(body.data.pagination.total).toBe(3);
      expect(body.data.items).toHaveLength(3);

      const returnedIds = body.data.items.map((item) => item.id);
      for (const id of createdAllowedIpIds) {
        expect(returnedIds).toContain(id);
      }
    });
  });

  describe('GET /allowed-ips/:id', () => {
    const createdAllowedIpIds: string[] = [];
    const createdClientIds: string[] = [];

    afterAll(async () => {
      if (createdAllowedIpIds.length > 0) {
        await db.prisma.allowedIp.deleteMany({
          where: { id: { in: createdAllowedIpIds } },
        });
        createdAllowedIpIds.length = 0;
      }

      if (createdClientIds.length > 0) {
        await db.prisma.client.deleteMany({
          where: { id: { in: createdClientIds } },
        });
        createdClientIds.length = 0;
      }
    });

    it('returns the allowed IP when it exists', async () => {
      const client = await createTestClient(db);
      createdClientIds.push(client.id);

      const allowedIp = await db.prisma.allowedIp.create({
        data: {
          clientId: client.id,
          address: randomIpv4(),
          type: AllowedIpType.IPV4,
          active: true,
        },
      });
      createdAllowedIpIds.push(allowedIp.id);

      const response = await authorizedGet(
        app,
        `/api/v1/allowed-ips/${allowedIp.id}`,
        adminToken,
      );

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<AllowedIpResource>;
      expect(body.data.id).toBe(allowedIp.id);
      expect(body.data.address).toBe(allowedIp.address);
    });

    it('returns 404 when the allowed IP does not exist', async () => {
      const response = await authorizedGet(
        app,
        `/api/v1/allowed-ips/${randomUUID()}`,
        adminToken,
      );

      expect(response.status).toBe(404);

      const body = response.body as ApiErrorResponse;
      expect(body.success).toBe(false);
    });
  });

  describe('PATCH /allowed-ips/:id', () => {
    const createdAllowedIpIds: string[] = [];
    const createdClientIds: string[] = [];

    afterAll(async () => {
      if (createdAllowedIpIds.length > 0) {
        await db.prisma.allowedIp.deleteMany({
          where: { id: { in: createdAllowedIpIds } },
        });
        createdAllowedIpIds.length = 0;
      }

      if (createdClientIds.length > 0) {
        await db.prisma.client.deleteMany({
          where: { id: { in: createdClientIds } },
        });
        createdClientIds.length = 0;
      }
    });

    it('updates the allowed IP address', async () => {
      const client = await createTestClient(db);
      createdClientIds.push(client.id);

      const allowedIp = await db.prisma.allowedIp.create({
        data: {
          clientId: client.id,
          address: randomIpv4(),
          type: AllowedIpType.IPV4,
          active: true,
        },
      });
      createdAllowedIpIds.push(allowedIp.id);

      const newAddress = randomIpv4();
      const payload: UpdateAllowedIpDto = { address: newAddress };

      const response = await authorizedPatch(
        app,
        `/api/v1/allowed-ips/${allowedIp.id}`,
        adminToken,
        payload,
      );

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<AllowedIpResource>;
      expect(body.data.address).toBe(newAddress);
    });

    it('updates a HOSTNAME allowed source to a new hostname', async () => {
      const client = await createTestClient(db);
      createdClientIds.push(client.id);

      const allowedIp = await db.prisma.allowedIp.create({
        data: {
          clientId: client.id,
          address: 'old.cliente.com.br',
          type: AllowedIpType.HOSTNAME,
          active: true,
        },
      });
      createdAllowedIpIds.push(allowedIp.id);

      const payload: UpdateAllowedIpDto = { address: 'novo.cliente.com.br' };

      const response = await authorizedPatch(
        app,
        `/api/v1/allowed-ips/${allowedIp.id}`,
        adminToken,
        payload,
      );

      expect(response.status).toBe(200);

      const body = response.body as ApiResponse<AllowedIpResource>;
      expect(body.data.address).toBe('novo.cliente.com.br');
      expect(body.data.type).toBe(AllowedIpType.HOSTNAME);
    });
  });

  describe('PATCH /allowed-ips/:id/status', () => {
    const createdAllowedIpIds: string[] = [];
    const createdClientIds: string[] = [];

    afterAll(async () => {
      if (createdAllowedIpIds.length > 0) {
        await db.prisma.allowedIp.deleteMany({
          where: { id: { in: createdAllowedIpIds } },
        });
        createdAllowedIpIds.length = 0;
      }

      if (createdClientIds.length > 0) {
        await db.prisma.client.deleteMany({
          where: { id: { in: createdClientIds } },
        });
        createdClientIds.length = 0;
      }
    });

    it('deactivates and reactivates the allowed IP', async () => {
      const client = await createTestClient(db);
      createdClientIds.push(client.id);

      const allowedIp = await db.prisma.allowedIp.create({
        data: {
          clientId: client.id,
          address: randomIpv4(),
          type: AllowedIpType.IPV4,
          active: true,
        },
      });
      createdAllowedIpIds.push(allowedIp.id);

      const deactivatePayload: ChangeAllowedIpStatusDto = { active: false };
      const deactivateResponse = await authorizedPatch(
        app,
        `/api/v1/allowed-ips/${allowedIp.id}/status`,
        adminToken,
        deactivatePayload,
      );

      expect(deactivateResponse.status).toBe(200);
      const deactivateBody = deactivateResponse.body as ApiResponse<AllowedIpResource>;
      expect(deactivateBody.data.active).toBe(false);

      const reactivatePayload: ChangeAllowedIpStatusDto = { active: true };
      const reactivateResponse = await authorizedPatch(
        app,
        `/api/v1/allowed-ips/${allowedIp.id}/status`,
        adminToken,
        reactivatePayload,
      );

      expect(reactivateResponse.status).toBe(200);
      const reactivateBody = reactivateResponse.body as ApiResponse<AllowedIpResource>;
      expect(reactivateBody.data.active).toBe(true);
    });
  });

  describe('DELETE /allowed-ips/:id', () => {
    const createdAllowedIpIds: string[] = [];
    const createdClientIds: string[] = [];
    const createdUserIds: string[] = [];

    afterAll(async () => {
      if (createdAllowedIpIds.length > 0) {
        await db.prisma.allowedIp.deleteMany({
          where: { id: { in: createdAllowedIpIds } },
        });
        createdAllowedIpIds.length = 0;
      }

      if (createdClientIds.length > 0) {
        await db.prisma.client.deleteMany({
          where: { id: { in: createdClientIds } },
        });
        createdClientIds.length = 0;
      }

      if (createdUserIds.length > 0) {
        await db.prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
        createdUserIds.length = 0;
      }
    });

    it('deletes an existing allowed IP, removing it from the database', async () => {
      const client = await createTestClient(db);
      createdClientIds.push(client.id);

      const allowedIp = await db.prisma.allowedIp.create({
        data: {
          clientId: client.id,
          address: randomIpv4(),
          type: AllowedIpType.IPV4,
          active: true,
        },
      });

      const response = await authorizedDelete(
        app,
        `/api/v1/allowed-ips/${allowedIp.id}`,
        adminToken,
      );

      expect(response.status).toBe(204);

      const found = await db.prisma.allowedIp.findUnique({ where: { id: allowedIp.id } });
      expect(found).toBeNull();
    });

    it('creates an audit log entry when the allowed IP is deleted', async () => {
      const client = await createTestClient(db);
      createdClientIds.push(client.id);

      const allowedIp = await db.prisma.allowedIp.create({
        data: {
          clientId: client.id,
          address: randomIpv4(),
          type: AllowedIpType.IPV4,
          active: true,
        },
      });

      const response = await authorizedDelete(
        app,
        `/api/v1/allowed-ips/${allowedIp.id}`,
        adminToken,
      );

      expect(response.status).toBe(204);

      const auditLog = await db.prisma.auditLog.findFirst({
        where: { entityId: allowedIp.id, action: AuditAction.DELETE },
      });

      expect(auditLog).not.toBeNull();
      expect(auditLog?.entity).toBe(AuditEntity.ALLOWED_IP);
    });

    it('returns 404 when the allowed IP does not exist', async () => {
      const response = await authorizedDelete(
        app,
        `/api/v1/allowed-ips/${randomUUID()}`,
        adminToken,
      );

      expect(response.status).toBe(404);

      const body = response.body as ApiErrorResponse;
      expect(body.success).toBe(false);
    });

    it('returns 401 when no token is provided', async () => {
      const client = await createTestClient(db);
      createdClientIds.push(client.id);

      const allowedIp = await db.prisma.allowedIp.create({
        data: {
          clientId: client.id,
          address: randomIpv4(),
          type: AllowedIpType.IPV4,
          active: true,
        },
      });
      createdAllowedIpIds.push(allowedIp.id);

      const response = await request(app.getHttpServer()).delete(
        `/api/v1/allowed-ips/${allowedIp.id}`,
      );

      expect(response.status).toBe(401);
    });

    it('returns 403 when the authenticated user is not an ADMIN', async () => {
      const client = await createTestClient(db);
      createdClientIds.push(client.id);

      const allowedIp = await db.prisma.allowedIp.create({
        data: {
          clientId: client.id,
          address: randomIpv4(),
          type: AllowedIpType.IPV4,
          active: true,
        },
      });
      createdAllowedIpIds.push(allowedIp.id);

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
        `/api/v1/allowed-ips/${allowedIp.id}`,
        operatorToken,
      );

      expect(response.status).toBe(403);
    });
  });

  describe('authentication', () => {
    it('returns 401 when no token is provided', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/allowed-ips');

      expect(response.status).toBe(401);
    });
  });
});
