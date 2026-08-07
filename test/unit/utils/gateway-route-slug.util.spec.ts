import {
  buildGatewayPublicPath,
  normalizeGatewayRouteSlug,
} from '../../../src/modules/gateway-routes/utils/gateway-route-slug.util';

describe('gateway-route-slug.util', () => {
  describe('normalizeGatewayRouteSlug', () => {
    it('lowercases the slug', () => {
      expect(normalizeGatewayRouteSlug('/Send-WhatsApp')).toBe('/send-whatsapp');
    });

    it('adds a leading slash when missing', () => {
      expect(normalizeGatewayRouteSlug('send-whatsapp')).toBe('/send-whatsapp');
    });

    it('strips a single trailing slash', () => {
      expect(normalizeGatewayRouteSlug('/send-whatsapp/')).toBe('/send-whatsapp');
    });

    it('allows nested path segments', () => {
      expect(normalizeGatewayRouteSlug('/integrations/send-whatsapp')).toBe(
        '/integrations/send-whatsapp',
      );
    });

    it('throws for an empty slug', () => {
      expect(() => normalizeGatewayRouteSlug('')).toThrow('The provided slug is invalid.');
    });

    it('throws for a slug containing whitespace', () => {
      expect(() => normalizeGatewayRouteSlug('/send whatsapp')).toThrow(
        'The provided slug is invalid.',
      );
    });

    it('throws for the root slug "/"', () => {
      expect(() => normalizeGatewayRouteSlug('/')).toThrow('The provided slug is invalid.');
    });

    it('throws for a slug containing a double slash', () => {
      expect(() => normalizeGatewayRouteSlug('/send//whatsapp')).toThrow(
        'The provided slug is invalid.',
      );
    });

    it('throws for a slug containing disallowed characters', () => {
      expect(() => normalizeGatewayRouteSlug('/send?whatsapp')).toThrow(
        'The provided slug is invalid.',
      );
    });

    it.each([
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
    ])('throws for the reserved administrative prefix %s', (reservedSlug) => {
      expect(() => normalizeGatewayRouteSlug(reservedSlug)).toThrow(
        'The provided slug is invalid.',
      );
    });

    it('throws for a slug nested under a reserved prefix', () => {
      expect(() => normalizeGatewayRouteSlug('/auth/login')).toThrow(
        'The provided slug is invalid.',
      );
    });

    it('does not throw for a slug that merely starts with the same letters as a reserved prefix', () => {
      expect(() => normalizeGatewayRouteSlug('/authentication')).not.toThrow();
    });
  });

  describe('buildGatewayPublicPath', () => {
    it('prefixes the slug with /gateway', () => {
      expect(buildGatewayPublicPath('/send-whatsapp')).toBe('/gateway/send-whatsapp');
    });
  });
});
