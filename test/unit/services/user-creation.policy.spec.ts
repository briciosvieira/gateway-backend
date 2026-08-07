import { ForbiddenException } from '@nestjs/common';
import { RoleCode } from '../../../generated/prisma/client';
import {
  validateUserCreationPermission,
  validateUserManagementPermission,
} from '../../../src/modules/users/policies/user-creation.policy';

describe('user-creation.policy', () => {
  describe('validateUserCreationPermission', () => {
    it('allows an ADMIN to create a user with any role', () => {
      expect(() =>
        validateUserCreationPermission(RoleCode.ADMIN, RoleCode.ADMIN),
      ).not.toThrow();
    });

    it('allows an OPERATOR to create a non-ADMIN user', () => {
      expect(() =>
        validateUserCreationPermission(RoleCode.OPERATOR, RoleCode.VIEWER),
      ).not.toThrow();
    });

    it('forbids an OPERATOR from creating an ADMIN user', () => {
      expect(() =>
        validateUserCreationPermission(RoleCode.OPERATOR, RoleCode.ADMIN),
      ).toThrow(ForbiddenException);
    });

    it('forbids a VIEWER from creating any user', () => {
      expect(() =>
        validateUserCreationPermission(RoleCode.VIEWER, RoleCode.VIEWER),
      ).toThrow('You do not have permission to create a user with this role.');
    });

    it('forbids an AUDITOR from creating any user', () => {
      expect(() =>
        validateUserCreationPermission(RoleCode.AUDITOR, RoleCode.VIEWER),
      ).toThrow(ForbiddenException);
    });
  });

  describe('validateUserManagementPermission', () => {
    it('allows an ADMIN to manage any user', () => {
      expect(() =>
        validateUserManagementPermission(RoleCode.ADMIN, RoleCode.ADMIN),
      ).not.toThrow();
    });

    it('allows an OPERATOR to manage a non-ADMIN user', () => {
      expect(() =>
        validateUserManagementPermission(RoleCode.OPERATOR, RoleCode.AUDITOR),
      ).not.toThrow();
    });

    it('forbids an OPERATOR from managing an ADMIN user', () => {
      expect(() =>
        validateUserManagementPermission(RoleCode.OPERATOR, RoleCode.ADMIN),
      ).toThrow('You do not have permission to manage this user.');
    });

    it('forbids a VIEWER from managing any user', () => {
      expect(() =>
        validateUserManagementPermission(RoleCode.VIEWER, RoleCode.VIEWER),
      ).toThrow(ForbiddenException);
    });
  });
});
