import type { RouteHeader } from '../../generated/prisma/client';
import { activeGatewayRouteFixture } from './gateway-routes.fixture';

export function buildRouteHeaderFixture(overrides: Partial<RouteHeader> = {}): RouteHeader {
  return {
    id: 'route-header-fixture-id',
    gatewayRouteId: activeGatewayRouteFixture.id,
    name: 'X-Custom-Header',
    valueEncrypted: 'aXY=:dGFn:Y2lwaGVy',
    sensitive: false,
    active: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

export const nonSensitiveRouteHeaderFixture: RouteHeader = buildRouteHeaderFixture();

export const sensitiveRouteHeaderFixture: RouteHeader = buildRouteHeaderFixture({
  id: 'route-header-sensitive-fixture-id',
  name: 'X-Api-Secret',
  sensitive: true,
});
