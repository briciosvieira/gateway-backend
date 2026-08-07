import { generateApiKey, hashApiKey } from '../../../src/modules/api-keys/utils/api-key.util';

describe('api-key.util', () => {
  describe('generateApiKey', () => {
    it('produces a key in the ghlf_<prefix>_<secret> format', () => {
      const result = generateApiKey('pepper');

      expect(result.fullKey).toMatch(/^ghlf_[0-9a-f]{8}_.+$/);
      expect(result.publicPrefix).toMatch(/^ghlf_[0-9a-f]{8}$/);
      expect(result.fullKey.startsWith(`${result.publicPrefix}_`)).toBe(true);
    });

    it('generates a hash consistent with hashApiKey for the same pepper', () => {
      const result = generateApiKey('pepper');

      expect(result.hash).toBe(hashApiKey(result.fullKey, 'pepper'));
    });

    it('never generates the same key twice', () => {
      const first = generateApiKey('pepper');
      const second = generateApiKey('pepper');

      expect(first.fullKey).not.toBe(second.fullKey);
      expect(first.publicPrefix).not.toBe(second.publicPrefix);
    });
  });

  describe('hashApiKey', () => {
    it('is deterministic for the same key and pepper', () => {
      expect(hashApiKey('ghlf_aaaaaaaa_secret', 'pepper')).toBe(
        hashApiKey('ghlf_aaaaaaaa_secret', 'pepper'),
      );
    });

    it('produces a different hash for a different pepper', () => {
      expect(hashApiKey('ghlf_aaaaaaaa_secret', 'pepper-a')).not.toBe(
        hashApiKey('ghlf_aaaaaaaa_secret', 'pepper-b'),
      );
    });

    it('returns a 64-character hex digest (sha256)', () => {
      expect(hashApiKey('ghlf_aaaaaaaa_secret', 'pepper')).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
