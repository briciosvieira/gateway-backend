import * as argon2 from 'argon2';
import type { PrismaClient, RoleCode, User } from '../../../generated/prisma/client';
import { randomEmail, randomStrongPassword, randomUsername } from '../random-data.helper';
import type { TestDatabase } from '../test-database.helper';

export interface CreatedTestUser {
  user: User;
  plainPassword: string;
}

export interface TestUserFactoryOptions {
  roleCode?: RoleCode;
  active?: boolean;
  firstLogin?: boolean;
  username?: string;
  email?: string;
  name?: string;
  password?: string;
}

/** Creates a real, persisted User for a given role, ready to log in with a known password. */
export async function createTestUser(
  db: TestDatabase,
  options: TestUserFactoryOptions = {},
): Promise<CreatedTestUser> {
  const prisma: PrismaClient = db.prisma;
  const roleCode = options.roleCode ?? ('ADMIN' as RoleCode);
  const roleId = await db.getRoleId(roleCode);
  const plainPassword = options.password ?? randomStrongPassword();
  const passwordHash = await argon2.hash(plainPassword);

  const user = await prisma.user.create({
    data: {
      name: options.name ?? `Test User ${roleCode}`,
      username: options.username ?? randomUsername(),
      email: options.email ?? randomEmail(),
      passwordHash,
      roleId,
      active: options.active ?? true,
      firstLogin: options.firstLogin ?? false,
    },
  });

  return { user, plainPassword };
}
