import type { Client, PrismaClient } from '../../../generated/prisma/client';
import { generateClientCode } from '../../../src/modules/clients/utils/client-code.util';
import { randomSuffix } from '../random-data.helper';
import type { TestDatabase } from '../test-database.helper';

export interface TestClientFactoryOptions {
  name?: string;
  code?: string;
  active?: boolean;
}

/**
 * Creates a real, persisted Client. Mirrors ClientsService.create(): the
 * code is derived from the name via generateClientCode() unless an explicit
 * override is passed — keeping the factory aligned with the real backend
 * behavior (code is never independent of the name).
 */
export async function createTestClient(
  db: TestDatabase,
  options: TestClientFactoryOptions = {},
): Promise<Client> {
  const prisma: PrismaClient = db.prisma;
  const name = options.name ?? `Test Client ${randomSuffix(8)}`;
  const code = options.code ?? generateClientCode(name);

  return prisma.client.create({
    data: {
      name,
      code,
      active: options.active ?? true,
    },
  });
}
