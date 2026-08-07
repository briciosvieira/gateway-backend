import { randomBytes } from 'node:crypto';
import {
  decryptHeaderValue,
  encryptHeaderValue,
  parseHeaderEncryptionKey,
} from '../../../src/modules/route-headers/utils/route-header-encryption.util';

describe('route-header-encryption.util', () => {
  const validHexKey = randomBytes(32).toString('hex');

  describe('parseHeaderEncryptionKey', () => {
    it('decodes a 64-character hex string into a 32-byte buffer', () => {
      const key = parseHeaderEncryptionKey(validHexKey);

      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('throws when the decoded key is not exactly 32 bytes', () => {
      const shortHexKey = randomBytes(16).toString('hex');

      expect(() => parseHeaderEncryptionKey(shortHexKey)).toThrow(
        'HEADER_ENCRYPTION_KEY must decode to exactly 32 bytes.',
      );
    });
  });

  describe('encryptHeaderValue / decryptHeaderValue', () => {
    it('round-trips a value through encryption and decryption', () => {
      const key = parseHeaderEncryptionKey(validHexKey);
      const encrypted = encryptHeaderValue('super-secret-value', key);

      expect(decryptHeaderValue(encrypted, key)).toBe('super-secret-value');
    });

    it('produces a different ciphertext each time due to a random IV', () => {
      const key = parseHeaderEncryptionKey(validHexKey);

      expect(encryptHeaderValue('same-value', key)).not.toBe(encryptHeaderValue('same-value', key));
    });

    it('produces a colon-separated base64 IV:authTag:ciphertext format', () => {
      const key = parseHeaderEncryptionKey(validHexKey);
      const encrypted = encryptHeaderValue('value', key);
      const parts = encrypted.split(':');

      expect(parts).toHaveLength(3);
      expect(() => Buffer.from(parts[0], 'base64')).not.toThrow();
    });

    it('fails to decrypt when the authentication tag has been tampered with', () => {
      const key = parseHeaderEncryptionKey(validHexKey);
      const encrypted = encryptHeaderValue('value', key);
      const [iv, , ciphertext] = encrypted.split(':');
      const tamperedAuthTag = Buffer.alloc(16, 1).toString('base64');
      const tampered = [iv, tamperedAuthTag, ciphertext].join(':');

      expect(() => decryptHeaderValue(tampered, key)).toThrow();
    });

    it('fails to decrypt with the wrong key', () => {
      const key = parseHeaderEncryptionKey(validHexKey);
      const otherKey = parseHeaderEncryptionKey(randomBytes(32).toString('hex'));
      const encrypted = encryptHeaderValue('value', key);

      expect(() => decryptHeaderValue(encrypted, otherKey)).toThrow();
    });

    it('throws for a malformed encrypted value missing segments', () => {
      const key = parseHeaderEncryptionKey(validHexKey);

      expect(() => decryptHeaderValue('only-one-segment', key)).toThrow(
        'The encrypted header value has an invalid format.',
      );
    });
  });
});
