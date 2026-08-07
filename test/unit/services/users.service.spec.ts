import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import type { Role } from '../../../generated/prisma/client';
import { RoleCode } from '../../../generated/prisma/client';
import type { AuditLogsService } from '../../../src/modules/audit-logs/audit-logs.service';
import type { ChangeUserRoleDto } from '../../../src/modules/users/dto/change-user-role.dto';
import type { ChangeUserStatusDto } from '../../../src/modules/users/dto/change-user-status.dto';
import type { CreateUserDto } from '../../../src/modules/users/dto/create-user.dto';
import type { UpdateUserDto } from '../../../src/modules/users/dto/update-user.dto';
import { UsersService } from '../../../src/modules/users/users.service';
import { adminRoleFixture, buildRoleFixture, operatorRoleFixture } from '../../fixtures/roles.fixture';
import {
  adminUserFixture,
  authenticatedAdminFixture,
  authenticatedOperatorFixture,
  authenticatedViewerFixture,
  operatorUserFixture,
  viewerUserFixture,
} from '../../fixtures/users.fixture';
import {
  createMockPrismaService,
  mockTransactionArray,
  mockTransactionCallback,
  resetMockPrismaService,
} from '../../helpers/prisma-mock.helper';
import type { MockPrismaService } from '../../helpers/prisma-mock.helper';

jest.mock('argon2', () => ({
  hash: jest.fn(),
}));

const mockedArgon2Hash = argon2.hash as jest.MockedFunction<typeof argon2.hash>;

interface SelectedUserFixture {
  id: string;
  name: string;
  username: string;
  email: string;
  active: boolean;
  firstLogin: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  // The mocked Prisma `user` delegate resolves generic `select` overloads against the
  // full `User` model, so the fixture must satisfy every scalar field even though
  // `roleId`/`passwordHash` are not part of `userSelect` and are never asserted on.
  roleId: string;
  passwordHash: string;
  role: {
    id: string;
    code: RoleCode;
    name: string;
    level: number;
  };
}

function buildSelectedUserFixture(
  overrides: Partial<Omit<SelectedUserFixture, 'role'>> = {},
  role: Role = operatorRoleFixture,
): SelectedUserFixture {
  return {
    id: 'user-selected-id',
    name: 'Selected Fixture',
    username: 'selected_fixture',
    email: 'selected.fixture@example.test',
    active: true,
    firstLogin: false,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    roleId: role.id,
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$fixturehash',
    ...overrides,
    role: {
      id: role.id,
      code: role.code,
      name: role.name,
      level: role.level,
    },
  };
}

