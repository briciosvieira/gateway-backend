import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { User } from '../../generated/prisma/client';
import { RoleCode } from '../../generated/prisma/client';
import { createTestUser } from '../helpers/factories/user.factory';
import { signTestAccessToken } from '../helpers/jwt.helper';
import { randomSuffix } from '../helpers/random-data.helper';
import { authorizedGet, authorizedPost } from '../helpers/request.helper';
import { createTestApp } from '../helpers/test-app.helper';
import { TestDatabase } from '../helpers/test-database.helper';

interface ApiSuccessResponse<T> {
  success: true;
  message: string;
  data: T;
  requestId: string;
  timestamp: string;
}

interface ClientResponseBody {
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

interface AuditLogUser {
  id: string;
  name: string;
  username: string;
  email?: string;
  role: {
    code: string;
    name: string;
  };
}

interface AuditLogEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  previousValue: unknown;
  newValue: unknown;
  sourceIp: string | null;
  requestId: string | null;
  description: string | null;
  createdAt: string;
  user: AuditLogUser | null;
}

interface AuditLogListData {
  items: AuditLogEntry[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

describe('AuditLogs (integration)', () => {
  let app: NestFastifyApplication;
  let db: TestDatabase;
  let adminToken: string;
  let adminUser: User;
  let createdClientId: string;
  let createdAuditLogId: string;
  const requestMarker = randomUUID();

  beforeAll(async () => {
    db = new TestDatabase();
    await db.connect();
    app = await createTestApp();

    const { user } = await createTestUser(db, { roleCode: RoleCode.ADMIN });
    adminUser = user;
    adminToken = signTestAccessToken({
      id: user.id,
      username: user.username,
      email: user.email,
      role: RoleCode.ADMIN,
      roleLevel: 100,
      firstLogin: false,
    });

    // Generate a real audit log entry by performing a real administrative
    // action (creating a client through the API), tagged with a unique
    // X-Request-Id so it can be looked up deterministically even though
    // other suites write to the same shared audit_logs table.
    const createClientResponse = await authorizedPost(app, '/api/v1/clients', adminToken, {
      name: `Audit Test Client ${randomSuffix(6)}`,
    }).set('X-Request-Id', requestMarker);

    expect(createClientResponse.status).toBe(201);

    createdClientId = (createClientResponse.body as ApiSuccessResponse<ClientResponseBody>).data
      .id;

    const auditLogResponse = await authorizedGet(
      app,
      `/api/v1/audit-logs?requestId=${requestMarker}`,
      adminToken,
    );

    expect(auditLogResponse.status).toBe(200);

    const auditLogData = (auditLogResponse.body as ApiSuccessResponse<AuditLogListData>).data;

    expect(auditLogData.items).toHaveLength(1);

    createdAuditLogId = auditLogData.items[0].id;
  });

  afterAll(async () => {
    await db.prisma.auditLog.deleteMany({ where: { requestId: requestMarker } });
    await db.prisma.client.deleteMany({ where: { id: createdClientId } });

    await app.close();
    await db.disconnect();
  });

  it('recorded a CREATE/CLIENT audit log entry for the client created above', async () => {
    const response = await authorizedGet(
      app,
      `/api/v1/audit-logs?requestId=${requestMarker}`,
      adminToken,
    );

    expect(response.status).toBe(200);

    const data = (response.body as ApiSuccessResponse<AuditLogListData>).data;

    expect(data.items).toHaveLength(1);

    const [entry] = data.items;

    expect(entry.action).toBe('CREATE');
    expect(entry.entity).toBe('CLIENT');
    expect(entry.entityId).toBe(createdClientId);
    expect(entry.requestId).toBe(requestMarker);

    if (!entry.user) {
      throw new Error('Expected the audit log entry to include the acting user.');
    }

    expect(entry.user.id).toBe(adminUser.id);
    expect(entry.user.username).toBe(adminUser.username);
  });

  it('filters by entity=CLIENT', async () => {
    const response = await authorizedGet(
      app,
      `/api/v1/audit-logs?requestId=${requestMarker}&entity=CLIENT`,
      adminToken,
    );

    expect(response.status).toBe(200);

    const data = (response.body as ApiSuccessResponse<AuditLogListData>).data;

    expect(data.items).toHaveLength(1);
    expect(data.items[0].id).toBe(createdAuditLogId);
  });

  it('filters by action=CREATE', async () => {
    const response = await authorizedGet(
      app,
      `/api/v1/audit-logs?requestId=${requestMarker}&action=CREATE`,
      adminToken,
    );

    expect(response.status).toBe(200);

    const data = (response.body as ApiSuccessResponse<AuditLogListData>).data;

    expect(data.items).toHaveLength(1);
    expect(data.items[0].id).toBe(createdAuditLogId);
  });

  it('finds no results when the entity/action combination does not match', async () => {
    const response = await authorizedGet(
      app,
      `/api/v1/audit-logs?requestId=${requestMarker}&action=DELETE`,
      adminToken,
    );

    expect(response.status).toBe(200);

    const data = (response.body as ApiSuccessResponse<AuditLogListData>).data;

    expect(data.items).toHaveLength(0);
  });

  it('gets the audit log by id', async () => {
    const response = await authorizedGet(
      app,
      `/api/v1/audit-logs/${createdAuditLogId}`,
      adminToken,
    );

    expect(response.status).toBe(200);

    const entry = (response.body as ApiSuccessResponse<AuditLogEntry>).data;

    expect(entry.id).toBe(createdAuditLogId);
    expect(entry.action).toBe('CREATE');
    expect(entry.entity).toBe('CLIENT');
    expect(entry.entityId).toBe(createdClientId);
  });

  it('returns 404 for a non-existent audit log id', async () => {
    const response = await authorizedGet(app, `/api/v1/audit-logs/${randomUUID()}`, adminToken);

    expect(response.status).toBe(404);
  });

  it('returns 401 when no token is provided', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/audit-logs');

    expect(response.status).toBe(401);
  });
});
