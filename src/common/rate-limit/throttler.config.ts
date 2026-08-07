import type { ExecutionContext } from '@nestjs/common';
import type {
  ThrottlerGetTrackerFunction,
  ThrottlerModuleOptions,
} from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { GatewayProxyController } from '../../modules/gateway-proxy/gateway-proxy.controller';

const ONE_MINUTE_MS = 60_000;
const ADMIN_RATE_LIMIT = 100;
const DEFAULT_PROXY_RATE_LIMIT = 1000;

function isGatewayProxyRequest(context: ExecutionContext): boolean {
  return context.getClass() === GatewayProxyController;
}

function extractClientIp(request: FastifyRequest): string {
  return request.ips && request.ips.length > 0 ? request.ips[0] : request.ip;
}

const getAdminTracker: ThrottlerGetTrackerFunction = (req) =>
  extractClientIp(req as FastifyRequest);

const getProxyTracker: ThrottlerGetTrackerFunction = (req) => {
  const request = req as FastifyRequest;
  const apiKeyHeader = request.headers['x-api-key'];
  const apiKey = typeof apiKeyHeader === 'string' ? apiKeyHeader : 'no-api-key';

  return `${apiKey}:${extractClientIp(request)}`;
};

/**
 * Resolves the Gateway Proxy rate limit for a request. Currently always
 * returns the default — this is the hook where a future per-API-Key
 * `requestsPerMinute` configuration would plug in, without requiring any
 * change to the throttling wiring itself.
 */
function resolveProxyRateLimit(_context: ExecutionContext): number {
  return DEFAULT_PROXY_RATE_LIMIT;
}

export const throttlerConfig: ThrottlerModuleOptions = {
  throttlers: [
    {
      name: 'default',
      ttl: ONE_MINUTE_MS,
      limit: ADMIN_RATE_LIMIT,
      skipIf: isGatewayProxyRequest,
      getTracker: getAdminTracker,
    },
    {
      name: 'proxy',
      ttl: ONE_MINUTE_MS,
      limit: resolveProxyRateLimit,
      skipIf: (context) => !isGatewayProxyRequest(context),
      getTracker: getProxyTracker,
    },
  ],
};
