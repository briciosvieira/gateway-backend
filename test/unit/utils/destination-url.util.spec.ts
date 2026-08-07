import { normalizeDestinationUrl } from '../../../src/modules/gateway-routes/utils/destination-url.util';

describe('destination-url.util', () => {
  describe('normalizeDestinationUrl', () => {
    it('accepts a plain http URL unchanged', () => {
      expect(normalizeDestinationUrl('http://internal.local/webhook')).toBe(
        'http://internal.local/webhook',
      );
    });

    it('accepts a plain https URL unchanged', () => {
      expect(normalizeDestinationUrl('https://internal.local/webhook')).toBe(
        'https://internal.local/webhook',
      );
    });

    it('preserves the query string', () => {
      expect(normalizeDestinationUrl('http://internal.local/webhook?token=abc')).toBe(
        'http://internal.local/webhook?token=abc',
      );
    });

    it('strips a single trailing slash from a non-root path', () => {
      expect(normalizeDestinationUrl('http://internal.local/webhook/')).toBe(
        'http://internal.local/webhook',
      );
    });

    it('keeps the root path as a single slash', () => {
      expect(normalizeDestinationUrl('http://internal.local/')).toBe('http://internal.local/');
    });

    it('rejects a malformed URL', () => {
      expect(() => normalizeDestinationUrl('not a url')).toThrow(
        'The provided destination URL is invalid.',
      );
    });

    it('rejects protocols other than http/https', () => {
      expect(() => normalizeDestinationUrl('ftp://internal.local/file')).toThrow(
        'The provided destination URL is invalid.',
      );
    });

    it('rejects a URL containing embedded credentials', () => {
      expect(() => normalizeDestinationUrl('http://user:pass@internal.local/webhook')).toThrow(
        'The provided destination URL is invalid.',
      );
    });

    it('rejects a URL containing a fragment', () => {
      expect(() => normalizeDestinationUrl('http://internal.local/webhook#section')).toThrow(
        'The provided destination URL is invalid.',
      );
    });

    it('trims surrounding whitespace before validating', () => {
      expect(normalizeDestinationUrl('  http://internal.local/webhook  ')).toBe(
        'http://internal.local/webhook',
      );
    });
  });
});
