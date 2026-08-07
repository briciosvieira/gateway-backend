import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuthService } from '../../../src/modules/auth/auth.service';
import type { AuthenticatedUser } from '../../../src/modules/auth/interfaces/authenticated-user.interface';
import type { JwtPayload } from '../../../src/modules/auth/interfaces/jwt-payload.interface';
import { RoleCode } from '../../../generated/prisma/client';
import { adminUserFixture, authenticatedAdminFixture } from '../../fixtures/users.fixture';
import {
  createMockPrismaService,
  mockTransactionArray,
  resetMockPrismaService,
} from '../../helpers/prisma-mock.helper';
import type { MockPrismaService } from '../../helpers/prisma-mock.helper';

jest.mock('argon2');

describe('AuthService', () => {
  let service: AuthService;
  let prisma: MockPrismaService;
  let jwtService: JwtService;
  let configService: ConfigService;

  const configValues: Record<string, string> = {
    JWT_ACCESS_SECRET: 'test-access-secret',
    JWT_REFRESH_SECRET: 'test-refresh-secret',
    JWT_ACCESS_EXPIRES_IN: '15m',
    JWT_REFRESH_EXPIRES_IN: '7d',
  };

  beforeEach(() => {
    prisma = createMockPrismaService();

    jwtService = {
      signAsync: jest.fn(),
      verifyAsync: jest.fn(),
      decode: jest.fn(),
    } as unknown as JwtService;

    configService = {
      get: jest.fn(),
    } as unknown as ConfigService;

    (configService.get as jest.Mock).mockImplementation(
      (key: string, defaultValue?: string) => configValues[key] ?? defaultValue,
    );

    service = new AuthService(prisma, jwtService, configService);
  });

  afterEach(() => {
    resetMockPrismaService(prisma);
    jest.clearAllMocks();
  });

  const futureExp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

  function mockSuccessfulTokenGeneration(): void {
    (jwtService.signAsync as jest.Mock)
      .mockResolvedValueOnce('signed-access-token')
      .mockResolvedValueOnce('signed-refresh-token');
    (jwtService.decode as jest.Mock).mockReturnValue({ exp: futureExp });
    (argon2.hash as jest.Mock).mockResolvedValue('hashed-refresh-token');
    prisma.refreshToken.create.mockResolvedValue({
      id: 'refresh-token-id',
      userId: adminUserFixture.id,
      tokenHash: 'hashed-refresh-token',
      revokedAt: null,
      expiresAt: new Date(futureExp * 1000),
      createdAt: new Date(),
    } as never);
  }

  describe('login', () => {
    it('throws UnauthorizedException when the user is not found', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.login({ login: 'missing', password: 'password123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when the user is inactive', async () => {
      prisma.user.findFirst.mockResolvedValue({ ...adminUserFixture, active: false } as never);

      await expect(
        service.login({ login: 'admin_fixture', password: 'password123' }),
      ).rejects.toThrow('Invalid username, email or password.');
    });

    it('throws UnauthorizedException when the role is inactive', async () => {
      prisma.user.findFirst.mockResolvedValue({
        ...adminUserFixture,
        role: { ...adminUserFixture.role, active: false },
      } as never);

      await expect(
        service.login({ login: 'admin_fixture', password: 'password123' }),
      ).rejects.toThrow('Invalid username, email or password.');
    });

    it('throws UnauthorizedException when the password is invalid', async () => {
      prisma.user.findFirst.mockResolvedValue(adminUserFixture as never);
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ login: 'admin_fixture', password: 'wrong-password' }),
      ).rejects.toThrow('Invalid username, email or password.');
    });

    it('normalizes the login (trim + lowercase) before searching for the user', async () => {
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.login({ login: '  Admin_Fixture@Example.Test  ', password: 'password123' }),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [{ username: 'admin_fixture@example.test' }, { email: 'admin_fixture@example.test' }],
        },
        include: { role: true },
      });
    });

    it('updates lastLoginAt, generates a token pair and returns the login payload on success', async () => {
      prisma.user.findFirst.mockResolvedValue(adminUserFixture as never);
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      prisma.user.update.mockResolvedValue({ ...adminUserFixture, lastLoginAt: new Date() } as never);
      mockSuccessfulTokenGeneration();

      const result = await service.login({ login: 'admin_fixture', password: 'password123' });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: adminUserFixture.id },
        data: { lastLoginAt: expect.any(Date) },
      });

      expect(result).toEqual({
        accessToken: 'signed-access-token',
        refreshToken: 'signed-refresh-token',
        accessTokenExpiresIn: '15m',
        refreshTokenExpiresIn: '7d',
        user: {
          name: adminUserFixture.name,
          username: adminUserFixture.username,
          email: adminUserFixture.email,
          role: adminUserFixture.role.code,
          firstLogin: adminUserFixture.firstLogin,
        },
        mustChangePassword: adminUserFixture.firstLogin,
      });
    });

    it('reflects mustChangePassword as true when the user has firstLogin set', async () => {
      const firstLoginUser = { ...adminUserFixture, firstLogin: true };
      prisma.user.findFirst.mockResolvedValue(firstLoginUser as never);
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      prisma.user.update.mockResolvedValue(firstLoginUser as never);
      mockSuccessfulTokenGeneration();

      const result = await service.login({ login: 'admin_fixture', password: 'password123' });

      expect(result.mustChangePassword).toBe(true);
    });
  });

  describe('refresh', () => {
    const validPayload: JwtPayload = {
      sub: adminUserFixture.id,
      username: adminUserFixture.username,
      email: adminUserFixture.email,
      role: adminUserFixture.role.code as RoleCode,
      roleLevel: adminUserFixture.role.level,
      firstLogin: adminUserFixture.firstLogin,
      tokenType: 'refresh',
      jti: 'refresh-token-id',
    };

    const storedTokenFixture = {
      id: 'refresh-token-id',
      userId: adminUserFixture.id,
      tokenHash: 'hashed-refresh-token',
      revokedAt: null as Date | null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      createdAt: new Date(),
      user: adminUserFixture,
    };

    it('throws an Error when JWT_REFRESH_SECRET is not configured', async () => {
      (configService.get as jest.Mock).mockImplementation((key: string) =>
        key === 'JWT_REFRESH_SECRET' ? undefined : configValues[key],
      );

      await expect(service.refresh('some-token')).rejects.toThrow(
        'JWT_REFRESH_SECRET is not configured.',
      );
    });

    it('throws UnauthorizedException when the token is invalid or expired', async () => {
      (jwtService.verifyAsync as jest.Mock).mockRejectedValue(new Error('invalid'));

      await expect(service.refresh('bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when tokenType is not "refresh"', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
        ...validPayload,
        tokenType: 'access',
      });

      await expect(service.refresh('access-token')).rejects.toThrow(
        'Invalid refresh token.',
      );
    });

    it('throws UnauthorizedException when the payload has no jti', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
        ...validPayload,
        jti: undefined,
      });

      await expect(service.refresh('no-jti-token')).rejects.toThrow(
        'Invalid refresh token.',
      );
    });

    it('throws UnauthorizedException when the stored refresh token is not found', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue(validPayload);
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refresh('unknown-token')).rejects.toThrow(
        'Refresh token is invalid or revoked.',
      );
    });

    it('throws UnauthorizedException when the stored refresh token is revoked', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue(validPayload);
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...storedTokenFixture,
        revokedAt: new Date(),
      } as never);

      await expect(service.refresh('revoked-token')).rejects.toThrow(
        'Refresh token is invalid or revoked.',
      );
    });

    it('throws UnauthorizedException when the stored refresh token is expired', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue(validPayload);
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...storedTokenFixture,
        expiresAt: new Date(Date.now() - 1000),
      } as never);

      await expect(service.refresh('expired-token')).rejects.toThrow(
        'Refresh token is invalid or revoked.',
      );
    });

    it('throws UnauthorizedException when the token user is inactive', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue(validPayload);
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...storedTokenFixture,
        user: { ...adminUserFixture, active: false },
      } as never);

      await expect(service.refresh('token')).rejects.toThrow(
        'Refresh token is invalid or revoked.',
      );
    });

    it('throws UnauthorizedException when the token user role is inactive', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue(validPayload);
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...storedTokenFixture,
        user: { ...adminUserFixture, role: { ...adminUserFixture.role, active: false } },
      } as never);

      await expect(service.refresh('token')).rejects.toThrow(
        'Refresh token is invalid or revoked.',
      );
    });

    it('throws UnauthorizedException when the token hash does not match', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue(validPayload);
      prisma.refreshToken.findUnique.mockResolvedValue(storedTokenFixture as never);
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(service.refresh('mismatched-token')).rejects.toThrow(
        'Refresh token is invalid.',
      );
    });

    it('revokes the old refresh token and generates a new token pair on success', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue(validPayload);
      prisma.refreshToken.findUnique.mockResolvedValue(storedTokenFixture as never);
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      prisma.refreshToken.update.mockResolvedValue({
        ...storedTokenFixture,
        revokedAt: new Date(),
      } as never);
      mockSuccessfulTokenGeneration();

      const result = await service.refresh('valid-refresh-token');

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: storedTokenFixture.id },
        data: { revokedAt: expect.any(Date) },
      });

      expect(result).toEqual({
        accessToken: 'signed-access-token',
        refreshToken: 'signed-refresh-token',
        accessTokenExpiresIn: '15m',
        refreshTokenExpiresIn: '7d',
      });
    });
  });

  describe('logout', () => {
    it('does not throw when JWT_REFRESH_SECRET is not configured', async () => {
      (configService.get as jest.Mock).mockImplementation((key: string) =>
        key === 'JWT_REFRESH_SECRET' ? undefined : configValues[key],
      );

      await expect(service.logout('any-token')).resolves.toBeUndefined();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('does not throw when the token is invalid', async () => {
      (jwtService.verifyAsync as jest.Mock).mockRejectedValue(new Error('invalid'));

      await expect(service.logout('bad-token')).resolves.toBeUndefined();
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('does not throw when the token is expired (idempotent)', async () => {
      (jwtService.verifyAsync as jest.Mock).mockRejectedValue(new Error('expired'));

      await expect(service.logout('expired-token')).resolves.toBeUndefined();
    });

    it('revokes the refresh token when the payload has a jti', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
        tokenType: 'refresh',
        jti: 'refresh-token-id',
      });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 } as never);

      await service.logout('valid-token');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'refresh-token-id', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('does not revoke anything when the payload has no jti', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({ tokenType: 'refresh' });

      await service.logout('token-without-jti');

      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('changePassword', () => {
    const dto = {
      currentPassword: 'CurrentPass123!',
      newPassword: 'NewPassword123!',
    };

    it('throws UnauthorizedException when the user is not found', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.changePassword(authenticatedAdminFixture, dto)).rejects.toThrow(
        'User was not found.',
      );
    });

    it('throws UnauthorizedException when the user is inactive', async () => {
      prisma.user.findUnique.mockResolvedValue({ ...adminUserFixture, active: false } as never);

      await expect(service.changePassword(authenticatedAdminFixture, dto)).rejects.toThrow(
        'User was not found.',
      );
    });

    it('throws UnauthorizedException when the current password is incorrect', async () => {
      prisma.user.findUnique.mockResolvedValue(adminUserFixture as never);
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(service.changePassword(authenticatedAdminFixture, dto)).rejects.toThrow(
        'Current password is incorrect.',
      );
    });

    it('throws UnauthorizedException when the new password matches the current one', async () => {
      prisma.user.findUnique.mockResolvedValue(adminUserFixture as never);
      (argon2.verify as jest.Mock).mockResolvedValue(true);

      await expect(service.changePassword(authenticatedAdminFixture, dto)).rejects.toThrow(
        'The new password must be different from the current password.',
      );
    });

    it('updates the password hash and revokes refresh tokens in a transaction on success', async () => {
      prisma.user.findUnique.mockResolvedValue(adminUserFixture as never);
      (argon2.verify as jest.Mock)
        .mockResolvedValueOnce(true) // current password matches
        .mockResolvedValueOnce(false); // new password differs from current
      (argon2.hash as jest.Mock).mockResolvedValue('new-hashed-password');
      mockTransactionArray(prisma, [
        { ...adminUserFixture, passwordHash: 'new-hashed-password', firstLogin: false },
        { count: 1 },
      ]);

      await expect(
        service.changePassword(authenticatedAdminFixture, dto),
      ).resolves.toBeUndefined();

      expect(argon2.hash).toHaveBeenCalledWith(dto.newPassword);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('getProfile', () => {
    it('returns the user profile using the currentUser id', async () => {
      const profile = {
        id: adminUserFixture.id,
        name: adminUserFixture.name,
        username: adminUserFixture.username,
        email: adminUserFixture.email,
        active: adminUserFixture.active,
        firstLogin: adminUserFixture.firstLogin,
        lastLoginAt: adminUserFixture.lastLoginAt,
        createdAt: adminUserFixture.createdAt,
        role: {
          id: adminUserFixture.role.id,
          code: adminUserFixture.role.code,
          name: adminUserFixture.role.name,
          level: adminUserFixture.role.level,
        },
      };
      prisma.user.findUnique.mockResolvedValue(profile as never);

      const result = await service.getProfile(authenticatedAdminFixture);

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: authenticatedAdminFixture.id },
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          active: true,
          firstLogin: true,
          lastLoginAt: true,
          createdAt: true,
          role: {
            select: {
              id: true,
              code: true,
              name: true,
              level: true,
            },
          },
        },
      });
      expect(result).toEqual(profile);
    });
  });
});
