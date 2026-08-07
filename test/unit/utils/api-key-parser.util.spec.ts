import { parseApiKey } from '../../../src/modules/gateway-proxy/utils/api-key-parser.util';

describe('api-key-parser.util', () => {
  describe('parseApiKey', () => {
    it('parses a well-formed key into prefix and full key', () => {
      const result = parseApiKey('ghlf_a1b2c3d4_someSecretPart-123');

      expect(result).toEqual({
        prefix: 'ghlf_a1b2c3d4',
        fullKey: 'ghlf_a1b2c3d4_someSecretPart-123',
      });
    });

    it('trims surrounding whitespace before matching', () => {
      const result = parseApiKey('  ghlf_a1b2c3d4_secret  ');

      expect(result).toEqual({
        prefix: 'ghlf_a1b2c3d4',
        fullKey: 'ghlf_a1b2c3d4_secret',
      });
    });

    it('returns null when the prefix is not 8 lowercase hex characters', () => {
      expect(parseApiKey('ghlf_ZZZZZZZZ_secret')).toBeNull();
      expect(parseApiKey('ghlf_abc_secret')).toBeNull();
    });

    it('returns null when the ghlf_ marker is missing', () => {
      expect(parseApiKey('a1b2c3d4_secret')).toBeNull();
    });

    it('returns null when there is no secret segment', () => {
      expect(parseApiKey('ghlf_a1b2c3d4')).toBeNull();
      expect(parseApiKey('ghlf_a1b2c3d4_')).toBeNull();
    });

    it('returns null for an empty string', () => {
      expect(parseApiKey('')).toBeNull();
    });

    it('rejects secrets containing characters outside the allowed set', () => {
      expect(parseApiKey('ghlf_a1b2c3d4_has space')).toBeNull();
    });
  });
});
