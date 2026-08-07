import { randomBytes, randomUUID } from 'node:crypto';

export function randomSuffix(length = 8): string {
  return randomBytes(length).toString('hex').slice(0, length);
}

export function randomUsername(): string {
  return `test_user_${randomSuffix(6)}`;
}

export function randomEmail(): string {
  return `test_${randomSuffix(6)}@example.test`;
}

export function randomClientCode(): string {
  return `TEST_CLIENT_${randomSuffix(6).toUpperCase()}`;
}

export function randomSlug(): string {
  return `/test-route-${randomSuffix(6)}`;
}

export function randomStrongPassword(): string {
  return `Str0ng@Pass_${randomSuffix(6)}`;
}

export function randomIpv4(): string {
  const octet = (): number => Math.floor(Math.random() * 200) + 1;

  return `${octet()}.${octet()}.${octet()}.${octet()}`;
}

export { randomUUID };
