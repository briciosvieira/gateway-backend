import { normalizeRouteHeaderName } from '../../../src/modules/route-headers/utils/route-header-name.util';

describe('route-header-name.util', () => {
  describe('normalizeRouteHeaderName', () => {
    it('normalizes a lowercase header name to Header-Case', () => {
      expect(normalizeRouteHeaderName('x-api-key')).toBe('X-Api-Key');
    });

    it('normalizes an uppercase header name to Header-Case', () => {
      expect(normalizeRouteHeaderName('X-API-KEY')).toBe('X-Api-Key');
    });

    it('normalizes a single-word header name', () => {
      expect(normalizeRouteHeaderName('accept')).toBe('Accept');
    });

    it('trims surrounding whitespace before normalizing', () => {
      expect(normalizeRouteHeaderName('  x-custom-header  ')).toBe('X-Custom-Header');
    });

    it('throws for an empty header name', () => {
      expect(() => normalizeRouteHeaderName('')).toThrow('The provided header name is invalid.');
    });

    it('throws for a header name containing digits or symbols', () => {
      expect(() => normalizeRouteHeaderName('x-header-1')).toThrow(
        'The provided header name is invalid.',
      );
      expect(() => normalizeRouteHeaderName('x header')).toThrow(
        'The provided header name is invalid.',
      );
    });

    it.each([
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
    ])('throws for the forbidden header "%s" regardless of casing', (forbiddenHeader) => {
      expect(() => normalizeRouteHeaderName(forbiddenHeader)).toThrow(
        'This header cannot be configured.',
      );
      expect(() => normalizeRouteHeaderName(forbiddenHeader.toUpperCase())).toThrow(
        'This header cannot be configured.',
      );
    });

    it('allows a custom header name that is not forbidden', () => {
      expect(normalizeRouteHeaderName('x-custom-tenant-id')).toBe('X-Custom-Tenant-Id');
    });
  });
});
