import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  Prisma,
  RequestLogAuthenticationMode,
  RequestLogResult,
  RequestOrigin,
} from '../../../generated/prisma/client';
import { RequestLogsService } from '../../../src/modules/request-logs/request-logs.service';
import type { CreateRequestLogInput } from '../../../src/modules/request-logs/interfaces/create-request-log.interface';
import type { FindRequestLogsQueryDto } from '../../../src/modules/request-logs/dto/find-request-logs-query.dto';
import {
  createMockPrismaService,
  mockTransactionArray,
  resetMockPrismaService,
} from '../../helpers/prisma-mock.helper';
import type { MockPrismaService } from '../../helpers/prisma-mock.helper';

const requestLogFixture = {
  id: 'log-1',
  requestId: 'req-1',
  attemptedAt: new Date('2026-08-07T00:42:08.000Z'),
  requestOrigin: RequestOrigin.PUBLIC,
  sourceHost: 'hub.wdcpartners.com.br',
  clientId: 'client-1',
  apiKeyId: 'api-key-1',
  gatewayRouteId: 'route-1',
  authenticationMode: RequestLogAuthenticationMode.API_KEY,
  sourceIp: '203.0.113.10',
  method: 'GET',
  publicPath: '/v1/orders',
  publicEndpoint: 'https://hub.wdcpartners.com.br/v1/orders',
  destinationHost: 'upstream.internal.test',
  destinationIp: '10.120.0.248',
  statusCode: 200,
  upstreamStatusCode: 200,
  durationMs: 42,
  attempts: 1,
  result: RequestLogResult.SUCCESS,
  errorCode: null,
  errorMessage: null,
  destinationUrl: 'https://upstream.internal.test/v1/orders',
  requestSizeBytes: 128,
  responseSizeBytes: 256,
  responseBody: { ok: true },
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  client: { id: 'client-1', name: 'Client', code: 'CLIENT' },
  apiKey: { id: 'api-key-1', name: 'Key' },
  gatewayRoute: { id: 'route-1', name: 'Route', slug: 'route', method: 'GET' },
};

const baseCreateInput: CreateRequestLogInput = {
  requestId: 'req-1',
  attemptedAt: new Date('2026-08-07T00:42:08.000Z'),
  requestOrigin: RequestOrigin.PUBLIC,
  sourceHost: 'hub.wdcpartners.com.br',
  authenticationMode: RequestLogAuthenticationMode.API_KEY,
  sourceIp: '203.0.113.10',
  method: 'GET',
  publicPath: '/v1/orders',
  publicEndpoint: 'https://hub.wdcpartners.com.br/v1/orders',
  destinationHost: 'upstream.internal.test',
  destinationUrl: 'https://upstream.internal.test/v1/orders',
  destinationIp: '10.120.0.248',
  statusCode: 200,
  upstreamStatusCode: 200,
  durationMs: 42,
  attempts: 1,
  result: RequestLogResult.SUCCESS,
};

const baseQuery: FindRequestLogsQueryDto = {
  page: 1,
  limit: 20,
  sortBy: 'attemptedAt',
  sortOrder: 'desc',
};

