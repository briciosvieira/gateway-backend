import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AllowedIpType, AuditAction, AuditEntity, Prisma } from '../../../generated/prisma/client';
import type {
  ClientResourceSummarySortDirection,
  ClientResourceSummaryStatus,
} from '../../common/dto/find-client-resource-summary-query.base';
import type { RequestContext } from '../../common/interfaces/request-context.interface';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AllowedHostnameResolverService } from './allowed-hostname-resolver.service';
import type { ChangeAllowedIpStatusDto } from './dto/change-allowed-ip-status.dto';
import type { CreateAllowedIpDto } from './dto/create-allowed-ip.dto';
import type {
  AllowedIpClientSummarySortField,
  FindAllowedIpClientsSummaryQueryDto,
} from './dto/find-allowed-ip-clients-summary-query.dto';
import type {
  AllowedIpSortDirection,
  AllowedIpSortField,
  FindAllowedIpsQueryDto,
} from './dto/find-allowed-ips-query.dto';
import type { UpdateAllowedIpDto } from './dto/update-allowed-ip.dto';
import { parseAllowedIpAddress } from './utils/ip-address.util';

const allowedIpSelect = {
  id: true,
  clientId: true,
  address: true,
  type: true,
  description: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  client: {
    select: {
      id: true,
      name: true,
      code: true,
      active: true,
    },
  },
} as const;

const clientSelect = {
  id: true,
  name: true,
  code: true,
  active: true,
} as const;

interface AllowedIpClientSummaryRow {
  clientId: string;
  clientName: string;
  clientCode: string;
  clientActive: boolean;
  total: number;
  active: number;
  inactive: number;
}

interface CountRow {
  total: number;
}

