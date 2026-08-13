import { errors as undiciErrors, request as undiciRequest } from 'undici';

jest.mock('undici', () => ({
  request: jest.fn(),
  errors: jest.requireActual('undici').errors,
}));

const mockUndiciRequest = undiciRequest as jest.MockedFunction<typeof undiciRequest>;

import { randomBytes } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import {
  AllowedIpType,
  RequestLogAuthenticationMode,
  RequestOrigin,
} from '../../../generated/prisma/client';
import type { AllowedHostnameResolverService } from '../../../src/modules/allowed-ips/allowed-hostname-resolver.service';
import { generateApiKey, hashApiKey } from '../../../src/modules/api-keys/utils/api-key.util';
import { GatewayProxyService } from '../../../src/modules/gateway-proxy/gateway-proxy.service';
import { isGatewayErrorResult } from '../../../src/modules/gateway-proxy/interfaces/gateway-error.interface';
import type { RequestLogsService } from '../../../src/modules/request-logs/request-logs.service';
import { encryptHeaderValue } from '../../../src/modules/route-headers/utils/route-header-encryption.util';
import type { TrustedCaDispatcherService } from '../../../src/modules/trusted-cas/trusted-ca-dispatcher.service';
import {
  createMockPrismaService,
  resetMockPrismaService,
} from '../../helpers/prisma-mock.helper';
import type { MockPrismaService } from '../../helpers/prisma-mock.helper';

const PEPPER = 'test-pepper';
const ENCRYPTION_KEY_HEX = randomBytes(32).toString('hex');
const ENCRYPTION_KEY_BUFFER = Buffer.from(ENCRYPTION_KEY_HEX, 'hex');

const CLIENT_ID = 'client-1';
const OTHER_CLIENT_ID = 'client-2';
const ROUTE_ID = 'route-1';
const API_KEY_ID = 'api-key-1';
const DESTINATION_URL = 'http://upstream.internal.test/webhook';
const SOURCE_IP = '203.0.113.10';

const validApiKey = generateApiKey(PEPPER);

interface RouteRecord {
  id: string;
  slug: string;
  method: string;
  destinationUrl: string;
  timeoutMs: number;
  retryCount: number;
  active: boolean;
  requiresApiKey: boolean;
  clientId: string;
}

interface ApiKeyRecord {
  id: string;
  clientId: string;
  keyHash: string;
  active: boolean;
  revokedAt: Date | null;
  expiresAt: Date | null;
  client: { active: boolean };
}

interface AllowedIpRecord {
  address: string;
  type: AllowedIpType;
}

interface RouteHeaderRecord {
  name: string;
  valueEncrypted: string;
}

function buildRoute(overrides: Partial<RouteRecord> = {}): RouteRecord {
  return {
    id: ROUTE_ID,
    slug: '/my-route',
    method: 'GET',
    destinationUrl: DESTINATION_URL,
    timeoutMs: 5000,
    retryCount: 0,
    active: true,
    requiresApiKey: true,
    clientId: CLIENT_ID,
    ...overrides,
  };
}

function buildApiKeyRecord(overrides: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return {
    id: API_KEY_ID,
    clientId: CLIENT_ID,
    keyHash: validApiKey.hash,
    active: true,
    revokedAt: null,
    expiresAt: null,
    client: { active: true },
    ...overrides,
  };
}

function setupResolutionMocks(
  prisma: MockPrismaService,
  options: {
    route?: RouteRecord | null;
    clientActive?: boolean;
    apiKeyRecord?: ApiKeyRecord | null;
    allowedIps?: AllowedIpRecord[];
    routeHeaders?: RouteHeaderRecord[];
  } = {},
): void {
  prisma.gatewayRoute.findUnique.mockResolvedValue((options.route ?? buildRoute()) as never);
  prisma.client.findUnique.mockResolvedValue({ active: options.clientActive ?? true } as never);
  prisma.apiKey.findUnique.mockResolvedValue(
    (options.apiKeyRecord === undefined ? buildApiKeyRecord() : options.apiKeyRecord) as never,
  );
  prisma.allowedIp.findMany.mockResolvedValue(
    (options.allowedIps ?? [{ address: SOURCE_IP, type: AllowedIpType.IPV4 }]) as never,
  );
  prisma.routeHeader.findMany.mockResolvedValue((options.routeHeaders ?? []) as never);
  prisma.apiKey.update.mockResolvedValue(undefined as never);
}

