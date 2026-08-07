import type { RoleCode } from '../../../../generated/prisma/client';

export interface JwtPayload {
  sub: string;
  username: string;
  email: string;
  role: RoleCode;
  roleLevel: number;
  firstLogin: boolean;
  tokenType: 'access' | 'refresh';
  jti?: string;
}
