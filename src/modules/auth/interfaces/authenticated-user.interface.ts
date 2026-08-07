import type { RoleCode } from '../../../../generated/prisma/client';

export interface AuthenticatedUser {
  id: string;
  username: string;
  email: string;
  role: RoleCode;
  roleLevel: number;
  firstLogin: boolean;
}
