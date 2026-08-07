import type { ResolvedRouteHeader } from '../interfaces/resolved-gateway-request.interface';

const ALLOWED_FORWARD_HEADER_NAMES = new Set([
  'accept',
  'accept-language',
  'content-type',
  'user-agent',
  'x-request-id',
]);

const BLOCKED_FORWARD_X_HEADER_NAMES = new Set([
  'x-api-key',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
]);

const ALWAYS_REMOVED_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
  'keep-alive',
  'te',
  'trailer',
  'expect',
]);

const ALLOWED_RESPONSE_HEADER_NAMES = new Set([
  'content-type',
  'content-disposition',
  'cache-control',
  'etag',
  'last-modified',
  'location',
  'retry-after',
]);

const BLOCKED_RESPONSE_X_HEADER_NAMES = new Set([
  'x-gateway-request-id',
  'x-gateway-source-ip',
  'x-api-key',
]);

const ALWAYS_REMOVED_RESPONSE_HEADER_NAMES = new Set([
  'set-cookie',
  'connection',
  'transfer-encoding',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'trailer',
  'upgrade',
]);

export function buildForwardHeaders(
  incomingHeaders: Record<string, string | string[] | undefined>,
  routeHeaders: ResolvedRouteHeader[],
  requestId: string,
  sourceIp: string,
): Record<string, string> {
  const forwardHeaders: Record<string, string> = {};

  for (const [rawName, rawValue] of Object.entries(incomingHeaders)) {
    const name = rawName.toLowerCase();

    if (ALWAYS_REMOVED_HEADER_NAMES.has(name) || rawValue === undefined) {
      continue;
    }

    const isAllowedBaseHeader = ALLOWED_FORWARD_HEADER_NAMES.has(name);
    const isAllowedCustomHeader =
      name.startsWith('x-') && !BLOCKED_FORWARD_X_HEADER_NAMES.has(name);

    if (!isAllowedBaseHeader && !isAllowedCustomHeader) {
      continue;
    }

    forwardHeaders[name] = Array.isArray(rawValue) ? rawValue.join(', ') : rawValue;
  }

  // Headers configured on the route take precedence over external headers with the same name.
  for (const header of routeHeaders) {
    forwardHeaders[header.name.toLowerCase()] = header.value;
  }

  forwardHeaders['x-gateway-request-id'] = requestId;
  forwardHeaders['x-gateway-source-ip'] = sourceIp;

  return forwardHeaders;
}

export function sanitizeResponseHeaders(
  upstreamHeaders: Record<string, string | string[] | undefined>,
  requestId: string,
): Record<string, string | string[]> {
  const sanitizedHeaders: Record<string, string | string[]> = {};

  for (const [rawName, value] of Object.entries(upstreamHeaders)) {
    const name = rawName.toLowerCase();

    if (ALWAYS_REMOVED_RESPONSE_HEADER_NAMES.has(name) || value === undefined) {
      continue;
    }

    const isAllowedBaseHeader = ALLOWED_RESPONSE_HEADER_NAMES.has(name);
    const isAllowedCustomHeader =
      name.startsWith('x-') && !BLOCKED_RESPONSE_X_HEADER_NAMES.has(name);

    if (!isAllowedBaseHeader && !isAllowedCustomHeader) {
      continue;
    }

    sanitizedHeaders[name] = value;
  }

  sanitizedHeaders['x-request-id'] = requestId;

  return sanitizedHeaders;
}
