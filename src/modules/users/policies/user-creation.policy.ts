import { ForbiddenException } from '@nestjs/common';
import { RoleCode } from '../../../../generated/prisma/client';

export function validateUserCreationPermission(
  currentUserRole: RoleCode,
  targetUserRole: RoleCode,
): void {
  if (currentUserRole === RoleCode.ADMIN) {
    return;
  }

  if (
    currentUserRole === RoleCode.OPERATOR &&
    targetUserRole !== RoleCode.ADMIN
  ) {
    return;
  }

  throw new ForbiddenException(
    'You do not have permission to create a user with this role.',
  );
}

export function validateUserManagementPermission(
  currentUserRole: RoleCode,
  targetUserRole: RoleCode,
): void {
  if (currentUserRole === RoleCode.ADMIN) {
    return;
  }

  if (
    currentUserRole === RoleCode.OPERATOR &&
    targetUserRole !== RoleCode.ADMIN
  ) {
    return;
  }

  throw new ForbiddenException(
    'You do not have permission to manage this user.',
  );
}