function buildFastifyRequest(
  overrides: Partial<{
    url: string;
    method: string;
    headers: Record<string, string | string[] | undefined>;
    ip: string;
    body: unknown;
    host: string;
    protocol: string;
  }> = {},
): FastifyRequest {
  return {
    url: overrides.url ?? '/gateway/my-route',
    method: overrides.method ?? 'GET',
    headers: {
      'x-request-id': 'req-1',
      host: overrides.host ?? 'hub.wdcpartners.com.br',
      ...(overrides.headers ?? {}),
    },
    ip: overrides.ip ?? SOURCE_IP,
    body: overrides.body,
    host: overrides.host ?? 'hub.wdcpartners.com.br',
    protocol: overrides.protocol ?? 'https',
  } as unknown as FastifyRequest;
}

function buildValidRequest(
  overrides: Partial<{
    url: string;
    method: string;
    headers: Record<string, string | string[] | undefined>;
    ip: string;
    body: unknown;
    host: string;
    protocol: string;
  }> = {},
): FastifyRequest {
  return buildFastifyRequest({
    ...overrides,
    headers: { 'x-api-key': validApiKey.fullKey, ...(overrides.headers ?? {}) },
  });
}

function mockUpstreamSuccess(
  statusCode = 200,
  jsonBody: unknown = { ok: true },
  headers: Record<string, string> = { 'content-type': 'application/json' },
): void {
  mockUndiciRequest.mockResolvedValue({
    statusCode,
    headers,
    body: { arrayBuffer: async () => Buffer.from(JSON.stringify(jsonBody)) },
  } as never);
}

