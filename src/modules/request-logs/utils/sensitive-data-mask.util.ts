const SENSITIVE_KEYS = [
  'authorization',
  'x-api-key',
  'api-key',
  'apikey',
  'api_key',
  'cookie',
  'set-cookie',
  'password',
  'passwd',
  'secret',
  'token',
  'access_token',
  'refresh_token',
  'client_secret',
  'private_key',
  'valueencrypted',
  'value_encrypted',
  'pem',
  'certificate',
];

const EXCLUDED_FROM_MASKING = new Set(['requestid', 'request_id']);

const MASKED_VALUE = '********';
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 4000;
const TRUNCATION_SUFFIX = '...[truncated]';

export function sanitizeForLog(value: unknown): unknown {
  return sanitizeValue(value, 0, new Set());
}

function sanitizeValue(value: unknown, depth: number, seen: Set<object>): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    return truncateString(value);
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return `[binary ${value.length} bytes]`;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    return `[${typeof value}]`;
  }

  if (depth >= MAX_DEPTH) {
    return '[max depth reached]';
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return '[circular]';
    }

    seen.add(value);
    const limitedItems = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, depth + 1, seen));

    if (value.length > MAX_ARRAY_ITEMS) {
      limitedItems.push(`[${value.length - MAX_ARRAY_ITEMS} more items truncated]`);
    }

    seen.delete(value);
    return limitedItems;
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[circular]';
    }

    seen.add(value);
    const sanitizedObject: Record<string, unknown> = {};

    for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
      sanitizedObject[key] = isSensitiveKey(key)
        ? MASKED_VALUE
        : sanitizeValue(entryValue, depth + 1, seen);
    }

    seen.delete(value);
    return sanitizedObject;
  }

  return String(value);
}

function isSensitiveKey(key: string): boolean {
  const normalizedKey = key.toLowerCase();

  if (EXCLUDED_FROM_MASKING.has(normalizedKey)) {
    return false;
  }

  return SENSITIVE_KEYS.some((sensitiveKey) => normalizedKey.includes(sensitiveKey));
}

function truncateString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_STRING_LENGTH)}${TRUNCATION_SUFFIX}`;
}