@Injectable()
export class AllowedIpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly allowedHostnameResolverService: AllowedHostnameResolverService,
  ) {}

  async create(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    dto: CreateAllowedIpDto,
  ) {
    const client = await this.getClientOrThrow(dto.clientId);

    if (!client.active) {
      throw new BadRequestException('Client is inactive.');
    }

    const { normalizedAddress, type } = parseAllowedIpAddress(dto.address);

    const existingAllowedIp = await this.prisma.allowedIp.findUnique({
      where: {
        clientId_address: {
          clientId: client.id,
          address: normalizedAddress,
        },
      },
    });

    if (existingAllowedIp) {
      throw new ConflictException(
        'This IP address or CIDR network is already allowed for this client.',
      );
    }

    const allowedIp = await this.prisma.allowedIp.create({
      data: {
        clientId: client.id,
        address: normalizedAddress,
        type,
        description: this.normalizeOptionalText(dto.description),
        active: true,
      },
      select: allowedIpSelect,
    });

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.CREATE,
      entity: AuditEntity.ALLOWED_IP,
      entityId: allowedIp.id,
      newValue: {
        clientId: allowedIp.clientId,
        address: allowedIp.address,
        type: allowedIp.type,
        description: allowedIp.description,
        active: allowedIp.active,
      },
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `Allowed IP ${allowedIp.address} was created for client ${client.code}.`,
    });

    return allowedIp;
  }

  async findAll(query: FindAllowedIpsQueryDto) {
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;

    const where = this.buildWhere(query);
    const orderBy = this.buildOrderBy(query.sortBy, query.sortOrder);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.allowedIp.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: allowedIpSelect,
      }),
      this.prisma.allowedIp.count({
        where,
      }),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
      filters: {
        search: query.search ?? null,
        clientId: query.clientId ?? null,
        type: query.type ?? null,
        active: query.active ?? null,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
      },
    };
  }

  async findClientsSummary(query: FindAllowedIpClientsSummaryQueryDto) {
    const page = query.page;
    const limit = query.limit;
    const offset = (page - 1) * limit;
    const trimmedSearch = query.search?.trim();
    const searchPattern = trimmedSearch ? `%${trimmedSearch}%` : null;
    const status = query.status ?? null;
    const orderBy = this.buildClientSummaryOrderBy(query.sortBy, query.sortOrder);
    const searchFilter = searchPattern
      ? Prisma.sql`WHERE c.name ILIKE ${searchPattern} OR c.code ILIKE ${searchPattern}`
      : Prisma.empty;

    const groupedQuery = Prisma.sql`
      WITH grouped AS (
        SELECT
          c.id AS "clientId",
          c.name AS "clientName",
          c.code AS "clientCode",
          c.active AS "clientActive",
          COUNT(ai.id)::int AS total,
          COUNT(*) FILTER (
            WHERE ai.active = true
          )::int AS active,
          COUNT(*) FILTER (
            WHERE ai.active = false
          )::int AS inactive
        FROM allowed_ips ai
        INNER JOIN clients c ON c.id = ai.client_id
        ${searchFilter}
        GROUP BY c.id, c.name, c.code, c.active
      )
    `;

    const statusFilter = this.buildClientSummaryStatusFilter(status);

    const dataQuery = Prisma.sql`
      ${groupedQuery}
      SELECT
        "clientId",
        "clientName",
        "clientCode",
        "clientActive",
        total,
        active,
        inactive
      FROM grouped
      WHERE total > 0
        AND ${statusFilter}
      ORDER BY ${orderBy}
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const countQuery = Prisma.sql`
      ${groupedQuery}
      SELECT COUNT(*)::int AS total
      FROM grouped
      WHERE total > 0
        AND ${statusFilter}
    `;

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<AllowedIpClientSummaryRow[]>(dataQuery),
      this.prisma.$queryRaw<CountRow[]>(countQuery),
    ]);

    const total = countRows[0]?.total ?? 0;

    return {
      items: rows.map((row) => ({
        client: {
          id: row.clientId,
          name: row.clientName,
          code: row.clientCode,
          active: row.clientActive,
        },
        total: row.total,
        active: row.active,
        inactive: row.inactive,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
      filters: {
        search: trimmedSearch ?? null,
        status,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
      },
    };
  }

  async findOne(allowedIpId: string) {
    return this.getAllowedIpOrThrow(allowedIpId);
  }

  async update(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    allowedIpId: string,
    dto: UpdateAllowedIpDto,
  ) {
    const currentAllowedIp = await this.getAllowedIpOrThrow(allowedIpId);

    let normalizedAddress: string | undefined;
    let type: (typeof currentAllowedIp)['type'] | undefined;

    if (dto.address !== undefined) {
      const parsed = parseAllowedIpAddress(dto.address);
      normalizedAddress = parsed.normalizedAddress;
      type = parsed.type;

      if (normalizedAddress !== currentAllowedIp.address) {
        const conflictingAllowedIp = await this.prisma.allowedIp.findUnique({
          where: {
            clientId_address: {
              clientId: currentAllowedIp.clientId,
              address: normalizedAddress,
            },
          },
        });

        if (conflictingAllowedIp) {
          throw new ConflictException(
            'This IP address or CIDR network is already allowed for this client.',
          );
        }
      }
    }

    const updatedAllowedIp = await this.prisma.allowedIp.update({
      where: {
        id: allowedIpId,
      },
      data: {
        ...(normalizedAddress !== undefined ? { address: normalizedAddress, type } : {}),
        ...(dto.description !== undefined
          ? { description: this.normalizeOptionalText(dto.description) }
          : {}),
      },
      select: allowedIpSelect,
    });

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.UPDATE,
      entity: AuditEntity.ALLOWED_IP,
      entityId: updatedAllowedIp.id,
      previousValue: {
        address: currentAllowedIp.address,
        type: currentAllowedIp.type,
        description: currentAllowedIp.description,
      },
      newValue: {
        address: updatedAllowedIp.address,
        type: updatedAllowedIp.type,
        description: updatedAllowedIp.description,
      },
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `Allowed IP ${updatedAllowedIp.address} was updated.`,
    });

    if (
      currentAllowedIp.type === AllowedIpType.HOSTNAME &&
      normalizedAddress !== undefined &&
      normalizedAddress !== currentAllowedIp.address
    ) {
      this.allowedHostnameResolverService.invalidate(currentAllowedIp.address);
    }

    return updatedAllowedIp;
  }

  async changeStatus(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    allowedIpId: string,
    dto: ChangeAllowedIpStatusDto,
  ) {
    const currentAllowedIp = await this.getAllowedIpOrThrow(allowedIpId);

    if (currentAllowedIp.active === dto.active) {
      return currentAllowedIp;
    }

    if (dto.active && !currentAllowedIp.client.active) {
      throw new BadRequestException('Client is inactive.');
    }

    const updatedAllowedIp = await this.prisma.allowedIp.update({
      where: {
        id: allowedIpId,
      },
      data: {
        active: dto.active,
      },
      select: allowedIpSelect,
    });

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: dto.active ? AuditAction.ACTIVATE : AuditAction.DEACTIVATE,
      entity: AuditEntity.ALLOWED_IP,
      entityId: updatedAllowedIp.id,
      previousValue: {
        active: currentAllowedIp.active,
      },
      newValue: {
        active: updatedAllowedIp.active,
      },
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `Allowed IP ${updatedAllowedIp.address} was ${
        updatedAllowedIp.active ? 'activated' : 'deactivated'
      }.`,
    });

    if (!updatedAllowedIp.active && updatedAllowedIp.type === AllowedIpType.HOSTNAME) {
      this.allowedHostnameResolverService.invalidate(updatedAllowedIp.address);
    }

    return updatedAllowedIp;
  }

  async remove(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    allowedIpId: string,
  ): Promise<void> {
    const allowedIp = await this.getAllowedIpOrThrow(allowedIpId);

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.DELETE,
      entity: AuditEntity.ALLOWED_IP,
      entityId: allowedIp.id,
      previousValue: {
        clientId: allowedIp.clientId,
        address: allowedIp.address,
        type: allowedIp.type,
        active: allowedIp.active,
      },
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `Allowed IP ${allowedIp.address} was deleted.`,
    });

    await this.prisma.allowedIp.delete({ where: { id: allowedIpId } });

    if (allowedIp.type === AllowedIpType.HOSTNAME) {
      this.allowedHostnameResolverService.invalidate(allowedIp.address);
    }
  }

  private async getClientOrThrow(clientId: string) {
    const client = await this.prisma.client.findUnique({
      where: {
        id: clientId,
      },
      select: clientSelect,
    });

    if (!client) {
      throw new NotFoundException('Client was not found.');
    }

    return client;
  }

  private async getAllowedIpOrThrow(allowedIpId: string) {
    const allowedIp = await this.prisma.allowedIp.findUnique({
      where: {
        id: allowedIpId,
      },
      select: allowedIpSelect,
    });

    if (!allowedIp) {
      throw new NotFoundException('Allowed IP was not found.');
    }

    return allowedIp;
  }

  private buildWhere(query: FindAllowedIpsQueryDto): Prisma.AllowedIpWhereInput {
    const search = query.search?.trim();

    return {
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(search
        ? {
            OR: [
              { address: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
              { client: { name: { contains: search, mode: 'insensitive' } } },
              { client: { code: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
  }

  private buildOrderBy(
    sortBy: AllowedIpSortField,
    sortOrder: AllowedIpSortDirection,
  ): Prisma.AllowedIpOrderByWithRelationInput {
    const allowedFields: Record<
      AllowedIpSortField,
      Prisma.AllowedIpOrderByWithRelationInput
    > = {
      address: { address: sortOrder },
      createdAt: { createdAt: sortOrder },
      updatedAt: { updatedAt: sortOrder },
    };

    return allowedFields[sortBy];
  }

  private buildClientSummaryStatusFilter(
    status: ClientResourceSummaryStatus | null,
  ): Prisma.Sql {
    if (status === 'active') {
      return Prisma.sql`active > 0`;
    }

    if (status === 'inactive') {
      return Prisma.sql`active = 0 AND total > 0`;
    }

    return Prisma.sql`TRUE`;
  }

  private buildClientSummaryOrderBy(
    sortBy: AllowedIpClientSummarySortField,
    sortOrder: ClientResourceSummarySortDirection,
  ): Prisma.Sql {
    const orderByMap: Record<
      AllowedIpClientSummarySortField,
      Record<ClientResourceSummarySortDirection, Prisma.Sql>
    > = {
      clientName: {
        asc: Prisma.raw(`LOWER("clientName") ASC, "clientId" ASC`),
        desc: Prisma.raw(`LOWER("clientName") DESC, "clientId" ASC`),
      },
      total: {
        asc: Prisma.raw(`total ASC, "clientId" ASC`),
        desc: Prisma.raw(`total DESC, "clientId" ASC`),
      },
      active: {
        asc: Prisma.raw(`active ASC, "clientId" ASC`),
        desc: Prisma.raw(`active DESC, "clientId" ASC`),
      },
      inactive: {
        asc: Prisma.raw(`inactive ASC, "clientId" ASC`),
        desc: Prisma.raw(`inactive DESC, "clientId" ASC`),
      },
    };

    return orderByMap[sortBy][sortOrder];
  }

  private normalizeOptionalText(value: string | undefined): string | null {
    if (value === undefined) {
      return null;
    }

    const normalizedValue = value.trim();

    return normalizedValue.length > 0 ? normalizedValue : null;
  }
}
