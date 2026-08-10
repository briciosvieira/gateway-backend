import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import type { CreateRequestLogInput } from './interfaces/create-request-log.interface';
import type {
  FindRequestLogsQueryDto,
  RequestLogSortDirection,
  RequestLogSortField,
} from './dto/find-request-logs-query.dto';
import { toPrismaJson } from './utils/log-json.util';
import { sanitizeForLog } from './utils/sensitive-data-mask.util';

const DEFAULT_BODY_MAX_BYTES = 16384;

const requestLogListSelect = {
  id: true,
  requestId: true,
  attemptedAt: true,
  requestOrigin: true,
  sourceHost: true,
  clientId: true,
  apiKeyId: true,
  gatewayRouteId: true,
  authenticationMode: true,
  sourceIp: true,
  method: true,
  publicPath: true,
  publicEndpoint: true,
  destinationHost: true,
  destinationIp: true,
  statusCode: true,
  durationMs: true,
  attempts: true,
  result: true,
  errorCode: true,
  errorMessage: true,
  requestSizeBytes: true,
  responseSizeBytes: true,
  createdAt: true,
  client: {
    select: {
      id: true,
      name: true,
      code: true,
    },
  },
  apiKey: {
    select: {
      id: true,
      name: true,
    },
  },
  gatewayRoute: {
    select: {
      id: true,
      name: true,
      slug: true,
      method: true,
    },
  },
} as const;

const requestLogDetailSelect = {
  ...requestLogListSelect,
  destinationUrl: true,
  upstreamStatusCode: true,
  requestHeaders: true,
  requestQuery: true,
  requestBody: true,
  responseHeaders: true,
  responseBody: true,
} as const;

