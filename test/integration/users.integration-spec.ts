import { ForbiddenException } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { ApiErrorResponse } from '../../src/common/interfaces/api-error-response.interface';
import type { ApiResponse } from '../../src/common/interfaces/api-response.interface';
import type { RequestContext } from '../../src/common/interfaces/request-context.interface';
import type { AuthenticatedUser } from '../../src/modules/auth/interfaces/authenticated-user.interface';
import { UsersService } from '../../src/modules/users/users.service';
import { AuditAction, AuditEntity, RoleCode } from '../../generated/prisma/client';
import type { CreatedTestUser } from '../helpers/factories/user.factory';
import { createTestUser } from '../helpers/factories/user.factory';
import { randomEmail, randomUsername } from '../helpers/random-data.helper';
import {
  authorizedDelete,
  authorizedGet,
  authorizedPatch,
  authorizedPost,
} from '../helpers/request.helper';
import { createTestApp } from '../helpers/test-app.helper';
import { TestDatabase } from '../helpers/test-database.helper';

interface UserRoleSummary {
  id: string;
  code: string;
  name: string;
  level: number;
}

interface UserSummary {
  id: string;
  name: string;
  username: string;
  email: string;
  active: boolean;
  firstLogin: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  role: UserRoleSummary;
}

interface CreateUserResponseData {
  user: UserSummary;
  temporaryPassword: string;
  passwordMustBeChanged: boolean;
}

interface ResetPasswordResponseData {
  temporaryPassword: string;
  passwordMustBeChanged: boolean;
}

interface LoginResponseData {
  accessToken: string;
  refreshToken: string;
  user: {
    username: string;
  };
}

async function loginAndGetToken(
  app: NestFastifyApplication,
  username: string,
  password: string,
): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ login: username, password })
    .expect(200);

  return (response.body as ApiResponse<LoginResponseData>).data.accessToken;
}

