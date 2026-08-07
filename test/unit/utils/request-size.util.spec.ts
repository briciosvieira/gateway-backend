import { estimatePayloadSize } from '../../../src/modules/request-logs/utils/request-size.util';

describe('request-size.util', () => {
  describe('estimatePayloadSize', () => {
    it('returns null for undefined', () => {
      expect(estimatePayloadSize(undefined)).toBeNull();
    });

    it('returns null for null', () => {
      expect(estimatePayloadSize(null)).toBeNull();
    });

    it('returns the exact byte length of a Buffer', () => {
      const buffer = Buffer.from('hello world');

      expect(estimatePayloadSize(buffer)).toBe(buffer.length);
    });

    it('returns the UTF-8 byte length of a string, accounting for multi-byte characters', () => {
      expect(estimatePayloadSize('café')).toBe(Buffer.byteLength('café', 'utf8'));
      expect(estimatePayloadSize('café')).not.toBe('café'.length);
    });

    it('returns the serialized UTF-8 byte length of a plain object', () => {
      const value = { name: 'test', active: true };

      expect(estimatePayloadSize(value)).toBe(Buffer.byteLength(JSON.stringify(value), 'utf8'));
    });

    it('returns null when the value cannot be serialized (e.g. a function)', () => {
      expect(estimatePayloadSize(() => undefined)).toBeNull();
    });

    it('returns null when JSON.stringify would return undefined (e.g. a bare symbol)', () => {
      expect(estimatePayloadSize(Symbol('x'))).toBeNull();
    });
  });
});
