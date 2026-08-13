const MAX_HOSTNAME_LENGTH = 253;
const HOSTNAME_LABEL_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const DISALLOWED_CHARACTERS_PATTERN = /[\s/:?#*@\\]/;

/**
 * Validates and normalizes a bare hostname (trim + lowercase) for use as an
 * Allowed IP entry of type HOSTNAME. Deliberately rejects anything that
 * looks like a URL (protocol, path, port, query string) or a wildcard —
 * only a plain DNS name such as `api.cliente.com.br` is accepted.
 */
export function parseAllowedHostname(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (
    normalized.length === 0 ||
    normalized.length > MAX_HOSTNAME_LENGTH ||
    DISALLOWED_CHARACTERS_PATTERN.test(normalized) ||
    normalized.startsWith('.') ||
    normalized.endsWith('.') ||
    normalized.includes('..')
  ) {
    throw new Error('INVALID_HOSTNAME');
  }

  const labels = normalized.split('.');

  if (labels.length < 2 || labels.some((label) => !HOSTNAME_LABEL_PATTERN.test(label))) {
    throw new Error('INVALID_HOSTNAME');
  }

  const topLevelLabel = labels[labels.length - 1];

  if (/^[0-9]+$/.test(topLevelLabel)) {
    // A purely numeric last label means this was almost certainly a
    // malformed IP address (e.g. "300.300.300.300"), not a real hostname —
    // real TLDs are always alphabetic.
    throw new Error('INVALID_HOSTNAME');
  }

  return normalized;
}
