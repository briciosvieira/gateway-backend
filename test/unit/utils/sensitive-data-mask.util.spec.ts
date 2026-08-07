import { sanitizeForLog } from '../../../src/modules/request-logs/utils/sensitive-data-mask.util';

describe('sensitive-data-mask.util', () => {
  describe('sanitizeForLog', () => {
    it('masks known sensitive keys regardless of case', () => {
      const result = sanitizeForLog({
        Authorization: 'Bearer abc',
        'X-Api-Key': 'ghlf_x',
        password: 'secret',
        Token: 'jwt-value',
      }) as Record<string, unknown>;

      expect(result.Authorization).toBe('********');
      expect(result['X-Api-Key']).toBe('********');
      expect(result.password).toBe('********');
      expect(result.Token).toBe('********');
    });

    it('masks a sensitive key even when nested inside other keys (e.g. client_secret)', () => {
      const result = sanitizeForLog({ client_secret: 'abc', refresh_token: 'xyz' }) as Record<
        string,
        unknown
      >;

      expect(result.client_secret).toBe('********');
      expect(result.refresh_token).toBe('********');
    });

    it('never masks requestId or request_id', () => {
      const result = sanitizeForLog({ requestId: 'abc-123', request_id: 'def-456' }) as Record<
        string,
        unknown
      >;

      expect(result.requestId).toBe('abc-123');
      expect(result.request_id).toBe('def-456');
    });

    it('preserves non-sensitive keys untouched', () => {
      const result = sanitizeForLog({ method: 'POST', statusCode: 200 }) as Record<
        string,
        unknown
      >;

      expect(result.method).toBe('POST');
      expect(result.statusCode).toBe(200);
    });

    it('masks sensitive keys nested inside arrays and objects', () => {
      const result = sanitizeForLog({
        items: [{ password: 'secret1' }, { password: 'secret2' }],
      }) as { items: Array<Record<string, unknown>> };

      expect(result.items[0].password).toBe('********');
      expect(result.items[1].password).toBe('********');
    });

    it('replaces circular object references with a marker instead of throwing', () => {
      const circular: Record<string, unknown> = { name: 'test' };
      circular.self = circular;

      expect(() => sanitizeForLog(circular)).not.toThrow();
      const result = sanitizeForLog(circular) as Record<string, unknown>;
      expect(result.self).toBe('[circular]');
    });

    it('replaces circular array references with a marker instead of throwing', () => {
      const circular: unknown[] = [];
      circular.push(circular);

      const result = sanitizeForLog(circular) as unknown[];
      expect(result[0]).toBe('[circular]');
    });

    it('truncates strings longer than the maximum length', () => {
      const longString = 'a'.repeat(5000);
      const result = sanitizeForLog(longString) as string;

      expect(result.length).toBeLessThan(5000);
      expect(result.endsWith('...[truncated]')).toBe(true);
    });

    it('limits arrays to the maximum number of items and appends a summary', () => {
      const bigArray = Array.from({ length: 60 }, (_, index) => index);
      const result = sanitizeForLog(bigArray) as unknown[];

      expect(result).toHaveLength(51);
      expect(result[50]).toBe('[10 more items truncated]');
    });

    it('caps recursion depth and returns a marker beyond the maximum', () => {
      let deepObject: Record<string, unknown> = { value: 'bottom' };

      for (let i = 0; i < 10; i += 1) {
        deepObject = { nested: deepObject };
      }

      const result = sanitizeForLog(deepObject);

      expect(JSON.stringify(result)).toContain('[max depth reached]');
    });

    it('converts Buffers to a byte-length marker instead of exposing raw bytes', () => {
      const result = sanitizeForLog(Buffer.from('secret-bytes'));

      expect(result).toBe(`[binary ${Buffer.byteLength('secret-bytes')} bytes]`);
    });

    it('converts Date instances to ISO strings', () => {
      const date = new Date('2026-01-01T00:00:00.000Z');

      expect(sanitizeForLog(date)).toBe('2026-01-01T00:00:00.000Z');
    });

    it('converts functions, symbols and bigints to a type marker', () => {
      expect(sanitizeForLog(() => undefined)).toBe('[function]');
      expect(sanitizeForLog(Symbol('x'))).toBe('[symbol]');
      expect(sanitizeForLog(BigInt(10))).toBe('[bigint]');
    });

    it('converts null and undefined to null', () => {
      expect(sanitizeForLog(null)).toBeNull();
      expect(sanitizeForLog(undefined)).toBeNull();
    });

    it('converts non-finite numbers to null', () => {
      expect(sanitizeForLog(Number.NaN)).toBeNull();
      expect(sanitizeForLog(Number.POSITIVE_INFINITY)).toBeNull();
    });

    it('keeps booleans and finite numbers unchanged', () => {
      expect(sanitizeForLog(true)).toBe(true);
      expect(sanitizeForLog(42)).toBe(42);
    });
  });
});
