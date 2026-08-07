export function estimatePayloadSize(value: unknown): number | null {
  if (value === undefined) {
    return null;
  }

  try {
    if (value === null) {
      return null;
    }

    if (Buffer.isBuffer(value)) {
      return value.length;
    }

    if (typeof value === 'string') {
      return Buffer.byteLength(value, 'utf8');
    }

    const serialized = JSON.stringify(value);

    return serialized === undefined ? null : Buffer.byteLength(serialized, 'utf8');
  } catch {
    return null;
  }
}