describe('UsersService', () => {
  let service: UsersService;
  let prisma: MockPrismaService;
  let auditLogsService: { create: jest.Mock };

  const requestContext = { sourceIp: '203.0.113.10', requestId: 'req-1' };

  beforeEach(() => {
    prisma = createMockPrismaService();
    auditLogsService = { create: jest.fn().mockResolvedValue(undefined) };
    mockedArgon2Hash.mockResolvedValue('$argon2id$v=19$m=65536,t=3,p=4$mocked-hash');

    service = new UsersService(prisma, auditLogsService as unknown as AuditLogsService);
  });

  afterEach(() => {
    resetMockPrismaService(prisma);
    jest.clearAllMocks();
  });

  describe('create', () => {
    const createDto: CreateUserDto = {
      name: 'New User',
      username: '  New.User  ',
      email: '  New.User@Example.Test  ',
      roleId: operatorRoleFixture.id,
      requirePasswordChange: true,
    };

    it('throws NotFoundException when the role does not exist', async () => {
      prisma.role.findUnique.mockResolvedValue(null);

      await expect(
        service.create(authenticatedAdminFixture, requestContext, createDto),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the role is inactive', async () => {
      prisma.role.findUnique.mockResolvedValue(buildRoleFixture({ active: false }));

      await expect(
        service.create(authenticatedAdminFixture, requestContext, createDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when the username or email is already registered', async () => {
      prisma.role.findUnique.mockResolvedValue(operatorRoleFixture);
      prisma.user.findFirst.mockResolvedValue(operatorUserFixture);

      await expect(
        service.create(authenticatedAdminFixture, requestContext, createDto),
      ).rejects.toThrow(ConflictException);

      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('propagates the ForbiddenException raised by the creation policy', async () => {
      prisma.role.findUnique.mockResolvedValue(adminRoleFixture);

      await expect(
        service.create(authenticatedViewerFixture, requestContext, {
          ...createDto,
          roleId: adminRoleFixture.id,
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it('normalizes username and email, hashes the temporary password, and creates the user', async () => {
      prisma.role.findUnique.mockResolvedValue(operatorRoleFixture);
      prisma.user.findFirst.mockResolvedValue(null);
      const createdUser = buildSelectedUserFixture(
        {
          id: 'user-new-id',
          name: 'New User',
          username: 'new.user',
          email: 'new.user@example.test',
          firstLogin: true,
        },
        operatorRoleFixture,
      );
      prisma.user.create.mockResolvedValue(createdUser);

      const result = await service.create(authenticatedAdminFixture, requestContext, createDto);

      expect(mockedArgon2Hash).toHaveBeenCalled();
      const createCall = prisma.user.create.mock.calls[0][0] as {
        data: { username: string; email: string; firstLogin: boolean; passwordHash: string };
      };
      expect(createCall.data.username).toBe('new.user');
      expect(createCall.data.email).toBe('new.user@example.test');
      expect(createCall.data.firstLogin).toBe(true);
      expect(createCall.data.passwordHash).toBe('$argon2id$v=19$m=65536,t=3,p=4$mocked-hash');

      expect(result.user).toEqual(createdUser);
      expect(typeof result.temporaryPassword).toBe('string');
      expect(result.temporaryPassword.length).toBeGreaterThan(0);
      expect(result.passwordMustBeChanged).toBe(true);
    });

    it('defaults firstLogin to true when requirePasswordChange is not provided', async () => {
      prisma.role.findUnique.mockResolvedValue(operatorRoleFixture);
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(buildSelectedUserFixture({ firstLogin: true }));

      await service.create(authenticatedAdminFixture, requestContext, {
        ...createDto,
        requirePasswordChange: undefined,
      });

      const createCall = prisma.user.create.mock.calls[0][0] as {
        data: { firstLogin: boolean };
      };
      expect(createCall.data.firstLogin).toBe(true);
    });

    it('sets firstLogin to false when requirePasswordChange is explicitly false', async () => {
      prisma.role.findUnique.mockResolvedValue(operatorRoleFixture);
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(buildSelectedUserFixture({ firstLogin: false }));

      await service.create(authenticatedAdminFixture, requestContext, {
        ...createDto,
        requirePasswordChange: false,
      });

      const createCall = prisma.user.create.mock.calls[0][0] as {
        data: { firstLogin: boolean };
      };
      expect(createCall.data.firstLogin).toBe(false);
    });

    it('records a CREATE audit log', async () => {
      prisma.role.findUnique.mockResolvedValue(operatorRoleFixture);
      prisma.user.findFirst.mockResolvedValue(null);
      const createdUser = buildSelectedUserFixture(
        { id: 'user-new-id', username: 'new.user', email: 'new.user@example.test', firstLogin: true },
        operatorRoleFixture,
      );
      prisma.user.create.mockResolvedValue(createdUser);

      await service.create(authenticatedAdminFixture, requestContext, createDto);

      expect(auditLogsService.create).toHaveBeenCalledWith({
        userId: authenticatedAdminFixture.id,
        action: 'CREATE',
        entity: 'USER',
        entityId: createdUser.id,
        newValue: {
          name: createdUser.name,
          username: createdUser.username,
          email: createdUser.email,
          active: createdUser.active,
          firstLogin: createdUser.firstLogin,
          role: createdUser.role.code,
        },
        sourceIp: requestContext.sourceIp,
        requestId: requestContext.requestId,
        description: `User ${createdUser.username} was created.`,
      });
    });
  });

  describe('findAll', () => {
    it('uses an empty where clause when the current user is an administrator', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await service.findAll(authenticatedAdminFixture);

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: {},
        select: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
    });

    it('excludes administrators from the where clause for non-administrator users', async () => {
      prisma.user.findMany.mockResolvedValue([]);

      await service.findAll(authenticatedOperatorFixture);

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { role: { code: { not: RoleCode.ADMIN } } },
        select: expect.any(Object),
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('findOne', () => {
    it('returns the user when found and manageable', async () => {
      const selectedUser = buildSelectedUserFixture({}, operatorRoleFixture);
      prisma.user.findUnique.mockResolvedValue(selectedUser);

      await expect(
        service.findOne(authenticatedAdminFixture, selectedUser.id),
      ).resolves.toEqual(selectedUser);
    });

    it('throws NotFoundException when the user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findOne(authenticatedAdminFixture, 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('propagates the ForbiddenException when the current user cannot manage the target', async () => {
      const selectedAdmin = buildSelectedUserFixture({ id: 'user-admin-id' }, adminRoleFixture);
      prisma.user.findUnique.mockResolvedValue(selectedAdmin);

      await expect(
        service.findOne(authenticatedViewerFixture, selectedAdmin.id),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update', () => {
    const dto: UpdateUserDto = { username: 'renamed.user', email: 'renamed.user@example.test' };

    it('throws NotFoundException when the target user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.update(authenticatedAdminFixture, requestContext, 'missing', dto),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the username or email belongs to another user', async () => {
      prisma.user.findUnique.mockResolvedValue(operatorUserFixture);
      prisma.user.findFirst.mockResolvedValue(viewerUserFixture);

      await expect(
        service.update(authenticatedAdminFixture, requestContext, operatorUserFixture.id, dto),
      ).rejects.toThrow(ConflictException);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('updates the user when there is no conflicting username or email', async () => {
      prisma.user.findUnique.mockResolvedValue(operatorUserFixture);
      prisma.user.findFirst.mockResolvedValue(null);
      const updatedUser = buildSelectedUserFixture(
        {
          id: operatorUserFixture.id,
          username: 'renamed.user',
          email: 'renamed.user@example.test',
        },
        operatorRoleFixture,
      );
      prisma.user.update.mockResolvedValue(updatedUser);

      const result = await service.update(
        authenticatedAdminFixture,
        requestContext,
        operatorUserFixture.id,
        dto,
      );

      expect(result).toEqual(updatedUser);
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          id: { not: operatorUserFixture.id },
          OR: [{ username: 'renamed.user' }, { email: 'renamed.user@example.test' }],
        },
      });
    });

    it('records an audit log with previous and new values', async () => {
      prisma.user.findUnique.mockResolvedValue(operatorUserFixture);
      prisma.user.findFirst.mockResolvedValue(null);
      const updatedUser = buildSelectedUserFixture(
        {
          id: operatorUserFixture.id,
          username: 'renamed.user',
          email: 'renamed.user@example.test',
        },
        operatorRoleFixture,
      );
      prisma.user.update.mockResolvedValue(updatedUser);

      await service.update(authenticatedAdminFixture, requestContext, operatorUserFixture.id, dto);

      expect(auditLogsService.create).toHaveBeenCalledWith({
        userId: authenticatedAdminFixture.id,
        action: 'UPDATE',
        entity: 'USER',
        entityId: updatedUser.id,
        previousValue: {
          name: operatorUserFixture.name,
          username: operatorUserFixture.username,
          email: operatorUserFixture.email,
        },
        newValue: {
          name: updatedUser.name,
          username: updatedUser.username,
          email: updatedUser.email,
        },
        sourceIp: requestContext.sourceIp,
        requestId: requestContext.requestId,
        description: `User ${updatedUser.username} was updated.`,
      });
    });

    it('checks for conflicts using only the username when email is not provided', async () => {
      prisma.user.findUnique.mockResolvedValue(operatorUserFixture);
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue(
        buildSelectedUserFixture({ id: operatorUserFixture.id }, operatorRoleFixture),
      );

      await service.update(authenticatedAdminFixture, requestContext, operatorUserFixture.id, {
        username: 'only-username',
      });

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: { not: operatorUserFixture.id }, OR: [{ username: 'only-username' }] },
      });
    });

    it('checks for conflicts using only the email when username is not provided', async () => {
      prisma.user.findUnique.mockResolvedValue(operatorUserFixture);
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.update.mockResolvedValue(
        buildSelectedUserFixture({ id: operatorUserFixture.id }, operatorRoleFixture),
      );

      await service.update(authenticatedAdminFixture, requestContext, operatorUserFixture.id, {
        email: 'only-email@example.test',
      });

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: {
          id: { not: operatorUserFixture.id },
          OR: [{ email: 'only-email@example.test' }],
        },
      });
    });

    it('skips the conflict check entirely when neither username nor email is provided', async () => {
      prisma.user.findUnique.mockResolvedValue(operatorUserFixture);
      prisma.user.update.mockResolvedValue(
        buildSelectedUserFixture({ id: operatorUserFixture.id }, operatorRoleFixture),
      );

      await service.update(authenticatedAdminFixture, requestContext, operatorUserFixture.id, {
        name: 'Only Name Changed',
      });

      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      const updateCall = prisma.user.update.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(updateCall.data).toEqual({ name: 'Only Name Changed' });
    });
  });

  describe('changeRole', () => {
    const roleDto: ChangeUserRoleDto = { roleId: adminRoleFixture.id };

    it('throws NotFoundException when the target user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.changeRole(authenticatedAdminFixture, requestContext, 'missing', roleDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the new role does not exist or is inactive', async () => {
      prisma.user.findUnique.mockResolvedValue(operatorUserFixture);
      prisma.role.findUnique.mockResolvedValue(null);

      await expect(
        service.changeRole(
          authenticatedAdminFixture,
          requestContext,
          operatorUserFixture.id,
          roleDto,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when an administrator tries to remove their own administrator role', async () => {
      prisma.user.findUnique.mockResolvedValue(adminUserFixture);
      prisma.role.findUnique.mockResolvedValue(operatorRoleFixture);

      await expect(
        service.changeRole(authenticatedAdminFixture, requestContext, adminUserFixture.id, {
          roleId: operatorRoleFixture.id,
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when demoting the last active administrator', async () => {
      prisma.user.findUnique.mockResolvedValue(adminUserFixture);
      prisma.role.findUnique.mockResolvedValue(operatorRoleFixture);
      prisma.user.count.mockResolvedValue(0);

      await expect(
        service.changeRole(authenticatedAdminFixture, requestContext, 'user-other-admin-id', {
          roleId: operatorRoleFixture.id,
        }),
      ).rejects.toThrow('The last active administrator cannot be deactivated or demoted.');

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('demotes an administrator when another active administrator exists', async () => {
      prisma.user.findUnique.mockResolvedValue(adminUserFixture);
      prisma.role.findUnique.mockResolvedValue(operatorRoleFixture);
      prisma.user.count.mockResolvedValue(1);
      const updatedUser = buildSelectedUserFixture(
        { id: 'user-other-admin-id' },
        operatorRoleFixture,
      );
      prisma.user.update.mockResolvedValue(updatedUser);

      const result = await service.changeRole(
        authenticatedAdminFixture,
        requestContext,
        'user-other-admin-id',
        { roleId: operatorRoleFixture.id },
      );

      expect(result).toEqual(updatedUser);
    });

    it('changes the role of a non-administrator target and records an audit log', async () => {
      prisma.user.findUnique.mockResolvedValue(viewerUserFixture);
      prisma.role.findUnique.mockResolvedValue(operatorRoleFixture);
      const updatedUser = buildSelectedUserFixture(
        { id: viewerUserFixture.id },
        operatorRoleFixture,
      );
      prisma.user.update.mockResolvedValue(updatedUser);

      const result = await service.changeRole(
        authenticatedAdminFixture,
        requestContext,
        viewerUserFixture.id,
        { roleId: operatorRoleFixture.id },
      );

      expect(result).toEqual(updatedUser);
      expect(prisma.user.count).not.toHaveBeenCalled();
      expect(auditLogsService.create).toHaveBeenCalledWith({
        userId: authenticatedAdminFixture.id,
        action: 'CHANGE_ROLE',
        entity: 'USER',
        entityId: updatedUser.id,
        previousValue: { role: viewerUserFixture.role.code },
        newValue: { role: updatedUser.role.code },
        sourceIp: requestContext.sourceIp,
        requestId: requestContext.requestId,
        description: `User ${updatedUser.username} role was changed.`,
      });
    });
  });

  describe('changeStatus', () => {
    const activateDto: ChangeUserStatusDto = { active: true };
    const deactivateDto: ChangeUserStatusDto = { active: false };

    it('throws NotFoundException when the target user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.changeStatus(authenticatedAdminFixture, requestContext, 'missing', deactivateDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when a user tries to deactivate itself', async () => {
      prisma.user.findUnique.mockResolvedValue(adminUserFixture);

      await expect(
        service.changeStatus(
          authenticatedAdminFixture,
          requestContext,
          adminUserFixture.id,
          deactivateDto,
        ),
      ).rejects.toThrow('You cannot deactivate your own user.');

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when deactivating the last active administrator', async () => {
      prisma.user.findUnique.mockResolvedValue(adminUserFixture);
      prisma.user.count.mockResolvedValue(0);

      await expect(
        service.changeStatus(
          authenticatedAdminFixture,
          requestContext,
          'user-other-admin-id',
          deactivateDto,
        ),
      ).rejects.toThrow('The last active administrator cannot be deactivated or demoted.');

      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('deactivates a non-self administrator when another active administrator exists', async () => {
      prisma.user.findUnique.mockResolvedValue(adminUserFixture);
      prisma.user.count.mockResolvedValue(1);
      mockTransactionCallback(prisma);
      const updatedUser = buildSelectedUserFixture(
        { id: 'user-other-admin-id', active: false },
        adminRoleFixture,
      );
      prisma.user.update.mockResolvedValue(updatedUser);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.changeStatus(
        authenticatedAdminFixture,
        requestContext,
        'user-other-admin-id',
        deactivateDto,
      );

      expect(result).toEqual(updatedUser);
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-other-admin-id', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('activates a user without revoking refresh tokens', async () => {
      prisma.user.findUnique.mockResolvedValue(viewerUserFixture);
      mockTransactionCallback(prisma);
      const updatedUser = buildSelectedUserFixture(
        { id: viewerUserFixture.id, active: true },
        operatorRoleFixture,
      );
      prisma.user.update.mockResolvedValue(updatedUser);

      const result = await service.changeStatus(
        authenticatedAdminFixture,
        requestContext,
        viewerUserFixture.id,
        activateDto,
      );

      expect(result).toEqual(updatedUser);
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
    });

    it('records an ACTIVATE/DEACTIVATE audit log', async () => {
      prisma.user.findUnique.mockResolvedValue(viewerUserFixture);
      mockTransactionCallback(prisma);
      const updatedUser = buildSelectedUserFixture(
        { id: viewerUserFixture.id, active: false },
        operatorRoleFixture,
      );
      prisma.user.update.mockResolvedValue(updatedUser);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await service.changeStatus(
        authenticatedAdminFixture,
        requestContext,
        viewerUserFixture.id,
        deactivateDto,
      );

      expect(auditLogsService.create).toHaveBeenCalledWith({
        userId: authenticatedAdminFixture.id,
        action: 'DEACTIVATE',
        entity: 'USER',
        entityId: updatedUser.id,
        previousValue: { active: viewerUserFixture.active },
        newValue: { active: updatedUser.active },
        sourceIp: requestContext.sourceIp,
        requestId: requestContext.requestId,
        description: `User ${updatedUser.username} was deactivated.`,
      });
    });
  });

  describe('resetPassword', () => {
    it('throws NotFoundException when the target user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPassword(authenticatedAdminFixture, requestContext, 'missing'),
      ).rejects.toThrow(NotFoundException);
    });

    it('generates a new temporary password, revokes refresh tokens, and records an audit log', async () => {
      prisma.user.findUnique.mockResolvedValue(operatorUserFixture);
      mockTransactionArray(prisma, [operatorUserFixture, { count: 1 }]);

      const result = await service.resetPassword(
        authenticatedAdminFixture,
        requestContext,
        operatorUserFixture.id,
      );

      expect(mockedArgon2Hash).toHaveBeenCalled();
      expect(typeof result.temporaryPassword).toBe('string');
      expect(result.temporaryPassword.length).toBeGreaterThan(0);
      expect(result.passwordMustBeChanged).toBe(true);

      expect(auditLogsService.create).toHaveBeenCalledWith({
        userId: authenticatedAdminFixture.id,
        action: 'RESET_PASSWORD',
        entity: 'USER',
        entityId: operatorUserFixture.id,
        previousValue: { firstLogin: operatorUserFixture.firstLogin },
        newValue: { firstLogin: true },
        sourceIp: requestContext.sourceIp,
        requestId: requestContext.requestId,
        description: `Password for user ${operatorUserFixture.username} was reset.`,
      });
    });
  });

  describe('changePasswordRequirement', () => {
    it('throws NotFoundException when the target user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.changePasswordRequirement(authenticatedAdminFixture, requestContext, 'missing', true),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates the password change requirement and records an audit log', async () => {
      prisma.user.findUnique.mockResolvedValue(operatorUserFixture);
      const updatedUser = buildSelectedUserFixture(
        { id: operatorUserFixture.id, firstLogin: true },
        operatorRoleFixture,
      );
      prisma.user.update.mockResolvedValue(updatedUser);

      const result = await service.changePasswordRequirement(
        authenticatedAdminFixture,
        requestContext,
        operatorUserFixture.id,
        true,
      );

      expect(result).toEqual(updatedUser);
      expect(auditLogsService.create).toHaveBeenCalledWith({
        userId: authenticatedAdminFixture.id,
        action: 'CHANGE_PASSWORD_REQUIREMENT',
        entity: 'USER',
        entityId: updatedUser.id,
        previousValue: { firstLogin: operatorUserFixture.firstLogin },
        newValue: { firstLogin: updatedUser.firstLogin },
        sourceIp: requestContext.sourceIp,
        requestId: requestContext.requestId,
        description: `Password change requirement for user ${updatedUser.username} was updated.`,
      });
    });
  });

  describe('remove', () => {
    it('throws ForbiddenException with USER_CANNOT_DELETE_SELF when deleting your own user', async () => {
      let thrown: unknown;

      try {
        await service.remove(
          authenticatedAdminFixture,
          requestContext,
          authenticatedAdminFixture.id,
        );
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ForbiddenException);
      expect((thrown as ForbiddenException).getResponse()).toMatchObject({
        code: 'USER_CANNOT_DELETE_SELF',
      });
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the target user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.remove(authenticatedAdminFixture, requestContext, 'missing'),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('propagates the ForbiddenException raised by the management policy', async () => {
      prisma.user.findUnique.mockResolvedValue(adminUserFixture);

      await expect(
        service.remove(authenticatedOperatorFixture, requestContext, adminUserFixture.id),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.user.count).not.toHaveBeenCalled();
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException with LAST_ADMIN_CANNOT_BE_DELETED when deleting the last active administrator', async () => {
      prisma.user.findUnique.mockResolvedValue(adminUserFixture);
      prisma.user.count.mockResolvedValue(0);
      let thrown: unknown;

      try {
        await service.remove(authenticatedAdminFixture, requestContext, 'user-other-admin-id');
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ForbiddenException);
      expect((thrown as ForbiddenException).getResponse()).toMatchObject({
        code: 'LAST_ADMIN_CANNOT_BE_DELETED',
      });
      expect(prisma.user.delete).not.toHaveBeenCalled();
    });

    it('deletes an administrator when another active administrator exists', async () => {
      prisma.user.findUnique.mockResolvedValue(adminUserFixture);
      prisma.user.count.mockResolvedValue(1);

      await service.remove(authenticatedAdminFixture, requestContext, 'user-other-admin-id');

      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: 'user-other-admin-id' },
      });
    });

    it('deletes a non-administrator target directly, without checking for other administrators', async () => {
      prisma.user.findUnique.mockResolvedValue(operatorUserFixture);

      await service.remove(authenticatedAdminFixture, requestContext, operatorUserFixture.id);

      expect(prisma.user.count).not.toHaveBeenCalled();
      expect(prisma.user.delete).toHaveBeenCalledWith({
        where: { id: operatorUserFixture.id },
      });
    });

    it('records a DELETE audit log without newValue or passwordHash', async () => {
      prisma.user.findUnique.mockResolvedValue(operatorUserFixture);

      await service.remove(authenticatedAdminFixture, requestContext, operatorUserFixture.id);

      expect(auditLogsService.create).toHaveBeenCalledWith({
        userId: authenticatedAdminFixture.id,
        action: 'DELETE',
        entity: 'USER',
        entityId: operatorUserFixture.id,
        previousValue: {
          name: operatorUserFixture.name,
          username: operatorUserFixture.username,
          email: operatorUserFixture.email,
          role: operatorUserFixture.role.code,
          active: operatorUserFixture.active,
        },
        sourceIp: requestContext.sourceIp,
        requestId: requestContext.requestId,
        description: `User ${operatorUserFixture.username} was deleted.`,
      });

      const auditCall = auditLogsService.create.mock.calls[0][0] as {
        previousValue: Record<string, unknown>;
        newValue?: unknown;
      };
      expect(auditCall.previousValue).not.toHaveProperty('passwordHash');
      expect(auditCall.newValue).toBeUndefined();
    });
  });
});
