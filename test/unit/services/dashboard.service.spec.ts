import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { RequestLogResult } from '../../../generated/prisma/client';
import { DashboardService } from '../../../src/modules/dashboard/dashboard.service';
import type {
  DashboardPeriodDto,
  DashboardTopListQueryDto,
} from '../../../src/modules/dashboard/dto/dashboard-period.dto';
import { createMockPrismaService, resetMockPrismaService } from '../../helpers/prisma-mock.helper';
import type { MockPrismaService } from '../../helpers/prisma-mock.helper';

interface OverviewCounts {
  totalClients: number;
  activeClients: number;
  totalApiKeys: number;
  activeApiKeys: number;
  totalRoutes: number;
  activeRoutes: number;
  totalRequests: number;
  requestsInPeriod: number;
  successfulRequests: number;
  failedRequests: number;
  averageDurationMs: number | null;
  maxDurationMs: number | null;
  averageAttempts: number | null;
}

describe('DashboardService', () => {
  let service: DashboardService;
  let prisma: MockPrismaService;
  let configService: { get: jest.Mock };

  const mockOverviewCounts = (values: OverviewCounts): void => {
    prisma.client.count
      .mockResolvedValueOnce(values.totalClients)
      .mockResolvedValueOnce(values.activeClients);
    prisma.apiKey.count
      .mockResolvedValueOnce(values.totalApiKeys)
      .mockResolvedValueOnce(values.activeApiKeys);
    prisma.gatewayRoute.count
      .mockResolvedValueOnce(values.totalRoutes)
      .mockResolvedValueOnce(values.activeRoutes);
    prisma.requestLog.count
      .mockResolvedValueOnce(values.totalRequests)
      .mockResolvedValueOnce(values.requestsInPeriod)
      .mockResolvedValueOnce(values.successfulRequests)
      .mockResolvedValueOnce(values.failedRequests);
    prisma.requestLog.aggregate.mockResolvedValueOnce({
      _avg: { durationMs: values.averageDurationMs, attempts: values.averageAttempts },
      _max: { durationMs: values.maxDurationMs },
    } as never);
  };

  beforeEach(() => {
    prisma = createMockPrismaService();
    configService = { get: jest.fn().mockReturnValue('test') };

    service = new DashboardService(prisma, configService as unknown as ConfigService);
  });

  afterEach(() => {
    resetMockPrismaService(prisma);
    jest.clearAllMocks();
  });

  describe('getOverview', () => {
    const baseCounts: OverviewCounts = {
      totalClients: 12,
      activeClients: 9,
      totalApiKeys: 20,
      activeApiKeys: 15,
      totalRoutes: 6,
      activeRoutes: 5,
      totalRequests: 500,
      requestsInPeriod: 10,
      successfulRequests: 8,
      failedRequests: 2,
      averageDurationMs: 145.6,
      maxDurationMs: 900,
      averageAttempts: 1.25,
    };

    const periodCases: ReadonlyArray<readonly [string, DashboardPeriodDto]> = [
      ['today', { period: 'today' }],
      ['last7days', { period: 'last7days' }],
      ['last30days', { period: 'last30days' }],
      ['last90days', { period: 'last90days' }],
      [
        'custom',
        {
          period: 'custom',
          startDate: '2026-08-01T00:00:00.000Z',
          endDate: '2026-08-04T23:59:59.999Z',
        },
      ],
    ];

    it.each(periodCases)('resolves the overview for period=%s', async (_label, query) => {
      mockOverviewCounts(baseCounts);

      const result = await service.getOverview(query);

      expect(result.totalClients).toBe(baseCounts.totalClients);
      expect(result.activeClients).toBe(baseCounts.activeClients);
      expect(result.totalApiKeys).toBe(baseCounts.totalApiKeys);
      expect(result.activeApiKeys).toBe(baseCounts.activeApiKeys);
      expect(result.totalRoutes).toBe(baseCounts.totalRoutes);
      expect(result.activeRoutes).toBe(baseCounts.activeRoutes);
      expect(result.totalRequests).toBe(baseCounts.totalRequests);
      expect(result.requestsInPeriod).toBe(baseCounts.requestsInPeriod);
      expect(result.successfulRequests).toBe(baseCounts.successfulRequests);
      expect(result.failedRequests).toBe(baseCounts.failedRequests);
      expect(result.successRate).toBe(80);
      expect(result.errorRate).toBe(20);
      expect(result.averageResponseTime).toBe(146);
      expect(result.maxResponseTime).toBe(900);
      expect(result.averageAttempts).toBe(1.25);
    });

    it('throws BadRequestException for period=custom without startDate/endDate', async () => {
      await expect(service.getOverview({ period: 'custom' })).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for period=custom when startDate is after endDate', async () => {
      await expect(
        service.getOverview({
          period: 'custom',
          startDate: '2026-08-10T00:00:00.000Z',
          endDate: '2026-08-01T00:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns 0 success/error rate when there are no requests in the period', async () => {
      mockOverviewCounts({
        ...baseCounts,
        requestsInPeriod: 0,
        successfulRequests: 0,
        failedRequests: 0,
      });

      const result = await service.getOverview({ period: 'last7days' });

      expect(result.successRate).toBe(0);
      expect(result.errorRate).toBe(0);
    });

    it('falls back to 0 for average/max response time and attempts when there is no aggregate data', async () => {
      mockOverviewCounts({
        ...baseCounts,
        averageDurationMs: null,
        maxDurationMs: null,
        averageAttempts: null,
      });

      const result = await service.getOverview({ period: 'last7days' });

      expect(result.averageResponseTime).toBe(0);
      expect(result.maxResponseTime).toBe(0);
      expect(result.averageAttempts).toBe(0);
    });
  });

  describe('getRequestsOverTime', () => {
    it('buckets logs by hour for period=today, sorted ascending', async () => {
      prisma.requestLog.findMany.mockResolvedValueOnce([
        { createdAt: new Date('2026-08-05T08:10:00.000Z'), result: RequestLogResult.SUCCESS },
        { createdAt: new Date('2026-08-05T08:50:00.000Z'), result: RequestLogResult.ERROR },
        { createdAt: new Date('2026-08-05T09:05:00.000Z'), result: RequestLogResult.SUCCESS },
      ] as never);

      const result = await service.getRequestsOverTime({ period: 'today' });

      expect(result.map((point) => point.label)).toEqual(['2026-08-05T08', '2026-08-05T09']);
      expect(result).toEqual([
        { label: '2026-08-05T08', requests: 2, success: 1, error: 1 },
        { label: '2026-08-05T09', requests: 1, success: 1, error: 0 },
      ]);

      for (const point of result) {
        expect(point.requests).toBe(point.success + point.error);
      }
    });

    it('buckets logs by day for period=last7days, sorted ascending', async () => {
      prisma.requestLog.findMany.mockResolvedValueOnce([
        { createdAt: new Date('2026-08-03T12:00:00.000Z'), result: RequestLogResult.SUCCESS },
        { createdAt: new Date('2026-08-01T05:00:00.000Z'), result: RequestLogResult.ERROR },
        { createdAt: new Date('2026-08-01T22:00:00.000Z'), result: RequestLogResult.SUCCESS },
      ] as never);

      const result = await service.getRequestsOverTime({ period: 'last7days' });

      expect(result.map((point) => point.label)).toEqual(['2026-08-01', '2026-08-03']);
      expect(result[0]).toEqual({ label: '2026-08-01', requests: 2, success: 1, error: 1 });
      expect(result[1]).toEqual({ label: '2026-08-03', requests: 1, success: 1, error: 0 });

      for (const point of result) {
        expect(point.requests).toBe(point.success + point.error);
      }
    });

    it('buckets logs by day for period=last30days', async () => {
      prisma.requestLog.findMany.mockResolvedValueOnce([
        { createdAt: new Date('2026-07-10T00:00:00.000Z'), result: RequestLogResult.SUCCESS },
        { createdAt: new Date('2026-07-10T18:00:00.000Z'), result: RequestLogResult.ERROR },
      ] as never);

      const result = await service.getRequestsOverTime({ period: 'last30days' });

      expect(result).toEqual([{ label: '2026-07-10', requests: 2, success: 1, error: 1 }]);
    });

    it('buckets logs by ISO week for period=last90days, sorted ascending', async () => {
      // 2026-08-03 is a Monday; 2026-08-05 (Wed) and 2026-08-09 (Sun) fall in the same
      // ISO week starting on that Monday. 2026-08-10 is the following Monday.
      prisma.requestLog.findMany.mockResolvedValueOnce([
        { createdAt: new Date('2026-08-03T10:00:00.000Z'), result: RequestLogResult.SUCCESS },
        { createdAt: new Date('2026-08-05T10:00:00.000Z'), result: RequestLogResult.ERROR },
        { createdAt: new Date('2026-08-09T23:00:00.000Z'), result: RequestLogResult.SUCCESS },
        { createdAt: new Date('2026-08-10T01:00:00.000Z'), result: RequestLogResult.ERROR },
      ] as never);

      const result = await service.getRequestsOverTime({ period: 'last90days' });

      expect(result.map((point) => point.label)).toEqual(['2026-08-03', '2026-08-10']);
      expect(result[0]).toEqual({ label: '2026-08-03', requests: 3, success: 2, error: 1 });
      expect(result[1]).toEqual({ label: '2026-08-10', requests: 1, success: 0, error: 1 });
    });
  });

  describe('getTopClients', () => {
    const query: DashboardTopListQueryDto = { period: 'last7days', limit: 10 };

    it('maps ranked clients, merges error counts, and falls back to Unknown for deleted clients', async () => {
      prisma.requestLog.groupBy
        .mockResolvedValueOnce([
          { clientId: 'client-1', _count: { clientId: 5 }, _avg: { durationMs: 120 } },
          { clientId: 'client-2', _count: { clientId: 3 }, _avg: { durationMs: 80 } },
        ] as never)
        .mockResolvedValueOnce([
          { clientId: 'client-1', _count: { clientId: 1 } },
          { clientId: 'client-2', _count: { clientId: 2 } },
        ] as never);
      prisma.client.findMany.mockResolvedValueOnce([
        { id: 'client-1', name: 'Acme Corp', code: 'ACME' },
      ] as never);

      const result = await service.getTopClients(query);

      expect(result).toEqual([
        {
          clientId: 'client-1',
          name: 'Acme Corp',
          code: 'ACME',
          requests: 5,
          errors: 1,
          averageResponseTime: 120,
        },
        {
          clientId: 'client-2',
          name: 'Unknown',
          code: 'UNKNOWN',
          requests: 3,
          errors: 2,
          averageResponseTime: 80,
        },
      ]);
    });

    it('defaults errors and averageResponseTime to 0 when there is no matching data', async () => {
      prisma.requestLog.groupBy
        .mockResolvedValueOnce([
          { clientId: 'client-3', _count: { clientId: 1 }, _avg: { durationMs: null } },
        ] as never)
        .mockResolvedValueOnce([] as never);
      prisma.client.findMany.mockResolvedValueOnce([] as never);

      const result = await service.getTopClients(query);

      expect(result).toEqual([
        {
          clientId: 'client-3',
          name: 'Unknown',
          code: 'UNKNOWN',
          requests: 1,
          errors: 0,
          averageResponseTime: 0,
        },
      ]);
    });
  });

  describe('getTopRoutes', () => {
    const query: DashboardTopListQueryDto = { period: 'last7days', limit: 10 };

    it('maps ranked routes, merges error counts, and falls back to Unknown for deleted routes', async () => {
      prisma.requestLog.groupBy
        .mockResolvedValueOnce([
          { gatewayRouteId: 'route-1', _count: { gatewayRouteId: 4 }, _avg: { durationMs: 200 } },
          { gatewayRouteId: 'route-2', _count: { gatewayRouteId: 1 }, _avg: { durationMs: 50 } },
        ] as never)
        .mockResolvedValueOnce([
          { gatewayRouteId: 'route-1', _count: { gatewayRouteId: 2 } },
        ] as never);
      prisma.gatewayRoute.findMany.mockResolvedValueOnce([
        { id: 'route-1', name: 'Get Users', slug: 'get-users', method: 'GET' },
      ] as never);

      const result = await service.getTopRoutes(query);

      expect(result).toEqual([
        {
          routeId: 'route-1',
          name: 'Get Users',
          slug: 'get-users',
          method: 'GET',
          requests: 4,
          errors: 2,
          averageResponseTime: 200,
        },
        {
          routeId: 'route-2',
          name: 'Unknown',
          slug: 'unknown',
          method: 'UNKNOWN',
          requests: 1,
          errors: 0,
          averageResponseTime: 50,
        },
      ]);
    });
  });

  describe('getStatusDistribution', () => {
    it('maps grouped status codes to totals', async () => {
      prisma.requestLog.groupBy.mockResolvedValueOnce([
        { statusCode: 200, _count: { statusCode: 10 } },
        { statusCode: 500, _count: { statusCode: 2 } },
      ] as never);

      const result = await service.getStatusDistribution({ period: 'last7days' });

      expect(result).toEqual([
        { statusCode: 200, total: 10 },
        { statusCode: 500, total: 2 },
      ]);
    });
  });

  describe('getTopErrors', () => {
    it('maps grouped error codes to totals, using errorCode as a string', async () => {
      prisma.requestLog.groupBy.mockResolvedValueOnce([
        { errorCode: 'TIMEOUT', _count: { errorCode: 5 } },
        { errorCode: 'UPSTREAM_5XX', _count: { errorCode: 2 } },
      ] as never);

      const result = await service.getTopErrors({ period: 'last7days', limit: 10 });

      expect(result).toEqual([
        { errorCode: 'TIMEOUT', total: 5 },
        { errorCode: 'UPSTREAM_5XX', total: 2 },
      ]);

      for (const item of result) {
        expect(typeof item.errorCode).toBe('string');
      }
    });
  });

  describe('getTopSourceIps', () => {
    it('maps grouped source IPs to request counts', async () => {
      prisma.requestLog.groupBy.mockResolvedValueOnce([
        { sourceIp: '203.0.113.5', _count: { sourceIp: 7 } },
        { sourceIp: '198.51.100.2', _count: { sourceIp: 3 } },
      ] as never);

      const result = await service.getTopSourceIps({ period: 'last7days', limit: 10 });

      expect(result).toEqual([
        { sourceIp: '203.0.113.5', requests: 7 },
        { sourceIp: '198.51.100.2', requests: 3 },
      ]);
    });
  });

  describe('getRecentRequests', () => {
    it('maps recent logs, renaming gatewayRoute to route, and preserves null relations', async () => {
      const createdAt1 = new Date('2026-08-05T10:00:00.000Z');
      const createdAt2 = new Date('2026-08-05T09:00:00.000Z');

      prisma.requestLog.findMany.mockResolvedValueOnce([
        {
          requestId: 'req-1',
          statusCode: 200,
          durationMs: 120,
          createdAt: createdAt1,
          client: { id: 'client-1', name: 'Acme Corp', code: 'ACME' },
          gatewayRoute: { id: 'route-1', name: 'Get Users', slug: 'get-users' },
        },
        {
          requestId: 'req-2',
          statusCode: 500,
          durationMs: 300,
          createdAt: createdAt2,
          client: null,
          gatewayRoute: null,
        },
      ] as never);

      const result = await service.getRecentRequests({ period: 'last7days' });

      expect(result).toEqual([
        {
          requestId: 'req-1',
          client: { id: 'client-1', name: 'Acme Corp', code: 'ACME' },
          route: { id: 'route-1', name: 'Get Users', slug: 'get-users' },
          statusCode: 200,
          durationMs: 120,
          createdAt: createdAt1,
        },
        {
          requestId: 'req-2',
          client: null,
          route: null,
          statusCode: 500,
          durationMs: 300,
          createdAt: createdAt2,
        },
      ]);
    });
  });

  describe('getHealth', () => {
    it('reports a healthy database when $queryRaw resolves', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }] as never);
      configService.get.mockReturnValue('test');

      const result = await service.getHealth();

      expect(result.database).toBe('healthy');
      expect(result.gatewayStatus).toBe('healthy');
      expect(result.environment).toBe('test');
      expect(typeof result.version).toBe('string');
      expect(result.version.length).toBeGreaterThan(0);
      expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });

    it('reports an unhealthy database without throwing when $queryRaw rejects', async () => {
      prisma.$queryRaw.mockRejectedValueOnce(new Error('connection lost'));

      const result = await service.getHealth();

      expect(result.database).toBe('unhealthy');
      expect(result.gatewayStatus).toBe('healthy');
    });
  });
});
