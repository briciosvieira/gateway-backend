import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import {
  AuditAction,
  AuditEntity,
  RoleCode,
} from '../../../generated/prisma/client';
import type { RequestContext } from '../../common/interfaces/request-context.interface';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import type { ChangeUserRoleDto } from './dto/change-user-role.dto';
import type { ChangeUserStatusDto } from './dto/change-user-status.dto';
import type { CreateUserDto } from './dto/create-user.dto';
import type { UpdateUserDto } from './dto/update-user.dto';
import {
  validateUserCreationPermission,
  validateUserManagementPermission,
} from './policies/user-creation.policy';
import { generateTemporaryPassword } from './utils/temporary-password/temporary-password';

const userSelect = {
  id: true,
  name: true,
  username: true,
  email: true,
  active: true,
  firstLogin: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  role: {
    select: {
      id: true,
      code: true,
      name: true,
      level: true,
    },
  },
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    dto: CreateUserDto,
  ) {
    const role = await this.prisma.role.findUnique({
      where: {
        id: dto.roleId,
      },
    });

    if (!role || !role.active) {
      throw new NotFoundException('Role was not found or is inactive.');
    }

    validateUserCreationPermission(currentUser.role, role.code);

    const normalizedUsername = dto.username.trim().toLowerCase();
    const normalizedEmail = dto.email.trim().toLowerCase();

    const existingUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          {
            username: normalizedUsername,
          },
          {
            email: normalizedEmail,
          },
        ],
      },
    });

    if (existingUser) {
      throw new ConflictException('Username or email is already registered.');
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await argon2.hash(temporaryPassword);

    const user = await this.prisma.user.create({
      data: {
        name: dto.name.trim(),
        username: normalizedUsername,
        email: normalizedEmail,
        passwordHash,
        roleId: role.id,
        active: true,
        firstLogin: dto.requirePasswordChange ?? true,
      },
      select: userSelect,
    });

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.CREATE,
      entity: AuditEntity.USER,
      entityId: user.id,
      newValue: {
        name: user.name,
        username: user.username,
        email: user.email,
        active: user.active,
        firstLogin: user.firstLogin,
        role: user.role.code,
      },
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `User ${user.username} was created.`,
    });

    return {
      user,
      temporaryPassword,
      passwordMustBeChanged: user.firstLogin,
    };
  }

  async findAll(currentUser: AuthenticatedUser) {
    const where =
      currentUser.role === RoleCode.ADMIN
        ? {}
        : {
            role: {
              code: {
                not: RoleCode.ADMIN,
              },
            },
          };

    return this.prisma.user.findMany({
      where,
      select: userSelect,
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(currentUser: AuthenticatedUser, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: userSelect,
    });

    if (!user) {
      throw new NotFoundException('User was not found.');
    }

    validateUserManagementPermission(currentUser.role, user.role.code);

    return user;
  }

  async update(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    userId: string,
    dto: UpdateUserDto,
  ) {
    const targetUser = await this.getUserWithRole(userId);

    validateUserManagementPermission(currentUser.role, targetUser.role.code);

    const normalizedUsername = dto.username?.trim().toLowerCase();

    const normalizedEmail = dto.email?.trim().toLowerCase();

    if (normalizedUsername || normalizedEmail) {
      const conflictingUser = await this.prisma.user.findFirst({
        where: {
          id: {
            not: userId,
          },
          OR: [
            ...(normalizedUsername ? [{ username: normalizedUsername }] : []),
            ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
          ],
        },
      });

      if (conflictingUser) {
        throw new ConflictException('Username or email is already registered.');
      }
    }

    const updatedUser = await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(normalizedUsername !== undefined
          ? { username: normalizedUsername }
          : {}),
        ...(normalizedEmail !== undefined ? { email: normalizedEmail } : {}),
      },
      select: userSelect,
    });

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.UPDATE,
      entity: AuditEntity.USER,
      entityId: updatedUser.id,
      previousValue: {
        name: targetUser.name,
        username: targetUser.username,
        email: targetUser.email,
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

    return updatedUser;
  }

  async changeRole(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    userId: string,
    dto: ChangeUserRoleDto,
  ) {
    const targetUser = await this.getUserWithRole(userId);

    validateUserManagementPermission(currentUser.role, targetUser.role.code);

    const newRole = await this.prisma.role.findUnique({
      where: {
        id: dto.roleId,
      },
    });

    if (!newRole || !newRole.active) {
      throw new NotFoundException(
        'The requested role was not found or is inactive.',
      );
    }

    validateUserCreationPermission(currentUser.role, newRole.code);

    if (
      currentUser.id === userId &&
      targetUser.role.code === RoleCode.ADMIN &&
      newRole.code !== RoleCode.ADMIN
    ) {
      throw new ForbiddenException(
        'You cannot remove your own administrator role.',
      );
    }

    if (
      targetUser.role.code === RoleCode.ADMIN &&
      newRole.code !== RoleCode.ADMIN
    ) {
      await this.ensureAnotherActiveAdministratorExists(userId);
    }

    const updatedUser = await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        roleId: newRole.id,
      },
      select: userSelect,
    });

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.CHANGE_ROLE,
      entity: AuditEntity.USER,
      entityId: updatedUser.id,
      previousValue: {
        role: targetUser.role.code,
      },
      newValue: {
        role: updatedUser.role.code,
      },
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `User ${updatedUser.username} role was changed.`,
    });

    return updatedUser;
  }

  async changeStatus(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    userId: string,
    dto: ChangeUserStatusDto,
  ) {
    const targetUser = await this.getUserWithRole(userId);

    validateUserManagementPermission(currentUser.role, targetUser.role.code);

    if (currentUser.id === userId && dto.active === false) {
      throw new ForbiddenException('You cannot deactivate your own user.');
    }

    if (targetUser.role.code === RoleCode.ADMIN && dto.active === false) {
      await this.ensureAnotherActiveAdministratorExists(userId);
    }

    const updatedUser = await this.prisma.$transaction(async (transaction) => {
      const user = await transaction.user.update({
        where: {
          id: userId,
        },
        data: {
          active: dto.active,
        },
        select: userSelect,
      });

      if (!dto.active) {
        await transaction.refreshToken.updateMany({
          where: {
            userId,
            revokedAt: null,
          },
          data: {
            revokedAt: new Date(),
          },
        });
      }

      return user;
    });

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: dto.active ? AuditAction.ACTIVATE : AuditAction.DEACTIVATE,
      entity: AuditEntity.USER,
      entityId: updatedUser.id,
      previousValue: {
        active: targetUser.active,
      },
      newValue: {
        active: updatedUser.active,
      },
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `User ${updatedUser.username} was ${
        updatedUser.active ? 'activated' : 'deactivated'
      }.`,
    });

    return updatedUser;
  }

  async resetPassword(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    userId: string,
  ) {
    const targetUser = await this.getUserWithRole(userId);

    validateUserManagementPermission(currentUser.role, targetUser.role.code);

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await argon2.hash(temporaryPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: {
          id: userId,
        },
        data: {
          passwordHash,
          firstLogin: true,
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      }),
    ]);

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.RESET_PASSWORD,
      entity: AuditEntity.USER,
      entityId: targetUser.id,
      previousValue: {
        firstLogin: targetUser.firstLogin,
      },
      newValue: {
        firstLogin: true,
      },
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `Password for user ${targetUser.username} was reset.`,
    });

    return {
      temporaryPassword,
      passwordMustBeChanged: true,
    };
  }

  async changePasswordRequirement(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    userId: string,
    requirePasswordChange: boolean,
  ) {
    const targetUser = await this.getUserWithRole(userId);

    validateUserManagementPermission(currentUser.role, targetUser.role.code);

    const updatedUser = await this.prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        firstLogin: requirePasswordChange,
      },
      select: userSelect,
    });

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.CHANGE_PASSWORD_REQUIREMENT,
      entity: AuditEntity.USER,
      entityId: updatedUser.id,
      previousValue: {
        firstLogin: targetUser.firstLogin,
      },
      newValue: {
        firstLogin: updatedUser.firstLogin,
      },
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description:
        `Password change requirement for user ` +
        `${updatedUser.username} was updated.`,
    });

    return updatedUser;
  }

  async remove(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    userId: string,
  ): Promise<void> {
    if (currentUser.id === userId) {
      throw new ForbiddenException({
        message: 'You cannot delete your own user.',
        code: 'USER_CANNOT_DELETE_SELF',
      });
    }

    const targetUser = await this.getUserWithRole(userId);

    validateUserManagementPermission(currentUser.role, targetUser.role.code);

    if (targetUser.role.code === RoleCode.ADMIN) {
      await this.ensureAnotherActiveAdministratorExists(
        userId,
        'deleted',
        'LAST_ADMIN_CANNOT_BE_DELETED',
      );
    }

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.DELETE,
      entity: AuditEntity.USER,
      entityId: targetUser.id,
      previousValue: {
        name: targetUser.name,
        username: targetUser.username,
        email: targetUser.email,
        role: targetUser.role.code,
        active: targetUser.active,
      },
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `User ${targetUser.username} was deleted.`,
    });

    // RefreshToken.user is onDelete: Cascade (tokens are removed automatically)
    // and AuditLog.user is onDelete: SetNull (this user's past audit trail is
    // preserved, with userId cleared) — both handled by the database itself.
    await this.prisma.user.delete({ where: { id: userId } });
  }

  private async getUserWithRole(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      include: {
        role: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User was not found.');
    }

    return user;
  }

  private async ensureAnotherActiveAdministratorExists(
    excludedUserId: string,
    action: string = 'deactivated or demoted',
    code?: string,
  ): Promise<void> {
    const activeAdministrators = await this.prisma.user.count({
      where: {
        id: {
          not: excludedUserId,
        },
        active: true,
        role: {
          code: RoleCode.ADMIN,
          active: true,
        },
      },
    });

    if (activeAdministrators === 0) {
      const message = `The last active administrator cannot be ${action}.`;

      // Existing callers (changeRole/changeStatus) pass no code and must keep
      // getting the exact same plain-string exception shape as before — only
      // the new remove() call site opts into the richer {message, code} form.
      throw new ForbiddenException(code ? { message, code } : message);
    }
  }
}
