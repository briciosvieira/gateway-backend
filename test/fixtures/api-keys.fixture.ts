import type { ApiKey } from '../../generated/prisma/client';
import { activeClientFixture } from './clients.fixture';

export function buildApiKeyFixture(overrides: Partial<ApiKey> = {}): ApiKey {
  return {
    id: 'api-key-fixture-id',
    clientId: activeClientFixture.id,
    name: 'Fixture API Key',
    prefix: 'ghlf_fixture1',
    keyHash: 'fixture-hash',
    active: true,
    expiresAt: null,
    lastUsedAt: null,
    revokedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

export const activeApiKeyFixture: ApiKey = buildApiKeyFixture();

export const revokedApiKeyFixture: ApiKey = buildApiKeyFixture({
  id: 'api-key-revoked-fixture-id',
  prefix: 'ghlf_revoked1',
  active: false,
  revokedAt: new Date('2026-01-02T00:00:00.000Z'),
});
