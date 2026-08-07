import { BadRequestException } from '@nestjs/common';

export function normalizeDestinationUrl(value: string): string {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(value.trim());
  } catch {
    throw new BadRequestException('The provided destination URL is invalid.');
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new BadRequestException('The provided destination URL is invalid.');
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw new BadRequestException('The provided destination URL is invalid.');
  }

  if (parsedUrl.hash) {
    throw new BadRequestException('The provided destination URL is invalid.');
  }

  let pathname = parsedUrl.pathname;

  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  return `${parsedUrl.protocol}//${parsedUrl.host}${pathname}${parsedUrl.search}`;
}