@Injectable()
export class RequestLogsService {
  private readonly logger = new Logger(RequestLogsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async create(input: CreateRequestLogInput): Promise<void> {
    try {
      await this.prisma.requestLog.create({
        data: {
          requestId: input.requestId,
          attemptedAt: input.attemptedAt,
          requestOrigin: input.requestOrigin ?? null,
          sourceHost: input.sourceHost ?? null,
          clientId: input.clientId ?? null,
          apiKeyId: input.apiKeyId ?? null,
          gatewayRouteId: input.gatewayRouteId ?? null,
          authenticationMode: input.authenticationMode,
          sourceIp: input.sourceIp,
          method: input.method,
          publicPath: input.publicPath,
          publicEndpoint: input.publicEndpoint ?? null,
          destinationHost: input.destinationHost ?? null,
          destinationUrl: input.destinationUrl ?? null,
          destinationIp: input.destinationIp ?? null,
          statusCode: input.statusCode,
          upstreamStatusCode: input.upstreamStatusCode ?? null,
          durationMs: input.durationMs,
          attempts: input.attempts,
          result: input.result,
          errorCode: input.errorCode ?? null,
          errorMessage: input.errorMessage ?? null,
          requestHeaders: toPrismaJson(input.requestHeaders),
          requestQuery: toPrismaJson(input.requestQuery),
          requestBody: this.sanitizeAndLimitPayload(input.requestBody),
          responseHeaders: toPrismaJson(input.responseHeaders),
          responseBody: this.sanitizeAndLimitPayload(input.responseBody),
          requestSizeBytes: input.requestSizeBytes ?? null,
          responseSizeBytes: input.responseSizeBytes ?? null,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.warn(`Duplicate request log ignored for requestId ${input.requestId}.`);
        return;
      }

      this.logger.error(
        `Failed to persist request log for requestId ${input.requestId}.`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async findAll(query: FindRequestLogsQueryDto) {
    this.validateDateRange(query);

    const page = query.page;
    const limit = query.limit;
    const skip = (page - 1) * limit;

    const where = this.buildWhere(query);
    const orderBy = this.buildOrderBy(query.sortBy, query.sortOrder);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.requestLog.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        select: requestLogListSelect,
      }),
      this.prisma.requestLog.count({
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
        apiKeyId: query.apiKeyId ?? null,
        gatewayRouteId: query.gatewayRouteId ?? null,
        authenticationMode: query.authenticationMode ?? null,
        requestOrigin: query.requestOrigin ?? null,
        sourceIp: query.sourceIp ?? null,
        destinationHost: query.destinationHost ?? null,
        destinationIp: query.destinationIp ?? null,
        method: query.method ?? null,
        statusCode: query.statusCode ?? null,
        result: query.result ?? null,
        errorCode: query.errorCode ?? null,
        requestId: query.requestId ?? null,
        startDate: query.startDate ?? null,
        endDate: query.endDate ?? null,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
      },
    };
  }

  async findOne(requestLogId: string) {
    return this.getRequestLogOrThrow({ id: requestLogId });
  }

  async findByRequestId(requestId: string) {
    return this.getRequestLogOrThrow({ requestId });
  }

  private async getRequestLogOrThrow(where: Prisma.RequestLogWhereUniqueInput) {
    const requestLog = await this.prisma.requestLog.findUnique({
      where,
      select: requestLogDetailSelect,
    });

    if (!requestLog) {
      throw new NotFoundException('Request log was not found.');
    }

    return requestLog;
  }

  private validateDateRange(query: FindRequestLogsQueryDto): void {
    if (!query.startDate || !query.endDate) {
      return;
    }

    if (new Date(query.startDate) > new Date(query.endDate)) {
      throw new BadRequestException('startDate must not be after endDate.');
    }
  }

  private buildWhere(query: FindRequestLogsQueryDto): Prisma.RequestLogWhereInput {
    const search = query.search?.trim();
    const andFilters: Prisma.RequestLogWhereInput[] = [];

    if (query.startDate || query.endDate) {
      andFilters.push({
        attemptedAt: {
          ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
          ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
        },
      });
    }

    if (search) {
      andFilters.push({
        OR: [
          { requestId: { contains: search, mode: 'insensitive' } },
          { sourceIp: { contains: search, mode: 'insensitive' } },
          { sourceHost: { contains: search, mode: 'insensitive' } },
          { publicPath: { contains: search, mode: 'insensitive' } },
          { publicEndpoint: { contains: search, mode: 'insensitive' } },
          { destinationHost: { contains: search, mode: 'insensitive' } },
          { destinationIp: { contains: search, mode: 'insensitive' } },
          { errorCode: { contains: search, mode: 'insensitive' } },
          { client: { name: { contains: search, mode: 'insensitive' } } },
          { client: { code: { contains: search, mode: 'insensitive' } } },
          { apiKey: { name: { contains: search, mode: 'insensitive' } } },
          { apiKey: { prefix: { contains: search, mode: 'insensitive' } } },
          { gatewayRoute: { name: { contains: search, mode: 'insensitive' } } },
          { gatewayRoute: { slug: { contains: search, mode: 'insensitive' } } },
        ],
      });
    }

    return {
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.apiKeyId ? { apiKeyId: query.apiKeyId } : {}),
      ...(query.gatewayRouteId ? { gatewayRouteId: query.gatewayRouteId } : {}),
      ...(query.authenticationMode ? { authenticationMode: query.authenticationMode } : {}),
      ...(query.requestOrigin ? { requestOrigin: query.requestOrigin } : {}),
      ...(query.sourceIp ? { sourceIp: query.sourceIp } : {}),
      ...(query.destinationHost
        ? { destinationHost: { contains: query.destinationHost, mode: 'insensitive' } }
        : {}),
      ...(query.destinationIp ? { destinationIp: query.destinationIp } : {}),
      ...(query.method ? { method: query.method.toUpperCase() } : {}),
      ...(query.statusCode !== undefined ? { statusCode: query.statusCode } : {}),
      ...(query.result ? { result: query.result } : {}),
      ...(query.errorCode ? { errorCode: { contains: query.errorCode, mode: 'insensitive' } } : {}),
      ...(query.requestId ? { requestId: query.requestId } : {}),
      ...(andFilters.length > 0 ? { AND: andFilters } : {}),
    };
  }

  private buildOrderBy(
    sortBy: RequestLogSortField,
    sortOrder: RequestLogSortDirection,
  ): Prisma.RequestLogOrderByWithRelationInput[] {
    const allowedFields: Record<RequestLogSortField, Prisma.RequestLogOrderByWithRelationInput> = {
      attemptedAt: { attemptedAt: sortOrder },
      createdAt: { createdAt: sortOrder },
      durationMs: { durationMs: sortOrder },
      statusCode: { statusCode: sortOrder },
      attempts: { attempts: sortOrder },
    };

    // Postgres does not guarantee a stable order for rows that tie on the
    // primary sort field (e.g. many requests logged within the same
    // second), which is especially visible across paginated (skip/take)
    // requests — the same page can come back reshuffled between calls. `id`
    // is always unique, so appending it as a tiebreaker makes the order
    // fully deterministic regardless of ties on `sortBy`.
    return [allowedFields[sortBy], { id: 'desc' }];
  }

  private sanitizeAndLimitPayload(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    const sanitizedValue = sanitizeForLog(value);
    const serialized = JSON.stringify(sanitizedValue);

    if (serialized === undefined) {
      return undefined;
    }

    const sizeInBytes = Buffer.byteLength(serialized, 'utf8');
    const maxBytes = this.getBodyMaxBytes();

    if (sizeInBytes <= maxBytes) {
      return JSON.parse(serialized) as Prisma.InputJsonValue;
    }

    return {
      truncated: true,
      approximateSizeBytes: sizeInBytes,
      preview: serialized.slice(0, maxBytes),
    };
  }

  private getBodyMaxBytes(): number {
    const configuredValue = this.configService.get<string>('REQUEST_LOG_BODY_MAX_BYTES');
    const parsedValue = configuredValue ? Number.parseInt(configuredValue, 10) : Number.NaN;

    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : DEFAULT_BODY_MAX_BYTES;
  }
}
