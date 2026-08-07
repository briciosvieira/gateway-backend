import jwt from 'jsonwebtoken';
import type { RoleCode } from '../../generated/prisma/client';

export interface JwtTestUser {
  id: string;
  username: string;
  email: string;
  role: RoleCode;
  roleLevel: number;
  firstLogin: boolean;
}

/**
 * Signs an access token with the exact payload shape AuthService produces,
 * using JWT_ACCESS_SECRET from the test environment. Lets tests that are not
 * exercising the login flow itself obtain a valid token quickly.
 */
export function signTestAccessToken(user: JwtTestUser): string {
  const secret = process.env.JWT_ACCESS_SECRET;

  if (!secret) {
    throw new Error('JWT_ACCESS_SECRET is not configured in the test environment.');
  }

  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      roleLevel: user.roleLevel,
      firstLogin: user.firstLogin,
      tokenType: 'access',
    },
    secret,
    { expiresIn: '15m' },
  );
}

export function authorizationHeader(token: string): string {
  return `Bearer ${token}`;
}
