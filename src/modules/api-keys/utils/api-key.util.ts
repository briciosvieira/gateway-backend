import { createHash, randomBytes } from 'node:crypto';

export interface GeneratedApiKey {
  fullKey: string;
  publicPrefix: string;
  hash: string;
}

export function generateApiKey(pepper: string): GeneratedApiKey {
  const identifier = randomBytes(4).toString('hex');
  const secret = randomBytes(32).toString('base64url');

  const publicPrefix = `ghlf_${identifier}`;
  const fullKey = `${publicPrefix}_${secret}`;
  const hash = hashApiKey(fullKey, pepper);

  return {
    fullKey,
    publicPrefix,
    hash,
  };
}

export function hashApiKey(apiKey: string, pepper: string): string {
  return createHash('sha256').update(`${apiKey}:${pepper}`).digest('hex');
}
