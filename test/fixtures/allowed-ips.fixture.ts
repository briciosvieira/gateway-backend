import { AllowedIpType } from '../../generated/prisma/client';
import type { AllowedIp } from '../../generated/prisma/client';
import { activeClientFixture } from './clients.fixture';

export function buildAllowedIpFixture(overrides: Partial<AllowedIp> = {}): AllowedIp {
  return {
    id: 'allowed-ip-fixture-id',
    clientId: activeClientFixture.id,
    address: '203.0.113.10',
    type: AllowedIpType.IPV4,
    description: null,
    active: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

export const activeAllowedIpFixture: AllowedIp = buildAllowedIpFixture();

export const cidrAllowedIpFixture: AllowedIp = buildAllowedIpFixture({
  id: 'allowed-ip-cidr-fixture-id',
  address: '203.0.113.0/24',
  type: AllowedIpType.CIDR_IPV4,
});

export const hostnameAllowedIpFixture: AllowedIp = buildAllowedIpFixture({
  id: 'allowed-ip-hostname-fixture-id',
  address: 'api.cliente.com.br',
  type: AllowedIpType.HOSTNAME,
});
