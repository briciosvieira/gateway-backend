import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import type { FindAuditLogsQueryDto } from './dto/find-audit-logs-query.dto';
import type { CreateAuditLogInput } from './interfaces/create-audit-log.interface';

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateAuditLogInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId: input.userId ?? null,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        previousValue: input.previousValue,
        newValue: input.newValue,
        sourceIp: input.sourceIp ?? null,
        requestId: input.requestId ?? null,
        description: input.description ?? null,
      },
    });
  }

  async findAll(query: FindAuditLogsQueryDto) {
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;

    const where: Prisma.AuditLogWhereInput = {
      ...(query.action
        ? {
            action: query.action,
          }
        : {}),
      ...(query.entity
        ? {
            entity: query.entity,
          }
        : {}),
      ...(query.userId
        ? {
            userId: query.userId,
          }
        : {}),
      ...(query.entityId
        ? {
            entityId: query.entityId,
          }
        : {}),
      ...(query.requestId
        ? {
            requestId: query.requestId,
          }
        : {}),
      ...(query.startDate || query.endDate
        ? {
            createdAt: {
              ...(query.startDate
                ? {
                    gte: new Date(query.startDate),
                  }
                : {}),
              ...(query.endDate
                ? {
                    lte: new Date(query.endDate),
                  }
                : {}),
            },
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
        select: {
          id: true,
          action: true,
          entity: true,
          entityId: true,
          previousValue: true,
          newValue: true,
          sourceIp: true,
          requestId: true,
          description: true,
          createdAt: true,
          user: {
            select: {
              id: true,
              name: true,
              username: true,
              role: {
                select: {
                  code: true,
                  name: true,
                },
              },
            },
          },
        },
      }),

      this.prisma.auditLog.count({
        where,
      }),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    return this.prisma.auditLog.findUnique({
      where: {
        id,
      },
      select: {
        id: true,
        action: true,
        entity: true,
        entityId: true,
        previousValue: true,
        newValue: true,
        sourceIp: true,
        requestId: true,
        description: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            name: true,
            username: true,
            email: true,
            role: {
              select: {
                code: true,
                name: true,
              },
            },
          },
        },
      },
    });
  }
}
