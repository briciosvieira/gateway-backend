import type { ApiKey, PrismaClient } from '../../../generated/prisma/client';
import { generateApiKey } from '../../../src/modules/api-keys/utils/api-key.util';
import type { TestDatabase } from '../test-database.helper';

export interface CreatedTestApiKey {
  apiKey: ApiKey;
  fullKey: string;
}

export interface TestApiKeyFactoryOptions {
  name?: string;
  active?: boolean;
  expiresAt?: Date | null;
  revokedAt?: Date | null;
}

/** Creates a real, persisted ApiKey for a client, returning the one-time full key. */
export async function createTestApiKey(
  db: TestDatabase,
  clientId: string,
  options: TestApiKeyFactoryOptions = {},
): Promise<CreatedTestApiKey> {
  const prisma: PrismaClient = db.prisma;
  const pepper = process.env.API_KEY_PEPPER;

  if (!pepper) {
    throw new Error('API_KEY_PEPPER is not configured in the test environment.');
  }

  const { fullKey, publicPrefix, hash } = generateApiKey(pepper);

  const apiKey = await prisma.apiKey.create({
    data: {
      clientId,
      name: options.name ?? 'Test API Key',
      prefix: publicPrefix,
      keyHash: hash,
      active: options.active ?? true,
      expiresAt: options.expiresAt ?? null,
      revokedAt: options.revokedAt ?? null,
    },
  });

  return { apiKey, fullKey };
}
