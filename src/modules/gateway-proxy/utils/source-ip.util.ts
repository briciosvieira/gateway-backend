import * as ipaddr from 'ipaddr.js';

export function normalizeSourceIp(value: string): string {
  const trimmedValue = value.trim();

  try {
    const processedAddress = ipaddr.process(trimmedValue);

    return processedAddress.toString();
  } catch {
    return trimmedValue;
  }
}
