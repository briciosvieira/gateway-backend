import { parseAllowedIpAddress } from '../../../src/modules/allowed-ips/utils/ip-address.util';

describe('ip-address.util', () => {
  describe('parseAllowedIpAddress', () => {
    it('normalizes a plain IPv4 address', () => {
      expect(parseAllowedIpAddress('192.168.1.10')).toEqual({
        normalizedAddress: '192.168.1.10',
        type: 'IPV4',
      });
    });

    it('normalizes a plain IPv6 address', () => {
      const result = parseAllowedIpAddress('2001:0db8::0001');

      expect(result.type).toBe('IPV6');
    });

    it('converts an IPv4 CIDR to its network address', () => {
      expect(parseAllowedIpAddress('192.168.1.50/24')).toEqual({
        normalizedAddress: '192.168.1.0/24',
        type: 'CIDR_IPV4',
      });
    });

    it('converts an IPv6 CIDR to its network address', () => {
      const result = parseAllowedIpAddress('2001:db8::1234/32');

      expect(result.type).toBe('CIDR_IPV6');
      expect(result.normalizedAddress).toBe('2001:db8::/32');
    });

    it('trims surrounding whitespace before parsing', () => {
      expect(parseAllowedIpAddress('  192.168.1.10  ')).toEqual({
        normalizedAddress: '192.168.1.10',
        type: 'IPV4',
      });
    });

    it('throws BadRequestException for an invalid address', () => {
      expect(() => parseAllowedIpAddress('not-an-ip')).toThrow(
        'The provided IP address or CIDR network is invalid.',
      );
    });

    it('throws BadRequestException for an invalid CIDR network', () => {
      expect(() => parseAllowedIpAddress('192.168.1.10/99')).toThrow(
        'The provided IP address or CIDR network is invalid.',
      );
    });

    it('throws BadRequestException for an empty string', () => {
      expect(() => parseAllowedIpAddress('')).toThrow();
    });
  });
});
