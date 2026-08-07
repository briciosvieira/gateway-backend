import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'API_KEY_PEPPER',
  'HEADER_ENCRYPTION_KEY',
  'ALLOWED_ORIGINS',
] as const;

const DEFAULT_BODY_LIMIT_BYTES = 5 * 1024 * 1024;

const BODY_LIMIT_UNIT_MULTIPLIERS: Record<string, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
};

const BODY_LIMIT_PATTERN = /^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?$/i;

/**
 * Validates that every environment variable required for a safe boot is
 * present, and that ALLOWED_ORIGINS resolves to at least one concrete,
 * non-wildcard origin. Called before NestFactory.create() so the process
 * fails fast instead of starting with a partially-configured, insecure
 * setup.
 */
export function validateRequiredEnvVars(): void {
  const missing = REQUIRED_ENV_VARS.filter(
    (name) => !process.env[name]?.trim(),
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. The application cannot start.`,
    );
  }

  const origins = getAllowedOrigins();

  if (origins.length === 0) {
    throw new Error(
      'ALLOWED_ORIGINS did not resolve to any origin. The application cannot start.',
    );
  }

  if (origins.includes('*')) {
    throw new Error(
      'ALLOWED_ORIGINS must not contain the wildcard "*". List explicit origins instead.',
    );
  }
}

export function getAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS ?? '';

  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

export function getBodyLimit(): number {
  const raw = process.env.BODY_LIMIT?.trim();

  if (!raw) {
    return DEFAULT_BODY_LIMIT_BYTES;
  }

  const match = BODY_LIMIT_PATTERN.exec(raw);

  if (!match) {
    return DEFAULT_BODY_LIMIT_BYTES;
  }

  const [, amount, unit] = match;
  const multiplier = BODY_LIMIT_UNIT_MULTIPLIERS[(unit ?? 'B').toUpperCase()];
  const parsed = Number(amount) * multiplier;

  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_BODY_LIMIT_BYTES;
}

/**
 * Whether the app is being served over HTTPS (directly or via a
 * TLS-terminating proxy that forwards HTTPS). Controls whether HSTS is
 * sent — Strict-Transport-Security must never be sent over a plain HTTP
 * development connection.
 */
export function getHttpsEnabled(): boolean {
  return process.env.HTTPS_ENABLED?.trim().toLowerCase() === 'true';
}

/**
 * Whether X-Gateway-Version should be included in responses. Defaults to
 * enabled outside production (useful for Development/Staging) and disabled
 * in production unless explicitly turned on — the running version is
 * internal information that production responses should not volunteer.
 */
export function getExposeVersionHeader(): boolean {
  const raw = process.env.EXPOSE_VERSION_HEADER?.trim().toLowerCase();

  if (raw === 'true') {
    return true;
  }

  if (raw === 'false') {
    return false;
  }

  return process.env.NODE_ENV !== 'production';
}

export function getApplicationVersion(): string {
  try {
    const packageJsonPath = join(process.cwd(), 'package.json');
    const packageJsonContent = readFileSync(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageJsonContent) as { version?: string };

    return packageJson.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
