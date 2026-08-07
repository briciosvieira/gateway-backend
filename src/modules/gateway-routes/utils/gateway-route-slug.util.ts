import { BadRequestException } from '@nestjs/common';

const RESERVED_SLUG_PREFIXES = [
  '/api',
  '/api/v1',
  '/docs',
  '/health',
  '/auth',
  '/users',
  '/roles',
  '/clients',
  '/api-keys',
  '/allowed-ips',
  '/audit-logs',
];

const SLUG_CHARACTERS_PATTERN = /^[a-z0-9/_-]+$/;

export function normalizeGatewayRouteSlug(value: string): string {
  const trimmedValue = value.trim();

  if (!trimmedValue || /\s/.test(trimmedValue)) {
    throw new BadRequestException('The provided slug is invalid.');
  }

  let normalizedSlug = trimmedValue.toLowerCase();

  if (!normalizedSlug.startsWith('/')) {
    normalizedSlug = `/${normalizedSlug}`;
  }

  if (normalizedSlug.length > 1 && normalizedSlug.endsWith('/')) {
    normalizedSlug = normalizedSlug.slice(0, -1);
  }

  if (
    normalizedSlug === '/' ||
    normalizedSlug.includes('//') ||
    !SLUG_CHARACTERS_PATTERN.test(normalizedSlug) ||
    isReservedSlug(normalizedSlug)
  ) {
    throw new BadRequestException('The provided slug is invalid.');
  }

  return normalizedSlug;
}

export function buildGatewayPublicPath(slug: string): string {
  return `/gateway${slug}`;
}

function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUG_PREFIXES.some(
    (prefix) => slug === prefix || slug.startsWith(`${prefix}/`),
  );
}