describe('RequestLogsService', () => {
  let service: RequestLogsService;
  let prisma: MockPrismaService;
  let configService: { get: jest.Mock };

  beforeEach(() => {
    prisma = createMockPrismaService();
    configService = { get: jest.fn().mockReturnValue(undefined) };

    service = new RequestLogsService(prisma, configService as unknown as ConfigService);
  });

  afterEach(() => {
    resetMockPrismaService(prisma);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('persists a request log with null defaults for absent optional fields', async () => {
      prisma.requestLog.create.mockResolvedValue(requestLogFixture as never);

      await service.create(baseCreateInput);

      expect(prisma.requestLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          requestId: 'req-1',
          attemptedAt: baseCreateInput.attemptedAt,
          requestOrigin: RequestOrigin.PUBLIC,
          sourceHost: 'hub.wdcpartners.com.br',
          clientId: null,
          apiKeyId: null,
          gatewayRouteId: null,
          sourceIp: '203.0.113.10',
          method: 'GET',
          publicPath: '/v1/orders',
          publicEndpoint: 'https://hub.wdcpartners.com.br/v1/orders',
          destinationHost: 'upstream.internal.test',
          destinationUrl: 'https://upstream.internal.test/v1/orders',
          destinationIp: '10.120.0.248',
          statusCode: 200,
          upstreamStatusCode: 200,
          durationMs: 42,
          attempts: 1,
          result: RequestLogResult.SUCCESS,
          errorCode: null,
          errorMessage: null,
          requestSizeBytes: null,
          responseSizeBytes: null,
        }),
      });
    });

    it('always persists attemptedAt explicitly and never falls back to null', async () => {
      prisma.requestLog.create.mockResolvedValue(requestLogFixture as never);

      await service.create(baseCreateInput);

      expect(prisma.requestLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          attemptedAt: new Date('2026-08-07T00:42:08.000Z'),
        }),
      });
    });

    it('forwards optional fields when provided', async () => {
      prisma.requestLog.create.mockResolvedValue(requestLogFixture as never);

      await service.create({
        ...baseCreateInput,
        clientId: 'client-1',
        apiKeyId: 'api-key-1',
        gatewayRouteId: 'route-1',
        errorCode: 'INVALID_API_KEY',
        errorMessage: 'The API Key is invalid.',
        responseBody: { authorization: 'secret', ok: true },
        requestSizeBytes: 128,
        responseSizeBytes: 256,
      });

      expect(prisma.requestLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          clientId: 'client-1',
          apiKeyId: 'api-key-1',
          gatewayRouteId: 'route-1',
          errorCode: 'INVALID_API_KEY',
          errorMessage: 'The API Key is invalid.',
          responseBody: { authorization: '********', ok: true },
          requestSizeBytes: 128,
          responseSizeBytes: 256,
        }),
      });
    });

    it('stores a truncated placeholder when the request body exceeds the configured limit', async () => {
      configService.get.mockReturnValue('50');
      prisma.requestLog.create.mockResolvedValue(requestLogFixture as never);

      await service.create({
        ...baseCreateInput,
        requestBody: { data: 'a'.repeat(200) },
      });

      const call = prisma.requestLog.create.mock.calls[0][0] as {
        data: { requestBody: { truncated: boolean; approximateSizeBytes: number; preview: string } };
      };

      expect(call.data.requestBody.truncated).toBe(true);
      expect(call.data.requestBody.approximateSizeBytes).toBeGreaterThan(50);
      expect(typeof call.data.requestBody.preview).toBe('string');
      expect(call.data.requestBody.preview.length).toBeLessThanOrEqual(50);
    });

    it('falls back to the default max bytes when REQUEST_LOG_BODY_MAX_BYTES is not configured', async () => {
      configService.get.mockReturnValue(undefined);
      prisma.requestLog.create.mockResolvedValue(requestLogFixture as never);

      await service.create({
        ...baseCreateInput,
        requestBody: { message: 'small body' },
      });

      const call = prisma.requestLog.create.mock.calls[0][0] as {
        data: { requestBody: { message: string } };
      };

      expect(call.data.requestBody).toEqual({ message: 'small body' });
    });

    it('does not throw and swallows a duplicate key error (P2002)', async () => {
      const duplicateError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed.', {
        code: 'P2002',
        clientVersion: '1.0.0',
      });
      prisma.requestLog.create.mockRejectedValue(duplicateError);

      await expect(service.create(baseCreateInput)).resolves.toBeUndefined();
    });

    it('does not throw for unexpected errors', async () => {
      prisma.requestLog.create.mockRejectedValue(new Error('db down'));

      await expect(service.create(baseCreateInput)).resolves.toBeUndefined();
    });
  });

  describe('findAll', () => {
    it('throws BadRequestException when startDate is after endDate', async () => {
      await expect(
        service.findAll({
          ...baseQuery,
          startDate: '2026-02-01T00:00:00.000Z',
          endDate: '2026-01-01T00:00:00.000Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns paginated items with computed totalPages', async () => {
      mockTransactionArray(prisma, [[requestLogFixture], 1]);

      const result = await service.findAll(baseQuery);

      expect(result.items).toEqual([requestLogFixture]);
      expect(result.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    });

    it('returns totalPages 0 when there are no results', async () => {
      mockTransactionArray(prisma, [[], 0]);

      const result = await service.findAll(baseQuery);

      expect(result.pagination.totalPages).toBe(0);
    });

    it('applies the clientId filter', async () => {
      mockTransactionArray(prisma, [[requestLogFixture], 1]);

      const result = await service.findAll({ ...baseQuery, clientId: 'client-1' });

      expect(result.filters.clientId).toBe('client-1');
    });

    it('applies the apiKeyId filter', async () => {
      mockTransactionArray(prisma, [[requestLogFixture], 1]);

      const result = await service.findAll({ ...baseQuery, apiKeyId: 'api-key-1' });

      expect(result.filters.apiKeyId).toBe('api-key-1');
    });

    it('applies the gatewayRouteId filter', async () => {
      mockTransactionArray(prisma, [[requestLogFixture], 1]);

      const result = await service.findAll({ ...baseQuery, gatewayRouteId: 'route-1' });

      expect(result.filters.gatewayRouteId).toBe('route-1');
    });

    it('applies the sourceIp filter', async () => {
      mockTransactionArray(prisma, [[requestLogFixture], 1]);

      const result = await service.findAll({ ...baseQuery, sourceIp: '203.0.113.10' });

      expect(result.filters.sourceIp).toBe('203.0.113.10');
    });

    it('applies the requestOrigin filter', async () => {
      mockTransactionArray(prisma, [[requestLogFixture], 1]);

      const result = await service.findAll({ ...baseQuery, requestOrigin: RequestOrigin.PUBLIC });

      expect(result.filters.requestOrigin).toBe(RequestOrigin.PUBLIC);
    });

    it('applies the destinationHost filter', async () => {
      mockTransactionArray(prisma, [[requestLogFixture], 1]);

      const result = await service.findAll({
        ...baseQuery,
        destinationHost: 'upstream.internal',
      });

      expect(result.filters.destinationHost).toBe('upstream.internal');
    });

    it('applies the destinationIp filter', async () => {
      mockTransactionArray(prisma, [[requestLogFixture], 1]);

      const result = await service.findAll({ ...baseQuery, destinationIp: '10.120.0.248' });

      expect(result.filters.destinationIp).toBe('10.120.0.248');
    });

    it('applies the method filter, uppercased', async () => {
      mockTransactionArray(prisma, [[requestLogFixture], 1]);

      const result = await service.findAll({ ...baseQuery, method: 'get' });

      expect(result.filters.method).toBe('get');
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('applies the statusCode filter', async () => {
      mockTransactionArray(prisma, [[requestLogFixture], 1]);

      const result = await service.findAll({ ...baseQuery, statusCode: 200 });

      expect(result.filters.statusCode).toBe(200);
    });

    it('applies the result filter', async () => {
      mockTransactionArray(prisma, [[requestLogFixture], 1]);

      const result = await service.findAll({ ...baseQuery, result: RequestLogResult.ERROR });

      expect(result.filters.result).toBe(RequestLogResult.ERROR);
    });

    it('applies the errorCode filter', async () => {
      mockTransactionArray(prisma, [[requestLogFixture], 1]);

      const result = await service.findAll({ ...baseQuery, errorCode: 'INVALID_API_KEY' });

      expect(result.filters.errorCode).toBe('INVALID_API_KEY');
    });

    it('applies the requestId filter', async () => {
      mockTransactionArray(prisma, [[requestLogFixture], 1]);

      const result = await service.findAll({ ...baseQuery, requestId: 'req-1' });

      expect(result.filters.requestId).toBe('req-1');
    });

    it('applies the startDate and endDate filters', async () => {
      mockTransactionArray(prisma, [[requestLogFixture], 1]);

      const result = await service.findAll({
        ...baseQuery,
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-02-01T00:00:00.000Z',
      });

      expect(result.filters.startDate).toBe('2026-01-01T00:00:00.000Z');
      expect(result.filters.endDate).toBe('2026-02-01T00:00:00.000Z');
    });

    it('filters the requested period only by attemptedAt, without any createdAt fallback', async () => {
      mockTransactionArray(prisma, [[requestLogFixture], 1]);

      await service.findAll({
        ...baseQuery,
        startDate: '2026-08-07T00:00:00.000Z',
        endDate: '2026-08-07T23:59:59.999Z',
      });

      expect(prisma.requestLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: [
              {
                attemptedAt: {
                  gte: new Date('2026-08-07T00:00:00.000Z'),
                  lte: new Date('2026-08-07T23:59:59.999Z'),
                },
              },
            ],
          }),
        }),
      );
    });

    it('sorts by attemptedAt when requested', async () => {
      mockTransactionArray(prisma, [[requestLogFixture], 1]);

      await service.findAll({
        ...baseQuery,
        sortBy: 'attemptedAt',
        sortOrder: 'asc',
      });

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('appends a deterministic id tiebreaker so paginated results never depend on tie order', async () => {
      mockTransactionArray(prisma, [[requestLogFixture], 1]);

      await service.findAll({
        ...baseQuery,
        sortBy: 'attemptedAt',
        sortOrder: 'desc',
      });

      expect(prisma.requestLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ attemptedAt: 'desc' }, { id: 'desc' }],
        }),
      );
    });

    it('appends the same id tiebreaker regardless of which field is sorted', async () => {
      mockTransactionArray(prisma, [[requestLogFixture], 1]);

      await service.findAll({
        ...baseQuery,
        sortBy: 'statusCode',
        sortOrder: 'asc',
      });

      expect(prisma.requestLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ statusCode: 'asc' }, { id: 'desc' }],
        }),
      );
    });

    it('applies the textual search filter', async () => {
      mockTransactionArray(prisma, [[requestLogFixture], 1]);

      const result = await service.findAll({ ...baseQuery, search: 'orders' });

      expect(result.filters.search).toBe('orders');
    });
  });

  describe('findOne', () => {
    it('returns the request log when found', async () => {
      prisma.requestLog.findUnique.mockResolvedValue(requestLogFixture as never);

      await expect(service.findOne(requestLogFixture.id)).resolves.toEqual(requestLogFixture);
    });

    it('throws NotFoundException when not found', async () => {
      prisma.requestLog.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByRequestId', () => {
    it('returns the request log when found', async () => {
      prisma.requestLog.findUnique.mockResolvedValue(requestLogFixture as never);

      await expect(service.findByRequestId(requestLogFixture.requestId)).resolves.toEqual(
        requestLogFixture,
      );
    });

    it('throws NotFoundException when not found', async () => {
      prisma.requestLog.findUnique.mockResolvedValue(null);

      await expect(service.findByRequestId('missing-request-id')).rejects.toThrow(NotFoundException);
    });
  });
});
