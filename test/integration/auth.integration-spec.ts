import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { ApiErrorResponse } from '../../src/common/interfaces/api-error-response.interface';
import type { ApiResponse } from '../../src/common/interfaces/api-response.interface';
import { RoleCode } from '../../generated/prisma/client';
import type { CreatedTestUser } from '../helpers/factories/user.factory';
import { createTestUser } from '../helpers/factories/user.factory';
import { randomStrongPassword } from '../helpers/random-data.helper';
import { authorizedGet, authorizedPost } from '../helpers/request.helper';
import { createTestApp } from '../helpers/test-app.helper';
import { TestDatabase } from '../helpers/test-database.helper';

interface LoginResponseUser {
  name: string;
  username: string;
  email: string;
  role: string;
  firstLogin: boolean;
}

interface LoginResponseData {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: string;
  refreshTokenExpiresIn: string;
  user: LoginResponseUser;
  mustChangePassword: boolean;
}

interface TokenPairData {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: string;
  refreshTokenExpiresIn: string;
}

interface ProfileRole {
  id: string;
  code: string;
  name: string;
  level: number;
}

interface ProfileData {
  id: string;
  name: string;
  username: string;
  email: string;
  active: boolean;
  firstLogin: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  role: ProfileRole;
}

/** Signs a structurally valid JWT that AuthService will always reject (wrong secret / unknown jti). */
function signForeignRefreshToken(): string {
  return jwt.sign(
    { tokenType: 'refresh', jti: randomUUID() },
    'not-the-real-refresh-secret',
    { expiresIn: '7d' },
  );
}

describe('Auth (integration)', () => {
  let app: NestFastifyApplication;
  let db: TestDatabase;

  beforeAll(async () => {
    db = new TestDatabase();
    await db.connect();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await db.disconnect();
  });

  describe('POST /auth/login', () => {
    const knownPassword = 'Kn0wn@Pass1234';
    let activeUser: CreatedTestUser;
    let inactiveUser: CreatedTestUser;

    beforeAll(async () => {
      activeUser = await createTestUser(db, {
        roleCode: RoleCode.ADMIN,
        password: knownPassword,
      });
      inactiveUser = await createTestUser(db, {
        roleCode: RoleCode.VIEWER,
        password: knownPassword,
        active: false,
      });
    });

    afterAll(async () => {
      await db.prisma.user.deleteMany({
        where: { id: { in: [activeUser.user.id, inactiveUser.user.id] } },
      });
    });

    it('returns an access/refresh token pair for correct credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ login: activeUser.user.username, password: knownPassword })
        .expect(200);

      const body = response.body as ApiResponse<LoginResponseData>;

      expect(body.data.accessToken).toBeTruthy();
      expect(body.data.refreshToken).toBeTruthy();
      expect(body.data.user.username).toBe(activeUser.user.username);
      expect(body.data.mustChangePassword).toBe(false);
    });

    it('rejects a wrong password', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ login: activeUser.user.username, password: 'WrongPassword123!' })
        .expect(401);

      const body = response.body as ApiErrorResponse;

      expect(body.success).toBe(false);
    });

    it('rejects a username that does not exist', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ login: 'no_such_user_at_all', password: 'WhateverPass123!' })
        .expect(401);
    });

    it('rejects an inactive user even with the correct password', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ login: inactiveUser.user.username, password: knownPassword })
        .expect(401);
    });
  });

  describe('GET /auth/me', () => {
    let testUser: CreatedTestUser;
    let accessToken: string;

    beforeAll(async () => {
      testUser = await createTestUser(db, { roleCode: RoleCode.OPERATOR });

      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ login: testUser.user.username, password: testUser.plainPassword })
        .expect(200);

      accessToken = (loginResponse.body as ApiResponse<LoginResponseData>).data
        .accessToken;
    });

    afterAll(async () => {
      await db.prisma.user.delete({ where: { id: testUser.user.id } });
    });

    it('returns the current user profile with a valid token', async () => {
      const response = await authorizedGet(
        app,
        '/api/v1/auth/me',
        accessToken,
      ).expect(200);

      const body = response.body as ApiResponse<ProfileData>;

      expect(body.data.id).toBe(testUser.user.id);
      expect(body.data.username).toBe(testUser.user.username);
      expect(body.data.role.code).toBe(RoleCode.OPERATOR);
    });

    it('rejects the request when no token is provided', async () => {
      await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    });
  });

  describe('POST /auth/refresh', () => {
    let testUser: CreatedTestUser;
    let firstRefreshToken: string;

    beforeAll(async () => {
      testUser = await createTestUser(db, { roleCode: RoleCode.OPERATOR });

      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ login: testUser.user.username, password: testUser.plainPassword })
        .expect(200);

      firstRefreshToken = (loginResponse.body as ApiResponse<LoginResponseData>)
        .data.refreshToken;
    });

    afterAll(async () => {
      await db.prisma.user.delete({ where: { id: testUser.user.id } });
    });

    it('issues a new token pair for a valid refresh token', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: firstRefreshToken })
        .expect(200);

      const body = response.body as ApiResponse<TokenPairData>;

      expect(body.data.accessToken).toBeTruthy();
      expect(body.data.refreshToken).toBeTruthy();
      expect(body.data.refreshToken).not.toBe(firstRefreshToken);
    });

    it('rejects reuse of the same refresh token after rotation', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: firstRefreshToken })
        .expect(401);
    });
  });

  describe('POST /auth/change-password', () => {
    const initialPassword = 'Init1al@Pass99';
    let testUser: CreatedTestUser;
    let accessToken: string;

    beforeAll(async () => {
      testUser = await createTestUser(db, {
        roleCode: RoleCode.OPERATOR,
        password: initialPassword,
      });

      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ login: testUser.user.username, password: initialPassword })
        .expect(200);

      accessToken = (loginResponse.body as ApiResponse<LoginResponseData>).data
        .accessToken;
    });

    afterAll(async () => {
      await db.prisma.user.delete({ where: { id: testUser.user.id } });
    });

    it('rejects the wrong current password', async () => {
      await authorizedPost(app, '/api/v1/auth/change-password', accessToken, {
        currentPassword: 'NotTheRealPassword1!',
        newPassword: randomStrongPassword(),
      }).expect(401);
    });

    it('rejects a new password that does not meet the policy', async () => {
      await authorizedPost(app, '/api/v1/auth/change-password', accessToken, {
        currentPassword: initialPassword,
        newPassword: 'Sh0rt!',
      }).expect(400);
    });

    it('changes the password and rotates it end to end', async () => {
      const newPassword = randomStrongPassword();

      await authorizedPost(app, '/api/v1/auth/change-password', accessToken, {
        currentPassword: initialPassword,
        newPassword,
      }).expect(204);

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ login: testUser.user.username, password: initialPassword })
        .expect(401);

      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ login: testUser.user.username, password: newPassword })
        .expect(200);
    });
  });

  describe('POST /auth/logout', () => {
    it('returns 204 for a syntactically valid but unknown refresh token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .send({ refreshToken: signForeignRefreshToken() })
        .expect(204);
    });

    it('returns 204 even when the refresh token was already revoked', async () => {
      const testUser = await createTestUser(db, { roleCode: RoleCode.VIEWER });

      const loginResponse = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ login: testUser.user.username, password: testUser.plainPassword })
        .expect(200);

      const refreshToken = (
        loginResponse.body as ApiResponse<LoginResponseData>
      ).data.refreshToken;

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .send({ refreshToken })
        .expect(204);

      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .send({ refreshToken })
        .expect(204);

      await db.prisma.user.delete({ where: { id: testUser.user.id } });
    });
  });
});
