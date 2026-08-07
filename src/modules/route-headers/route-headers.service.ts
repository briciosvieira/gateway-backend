import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, AuditEntity } from '../../../generated/prisma/client';
import type { Prisma } from '../../../generated/prisma/client';
import type { RequestContext } from '../../common/interfaces/request-context.interface';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import type { ChangeRouteHeaderStatusDto } from './dto/change-route-header-status.dto';
import type { CreateRouteHeaderDto } from './dto/create-route-header.dto';
import type {
  FindRouteHeadersQueryDto,
  RouteHeaderSortDirection,
  RouteHeaderSortField,
} from './dto/find-route-headers-query.dto';
import type { UpdateRouteHeaderDto } from './dto/update-route-header.dto';
import {
  decryptHeaderValue,
  encryptHeaderValue,
  parseHeaderEncryptionKey,
} from './utils/route-header-encryption.util';
import { normalizeRouteHeaderName } from './utils/route-header-name.util';

const routeHeaderSelect = {
  id: true,
  gatewayRouteId: true,
  name: true,
  valueEncrypted: true,
  sensitive: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

const gatewayRouteSelect = {
  id: true,
  slug: true,
  active: true,
} as const;

type RouteHeaderRecord = {
  id: string;
  gatewayRouteId: string;
  name: string;
  valueEncrypted: string;
  sensitive: boolean;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const MASKED_VALUE = '********';

@Injectable()
export class RouteHeadersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    dto: CreateRouteHeaderDto,
  ) {
    const route = await this.getGatewayRouteOrThrow(dto.gatewayRouteId);

    if (!route.active) {
      throw new BadRequestException('Gateway route is inactive.');
    }

    const normalizedName = normalizeRouteHeaderName(dto.name);

    const existingHeader = await this.prisma.routeHeader.findUnique({
      where: {
        gatewayRouteId_name: {
          gatewayRouteId: route.id,
          name: normalizedName,
        },
      },
    });

    if (existingHeader) {
      throw new ConflictException(
        'This header is already configured for this gateway route.',
      );
    }

    const encryptionKey = this.getEncryptionKeyOrThrow();
    const valueEncrypted = encryptHeaderValue(dto.value, encryptionKey);

    const header = await this.prisma.routeHeader.create({
      data: {
        gatewayRouteId: route.id,
        name: normalizedName,
        valueEncrypted,
        sensitive: dto.sensitive ?? false,
        active: true,
      },
      select: routeHeaderSelect,
    });

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.CREATE,
      entity: AuditEntity.ROUTE_HEADER,
      entityId: header.id,
      newValue: this.toAuditValue(header),
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `Route header ${header.name} was created for gateway route ${route.slug}.`,
    });

    return this.toSafeRouteHeader(header, encryptionKey);
  }

  async findAll(query: FindRouteHeadersQueryDto) {
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;

    const where = this.buildWhere(query);
    const orderBy = this.buildOrderBy(query.sortBy, query.sortOrder);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.routeHeader.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: routeHeaderSelect,
      }),
      this.prisma.routeHeader.count({
        where,
      }),
    ]);

    const encryptionKey = this.getEncryptionKeyOrThrow();

    return {
      items: items.map((item) => this.toSafeRouteHeader(item, encryptionKey)),
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
      filters: {
        search: query.search ?? null,
        gatewayRouteId: query.gatewayRouteId ?? null,
        headerName: query.headerName ?? null,
        active: query.active ?? null,
        sensitive: query.sensitive ?? null,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
      },
    };
  }

  async findOne(routeHeaderId: string) {
    const header = await this.getRouteHeaderOrThrow(routeHeaderId);

    return this.toSafeRouteHeader(header, this.getEncryptionKeyOrThrow());
  }

  async update(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    routeHeaderId: string,
    dto: UpdateRouteHeaderDto,
  ) {
    const currentHeader = await this.getRouteHeaderOrThrow(routeHeaderId);

    const normalizedName =
      dto.name !== undefined ? normalizeRouteHeaderName(dto.name) : undefined;

    if (normalizedName !== undefined && normalizedName !== currentHeader.name) {
      const conflictingHeader = await this.prisma.routeHeader.findUnique({
        where: {
          gatewayRouteId_name: {
            gatewayRouteId: currentHeader.gatewayRouteId,
            name: normalizedName,
          },
        },
      });

      if (conflictingHeader) {
        throw new ConflictException(
          'This header is already configured for this gateway route.',
        );
      }
    }

    const encryptionKey = this.getEncryptionKeyOrThrow();
    const newValueEncrypted =
      dto.value !== undefined ? encryptHeaderValue(dto.value, encryptionKey) : undefined;

    const updatedHeader = await this.prisma.routeHeader.update({
      where: {
        id: routeHeaderId,
      },
      data: {
        ...(normalizedName !== undefined ? { name: normalizedName } : {}),
        ...(newValueEncrypted !== undefined ? { valueEncrypted: newValueEncrypted } : {}),
        ...(dto.sensitive !== undefined ? { sensitive: dto.sensitive } : {}),
      },
      select: routeHeaderSelect,
    });

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.UPDATE,
      entity: AuditEntity.ROUTE_HEADER,
      entityId: updatedHeader.id,
      previousValue: this.toAuditValue(currentHeader),
      newValue: this.toAuditValue(updatedHeader),
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `Route header ${updatedHeader.name} was updated.`,
    });

    return this.toSafeRouteHeader(updatedHeader, encryptionKey);
  }

  async changeStatus(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    routeHeaderId: string,
    dto: ChangeRouteHeaderStatusDto,
  ) {
    const currentHeader = await this.getRouteHeaderOrThrow(routeHeaderId);
    const encryptionKey = this.getEncryptionKeyOrThrow();

    if (currentHeader.active === dto.active) {
      return this.toSafeRouteHeader(currentHeader, encryptionKey);
    }

    const updatedHeader = await this.prisma.routeHeader.update({
      where: {
        id: routeHeaderId,
      },
      data: {
        active: dto.active,
      },
      select: routeHeaderSelect,
    });

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: dto.active ? AuditAction.ACTIVATE : AuditAction.DEACTIVATE,
      entity: AuditEntity.ROUTE_HEADER,
      entityId: updatedHeader.id,
      previousValue: this.toAuditValue(currentHeader),
      newValue: this.toAuditValue(updatedHeader),
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `Route header ${updatedHeader.name} was ${
        updatedHeader.active ? 'activated' : 'deactivated'
      }.`,
    });

    return this.toSafeRouteHeader(updatedHeader, encryptionKey);
  }

  async remove(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    routeHeaderId: string,
  ): Promise<void> {
    const header = await this.getRouteHeaderOrThrow(routeHeaderId);

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.DELETE,
      entity: AuditEntity.ROUTE_HEADER,
      entityId: header.id,
      previousValue: this.toAuditValue(header),
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `Route header ${header.name} was deleted.`,
    });

    await this.prisma.routeHeader.delete({ where: { id: routeHeaderId } });
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

  private async getRouteHeaderOrThrow(routeHeaderId: string) {
    const header = await this.prisma.routeHeader.findUnique({
      where: {
        id: routeHeaderId,
      },
      select: routeHeaderSelect,
    });

    if (!header) {
      throw new NotFoundException('Route header was not found.');
    }

    return header;
  }

  private getEncryptionKeyOrThrow(): Buffer {
    const hexKey = this.configService.get<string>('HEADER_ENCRYPTION_KEY');

    if (!hexKey) {
      throw new Error('HEADER_ENCRYPTION_KEY is not configured.');
    }

    return parseHeaderEncryptionKey(hexKey);
  }

  private toSafeRouteHeader(header: RouteHeaderRecord, encryptionKey: Buffer) {
    const { valueEncrypted, ...safeHeader } = header;

    return {
      ...safeHeader,
      value: header.sensitive ? MASKED_VALUE : decryptHeaderValue(valueEncrypted, encryptionKey),
    };
  }

  private toAuditValue(header: Pick<RouteHeaderRecord, 'gatewayRouteId' | 'name' | 'sensitive' | 'active'>) {
    return {
      gatewayRouteId: header.gatewayRouteId,
      headerName: header.name,
      sensitive: header.sensitive,
      active: header.active,
    };
  }

  private buildWhere(query: FindRouteHeadersQueryDto): Prisma.RouteHeaderWhereInput {
    const search = query.search?.trim();
    const headerName = query.headerName?.trim();

    return {
      ...(query.gatewayRouteId ? { gatewayRouteId: query.gatewayRouteId } : {}),
      ...(headerName ? { name: { contains: headerName, mode: 'insensitive' } } : {}),
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(query.sensitive !== undefined ? { sensitive: query.sensitive } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { gatewayRoute: { name: { contains: search, mode: 'insensitive' } } },
              { gatewayRoute: { slug: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
  }

  private buildOrderBy(
    sortBy: RouteHeaderSortField,
    sortOrder: RouteHeaderSortDirection,
  ): Prisma.RouteHeaderOrderByWithRelationInput {
    const allowedFields: Record<
      RouteHeaderSortField,
      Prisma.RouteHeaderOrderByWithRelationInput
    > = {
      headerName: { name: sortOrder },
      createdAt: { createdAt: sortOrder },
      updatedAt: { updatedAt: sortOrder },
    };

    return allowedFields[sortBy];
  }
}
