import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma/prisma.service';
import type { ChangePasswordDto } from './dto/change-password.dto';
import type { LoginDto } from './dto/login.dto';
import type { AuthenticatedUser } from './interfaces/authenticated-user.interface';
import type { JwtPayload } from './interfaces/jwt-payload.interface';
import type { SignOptions } from 'jsonwebtoken';
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: string;
  refreshTokenExpiresIn: string;
}

export interface LoginResponse extends TokenPair {
  user: {
    name: string;
    username: string;
    email: string;
    role: string;
    firstLogin: boolean;
  };
  mustChangePassword: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async login(dto: LoginDto): Promise<LoginResponse> {
    const normalizedLogin = dto.login.trim().toLowerCase();

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          {
            username: normalizedLogin,
          },
          {
            email: normalizedLogin,
          },
        ],
      },
      include: {
        role: true,
      },
    });

    if (!user || !user.active || !user.role.active) {
      throw new UnauthorizedException('Invalid username, email or password.');
    }

    const passwordIsValid = await argon2.verify(
      user.passwordHash,
      dto.password,
    );

    if (!passwordIsValid) {
      throw new UnauthorizedException('Invalid username, email or password.');
    }

    await this.prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        lastLoginAt: new Date(),
      },
    });

    const tokens = await this.generateTokenPair({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role.code,
      roleLevel: user.role.level,
      firstLogin: user.firstLogin,
    });

    return {
      ...tokens,
      user: {
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role.code,
        firstLogin: user.firstLogin,
      },
      mustChangePassword: user.firstLogin,
    };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET');

    if (!refreshSecret) {
      throw new Error('JWT_REFRESH_SECRET is not configured.');
    }

    let payload: JwtPayload;

    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }

    if (payload.tokenType !== 'refresh' || !payload.jti) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    const storedToken = await this.prisma.refreshToken.findUnique({
      where: {
        id: payload.jti,
      },
      include: {
        user: {
          include: {
            role: true,
          },
        },
      },
    });

    if (
      !storedToken ||
      storedToken.revokedAt ||
      storedToken.expiresAt <= new Date() ||
      !storedToken.user.active ||
      !storedToken.user.role.active
    ) {
      throw new UnauthorizedException('Refresh token is invalid or revoked.');
    }

    const tokenIsValid = await argon2.verify(
      storedToken.tokenHash,
      refreshToken,
    );

    if (!tokenIsValid) {
      throw new UnauthorizedException('Refresh token is invalid.');
    }

    // Rotation: old token is revoked after use.
    await this.prisma.refreshToken.update({
      where: {
        id: storedToken.id,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return this.generateTokenPair({
      id: storedToken.user.id,
      username: storedToken.user.username,
      email: storedToken.user.email,
      role: storedToken.user.role.code,
      roleLevel: storedToken.user.role.level,
      firstLogin: storedToken.user.firstLogin,
    });
  }

  async logout(refreshToken: string): Promise<void> {
    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET');

    if (!refreshSecret) {
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(
        refreshToken,
        {
          secret: refreshSecret,
          ignoreExpiration: true,
        },
      );

      if (payload.jti) {
        await this.prisma.refreshToken.updateMany({
          where: {
            id: payload.jti,
            revokedAt: null,
          },
          data: {
            revokedAt: new Date(),
          },
        });
      }
    } catch {
      // Logout remains idempotent.
    }
  }

  async changePassword(
    currentUser: AuthenticatedUser,
    dto: ChangePasswordDto,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: currentUser.id,
      },
    });

    if (!user || !user.active) {
      throw new UnauthorizedException('User was not found.');
    }

    const currentPasswordIsValid = await argon2.verify(
      user.passwordHash,
      dto.currentPassword,
    );

    if (!currentPasswordIsValid) {
      throw new UnauthorizedException('Current password is incorrect.');
    }

    const samePassword = await argon2.verify(
      user.passwordHash,
      dto.newPassword,
    );

    if (samePassword) {
      throw new UnauthorizedException(
        'The new password must be different from the current password.',
      );
    }

    const newPasswordHash = await argon2.hash(dto.newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: {
          id: currentUser.id,
        },
        data: {
          passwordHash: newPasswordHash,
          firstLogin: false,
        },
      }),

      this.prisma.refreshToken.updateMany({
        where: {
          userId: currentUser.id,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      }),
    ]);
  }

  async getProfile(currentUser: AuthenticatedUser) {
    return this.prisma.user.findUnique({
      where: {
        id: currentUser.id,
      },
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
  }

  private async generateTokenPair(user: AuthenticatedUser): Promise<TokenPair> {
    const accessSecret = this.configService.get<string>('JWT_ACCESS_SECRET');

    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET');

    const accessExpiresIn = this.configService.get<string>(
      'JWT_ACCESS_EXPIRES_IN',
      '15m',
    ) as SignOptions['expiresIn'];

    const refreshExpiresIn = this.configService.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
      '7d',
    ) as SignOptions['expiresIn'];

    if (!accessSecret || !refreshSecret) {
      throw new Error('JWT secrets are not configured.');
    }

    const refreshTokenId = randomUUID();

    const basePayload = {
      sub: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      roleLevel: user.roleLevel,
      firstLogin: user.firstLogin,
    };

    const accessToken = await this.jwtService.signAsync(
      {
        ...basePayload,
        tokenType: 'access',
      },
      {
        secret: accessSecret,
        expiresIn: accessExpiresIn,
      },
    );

    const refreshToken = await this.jwtService.signAsync(
      {
        ...basePayload,
        tokenType: 'refresh',
        jti: refreshTokenId,
      },
      {
        secret: refreshSecret,
        expiresIn: refreshExpiresIn,
      },
    );

    const decodedRefreshToken = this.jwtService.decode<{ exp?: number }>(
      refreshToken,
    );

    if (!decodedRefreshToken?.exp) {
      throw new Error('Refresh token expiration could not be determined.');
    }

    const tokenHash = await argon2.hash(refreshToken);

    await this.prisma.refreshToken.create({
      data: {
        id: refreshTokenId,
        userId: user.id,
        tokenHash,
        expiresAt: new Date(decodedRefreshToken.exp * 1000),
      },
    });

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresIn: String(accessExpiresIn),
      refreshTokenExpiresIn: String(refreshExpiresIn),
    };
  }
}
