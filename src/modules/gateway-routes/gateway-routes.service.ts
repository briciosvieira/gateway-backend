import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, AuditEntity, Prisma } from '../../../generated/prisma/client';
import type {
  ClientResourceSummarySortDirection,
  ClientResourceSummaryStatus,
} from '../../common/dto/find-client-resource-summary-query.base';
import type { RequestContext } from '../../common/interfaces/request-context.interface';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import type { ChangeGatewayRouteStatusDto } from './dto/change-gateway-route-status.dto';
import type { CreateGatewayRouteDto } from './dto/create-gateway-route.dto';
import type {
  FindGatewayRouteClientsSummaryQueryDto,
  GatewayRouteClientSummarySortField,
} from './dto/find-gateway-route-clients-summary-query.dto';
import type {
  FindGatewayRoutesQueryDto,
  GatewayRouteSortDirection,
  GatewayRouteSortField,
} from './dto/find-gateway-routes-query.dto';
import type { UpdateGatewayRouteDto } from './dto/update-gateway-route.dto';
import { buildGatewayPublicPath, normalizeGatewayRouteSlug } from './utils/gateway-route-slug.util';
import { normalizeDestinationUrl } from './utils/destination-url.util';

const gatewayRouteSelect = {
  id: true,
  clientId: true,
  name: true,
  slug: true,
  description: true,
  destinationUrl: true,
  method: true,
  timeoutMs: true,
  retryCount: true,
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

interface GatewayRouteClientSummaryRow {
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
export class GatewayRoutesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    dto: CreateGatewayRouteDto,
  ) {
    const client = await this.getClientOrThrow(dto.clientId);

    if (!client.active) {
      throw new BadRequestException('Client is inactive.');
    }

    const normalizedSlug = normalizeGatewayRouteSlug(dto.slug);
    const normalizedDestinationUrl = normalizeDestinationUrl(dto.destinationUrl);

    const existingRoute = await this.prisma.gatewayRoute.findUnique({
      where: {
        slug: normalizedSlug,
      },
    });

    if (existingRoute) {
      throw new ConflictException('A gateway route with this slug already exists.');
    }

    const route = await this.prisma.gatewayRoute.create({
      data: {
        clientId: client.id,
        name: dto.name.trim(),
        slug: normalizedSlug,
        description: this.normalizeOptionalText(dto.description),
        destinationUrl: normalizedDestinationUrl,
        method: dto.method,
        timeoutMs: dto.timeoutMs ?? 30000,
        retryCount: dto.retryCount ?? 0,
        active: true,
      },
      select: gatewayRouteSelect,
    });

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.CREATE,
      entity: AuditEntity.GATEWAY_ROUTE,
      entityId: route.id,
      newValue: {
        clientId: route.clientId,
        name: route.name,
        slug: route.slug,
        method: route.method,
        destinationUrl: route.destinationUrl,
        timeoutMs: route.timeoutMs,
        retryCount: route.retryCount,
        active: route.active,
      },
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `Gateway route ${route.slug} was created for client ${client.code}.`,
    });

    return this.withPublicPath(route);
  }

  async findAll(query: FindGatewayRoutesQueryDto) {
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;

    const where = this.buildWhere(query);
    const orderBy = this.buildOrderBy(query.sortBy, query.sortOrder);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.gatewayRoute.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: gatewayRouteSelect,
      }),
      this.prisma.gatewayRoute.count({
        where,
      }),
    ]);

    return {
      items: items.map((item) => this.withPublicPath(item)),
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
      filters: {
        search: query.search ?? null,
        clientId: query.clientId ?? null,
        method: query.method ?? null,
        active: query.active ?? null,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
      },
    };
  }

  async findClientsSummary(query: FindGatewayRouteClientsSummaryQueryDto) {
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
          COUNT(gr.id)::int AS total,
          COUNT(*) FILTER (
            WHERE gr.active = true
          )::int AS active,
          COUNT(*) FILTER (
            WHERE gr.active = false
          )::int AS inactive
        FROM gateway_routes gr
        INNER JOIN clients c ON c.id = gr.client_id
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
      this.prisma.$queryRaw<GatewayRouteClientSummaryRow[]>(dataQuery),
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

  async findOne(gatewayRouteId: string) {
    const route = await this.getGatewayRouteOrThrow(gatewayRouteId);

    return this.withPublicPath(route);
  }

  async update(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    gatewayRouteId: string,
    dto: UpdateGatewayRouteDto,
  ) {
    const currentRoute = await this.getGatewayRouteOrThrow(gatewayRouteId);

    const normalizedSlug =
      dto.slug !== undefined ? normalizeGatewayRouteSlug(dto.slug) : undefined;

    if (normalizedSlug !== undefined && normalizedSlug !== currentRoute.slug) {
      const conflictingRoute = await this.prisma.gatewayRoute.findUnique({
        where: {
          slug: normalizedSlug,
        },
      });

      if (conflictingRoute) {
        throw new ConflictException('A gateway route with this slug already exists.');
      }
    }

    const normalizedDestinationUrl =
      dto.destinationUrl !== undefined
        ? normalizeDestinationUrl(dto.destinationUrl)
        : undefined;

    const updatedRoute = await this.prisma.gatewayRoute.update({
      where: {
        id: gatewayRouteId,
      },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(normalizedSlug !== undefined ? { slug: normalizedSlug } : {}),
        ...(normalizedDestinationUrl !== undefined
          ? { destinationUrl: normalizedDestinationUrl }
          : {}),
        ...(dto.method !== undefined ? { method: dto.method } : {}),
        ...(dto.description !== undefined
          ? { description: this.normalizeOptionalText(dto.description) }
          : {}),
        ...(dto.timeoutMs !== undefined ? { timeoutMs: dto.timeoutMs } : {}),
        ...(dto.retryCount !== undefined ? { retryCount: dto.retryCount } : {}),
      },
      select: gatewayRouteSelect,
    });

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.UPDATE,
      entity: AuditEntity.GATEWAY_ROUTE,
      entityId: updatedRoute.id,
      previousValue: {
        name: currentRoute.name,
        slug: currentRoute.slug,
        method: currentRoute.method,
        destinationUrl: currentRoute.destinationUrl,
        description: currentRoute.description,
        timeoutMs: currentRoute.timeoutMs,
        retryCount: currentRoute.retryCount,
      },
      newValue: {
        name: updatedRoute.name,
        slug: updatedRoute.slug,
        method: updatedRoute.method,
        destinationUrl: updatedRoute.destinationUrl,
        description: updatedRoute.description,
        timeoutMs: updatedRoute.timeoutMs,
        retryCount: updatedRoute.retryCount,
      },
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `Gateway route ${updatedRoute.slug} was updated.`,
    });

    return this.withPublicPath(updatedRoute);
  }

  async changeStatus(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    gatewayRouteId: string,
    dto: ChangeGatewayRouteStatusDto,
  ) {
    const currentRoute = await this.getGatewayRouteOrThrow(gatewayRouteId);

    if (currentRoute.active === dto.active) {
      return this.withPublicPath(currentRoute);
    }

    if (dto.active && !currentRoute.client.active) {
      throw new BadRequestException('Client is inactive.');
    }

    const updatedRoute = await this.prisma.gatewayRoute.update({
      where: {
        id: gatewayRouteId,
      },
      data: {
        active: dto.active,
      },
      select: gatewayRouteSelect,
    });

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: dto.active ? AuditAction.ACTIVATE : AuditAction.DEACTIVATE,
      entity: AuditEntity.GATEWAY_ROUTE,
      entityId: updatedRoute.id,
      previousValue: {
        active: currentRoute.active,
      },
      newValue: {
        active: updatedRoute.active,
      },
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `Gateway route ${updatedRoute.slug} was ${
        updatedRoute.active ? 'activated' : 'deactivated'
      }.`,
    });

    return this.withPublicPath(updatedRoute);
  }

  async remove(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    gatewayRouteId: string,
  ): Promise<void> {
    const route = await this.getGatewayRouteOrThrow(gatewayRouteId);

    const routeHeaderCount = await this.prisma.routeHeader.count({
      where: { gatewayRouteId },
    });

    if (routeHeaderCount > 0) {
      throw new ConflictException({
        message:
          'Gateway route cannot be deleted while it still has Route Headers. Remove those first.',
        code: 'GATEWAY_ROUTE_HAS_DEPENDENCIES',
      });
    }

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.DELETE,
      entity: AuditEntity.GATEWAY_ROUTE,
      entityId: route.id,
      previousValue: {
        clientId: route.clientId,
        name: route.name,
        slug: route.slug,
        method: route.method,
        active: route.active,
      },
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `Gateway route ${route.slug} was deleted.`,
    });

    // RequestLog.gatewayRoute is onDelete: SetNull — historical logs survive
    // with gatewayRouteId cleared, so no dependency check is needed there.
    await this.prisma.gatewayRoute.delete({ where: { id: gatewayRouteId } });
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

  private async getGatewayRouteOrThrow(gatewayRouteId: string) {
    const route = await this.prisma.gatewayRoute.findUnique({
      where: {
        id: gatewayRouteId,
      },
      select: gatewayRouteSelect,
    });

    if (!route) {
      throw new NotFoundException('Gateway route was not found.');
    }

    return route;
  }

  private buildWhere(query: FindGatewayRoutesQueryDto): Prisma.GatewayRouteWhereInput {
    const search = query.search?.trim();

    return {
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.method ? { method: query.method } : {}),
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { slug: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
              { client: { name: { contains: search, mode: 'insensitive' } } },
              { client: { code: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
  }

  private buildOrderBy(
    sortBy: GatewayRouteSortField,
    sortOrder: GatewayRouteSortDirection,
  ): Prisma.GatewayRouteOrderByWithRelationInput {
    const allowedFields: Record<
      GatewayRouteSortField,
      Prisma.GatewayRouteOrderByWithRelationInput
    > = {
      name: { name: sortOrder },
      slug: { slug: sortOrder },
      createdAt: { createdAt: sortOrder },
      updatedAt: { updatedAt: sortOrder },
      timeoutMs: { timeoutMs: sortOrder },
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
    sortBy: GatewayRouteClientSummarySortField,
    sortOrder: ClientResourceSummarySortDirection,
  ): Prisma.Sql {
    const orderByMap: Record<
      GatewayRouteClientSummarySortField,
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

  private withPublicPath<T extends { slug: string }>(
    route: T,
  ): T & { publicPath: string } {
    return {
      ...route,
      publicPath: buildGatewayPublicPath(route.slug),
    };
  }
}
