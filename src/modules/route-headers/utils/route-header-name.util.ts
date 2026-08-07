import { BadRequestException } from '@nestjs/common';

const FORBIDDEN_HEADER_NAMES = [
  'host',
  'content-length',
  'transfer-encoding',
  'connection',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
  'keep-alive',
  'te',
  'trailer',
  'expect',
];

const HEADER_NAME_PATTERN = /^[a-zA-Z-]+$/;

export function normalizeRouteHeaderName(value: string): string {
  const trimmedValue = value.trim();

  if (!trimmedValue || !HEADER_NAME_PATTERN.test(trimmedValue)) {
    throw new BadRequestException('The provided header name is invalid.');
  }

  const normalizedName = trimmedValue
    .toLowerCase()
    .split('-')
    .filter((segment) => segment.length > 0)
    .map((segment) => `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`)
    .join('-');

  if (!normalizedName || isForbiddenHeaderName(normalizedName)) {
    throw new BadRequestException('This header cannot be configured.');
  }

  return normalizedName;
}

function isForbiddenHeaderName(normalizedName: string): boolean {
  return FORBIDDEN_HEADER_NAMES.includes(normalizedName.toLowerCase());
}
