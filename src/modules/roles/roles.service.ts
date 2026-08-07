import { Injectable } from '@nestjs/common';
import { RoleCode } from '../../../generated/prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  findAvailable(currentUser: AuthenticatedUser) {
    const availableCodes =
      currentUser.role === RoleCode.ADMIN
        ? [RoleCode.ADMIN, RoleCode.OPERATOR, RoleCode.VIEWER, RoleCode.AUDITOR]
        : [RoleCode.OPERATOR, RoleCode.VIEWER, RoleCode.AUDITOR];

    return this.prisma.role.findMany({
      where: {
        active: true,
        code: {
          in: availableCodes,
        },
      },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        level: true,
      },
      orderBy: {
        level: 'desc',
      },
    });
  }
}
