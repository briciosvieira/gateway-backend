import { GatewayHttpMethod } from '../../generated/prisma/client';
import type { GatewayRoute } from '../../generated/prisma/client';
import { activeClientFixture } from './clients.fixture';

export function buildGatewayRouteFixture(overrides: Partial<GatewayRoute> = {}): GatewayRoute {
  return {
    id: 'gateway-route-fixture-id',
    clientId: activeClientFixture.id,
    name: 'Fixture Route',
    slug: '/fixture-route',
    description: null,
    destinationUrl: 'http://upstream.internal.test/webhook',
    method: GatewayHttpMethod.POST,
    timeoutMs: 30000,
    retryCount: 0,
    active: true,
    requiresApiKey: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

export const activeGatewayRouteFixture: GatewayRoute = buildGatewayRouteFixture();

export const inactiveGatewayRouteFixture: GatewayRoute = buildGatewayRouteFixture({
  id: 'gateway-route-inactive-fixture-id',
  slug: '/fixture-route-inactive',
  active: false,
});

export const noApiKeyGatewayRouteFixture: GatewayRoute = buildGatewayRouteFixture({
  id: 'gateway-route-no-api-key-fixture-id',
  slug: '/fixture-route-no-api-key',
  requiresApiKey: false,
});
