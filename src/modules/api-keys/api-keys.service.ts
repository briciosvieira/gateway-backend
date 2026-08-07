import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, AuditEntity, Prisma } from '../../../generated/prisma/client';
import type {
  ClientResourceSummarySortDirection,
  ClientResourceSummaryStatus,
} from '../../common/dto/find-client-resource-summary-query.base';
import type { RequestContext } from '../../common/interfaces/request-context.interface';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import type { ChangeApiKeyStatusDto } from './dto/change-api-key-status.dto';
import type { CreateApiKeyDto } from './dto/create-api-key.dto';
import type {
  ApiKeyClientSummarySortField,
  FindApiKeyClientsSummaryQueryDto,
} from './dto/find-api-key-clients-summary-query.dto';
import type {
  ApiKeySortDirection,
  ApiKeySortField,
  FindApiKeysQueryDto,
} from './dto/find-api-keys-query.dto';
import type { RegenerateApiKeyDto } from './dto/regenerate-api-key.dto';
import type { UpdateApiKeyDto } from './dto/update-api-key.dto';
import { generateApiKey } from './utils/api-key.util';

const apiKeySelect = {
  id: true,
  clientId: true,
  name: true,
  prefix: true,
  active: true,
  expiresAt: true,
  lastUsedAt: true,
  revokedAt: true,
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

const KEY_STORAGE_WARNING =
  'Store this API Key securely. It will not be displayed again.';

interface ApiKeyClientSummaryRow {
  clientId: string;
  clientName: string;
  clientCode: string;
  clientActive: boolean;
  total: number;
  active: number;
  inactive: number;
  revoked: number;
}

interface CountRow {
  total: number;
}

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    dto: CreateApiKeyDto,
  ) {
    const client = await this.getClientOrThrow(dto.clientId);

    if (!client.active) {
      throw new BadRequestException('Client is inactive.');
    }

    const expiresAt =
      dto.expiresAt !== undefined
        ? this.parseAndValidateExpiration(dto.expiresAt)
        : null;

    const pepper = this.getPepperOrThrow();
    const { fullKey, publicPrefix, hash } = generateApiKey(pepper);

    const apiKey = await this.prisma.apiKey.create({
      data: {
        clientId: client.id,
        name: dto.name.trim(),
        prefix: publicPrefix,
        keyHash: hash,
        active: true,
        expiresAt,
      },
      select: apiKeySelect,
    });

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.CREATE,
      entity: AuditEntity.API_KEY,
      entityId: apiKey.id,
      newValue: {
        name: apiKey.name,
        clientId: apiKey.clientId,
        active: apiKey.active,
        expiresAt: apiKey.expiresAt,
      },
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `API Key ${apiKey.name} was created for client ${client.code}.`,
    });

    return {
      apiKey,
      key: fullKey,
      warning: KEY_STORAGE_WARNING,
    };
  }

  async findAll(query: FindApiKeysQueryDto) {
    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;

    const where = this.buildWhere(query);
    const orderBy = this.buildOrderBy(query.sortBy, query.sortOrder);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.apiKey.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: apiKeySelect,
      }),
      this.prisma.apiKey.count({
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
        prefix: query.prefix ?? null,
        active: query.active ?? null,
        expiresFrom: query.expiresFrom ?? null,
        expiresTo: query.expiresTo ?? null,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
      },
    };
  }

  async findClientsSummary(query: FindApiKeyClientsSummaryQueryDto) {
    const page = query.page;
    const limit = query.limit;
    const offset = (page - 1) * limit;
    const now = new Date();
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
          COUNT(ak.id)::int AS total,
          COUNT(*) FILTER (
            WHERE ak.revoked_at IS NULL
              AND ak.active = true
              AND (ak.expires_at IS NULL OR ak.expires_at > ${now})
          )::int AS active,
          COUNT(*) FILTER (
            WHERE ak.revoked_at IS NULL
              AND NOT (
                ak.active = true
                AND (ak.expires_at IS NULL OR ak.expires_at > ${now})
              )
          )::int AS inactive,
          COUNT(*) FILTER (
            WHERE ak.revoked_at IS NOT NULL
          )::int AS revoked
        FROM api_keys ak
        INNER JOIN clients c ON c.id = ak.client_id
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
        inactive,
        revoked
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
      this.prisma.$queryRaw<ApiKeyClientSummaryRow[]>(dataQuery),
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
        revoked: row.revoked,
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

  async findOne(apiKeyId: string) {
    return this.getApiKeyOrThrow(apiKeyId);
  }

  async update(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    apiKeyId: string,
    dto: UpdateApiKeyDto,
  ) {
    const currentApiKey = await this.getApiKeyOrThrow(apiKeyId);

    const expiresAt =
      dto.expiresAt !== undefined
        ? this.parseAndValidateExpiration(dto.expiresAt)
        : undefined;

    const updatedApiKey = await this.prisma.apiKey.update({
      where: {
        id: apiKeyId,
      },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      },
      select: apiKeySelect,
    });

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.UPDATE,
      entity: AuditEntity.API_KEY,
      entityId: updatedApiKey.id,
      previousValue: {
        name: currentApiKey.name,
        expiresAt: currentApiKey.expiresAt,
      },
      newValue: {
        name: updatedApiKey.name,
        expiresAt: updatedApiKey.expiresAt,
      },
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `API Key ${updatedApiKey.name} was updated.`,
    });

    return updatedApiKey;
  }

  async changeStatus(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    apiKeyId: string,
    dto: ChangeApiKeyStatusDto,
  ) {
    const currentApiKey = await this.getApiKeyOrThrow(apiKeyId);

    if (currentApiKey.active === dto.active) {
      return currentApiKey;
    }

    if (dto.active) {
      if (currentApiKey.revokedAt) {
        throw new BadRequestException('A revoked API Key cannot be reactivated.');
      }

      if (currentApiKey.expiresAt && currentApiKey.expiresAt <= new Date()) {
        throw new BadRequestException('An expired API Key cannot be activated.');
      }

      if (!currentApiKey.client.active) {
        throw new BadRequestException('Client is inactive.');
      }
    }

    const updatedApiKey = await this.prisma.apiKey.update({
      where: {
        id: apiKeyId,
      },
      data: {
        active: dto.active,
      },
      select: apiKeySelect,
    });

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: dto.active ? AuditAction.ACTIVATE : AuditAction.DEACTIVATE,
      entity: AuditEntity.API_KEY,
      entityId: updatedApiKey.id,
      previousValue: {
        active: currentApiKey.active,
      },
      newValue: {
        active: updatedApiKey.active,
      },
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `API Key ${updatedApiKey.name} was ${
        updatedApiKey.active ? 'activated' : 'deactivated'
      }.`,
    });

    return updatedApiKey;
  }

  async revoke(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    apiKeyId: string,
  ) {
    const currentApiKey = await this.getApiKeyOrThrow(apiKeyId);

    if (currentApiKey.revokedAt) {
      return currentApiKey;
    }

    const updatedApiKey = await this.prisma.apiKey.update({
      where: {
        id: apiKeyId,
      },
      data: {
        active: false,
        revokedAt: new Date(),
      },
      select: apiKeySelect,
    });

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.REVOKE,
      entity: AuditEntity.API_KEY,
      entityId: updatedApiKey.id,
      previousValue: {
        active: currentApiKey.active,
        revokedAt: currentApiKey.revokedAt,
      },
      newValue: {
        active: updatedApiKey.active,
        revokedAt: updatedApiKey.revokedAt,
      },
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `API Key ${updatedApiKey.name} was revoked.`,
    });

    return updatedApiKey;
  }

  async regenerate(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    apiKeyId: string,
    dto: RegenerateApiKeyDto,
  ) {
    const currentApiKey = await this.getApiKeyOrThrow(apiKeyId);
    const client = await this.getClientOrThrow(currentApiKey.clientId);

    const pepper = this.getPepperOrThrow();
    const { fullKey, publicPrefix, hash } = generateApiKey(pepper);

    const newApiKey = await this.prisma.apiKey.create({
      data: {
        clientId: client.id,
        name: currentApiKey.name,
        prefix: publicPrefix,
        keyHash: hash,
        active: true,
        expiresAt: currentApiKey.expiresAt,
      },
      select: apiKeySelect,
    });

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.REGENERATE,
      entity: AuditEntity.API_KEY,
      entityId: newApiKey.id,
      previousValue: {
        previousApiKeyId: currentApiKey.id,
        previousApiKeyName: currentApiKey.name,
      },
      newValue: {
        name: newApiKey.name,
        clientId: newApiKey.clientId,
      },
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `API Key ${currentApiKey.name} was regenerated.`,
    });

    let previousApiKeyRevoked = false;

    if (dto.revokePrevious !== false) {
      await this.revoke(currentUser, requestContext, currentApiKey.id);
      previousApiKeyRevoked = true;
    }

    return {
      apiKey: newApiKey,
      key: fullKey,
      previousApiKeyRevoked,
      warning: KEY_STORAGE_WARNING,
    };
  }

  async remove(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    apiKeyId: string,
  ): Promise<void> {
    const apiKey = await this.getApiKeyOrThrow(apiKeyId);

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.DELETE,
      entity: AuditEntity.API_KEY,
      entityId: apiKey.id,
      previousValue: {
        name: apiKey.name,
        clientId: apiKey.clientId,
        active: apiKey.active,
      },
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `API Key ${apiKey.name} was deleted.`,
    });

    // RequestLog.apiKey is onDelete: SetNull — historical logs survive with
    // apiKeyId cleared, so no dependency check is needed before deleting.
    await this.prisma.apiKey.delete({ where: { id: apiKeyId } });
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

  private async getApiKeyOrThrow(apiKeyId: string) {
    const apiKey = await this.prisma.apiKey.findUnique({
      where: {
        id: apiKeyId,
      },
      select: apiKeySelect,
    });

    if (!apiKey) {
      throw new NotFoundException('API Key was not found.');
    }

    return apiKey;
  }

  private parseAndValidateExpiration(expiresAt: string): Date {
    const parsedDate = new Date(expiresAt);

    if (parsedDate <= new Date()) {
      throw new BadRequestException('expiresAt must be a future date.');
    }

    return parsedDate;
  }

  private getPepperOrThrow(): string {
    const pepper = this.configService.get<string>('API_KEY_PEPPER');

    if (!pepper) {
      throw new Error('API_KEY_PEPPER is not configured.');
    }

    return pepper;
  }

  private buildWhere(query: FindApiKeysQueryDto): Prisma.ApiKeyWhereInput {
    const search = query.search?.trim();
    const prefix = query.prefix?.trim();

    return {
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.active !== undefined ? { active: query.active } : {}),
      ...(prefix ? { prefix: { contains: prefix, mode: 'insensitive' } } : {}),
      ...(query.expiresFrom || query.expiresTo
        ? {
            expiresAt: {
              ...(query.expiresFrom ? { gte: new Date(query.expiresFrom) } : {}),
              ...(query.expiresTo ? { lte: new Date(query.expiresTo) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { prefix: { contains: search, mode: 'insensitive' } },
              { client: { name: { contains: search, mode: 'insensitive' } } },
              { client: { code: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
  }

  private buildOrderBy(
    sortBy: ApiKeySortField,
    sortOrder: ApiKeySortDirection,
  ): Prisma.ApiKeyOrderByWithRelationInput {
    const allowedFields: Record<
      ApiKeySortField,
      Prisma.ApiKeyOrderByWithRelationInput
    > = {
      name: { name: sortOrder },
      createdAt: { createdAt: sortOrder },
      updatedAt: { updatedAt: sortOrder },
      expiresAt: { expiresAt: sortOrder },
      lastUsedAt: { lastUsedAt: sortOrder },
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
    sortBy: ApiKeyClientSummarySortField,
    sortOrder: ClientResourceSummarySortDirection,
  ): Prisma.Sql {
    const orderByMap: Record<
      ApiKeyClientSummarySortField,
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
      revoked: {
        asc: Prisma.raw(`revoked ASC, "clientId" ASC`),
        desc: Prisma.raw(`revoked DESC, "clientId" ASC`),
      },
    };

    return orderByMap[sortBy][sortOrder];
  }
}
