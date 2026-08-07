import type { Client } from '../../generated/prisma/client';

export function buildClientFixture(overrides: Partial<Client> = {}): Client {
  return {
    id: 'client-fixture-id',
    name: 'Fixture Client',
    code: 'FIXTURE_CLIENT',
    description: null,
    contactName: null,
    contactEmail: null,
    active: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

export const activeClientFixture: Client = buildClientFixture();

export const inactiveClientFixture: Client = buildClientFixture({
  id: 'client-inactive-fixture-id',
  code: 'INACTIVE_CLIENT',
  active: false,
});
