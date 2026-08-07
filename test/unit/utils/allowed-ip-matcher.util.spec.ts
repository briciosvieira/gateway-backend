import { sourceIpMatchesAllowedIp } from '../../../src/modules/gateway-proxy/utils/allowed-ip-matcher.util';

describe('allowed-ip-matcher.util', () => {
  describe('sourceIpMatchesAllowedIp', () => {
    it('matches an exact IPv4 address', () => {
      expect(
        sourceIpMatchesAllowedIp('203.0.113.10', { address: '203.0.113.10', type: 'IPV4' }),
      ).toBe(true);
    });

    it('does not match a different IPv4 address', () => {
      expect(
        sourceIpMatchesAllowedIp('203.0.113.11', { address: '203.0.113.10', type: 'IPV4' }),
      ).toBe(false);
    });

    it('matches an exact IPv6 address', () => {
      expect(
        sourceIpMatchesAllowedIp('2001:db8::1', { address: '2001:db8::1', type: 'IPV6' }),
      ).toBe(true);
    });

    it('matches an IPv4 address inside a CIDR_IPV4 network', () => {
      expect(
        sourceIpMatchesAllowedIp('203.0.113.55', { address: '203.0.113.0/24', type: 'CIDR_IPV4' }),
      ).toBe(true);
    });

    it('does not match an IPv4 address outside a CIDR_IPV4 network', () => {
      expect(
        sourceIpMatchesAllowedIp('203.0.114.55', { address: '203.0.113.0/24', type: 'CIDR_IPV4' }),
      ).toBe(false);
    });

    it('matches an IPv6 address inside a CIDR_IPV6 network', () => {
      expect(
        sourceIpMatchesAllowedIp('2001:db8::abcd', {
          address: '2001:db8::/32',
          type: 'CIDR_IPV6',
        }),
      ).toBe(true);
    });

    it('returns false when comparing an IPv4 source against an IPv6 CIDR network', () => {
      expect(
        sourceIpMatchesAllowedIp('203.0.113.10', { address: '2001:db8::/32', type: 'CIDR_IPV6' }),
      ).toBe(false);
    });

    it('returns false instead of throwing for a malformed source IP', () => {
      expect(
        sourceIpMatchesAllowedIp('not-an-ip', { address: '203.0.113.0/24', type: 'CIDR_IPV4' }),
      ).toBe(false);
    });

    it('returns false instead of throwing for a malformed CIDR network', () => {
      expect(
        sourceIpMatchesAllowedIp('203.0.113.10', { address: 'not-a-network', type: 'CIDR_IPV4' }),
      ).toBe(false);
    });
  });
});