describe('Users (integration)', () => {
  let app: NestFastifyApplication;
  let db: TestDatabase;
  let adminActor: CreatedTestUser;
  let adminToken: string;

  beforeAll(async () => {
    db = new TestDatabase();
    await db.connect();
    app = await createTestApp();

    adminActor = await createTestUser(db, { roleCode: RoleCode.ADMIN });
    adminToken = await loginAndGetToken(
      app,
      adminActor.user.username,
      adminActor.plainPassword,
    );
  });

  afterAll(async () => {
    await db.prisma.user.delete({ where: { id: adminActor.user.id } });
    await app.close();
    await db.disconnect();
  });

  describe('POST /users', () => {
    let viewerRoleId: string;
    const createdUserIds: string[] = [];

    beforeAll(async () => {
      viewerRoleId = await db.getRoleId(RoleCode.VIEWER);
    });

    afterAll(async () => {
      if (createdUserIds.length > 0) {
        await db.prisma.user.deleteMany({
          where: { id: { in: createdUserIds } },
        });
      }
    });

    it('creates a user with the VIEWER role and never exposes the password hash', async () => {
      const dto = {
        name: 'Integration Viewer',
        username: randomUsername(),
        email: randomEmail(),
        roleId: viewerRoleId,
      };

      const response = await authorizedPost(
        app,
        '/api/v1/users',
        adminToken,
        dto,
      ).expect(201);

      const body = response.body as ApiResponse<CreateUserResponseData>;

      createdUserIds.push(body.data.user.id);

      expect(body.data.user.username).toBe(dto.username);
      expect(body.data.user).not.toHaveProperty('passwordHash');
      expect(body.data.temporaryPassword).toBeTruthy();
      expect(body.data.passwordMustBeChanged).toBe(true);
    });

    it('rejects a duplicate username or email with 409', async () => {
      const dto = {
        name: 'Integration Duplicate',
        username: randomUsername(),
        email: randomEmail(),
        roleId: viewerRoleId,
      };

      const firstResponse = await authorizedPost(
        app,
        '/api/v1/users',
        adminToken,
        dto,
      ).expect(201);

      createdUserIds.push(
        (firstResponse.body as ApiResponse<CreateUserResponseData>).data.user
          .id,
      );

      const secondResponse = await authorizedPost(
        app,
        '/api/v1/users',
        adminToken,
        { ...dto, name: 'Another Name' },
      ).expect(409);

      expect((secondResponse.body as ApiErrorResponse).success).toBe(false);
    });

    it('rejects a roleId that does not exist with 404', async () => {
      await authorizedPost(app, '/api/v1/users', adminToken, {
        name: 'Integration Ghost Role',
        username: randomUsername(),
        email: randomEmail(),
        roleId: randomUUID(),
      }).expect(404);
    });
  });

  describe('GET /users and GET /users/:id', () => {
    let viewerUser: CreatedTestUser;

    beforeAll(async () => {
      viewerUser = await createTestUser(db, { roleCode: RoleCode.VIEWER });
    });

    afterAll(async () => {
      await db.prisma.user.delete({ where: { id: viewerUser.user.id } });
    });

    it('lists users and includes the created one', async () => {
      const response = await authorizedGet(
        app,
        '/api/v1/users',
        adminToken,
      ).expect(200);

      const body = response.body as ApiResponse<UserSummary[]>;

      expect(body.data.some((user) => user.id === viewerUser.user.id)).toBe(
        true,
      );
    });

    it('returns a single user by id', async () => {
      const response = await authorizedGet(
        app,
        `/api/v1/users/${viewerUser.user.id}`,
        adminToken,
      ).expect(200);

      const body = response.body as ApiResponse<UserSummary>;

      expect(body.data.id).toBe(viewerUser.user.id);
      expect(body.data.username).toBe(viewerUser.user.username);
    });

    it('returns 404 for a user id that does not exist', async () => {
      await authorizedGet(
        app,
        `/api/v1/users/${randomUUID()}`,
        adminToken,
      ).expect(404);
    });
  });

  describe('PATCH /users/:id', () => {
    let targetUser: CreatedTestUser;

    beforeAll(async () => {
      targetUser = await createTestUser(db, { roleCode: RoleCode.VIEWER });
    });

    afterAll(async () => {
      await db.prisma.user.delete({ where: { id: targetUser.user.id } });
    });

    it('updates the user name', async () => {
      const response = await authorizedPatch(
        app,
        `/api/v1/users/${targetUser.user.id}`,
        adminToken,
        { name: 'Renamed Integration User' },
      ).expect(200);

      const body = response.body as ApiResponse<UserSummary>;

      expect(body.data.name).toBe('Renamed Integration User');
    });
  });

  describe('PATCH /users/:id/role', () => {
    let targetUser: CreatedTestUser;
    let operatorRoleId: string;

    beforeAll(async () => {
      targetUser = await createTestUser(db, { roleCode: RoleCode.VIEWER });
      operatorRoleId = await db.getRoleId(RoleCode.OPERATOR);
    });

    afterAll(async () => {
      await db.prisma.user.delete({ where: { id: targetUser.user.id } });
    });

    it('changes the user role', async () => {
      const response = await authorizedPatch(
        app,
        `/api/v1/users/${targetUser.user.id}/role`,
        adminToken,
        { roleId: operatorRoleId },
      ).expect(200);

      const body = response.body as ApiResponse<UserSummary>;

      expect(body.data.role.code).toBe(RoleCode.OPERATOR);
    });
  });

  describe('PATCH /users/:id/status', () => {
    let targetUser: CreatedTestUser;

    beforeAll(async () => {
      targetUser = await createTestUser(db, { roleCode: RoleCode.VIEWER });
    });

    afterAll(async () => {
      await db.prisma.user.delete({ where: { id: targetUser.user.id } });
    });

    it('deactivates the user and blocks subsequent login', async () => {
      const response = await authorizedPatch(
        app,
        `/api/v1/users/${targetUser.user.id}/status`,
        adminToken,
        { active: false },
      ).expect(200);

      const body = response.body as ApiResponse<UserSummary>;

      expect(body.data.active).toBe(false);

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          login: targetUser.user.username,
          password: targetUser.plainPassword,
        })
        .expect(401);
    });
  });

  describe('POST /users/:id/reset-password', () => {
    let targetUser: CreatedTestUser;

    beforeAll(async () => {
      targetUser = await createTestUser(db, { roleCode: RoleCode.VIEWER });
    });

    afterAll(async () => {
      await db.prisma.user.delete({ where: { id: targetUser.user.id } });
    });

    it('resets the password and returns a new temporary one', async () => {
      const response = await authorizedPost(
        app,
        `/api/v1/users/${targetUser.user.id}/reset-password`,
        adminToken,
      ).expect(201);

      const body = response.body as ApiResponse<ResetPasswordResponseData>;

      expect(body.data.temporaryPassword).toBeTruthy();
      expect(body.data.temporaryPassword).not.toBe(targetUser.plainPassword);
      expect(body.data.passwordMustBeChanged).toBe(true);
    });
  });

  describe('PATCH /users/:id/password-requirement', () => {
    let targetUser: CreatedTestUser;

    beforeAll(async () => {
      targetUser = await createTestUser(db, {
        roleCode: RoleCode.VIEWER,
        firstLogin: false,
      });
    });

    afterAll(async () => {
      await db.prisma.user.delete({ where: { id: targetUser.user.id } });
    });

    it('updates the password change requirement flag', async () => {
      const response = await authorizedPatch(
        app,
        `/api/v1/users/${targetUser.user.id}/password-requirement`,
        adminToken,
        { requirePasswordChange: true },
      ).expect(200);

      const body = response.body as ApiResponse<UserSummary>;

      expect(body.data.firstLogin).toBe(true);
    });
  });

  describe('DELETE /users/:id', () => {
    let targetOperator: CreatedTestUser;

    beforeAll(async () => {
      targetOperator = await createTestUser(db, { roleCode: RoleCode.OPERATOR });
    });

    afterAll(async () => {
      await db.prisma.user.deleteMany({ where: { id: targetOperator.user.id } });
    });

    it('rejects self-deletion with 403 USER_CANNOT_DELETE_SELF', async () => {
      const response = await authorizedDelete(
        app,
        `/api/v1/users/${adminActor.user.id}`,
        adminToken,
      ).expect(403);

      const body = response.body as ApiErrorResponse;

      expect(body.code).toBe('USER_CANNOT_DELETE_SELF');

      // The admin actor must remain untouched: it is reused by every other
      // describe block in this file.
      const stillExists = await db.prisma.user.findUnique({
        where: { id: adminActor.user.id },
      });

      expect(stillExists).not.toBeNull();
    });

    it('returns 404 for a user id that does not exist', async () => {
      await authorizedDelete(
        app,
        `/api/v1/users/${randomUUID()}`,
        adminToken,
      ).expect(404);
    });

    it('deletes an OPERATOR user and records a DELETE/USER audit log entry', async () => {
      await authorizedDelete(
        app,
        `/api/v1/users/${targetOperator.user.id}`,
        adminToken,
      ).expect(204);

      const deletedUser = await db.prisma.user.findUnique({
        where: { id: targetOperator.user.id },
      });

      expect(deletedUser).toBeNull();

      const auditLog = await db.prisma.auditLog.findFirst({
        where: {
          entity: AuditEntity.USER,
          entityId: targetOperator.user.id,
          action: AuditAction.DELETE,
        },
      });

      expect(auditLog).not.toBeNull();
      expect(auditLog?.userId).toBe(adminActor.user.id);
    });

    it('rejects any request without a token', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/users/${randomUUID()}`)
        .expect(401);
    });

    it('rejects an OPERATOR caller, since this endpoint is restricted to ADMIN only', async () => {
      // Unlike the other /users endpoints (class-level @Roles(ADMIN, OPERATOR)),
      // DELETE /users/:id carries its own method-level @Roles(RoleCode.ADMIN).
      // RolesGuard.getAllAndOverride() picks the closer (method) decorator, so
      // an OPERATOR caller is rejected by the guard itself, before the request
      // ever reaches UsersService.remove()/validateUserManagementPermission.
      const operatorActor = await createTestUser(db, {
        roleCode: RoleCode.OPERATOR,
      });
      const operatorToken = await loginAndGetToken(
        app,
        operatorActor.user.username,
        operatorActor.plainPassword,
      );
      const adminTarget = await createTestUser(db, { roleCode: RoleCode.ADMIN });

      try {
        const response = await authorizedDelete(
          app,
          `/api/v1/users/${adminTarget.user.id}`,
          operatorToken,
        ).expect(403);

        expect((response.body as ApiErrorResponse).success).toBe(false);
      } finally {
        await db.prisma.user.deleteMany({
          where: { id: { in: [operatorActor.user.id, adminTarget.user.id] } },
        });
      }
    });

    it('returns 403 LAST_ADMIN_CANNOT_BE_DELETED when the target is the sole active administrator', async () => {
      // This scenario cannot be reproduced through the HTTP endpoint with a
      // real, distinct caller: UsersService.ensureAnotherActiveAdministratorExists
      // counts every OTHER active admin besides the target WITHOUT excluding
      // the caller, and DELETE /users/:id is ADMIN-only with JwtAuthGuard
      // re-validating the caller's `active` flag on every request. So any
      // caller allowed to reach this handler is, by construction, itself
      // "another active administrator" for a target that isn't themselves —
      // and a same-caller/target call is intercepted earlier by the
      // USER_CANNOT_DELETE_SELF check instead. The only way to exercise this
      // branch at all is to call UsersService.remove() directly (still wired
      // to the real app/DB) after temporarily deactivating every other
      // currently-active administrator, exactly as the unit test for this
      // service does with mocks (test/unit/services/users.service.spec.ts).
      //
      // Risk: briefly deactivating admins that belong to OTHER, concurrently
      // running integration files against this shared test database could
      // affect them for that short window. The deactivate/assert/reactivate
      // sequence below is kept inside this single `it`, with no unrelated
      // awaits in between, and the reactivation runs in a `finally` so it
      // happens even if the assertion throws.
      const onlyAdmin = await createTestUser(db, { roleCode: RoleCode.ADMIN });

      const otherActiveAdmins = await db.prisma.user.findMany({
        where: {
          role: { code: RoleCode.ADMIN },
          active: true,
          id: { not: onlyAdmin.user.id },
        },
        select: { id: true },
      });
      const otherActiveAdminIds = otherActiveAdmins.map((user) => user.id);

      await db.prisma.user.updateMany({
        where: { id: { in: otherActiveAdminIds } },
        data: { active: false },
      });

      try {
        const usersService = app.get(UsersService);
        const fakeCurrentUser: AuthenticatedUser = {
          id: adminActor.user.id,
          username: adminActor.user.username,
          email: adminActor.user.email,
          role: RoleCode.ADMIN,
          roleLevel: 100,
          firstLogin: false,
        };
        const fakeRequestContext: RequestContext = {
          requestId: randomUUID(),
          sourceIp: '127.0.0.1',
        };

        let thrown: unknown;

        try {
          await usersService.remove(
            fakeCurrentUser,
            fakeRequestContext,
            onlyAdmin.user.id,
          );
        } catch (error) {
          thrown = error;
        }

        expect(thrown).toBeInstanceOf(ForbiddenException);
        expect((thrown as ForbiddenException).getResponse()).toMatchObject({
          code: 'LAST_ADMIN_CANNOT_BE_DELETED',
        });

        const untouchedAdmin = await db.prisma.user.findUnique({
          where: { id: onlyAdmin.user.id },
        });

        expect(untouchedAdmin).not.toBeNull();
      } finally {
        await db.prisma.user.updateMany({
          where: { id: { in: otherActiveAdminIds } },
          data: { active: true },
        });
        await db.prisma.user.deleteMany({ where: { id: onlyAdmin.user.id } });
      }
    });
  });

  describe('Authorization', () => {
    let viewerActor: CreatedTestUser;
    let viewerToken: string;

    beforeAll(async () => {
      viewerActor = await createTestUser(db, { roleCode: RoleCode.VIEWER });
      viewerToken = await loginAndGetToken(
        app,
        viewerActor.user.username,
        viewerActor.plainPassword,
      );
    });

    afterAll(async () => {
      await db.prisma.user.delete({ where: { id: viewerActor.user.id } });
    });

    it('rejects any request without a token', async () => {
      await request(app.getHttpServer()).get('/api/v1/users').expect(401);
    });

    it('rejects a VIEWER role, which has no user-management permission', async () => {
      await authorizedGet(app, '/api/v1/users', viewerToken).expect(403);
    });
  });
});