function getPersistedRequestLogInput(requestLogsService: {
  create: jest.Mock;
}): Record<string, unknown> {
  return requestLogsService.create.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe('GatewayProxyService', () => {
  let service: GatewayProxyService;
  let prisma: MockPrismaService;
  let configService: { get: jest.Mock };
  let requestLogsService: { create: jest.Mock };
  let trustedCaDispatcherService: { getDispatcher: jest.Mock };
  let allowedHostnameResolverService: { resolve: jest.Mock };
  const dispatcher = { kind: 'trusted-ca-dispatcher' };

  beforeEach(() => {
    prisma = createMockPrismaService();
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'API_KEY_PEPPER') {
          return PEPPER;
        }

        if (key === 'HEADER_ENCRYPTION_KEY') {
          return ENCRYPTION_KEY_HEX;
        }

        return undefined;
      }),
    };
    requestLogsService = { create: jest.fn().mockResolvedValue(undefined) };
    trustedCaDispatcherService = {
      getDispatcher: jest.fn().mockResolvedValue(dispatcher),
    };
    allowedHostnameResolverService = { resolve: jest.fn().mockResolvedValue(null) };

    service = new GatewayProxyService(
      prisma,
      configService as unknown as ConfigService,
      requestLogsService as unknown as RequestLogsService,
      trustedCaDispatcherService as unknown as TrustedCaDispatcherService,
      allowedHostnameResolverService as unknown as AllowedHostnameResolverService,
    );
  });

  afterEach(() => {
    resetMockPrismaService(prisma);
    mockUndiciRequest.mockReset();
    jest.clearAllMocks();
  });

  describe('handleGatewayRequest — route resolution', () => {
    it('returns GATEWAY_ROUTE_NOT_FOUND (404) when no route matches the slug', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(null);

      const result = await service.handleGatewayRequest(buildFastifyRequest());

      expect(isGatewayErrorResult(result)).toBe(true);
      if (isGatewayErrorResult(result)) {
        expect(result.code).toBe('GATEWAY_ROUTE_NOT_FOUND');
        expect(result.statusCode).toBe(404);
      }
    });

    it('returns GATEWAY_ROUTE_NOT_FOUND (404) when the route exists but is inactive', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(buildRoute({ active: false }) as never);

      const result = await service.handleGatewayRequest(buildFastifyRequest());

      expect(isGatewayErrorResult(result)).toBe(true);
      if (isGatewayErrorResult(result)) {
        expect(result.code).toBe('GATEWAY_ROUTE_NOT_FOUND');
        expect(result.statusCode).toBe(404);
      }
    });

    it('returns METHOD_NOT_ALLOWED (405) with allowedMethods when the HTTP method differs', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(buildRoute({ method: 'POST' }) as never);

      const result = await service.handleGatewayRequest(buildFastifyRequest({ method: 'GET' }));

      expect(isGatewayErrorResult(result)).toBe(true);
      if (isGatewayErrorResult(result)) {
        expect(result.code).toBe('METHOD_NOT_ALLOWED');
        expect(result.statusCode).toBe(405);
        expect(result.allowedMethods).toBe('POST');
      }
    });

    it('returns CLIENT_INACTIVE (403) when the route client is not active', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(buildRoute() as never);
      prisma.client.findUnique.mockResolvedValue({ active: false } as never);

      const result = await service.handleGatewayRequest(buildFastifyRequest());

      expect(isGatewayErrorResult(result)).toBe(true);
      if (isGatewayErrorResult(result)) {
        expect(result.code).toBe('CLIENT_INACTIVE');
        expect(result.statusCode).toBe(403);
      }
    });
  });

  describe('handleGatewayRequest — API Key', () => {
    it('returns API_KEY_REQUIRED (401) when the x-api-key header is missing', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(buildRoute() as never);
      prisma.client.findUnique.mockResolvedValue({ active: true } as never);

      const result = await service.handleGatewayRequest(buildFastifyRequest());

      expect(isGatewayErrorResult(result)).toBe(true);
      if (isGatewayErrorResult(result)) {
        expect(result.code).toBe('API_KEY_REQUIRED');
        expect(result.statusCode).toBe(401);
      }
    });

    it('returns INVALID_API_KEY (401) when the key does not match the expected format', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(buildRoute() as never);
      prisma.client.findUnique.mockResolvedValue({ active: true } as never);

      const result = await service.handleGatewayRequest(
        buildFastifyRequest({ headers: { 'x-api-key': 'not-a-valid-key-format' } }),
      );

      expect(isGatewayErrorResult(result)).toBe(true);
      if (isGatewayErrorResult(result)) {
        expect(result.code).toBe('INVALID_API_KEY');
        expect(result.statusCode).toBe(401);
      }
    });

    it('returns INVALID_API_KEY (401) when no record matches the key prefix', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(buildRoute() as never);
      prisma.client.findUnique.mockResolvedValue({ active: true } as never);
      prisma.apiKey.findUnique.mockResolvedValue(null);

      const result = await service.handleGatewayRequest(buildValidRequest());

      expect(isGatewayErrorResult(result)).toBe(true);
      if (isGatewayErrorResult(result)) {
        expect(result.code).toBe('INVALID_API_KEY');
        expect(result.statusCode).toBe(401);
      }
    });

    it('returns INVALID_API_KEY (401) when the stored hash does not match the provided key', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(buildRoute() as never);
      prisma.client.findUnique.mockResolvedValue({ active: true } as never);
      prisma.apiKey.findUnique.mockResolvedValue(
        buildApiKeyRecord({ keyHash: hashApiKey('a-completely-different-key', PEPPER) }) as never,
      );

      const result = await service.handleGatewayRequest(buildValidRequest());

      expect(isGatewayErrorResult(result)).toBe(true);
      if (isGatewayErrorResult(result)) {
        expect(result.code).toBe('INVALID_API_KEY');
        expect(result.statusCode).toBe(401);
      }
    });

    it('returns INVALID_API_KEY (401) when the key is inactive', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(buildRoute() as never);
      prisma.client.findUnique.mockResolvedValue({ active: true } as never);
      prisma.apiKey.findUnique.mockResolvedValue(buildApiKeyRecord({ active: false }) as never);

      const result = await service.handleGatewayRequest(buildValidRequest());

      expect(isGatewayErrorResult(result)).toBe(true);
      if (isGatewayErrorResult(result)) {
        expect(result.code).toBe('INVALID_API_KEY');
      }
    });

    it('returns INVALID_API_KEY (401) when the key has been revoked', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(buildRoute() as never);
      prisma.client.findUnique.mockResolvedValue({ active: true } as never);
      prisma.apiKey.findUnique.mockResolvedValue(
        buildApiKeyRecord({ revokedAt: new Date('2026-01-01T00:00:00.000Z') }) as never,
      );

      const result = await service.handleGatewayRequest(buildValidRequest());

      expect(isGatewayErrorResult(result)).toBe(true);
      if (isGatewayErrorResult(result)) {
        expect(result.code).toBe('INVALID_API_KEY');
      }
    });

    it('returns INVALID_API_KEY (401) when the key has expired', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(buildRoute() as never);
      prisma.client.findUnique.mockResolvedValue({ active: true } as never);
      prisma.apiKey.findUnique.mockResolvedValue(
        buildApiKeyRecord({ expiresAt: new Date('2020-01-01T00:00:00.000Z') }) as never,
      );

      const result = await service.handleGatewayRequest(buildValidRequest());

      expect(isGatewayErrorResult(result)).toBe(true);
      if (isGatewayErrorResult(result)) {
        expect(result.code).toBe('INVALID_API_KEY');
      }
    });

    it('returns INVALID_API_KEY (401) when the API Key own client is inactive', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(buildRoute() as never);
      prisma.client.findUnique.mockResolvedValue({ active: true } as never);
      prisma.apiKey.findUnique.mockResolvedValue(
        buildApiKeyRecord({ client: { active: false } }) as never,
      );

      const result = await service.handleGatewayRequest(buildValidRequest());

      expect(isGatewayErrorResult(result)).toBe(true);
      if (isGatewayErrorResult(result)) {
        expect(result.code).toBe('INVALID_API_KEY');
      }
    });

    it('returns INVALID_API_KEY (401) when the key belongs to a different client than the route', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(buildRoute() as never);
      prisma.client.findUnique.mockResolvedValue({ active: true } as never);
      prisma.apiKey.findUnique.mockResolvedValue(
        buildApiKeyRecord({ clientId: OTHER_CLIENT_ID }) as never,
      );

      const result = await service.handleGatewayRequest(buildValidRequest());

      expect(isGatewayErrorResult(result)).toBe(true);
      if (isGatewayErrorResult(result)) {
        expect(result.code).toBe('INVALID_API_KEY');
      }
    });
  });

  describe('handleGatewayRequest — allowed IP', () => {
    it('returns IP_NOT_ALLOWED (403) when there are no active Allowed IPs (blocked by default)', async () => {
      setupResolutionMocks(prisma, { allowedIps: [] });

      const result = await service.handleGatewayRequest(buildValidRequest());

      expect(isGatewayErrorResult(result)).toBe(true);
      if (isGatewayErrorResult(result)) {
        expect(result.code).toBe('IP_NOT_ALLOWED');
        expect(result.statusCode).toBe(403);
      }
    });

    it('returns IP_NOT_ALLOWED (403) when no Allowed IP matches the source IP', async () => {
      setupResolutionMocks(prisma, {
        allowedIps: [{ address: '198.51.100.5', type: AllowedIpType.IPV4 }],
      });

      const result = await service.handleGatewayRequest(buildValidRequest({ ip: SOURCE_IP }));

      expect(isGatewayErrorResult(result)).toBe(true);
      if (isGatewayErrorResult(result)) {
        expect(result.code).toBe('IP_NOT_ALLOWED');
        expect(result.statusCode).toBe(403);
      }
    });

    describe('HOSTNAME entries', () => {
      const HOSTNAME = 'api.cliente.com.br';

      it('allows the request when the source IP is among the resolved addresses', async () => {
        setupResolutionMocks(prisma, {
          allowedIps: [{ address: HOSTNAME, type: AllowedIpType.HOSTNAME }],
        });
        allowedHostnameResolverService.resolve.mockResolvedValue([
          '177.207.247.1',
          SOURCE_IP,
          '200.10.10.2',
        ]);
        mockUpstreamSuccess();

        const result = await service.handleGatewayRequest(buildValidRequest({ ip: SOURCE_IP }));

        expect(isGatewayErrorResult(result)).toBe(false);
        expect(allowedHostnameResolverService.resolve).toHaveBeenCalledWith(HOSTNAME);
      });

      it('returns IP_NOT_ALLOWED when the source IP is not among the resolved addresses', async () => {
        setupResolutionMocks(prisma, {
          allowedIps: [{ address: HOSTNAME, type: AllowedIpType.HOSTNAME }],
        });
        allowedHostnameResolverService.resolve.mockResolvedValue(['200.10.10.2', '200.10.10.3']);

        const result = await service.handleGatewayRequest(buildValidRequest({ ip: SOURCE_IP }));

        expect(isGatewayErrorResult(result)).toBe(true);
        if (isGatewayErrorResult(result)) {
          expect(result.code).toBe('IP_NOT_ALLOWED');
        }
      });

      it('returns IP_NOT_ALLOWED (fail closed) when the hostname cannot be resolved', async () => {
        setupResolutionMocks(prisma, {
          allowedIps: [{ address: HOSTNAME, type: AllowedIpType.HOSTNAME }],
        });
        allowedHostnameResolverService.resolve.mockResolvedValue(null);

        const result = await service.handleGatewayRequest(buildValidRequest({ ip: SOURCE_IP }));

        expect(isGatewayErrorResult(result)).toBe(true);
        if (isGatewayErrorResult(result)) {
          expect(result.code).toBe('IP_NOT_ALLOWED');
        }
      });

      it('allows the request via a matching IP entry even when a HOSTNAME entry fails to resolve', async () => {
        setupResolutionMocks(prisma, {
          allowedIps: [
            { address: HOSTNAME, type: AllowedIpType.HOSTNAME },
            { address: SOURCE_IP, type: AllowedIpType.IPV4 },
          ],
        });
        allowedHostnameResolverService.resolve.mockResolvedValue(null);
        mockUpstreamSuccess();

        const result = await service.handleGatewayRequest(buildValidRequest({ ip: SOURCE_IP }));

        expect(isGatewayErrorResult(result)).toBe(false);
      });

      it('accepts an IPv6 address resolved for the hostname', async () => {
        const ipv6Source = '2001:db8::abcd';
        setupResolutionMocks(prisma, {
          allowedIps: [{ address: HOSTNAME, type: AllowedIpType.HOSTNAME }],
        });
        allowedHostnameResolverService.resolve.mockResolvedValue(['2001:db8::abcd']);
        mockUpstreamSuccess();

        const result = await service.handleGatewayRequest(buildValidRequest({ ip: ipv6Source }));

        expect(isGatewayErrorResult(result)).toBe(false);
      });
    });
  });

  describe('handleGatewayRequest — requiresApiKey=false', () => {
    it('proceeds without an API Key and reaches the upstream when the route does not require one', async () => {
      setupResolutionMocks(prisma, { route: buildRoute({ requiresApiKey: false }) });
      mockUpstreamSuccess(200, { ok: true });

      const result = await service.handleGatewayRequest(buildFastifyRequest());

      expect(isGatewayErrorResult(result)).toBe(false);
      if (!isGatewayErrorResult(result)) {
        expect(result.statusCode).toBe(200);
      }
      expect(requestLogsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyId: null,
          authenticationMode: RequestLogAuthenticationMode.NONE,
          result: 'SUCCESS',
        }),
      );
    });

    it('does not return API_KEY_REQUIRED when the header is missing and the route does not require it', async () => {
      setupResolutionMocks(prisma, { route: buildRoute({ requiresApiKey: false }) });
      mockUpstreamSuccess();

      const result = await service.handleGatewayRequest(buildFastifyRequest());

      if (isGatewayErrorResult(result)) {
        expect(result.code).not.toBe('API_KEY_REQUIRED');
      }
    });

    it('still returns IP_NOT_ALLOWED when the source IP is blocked, proving Allowed IP is not skipped', async () => {
      setupResolutionMocks(prisma, {
        route: buildRoute({ requiresApiKey: false }),
        allowedIps: [],
      });

      const result = await service.handleGatewayRequest(buildFastifyRequest());

      expect(isGatewayErrorResult(result)).toBe(true);
      if (isGatewayErrorResult(result)) {
        expect(result.code).toBe('IP_NOT_ALLOWED');
      }
    });

    it('still returns CLIENT_INACTIVE when the client is inactive, proving Client status is not skipped', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(
        buildRoute({ requiresApiKey: false }) as never,
      );
      prisma.client.findUnique.mockResolvedValue({ active: false } as never);

      const result = await service.handleGatewayRequest(buildFastifyRequest());

      expect(isGatewayErrorResult(result)).toBe(true);
      if (isGatewayErrorResult(result)) {
        expect(result.code).toBe('CLIENT_INACTIVE');
      }
    });

    it('still returns GATEWAY_ROUTE_NOT_FOUND when the route is inactive, proving Route status is not skipped', async () => {
      prisma.gatewayRoute.findUnique.mockResolvedValue(
        buildRoute({ requiresApiKey: false, active: false }) as never,
      );

      const result = await service.handleGatewayRequest(buildFastifyRequest());

      expect(isGatewayErrorResult(result)).toBe(true);
      if (isGatewayErrorResult(result)) {
        expect(result.code).toBe('GATEWAY_ROUTE_NOT_FOUND');
      }
    });

    it('validates a valid X-API-Key sent voluntarily and proceeds normally', async () => {
      setupResolutionMocks(prisma, { route: buildRoute({ requiresApiKey: false }) });
      mockUpstreamSuccess();

      const result = await service.handleGatewayRequest(buildValidRequest());

      expect(isGatewayErrorResult(result)).toBe(false);
      expect(requestLogsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKeyId: API_KEY_ID,
          authenticationMode: RequestLogAuthenticationMode.NONE,
        }),
      );
    });

    it('rejects with INVALID_API_KEY when an invalid X-API-Key is sent voluntarily', async () => {
      setupResolutionMocks(prisma, {
        route: buildRoute({ requiresApiKey: false }),
        apiKeyRecord: null,
      });

      const result = await service.handleGatewayRequest(buildValidRequest());

      expect(isGatewayErrorResult(result)).toBe(true);
      if (isGatewayErrorResult(result)) {
        expect(result.code).toBe('INVALID_API_KEY');
        expect(result.statusCode).toBe(401);
      }
    });
  });

  describe('handleGatewayRequest — success', () => {
    it('captures attemptedAt at request entry and reuses that same timestamp when persisting the log', async () => {
      const initialAttemptedAt = new Date('2026-08-07T00:55:57.000Z');
      const laterSystemTime = new Date('2026-08-07T01:05:00.000Z');

      jest.useFakeTimers();
      jest.setSystemTime(initialAttemptedAt);

      prisma.gatewayRoute.findUnique.mockResolvedValue(buildRoute() as never);
      prisma.client.findUnique.mockResolvedValue({ active: true } as never);
      prisma.apiKey.findUnique.mockResolvedValue(buildApiKeyRecord() as never);
      prisma.allowedIp.findMany.mockResolvedValue(
        [{ address: SOURCE_IP, type: AllowedIpType.IPV4 }] as never,
      );
      prisma.routeHeader.findMany.mockResolvedValue([] as never);
      prisma.apiKey.update.mockResolvedValue(undefined as never);
      trustedCaDispatcherService.getDispatcher.mockImplementation(async () => {
        jest.setSystemTime(laterSystemTime);
        return dispatcher;
      });
      mockUpstreamSuccess(200, { ok: true });

      try {
        await service.handleGatewayRequest(buildValidRequest());
      } finally {
        jest.useRealTimers();
      }

      expect(requestLogsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          attemptedAt: initialAttemptedAt,
        }),
      );
    });

    it('proxies the request and returns a sanitized ProxyResult on a 200 upstream response', async () => {
      setupResolutionMocks(prisma);
      mockUpstreamSuccess(200, { ok: true });

      const result = await service.handleGatewayRequest(buildValidRequest());

      expect(isGatewayErrorResult(result)).toBe(false);
      if (!isGatewayErrorResult(result)) {
        expect(result.statusCode).toBe(200);
        expect(result.attempts).toBe(1);
        expect(JSON.parse(result.body.toString())).toEqual({ ok: true });
        expect(result.headers['x-request-id']).toBe('req-1');
        expect(result.headers['content-type']).toBe('application/json');
      }

      expect(requestLogsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          attemptedAt: expect.any(Date),
          requestOrigin: RequestOrigin.PUBLIC,
          sourceHost: 'hub.wdcpartners.com.br',
          publicEndpoint: 'https://hub.wdcpartners.com.br/gateway/my-route',
          destinationHost: 'upstream.internal.test',
          result: 'SUCCESS',
          upstreamStatusCode: 200,
        }),
      );
    });

    it('retries after transient timeouts and succeeds on the 3rd attempt', async () => {
      setupResolutionMocks(prisma, { route: buildRoute({ retryCount: 2 }) });
      mockUndiciRequest
        .mockRejectedValueOnce(new undiciErrors.HeadersTimeoutError())
        .mockRejectedValueOnce(new undiciErrors.HeadersTimeoutError())
        .mockResolvedValueOnce({
          statusCode: 200,
          headers: {},
          body: { arrayBuffer: async () => Buffer.from('ok') },
        } as never);

      const result = await service.handleGatewayRequest(buildValidRequest());

      expect(isGatewayErrorResult(result)).toBe(false);
      if (!isGatewayErrorResult(result)) {
        expect(result.statusCode).toBe(200);
        expect(result.attempts).toBe(3);
      }
      expect(mockUndiciRequest).toHaveBeenCalledTimes(3);
    }, 10000);
  });

  describe('handleGatewayRequest — upstream failures', () => {
    it('returns UPSTREAM_TIMEOUT (504) once all retry attempts time out', async () => {
      setupResolutionMocks(prisma, { route: buildRoute({ retryCount: 1 }) });
      mockUndiciRequest.mockRejectedValue(new undiciErrors.HeadersTimeoutError());

      const result = await service.handleGatewayRequest(buildValidRequest());

      expect(isGatewayErrorResult(result)).toBe(true);
      if (isGatewayErrorResult(result)) {
        expect(result.code).toBe('UPSTREAM_TIMEOUT');
        expect(result.statusCode).toBe(504);
        expect(result.attempts).toBe(2);
      }
      expect(mockUndiciRequest).toHaveBeenCalledTimes(2);
      expect(getPersistedRequestLogInput(requestLogsService)).toEqual(
        expect.objectContaining({
          attemptedAt: expect.any(Date),
          errorCode: 'UPSTREAM_TIMEOUT',
          attempts: 2,
        }),
      );
    }, 10000);

    it('returns UPSTREAM_UNAVAILABLE (502) once all retry attempts fail with a connection error', async () => {
      setupResolutionMocks(prisma, { route: buildRoute({ retryCount: 0 }) });
      mockUndiciRequest.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await service.handleGatewayRequest(buildValidRequest());

      expect(isGatewayErrorResult(result)).toBe(true);
      if (isGatewayErrorResult(result)) {
        expect(result.code).toBe('UPSTREAM_UNAVAILABLE');
        expect(result.statusCode).toBe(502);
        expect(result.attempts).toBe(1);
      }
      expect(getPersistedRequestLogInput(requestLogsService)).toEqual(
        expect.objectContaining({
          attemptedAt: expect.any(Date),
          errorCode: 'UPSTREAM_UNAVAILABLE',
          attempts: 1,
        }),
      );
    });

    it('retries on 502/503/504 upstream responses and returns the raw status once retries are exhausted', async () => {
      setupResolutionMocks(prisma, { route: buildRoute({ retryCount: 1 }) });
      mockUndiciRequest.mockResolvedValue({
        statusCode: 503,
        headers: {},
        body: { arrayBuffer: async () => Buffer.from('') },
      } as never);

      const result = await service.handleGatewayRequest(buildValidRequest());

      // Exhausting retries on a retryable upstream status returns it as a normal
      // (non-GatewayErrorResult) response, not as an UPSTREAM_UNAVAILABLE error.
      expect(isGatewayErrorResult(result)).toBe(false);
      if (!isGatewayErrorResult(result)) {
        expect(result.statusCode).toBe(503);
        expect(result.attempts).toBe(2);
      }
      expect(mockUndiciRequest).toHaveBeenCalledTimes(2);
      expect(getPersistedRequestLogInput(requestLogsService)).toEqual(
        expect.objectContaining({
          attemptedAt: expect.any(Date),
          upstreamStatusCode: 503,
          attempts: 2,
        }),
      );
    }, 10000);
  });

  describe('handleGatewayRequest — attemptedAt propagation on gateway errors', () => {
    it.each([
      {
        name: 'route not found',
        setup: () => {
          prisma.gatewayRoute.findUnique.mockResolvedValue(null);
        },
        request: buildFastifyRequest(),
        expectedErrorCode: 'GATEWAY_ROUTE_NOT_FOUND',
      },
      {
        name: 'missing API Key',
        setup: () => {
          prisma.gatewayRoute.findUnique.mockResolvedValue(buildRoute() as never);
          prisma.client.findUnique.mockResolvedValue({ active: true } as never);
        },
        request: buildFastifyRequest(),
        expectedErrorCode: 'API_KEY_REQUIRED',
      },
      {
        name: 'IP blocked',
        setup: () => {
          setupResolutionMocks(prisma, { allowedIps: [] });
        },
        request: buildValidRequest(),
        expectedErrorCode: 'IP_NOT_ALLOWED',
      },
    ])('persists attemptedAt for $name', async ({ setup, request, expectedErrorCode }) => {
      setup();

      await service.handleGatewayRequest(request);

      expect(getPersistedRequestLogInput(requestLogsService)).toEqual(
        expect.objectContaining({
          attemptedAt: expect.any(Date),
          errorCode: expectedErrorCode,
        }),
      );
    });
  });

  describe('handleGatewayRequest — request forwarding', () => {
    it('classifies intranet hosts as INTERNAL in the request log', async () => {
      setupResolutionMocks(prisma);
      mockUpstreamSuccess();

      await service.handleGatewayRequest(
        buildValidRequest({
          host: 'gatewayhub.intranet.wdcnet',
          protocol: 'https',
        }),
      );

      expect(requestLogsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          requestOrigin: RequestOrigin.INTERNAL,
          sourceHost: 'gatewayhub.intranet.wdcnet',
          publicEndpoint: 'https://gatewayhub.intranet.wdcnet/gateway/my-route',
        }),
      );
    });

    it('captures a literal destination IP without needing DNS resolution', async () => {
      setupResolutionMocks(prisma, {
        route: buildRoute({ destinationUrl: 'http://10.120.0.248/webhook' }),
      });
      mockUpstreamSuccess();

      await service.handleGatewayRequest(buildValidRequest());

      expect(requestLogsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          destinationHost: '10.120.0.248',
          destinationIp: '10.120.0.248',
        }),
      );
    });

    it('does not forward a body for GET requests even when request.body is set', async () => {
      setupResolutionMocks(prisma, { route: buildRoute({ method: 'GET' }) });
      mockUpstreamSuccess();

      await service.handleGatewayRequest(
        buildValidRequest({ method: 'GET', body: { should: 'be-ignored' } }),
      );

      const [, options] = mockUndiciRequest.mock.calls[0];
      expect(options?.dispatcher).toBe(dispatcher);
      expect(options?.body).toBeUndefined();
    });

    it('decrypts and forwards active Route Headers to the upstream call', async () => {
      const encryptedValue = encryptHeaderValue('secret-value', ENCRYPTION_KEY_BUFFER);
      setupResolutionMocks(prisma, {
        routeHeaders: [{ name: 'X-Upstream-Auth', valueEncrypted: encryptedValue }],
      });
      mockUpstreamSuccess();

      await service.handleGatewayRequest(buildValidRequest());

      const [, options] = mockUndiciRequest.mock.calls[0];
      const headers = options?.headers as Record<string, string>;
      expect(headers['x-upstream-auth']).toBe('secret-value');
    });

    it('does not forward headers for Route Headers that are inactive (excluded by the query filter)', async () => {
      setupResolutionMocks(prisma, { routeHeaders: [] });
      mockUpstreamSuccess();

      await service.handleGatewayRequest(buildValidRequest());

      const [, options] = mockUndiciRequest.mock.calls[0];
      const headers = options?.headers as Record<string, string>;
      expect(headers['x-upstream-auth']).toBeUndefined();
    });

    it('converts an object body to a querystring for application/x-www-form-urlencoded requests', async () => {
      setupResolutionMocks(prisma, { route: buildRoute({ method: 'POST' }) });
      mockUpstreamSuccess();

      await service.handleGatewayRequest(
        buildValidRequest({
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: { foo: 'bar', baz: 'qux' },
        }),
      );

      const [, options] = mockUndiciRequest.mock.calls[0];
      expect(options?.body).toBe('foo=bar&baz=qux');
    });

    it('passes raw payloads to RequestLogsService so persistence can sanitize them centrally', async () => {
      setupResolutionMocks(prisma);
      mockUpstreamSuccess(200, { token: 'secret-token', ok: true });

      await service.handleGatewayRequest(
        buildValidRequest({
          headers: {
            'x-api-key': validApiKey.fullKey,
            authorization: 'Bearer super-secret',
          },
          body: {
            password: 'secret-password',
            nested: { valueEncrypted: 'ciphertext' },
          },
        }),
      );

      expect(requestLogsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          requestHeaders: expect.objectContaining({
            'x-api-key': validApiKey.fullKey,
            authorization: 'Bearer super-secret',
          }),
          requestBody: {
            password: 'secret-password',
            nested: { valueEncrypted: 'ciphertext' },
          },
          responseBody: { token: 'secret-token', ok: true },
        }),
      );
    });
  });
});
