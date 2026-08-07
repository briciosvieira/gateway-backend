export interface ParsedApiKey {
  prefix: string;
  fullKey: string;
}

const API_KEY_PATTERN = /^(ghlf_[0-9a-f]{8})_[A-Za-z0-9_-]+$/;

export function parseApiKey(rawApiKey: string): ParsedApiKey | null {
  const trimmedValue = rawApiKey.trim();
  const match = API_KEY_PATTERN.exec(trimmedValue);

  if (!match) {
    return null;
  }

  return {
    prefix: match[1],
    fullKey: trimmedValue,
  };
}
