import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;

export function parseHeaderEncryptionKey(hexKey: string): Buffer {
  const key = Buffer.from(hexKey, 'hex');

  if (key.length !== KEY_LENGTH_BYTES) {
    throw new Error('HEADER_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  }

  return key;
}

export function encryptHeaderValue(value: string, encryptionKey: Buffer): string {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKey, iv);

  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv, authTag, ciphertext].map((part) => part.toString('base64')).join(':');
}

export function decryptHeaderValue(valueEncrypted: string, encryptionKey: Buffer): string {
  const [ivBase64, authTagBase64, ciphertextBase64] = valueEncrypted.split(':');

  if (!ivBase64 || !authTagBase64 || !ciphertextBase64) {
    throw new Error('The encrypted header value has an invalid format.');
  }

  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');
  const ciphertext = Buffer.from(ciphertextBase64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, encryptionKey, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return decrypted.toString('utf8');
}
