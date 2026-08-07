import type { Role } from '../../generated/prisma/client';
import { RoleCode } from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../../src/modules/auth/interfaces/authenticated-user.interface';
import {
  adminRoleFixture,
  auditorRoleFixture,
  operatorRoleFixture,
  viewerRoleFixture,
} from './roles.fixture';

interface UserWithRole {
  id: string;
  roleId: string;
  name: string;
  username: string;
  email: string;
  passwordHash: string;
  active: boolean;
  firstLogin: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  role: Role;
}

function buildUserFixture(overrides: Partial<UserWithRole> = {}): UserWithRole {
  return {
    id: 'user-admin-id',
    roleId: adminRoleFixture.id,
    name: 'Admin Fixture',
    username: 'admin_fixture',
    email: 'admin.fixture@example.test',
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$fixturehash',
    active: true,
    firstLogin: false,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    role: adminRoleFixture,
    ...overrides,
  };
}

export const adminUserFixture = buildUserFixture();

export const operatorUserFixture = buildUserFixture({
  id: 'user-operator-id',
  roleId: operatorRoleFixture.id,
  name: 'Operator Fixture',
  username: 'operator_fixture',
  email: 'operator.fixture@example.test',
  role: operatorRoleFixture,
});

export const viewerUserFixture = buildUserFixture({
  id: 'user-viewer-id',
  roleId: viewerRoleFixture.id,
  name: 'Viewer Fixture',
  username: 'viewer_fixture',
  email: 'viewer.fixture@example.test',
  role: viewerRoleFixture,
});

export const auditorUserFixture = buildUserFixture({
  id: 'user-auditor-id',
  roleId: auditorRoleFixture.id,
  name: 'Auditor Fixture',
  username: 'auditor_fixture',
  email: 'auditor.fixture@example.test',
  role: auditorRoleFixture,
});

export function toAuthenticatedUser(user: UserWithRole): AuthenticatedUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role.code as RoleCode,
    roleLevel: user.role.level,
    firstLogin: user.firstLogin,
  };
}

export const authenticatedAdminFixture: AuthenticatedUser = toAuthenticatedUser(adminUserFixture);
export const authenticatedOperatorFixture: AuthenticatedUser = toAuthenticatedUser(operatorUserFixture);
export const authenticatedViewerFixture: AuthenticatedUser = toAuthenticatedUser(viewerUserFixture);
export const authenticatedAuditorFixture: AuthenticatedUser = toAuthenticatedUser(auditorUserFixture);
