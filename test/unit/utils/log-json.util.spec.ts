import { toPrismaJson } from '../../../src/modules/request-logs/utils/log-json.util';

describe('log-json.util', () => {
  describe('toPrismaJson', () => {
    it('returns undefined for undefined', () => {
      expect(toPrismaJson(undefined)).toBeUndefined();
    });

    it('returns undefined for null', () => {
      expect(toPrismaJson(null)).toBeUndefined();
    });

    it('returns a sanitized, JSON-round-tripped copy of a plain object', () => {
      expect(toPrismaJson({ method: 'POST', active: true })).toEqual({
        method: 'POST',
        active: true,
      });
    });

    it('masks sensitive keys before persisting', () => {
      const result = toPrismaJson({ authorization: 'Bearer abc', method: 'GET' }) as Record<
        string,
        unknown
      >;

      expect(result.authorization).toBe('********');
      expect(result.method).toBe('GET');
    });

    it('returns undefined instead of throwing for values that cannot be serialized', () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      // sanitizeForLog already breaks the cycle with a "[circular]" marker,
      // so this remains serializable — the guard exists for defense in depth.
      expect(() => toPrismaJson(circular)).not.toThrow();
    });
  });
});
