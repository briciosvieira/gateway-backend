import { normalizeSourceIp } from '../../../src/modules/gateway-proxy/utils/source-ip.util';

describe('source-ip.util', () => {
  describe('normalizeSourceIp', () => {
    it('normalizes an IPv4-mapped IPv6 address to plain IPv4', () => {
      expect(normalizeSourceIp('::ffff:203.0.113.10')).toBe('203.0.113.10');
    });

    it('keeps a plain IPv4 address unchanged', () => {
      expect(normalizeSourceIp('203.0.113.10')).toBe('203.0.113.10');
    });

    it('keeps a plain IPv6 address unchanged in canonical form', () => {
      expect(normalizeSourceIp('2001:db8::1')).toBe('2001:db8::1');
    });

    it('trims surrounding whitespace', () => {
      expect(normalizeSourceIp('  203.0.113.10  ')).toBe('203.0.113.10');
    });

    it('falls back to the trimmed raw value when parsing fails', () => {
      expect(normalizeSourceIp('  not-an-ip  ')).toBe('not-an-ip');
    });
  });
});
