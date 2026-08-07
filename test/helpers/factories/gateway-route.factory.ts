import type { GatewayRoute, PrismaClient } from '../../../generated/prisma/client';
import { GatewayHttpMethod } from '../../../generated/prisma/client';
import { randomSlug } from '../random-data.helper';
import type { TestDatabase } from '../test-database.helper';

export interface TestGatewayRouteFactoryOptions {
  name?: string;
  slug?: string;
  destinationUrl?: string;
  method?: GatewayHttpMethod;
  active?: boolean;
  timeoutMs?: number;
  retryCount?: number;
}

/** Creates a real, persisted GatewayRoute for a client. */
export async function createTestGatewayRoute(
  db: TestDatabase,
  clientId: string,
  options: TestGatewayRouteFactoryOptions = {},
): Promise<GatewayRoute> {
  const prisma: PrismaClient = db.prisma;
  const slug = options.slug ?? randomSlug();

  return prisma.gatewayRoute.create({
    data: {
      clientId,
      name: options.name ?? `Test Route ${slug}`,
      slug,
      destinationUrl: options.destinationUrl ?? 'http://127.0.0.1:9/unused',
      method: options.method ?? GatewayHttpMethod.GET,
      active: options.active ?? true,
      timeoutMs: options.timeoutMs ?? 5000,
      retryCount: options.retryCount ?? 0,
    },
  });
}
