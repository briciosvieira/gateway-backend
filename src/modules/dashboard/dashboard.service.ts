import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RequestLogResult } from '../../../generated/prisma/client';
import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import type { ChartPoint } from './interfaces/chart-point.interface';
import type { DashboardHealth, DashboardOverview } from './interfaces/dashboard-overview.interface';
import type {
  RecentRequestItem,
  StatusDistributionItem,
  TopClientItem,
  TopErrorItem,
  TopRouteItem,
  TopSourceIpItem,
} from './interfaces/top-item.interface';
import type { DashboardPeriodDto, DashboardTopListQueryDto } from './dto/dashboard-period.dto';

type PeriodRange = { startDate: Date; endDate: Date };
type Granularity = 'hour' | 'day' | 'week';

const RECENT_REQUESTS_LIMIT = 20;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const requestLogSummarySelect = {
  createdAt: true,
  result: true,
} as const;

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getOverview(query: DashboardPeriodDto): Promise<DashboardOverview> {
    const range = this.resolvePeriodRange(query);
    const periodWhere = this.buildPeriodWhere(range);

    const [
      totalClients,
      activeClients,
      totalApiKeys,
      activeApiKeys,
      totalRoutes,
      activeRoutes,
      totalRequests,
      requestsInPeriod,
      successfulRequests,
      failedRequests,
      durationAggregate,
    ] = await Promise.all([
      this.prisma.client.count(),
      this.prisma.client.count({ where: { active: true } }),
      this.prisma.apiKey.count(),
      this.prisma.apiKey.count({ where: { active: true } }),
      this.prisma.gatewayRoute.count(),
      this.prisma.gatewayRoute.count({ where: { active: true } }),
      this.prisma.requestLog.count(),
      this.prisma.requestLog.count({ where: periodWhere }),
      this.prisma.requestLog.count({ where: { ...periodWhere, result: RequestLogResult.SUCCESS } }),
      this.prisma.requestLog.count({ where: { ...periodWhere, result: RequestLogResult.ERROR } }),
      this.prisma.requestLog.aggregate({
        where: periodWhere,
        _avg: { durationMs: true, attempts: true },
        _max: { durationMs: true },
      }),
    ]);

    const successRate = requestsInPeriod === 0 ? 0 : (successfulRequests / requestsInPeriod) * 100;
    const errorRate = requestsInPeriod === 0 ? 0 : (failedRequests / requestsInPeriod) * 100;

    return {
      totalClients,
      activeClients,
      totalApiKeys,
      activeApiKeys,
      totalRoutes,
      activeRoutes,
      totalRequests,
      requestsInPeriod,
      successfulRequests,
      failedRequests,
      successRate: Number(successRate.toFixed(2)),
      errorRate: Number(errorRate.toFixed(2)),
      averageResponseTime: Math.round(durationAggregate._avg.durationMs ?? 0),
      maxResponseTime: durationAggregate._max.durationMs ?? 0,
      averageAttempts: Number((durationAggregate._avg.attempts ?? 0).toFixed(2)),
    };
  }

  async getRequestsOverTime(query: DashboardPeriodDto): Promise<ChartPoint[]> {
    const range = this.resolvePeriodRange(query);
    const granularity = this.resolveGranularity(query, range);

    const logs = await this.prisma.requestLog.findMany({
      where: this.buildPeriodWhere(range),
      select: requestLogSummarySelect,
    });

    const buckets = new Map<string, { requests: number; success: number; error: number }>();

    for (const log of logs) {
      const key = this.computeBucketKey(log.createdAt, granularity);
      const bucket = buckets.get(key) ?? { requests: 0, success: 0, error: 0 };

      bucket.requests += 1;

      if (log.result === RequestLogResult.SUCCESS) {
        bucket.success += 1;
      } else {
        bucket.error += 1;
      }

      buckets.set(key, bucket);
    }

    return Array.from(buckets.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([label, bucket]) => ({
        label,
        requests: bucket.requests,
        success: bucket.success,
        error: bucket.error,
      }));
  }

  async getTopClients(query: DashboardTopListQueryDto): Promise<TopClientItem[]> {
    const range = this.resolvePeriodRange(query);
    const periodWhere = this.buildPeriodWhere(range);

    const grouped = await this.prisma.requestLog.groupBy({
      by: ['clientId'],
      where: { ...periodWhere, clientId: { not: null } },
      _count: { clientId: true },
      _avg: { durationMs: true },
      orderBy: { _count: { clientId: 'desc' } },
      take: query.limit,
    });

    const clientIds = grouped
      .map((group) => group.clientId)
      .filter((id): id is string => id !== null);

    const [clients, errorGroups] = await Promise.all([
      this.prisma.client.findMany({
        where: { id: { in: clientIds } },
        select: { id: true, name: true, code: true },
      }),
      this.prisma.requestLog.groupBy({
        by: ['clientId'],
        where: { ...periodWhere, clientId: { in: clientIds }, result: RequestLogResult.ERROR },
        _count: { clientId: true },
      }),
    ]);

    const clientById = new Map(clients.map((client) => [client.id, client]));
    const errorsByClientId = new Map(
      errorGroups.map((group) => [group.clientId, group._count.clientId]),
    );

    return grouped.map((group) => {
      const clientId = group.clientId as string;
      const client = clientById.get(clientId);

      return {
        clientId,
        name: client?.name ?? 'Unknown',
        code: client?.code ?? 'UNKNOWN',
        requests: group._count.clientId,
        errors: errorsByClientId.get(clientId) ?? 0,
        averageResponseTime: Math.round(group._avg.durationMs ?? 0),
      };
    });
  }

  async getTopRoutes(query: DashboardTopListQueryDto): Promise<TopRouteItem[]> {
    const range = this.resolvePeriodRange(query);
    const periodWhere = this.buildPeriodWhere(range);

    const grouped = await this.prisma.requestLog.groupBy({
      by: ['gatewayRouteId'],
      where: { ...periodWhere, gatewayRouteId: { not: null } },
      _count: { gatewayRouteId: true },
      _avg: { durationMs: true },
      orderBy: { _count: { gatewayRouteId: 'desc' } },
      take: query.limit,
    });

    const routeIds = grouped
      .map((group) => group.gatewayRouteId)
      .filter((id): id is string => id !== null);

    const [routes, errorGroups] = await Promise.all([
      this.prisma.gatewayRoute.findMany({
        where: { id: { in: routeIds } },
        select: { id: true, name: true, slug: true, method: true },
      }),
      this.prisma.requestLog.groupBy({
        by: ['gatewayRouteId'],
        where: {
          ...periodWhere,
          gatewayRouteId: { in: routeIds },
          result: RequestLogResult.ERROR,
        },
        _count: { gatewayRouteId: true },
      }),
    ]);

    const routeById = new Map(routes.map((route) => [route.id, route]));
    const errorsByRouteId = new Map(
      errorGroups.map((group) => [group.gatewayRouteId, group._count.gatewayRouteId]),
    );

    return grouped.map((group) => {
      const routeId = group.gatewayRouteId as string;
      const route = routeById.get(routeId);

      return {
        routeId,
        name: route?.name ?? 'Unknown',
        slug: route?.slug ?? 'unknown',
        method: route?.method ?? 'UNKNOWN',
        requests: group._count.gatewayRouteId,
        errors: errorsByRouteId.get(routeId) ?? 0,
        averageResponseTime: Math.round(group._avg.durationMs ?? 0),
      };
    });
  }

  async getStatusDistribution(query: DashboardPeriodDto): Promise<StatusDistributionItem[]> {
    const range = this.resolvePeriodRange(query);
    const periodWhere = this.buildPeriodWhere(range);

    const grouped = await this.prisma.requestLog.groupBy({
      by: ['statusCode'],
      where: periodWhere,
      _count: { statusCode: true },
      orderBy: { statusCode: 'asc' },
    });

    return grouped.map((group) => ({
      statusCode: group.statusCode,
      total: group._count.statusCode,
    }));
  }

  async getTopErrors(query: DashboardTopListQueryDto): Promise<TopErrorItem[]> {
    const range = this.resolvePeriodRange(query);
    const periodWhere = this.buildPeriodWhere(range);

    const grouped = await this.prisma.requestLog.groupBy({
      by: ['errorCode'],
      where: { ...periodWhere, errorCode: { not: null } },
      _count: { errorCode: true },
      orderBy: { _count: { errorCode: 'desc' } },
      take: query.limit,
    });

    return grouped.map((group) => ({
      errorCode: group.errorCode as string,
      total: group._count.errorCode,
    }));
  }

  async getTopSourceIps(query: DashboardTopListQueryDto): Promise<TopSourceIpItem[]> {
    const range = this.resolvePeriodRange(query);
    const periodWhere = this.buildPeriodWhere(range);

    const grouped = await this.prisma.requestLog.groupBy({
      by: ['sourceIp'],
      where: periodWhere,
      _count: { sourceIp: true },
      orderBy: { _count: { sourceIp: 'desc' } },
      take: query.limit,
    });

    return grouped.map((group) => ({
      sourceIp: group.sourceIp,
      requests: group._count.sourceIp,
    }));
  }

  async getRecentRequests(query: DashboardPeriodDto): Promise<RecentRequestItem[]> {
    const range = this.resolvePeriodRange(query);
    const periodWhere = this.buildPeriodWhere(range);

    const logs = await this.prisma.requestLog.findMany({
      where: periodWhere,
      orderBy: { createdAt: 'desc' },
      take: RECENT_REQUESTS_LIMIT,
      select: {
        requestId: true,
        statusCode: true,
        durationMs: true,
        createdAt: true,
        client: {
          select: { id: true, name: true, code: true },
        },
        gatewayRoute: {
          select: { id: true, name: true, slug: true },
        },
      },
    });

    return logs.map((log) => ({
      requestId: log.requestId,
      client: log.client,
      route: log.gatewayRoute,
      statusCode: log.statusCode,
      durationMs: log.durationMs,
      createdAt: log.createdAt,
    }));
  }

  async getHealth(): Promise<DashboardHealth> {
    let databaseIsHealthy = true;

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      databaseIsHealthy = false;
    }

    return {
      gatewayStatus: 'healthy',
      database: databaseIsHealthy ? 'healthy' : 'unhealthy',
      uptimeSeconds: Math.round(process.uptime()),
      version: this.getApplicationVersion(),
      environment: this.configService.get<string>('NODE_ENV', 'development'),
    };
  }

  private resolvePeriodRange(query: DashboardPeriodDto): PeriodRange {
    const now = new Date();

    switch (query.period) {
      case 'today': {
        const startOfDay = new Date(
          Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
        );

        return { startDate: startOfDay, endDate: now };
      }
      case 'last7days':
        return { startDate: new Date(now.getTime() - 7 * ONE_DAY_MS), endDate: now };
      case 'last30days':
        return { startDate: new Date(now.getTime() - 30 * ONE_DAY_MS), endDate: now };
      case 'last90days':
        return { startDate: new Date(now.getTime() - 90 * ONE_DAY_MS), endDate: now };
      case 'custom': {
        if (!query.startDate || !query.endDate) {
          throw new BadRequestException(
            'startDate and endDate are required when period is "custom".',
          );
        }

        const startDate = new Date(query.startDate);
        const endDate = new Date(query.endDate);

        if (startDate > endDate) {
          throw new BadRequestException('startDate must not be after endDate.');
        }

        return { startDate, endDate };
      }
    }
  }

  private buildPeriodWhere(range: PeriodRange): Prisma.RequestLogWhereInput {
    return {
      createdAt: {
        gte: range.startDate,
        lte: range.endDate,
      },
    };
  }

  private resolveGranularity(query: DashboardPeriodDto, range: PeriodRange): Granularity {
    if (query.period === 'today') {
      return 'hour';
    }

    if (query.period === 'last7days' || query.period === 'last30days') {
      return 'day';
    }

    if (query.period === 'last90days') {
      return 'week';
    }

    const durationDays = (range.endDate.getTime() - range.startDate.getTime()) / ONE_DAY_MS;

    if (durationDays <= 2) {
      return 'hour';
    }

    if (durationDays <= 60) {
      return 'day';
    }

    return 'week';
  }

  private computeBucketKey(date: Date, granularity: Granularity): string {
    if (granularity === 'hour') {
      return date.toISOString().slice(0, 13);
    }

    if (granularity === 'day') {
      return date.toISOString().slice(0, 10);
    }

    return this.startOfIsoWeek(date).toISOString().slice(0, 10);
  }

  private startOfIsoWeek(date: Date): Date {
    const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const weekday = dayStart.getUTCDay();
    const diffToMonday = weekday === 0 ? -6 : 1 - weekday;

    dayStart.setUTCDate(dayStart.getUTCDate() + diffToMonday);

    return dayStart;
  }

  private getApplicationVersion(): string {
    try {
      const packageJsonPath = join(process.cwd(), 'package.json');
      const packageJsonContent = readFileSync(packageJsonPath, 'utf8');
      const packageJson = JSON.parse(packageJsonContent) as { version?: string };

      return packageJson.version ?? '0.0.0';
    } catch {
      return '0.0.0';
    }
  }
}
