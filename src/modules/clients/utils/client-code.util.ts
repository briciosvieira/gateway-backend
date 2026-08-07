const DIACRITICS_PATTERN = /[̀-ͯ]/g;
const DISALLOWED_CHARACTERS_PATTERN = /[^a-z0-9\s-]/g;
const WHITESPACE_OR_HYPHEN_RUN_PATTERN = /[\s-]+/g;
const LEADING_OR_TRAILING_HYPHENS_PATTERN = /^-+|-+$/g;

/**
 * Derives a URL/identifier-safe client code from its display name: strips
 * accents, lowercases, drops any character outside a-z0-9, and collapses
 * whitespace/hyphen runs into a single hyphen. Returns an empty string when
 * the name has no ASCII letters or digits at all — callers must treat that
 * as invalid, since an empty code is never acceptable.
 */
export function generateClientCode(name: string): string {
  const withoutDiacritics = name
    .trim()
    .normalize('NFD')
    .replace(DIACRITICS_PATTERN, '');

  const sanitized = withoutDiacritics
    .toLowerCase()
    .replace(DISALLOWED_CHARACTERS_PATTERN, '');

  const hyphenated = sanitized.replace(WHITESPACE_OR_HYPHEN_RUN_PATTERN, '-');

  return hyphenated.replace(LEADING_OR_TRAILING_HYPHENS_PATTERN, '');
}
