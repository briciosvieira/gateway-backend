import { RoleCode } from '../../generated/prisma/client';
import type { Role } from '../../generated/prisma/client';

export function buildRoleFixture(overrides: Partial<Role> = {}): Role {
  return {
    id: 'role-admin-id',
    code: RoleCode.ADMIN,
    name: 'Administrator',
    description: 'Full access role.',
    level: 100,
    active: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

export const adminRoleFixture: Role = buildRoleFixture();

export const operatorRoleFixture: Role = buildRoleFixture({
  id: 'role-operator-id',
  code: RoleCode.OPERATOR,
  name: 'Operator',
  level: 50,
});

export const viewerRoleFixture: Role = buildRoleFixture({
  id: 'role-viewer-id',
  code: RoleCode.VIEWER,
  name: 'Viewer',
  level: 20,
});

export const auditorRoleFixture: Role = buildRoleFixture({
  id: 'role-auditor-id',
  code: RoleCode.AUDITOR,
  name: 'Auditor',
  level: 10,
});
