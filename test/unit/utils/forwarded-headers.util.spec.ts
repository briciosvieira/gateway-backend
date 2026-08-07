import {
  buildForwardHeaders,
  sanitizeResponseHeaders,
} from '../../../src/modules/gateway-proxy/utils/forwarded-headers.util';

describe('forwarded-headers.util', () => {
  describe('buildForwardHeaders', () => {
    it('forwards allow-listed base headers', () => {
      const result = buildForwardHeaders(
        { accept: 'application/json', 'content-type': 'application/json' },
        [],
        'req-1',
        '203.0.113.10',
      );

      expect(result.accept).toBe('application/json');
      expect(result['content-type']).toBe('application/json');
    });

    it('forwards custom x- headers that are not blocked', () => {
      const result = buildForwardHeaders(
        { 'x-tenant-id': 'tenant-1' },
        [],
        'req-1',
        '203.0.113.10',
      );

      expect(result['x-tenant-id']).toBe('tenant-1');
    });

    it('never forwards x-api-key, even though it starts with x-', () => {
      const result = buildForwardHeaders({ 'x-api-key': 'ghlf_x_secret' }, [], 'req-1', '203.0.113.10');

      expect(result['x-api-key']).toBeUndefined();
    });

    it('never forwards authorization, cookie or host', () => {
      const result = buildForwardHeaders(
        { authorization: 'Bearer abc', cookie: 'session=1', host: 'internal.local' },
        [],
        'req-1',
        '203.0.113.10',
      );

      expect(result.authorization).toBeUndefined();
      expect(result.cookie).toBeUndefined();
      expect(result.host).toBeUndefined();
    });

    it('drops headers that are neither allow-listed base headers nor x- headers', () => {
      const result = buildForwardHeaders({ 'some-random-header': 'value' }, [], 'req-1', '203.0.113.10');

      expect(result['some-random-header']).toBeUndefined();
    });

    it('joins array header values with a comma', () => {
      const result = buildForwardHeaders(
        { accept: ['application/json', 'text/plain'] },
        [],
        'req-1',
        '203.0.113.10',
      );

      expect(result.accept).toBe('application/json, text/plain');
    });

    it('skips headers with an undefined value', () => {
      const result = buildForwardHeaders({ accept: undefined }, [], 'req-1', '203.0.113.10');

      expect(result.accept).toBeUndefined();
    });

    it('adds the configured route headers on top of the forwarded ones', () => {
      const result = buildForwardHeaders(
        {},
        [{ name: 'X-Custom-Header', value: 'configured-value' }],
        'req-1',
        '203.0.113.10',
      );

      expect(result['x-custom-header']).toBe('configured-value');
    });

    it('lets a configured route header override an external header with the same name', () => {
      const result = buildForwardHeaders(
        { 'x-custom-header': 'external-value' },
        [{ name: 'X-Custom-Header', value: 'configured-value' }],
        'req-1',
        '203.0.113.10',
      );

      expect(result['x-custom-header']).toBe('configured-value');
    });

    it('always adds x-gateway-request-id and x-gateway-source-ip', () => {
      const result = buildForwardHeaders({}, [], 'req-42', '203.0.113.99');

      expect(result['x-gateway-request-id']).toBe('req-42');
      expect(result['x-gateway-source-ip']).toBe('203.0.113.99');
    });
  });

  describe('sanitizeResponseHeaders', () => {
    it('forwards allow-listed base response headers', () => {
      const result = sanitizeResponseHeaders({ 'content-type': 'application/json' }, 'req-1');

      expect(result['content-type']).toBe('application/json');
    });

    it('forwards custom x- response headers that are not blocked', () => {
      const result = sanitizeResponseHeaders({ 'x-custom-response': 'value' }, 'req-1');

      expect(result['x-custom-response']).toBe('value');
    });

    it('never forwards x-gateway-request-id, x-gateway-source-ip or x-api-key from upstream', () => {
      const result = sanitizeResponseHeaders(
        {
          'x-gateway-request-id': 'spoofed',
          'x-gateway-source-ip': 'spoofed',
          'x-api-key': 'leaked',
        },
        'req-1',
      );

      expect(result['x-gateway-request-id']).toBeUndefined();
      expect(result['x-gateway-source-ip']).toBeUndefined();
      expect(result['x-api-key']).toBeUndefined();
    });

    it('never forwards set-cookie or connection-level headers', () => {
      const result = sanitizeResponseHeaders(
        { 'set-cookie': 'session=1', connection: 'keep-alive' },
        'req-1',
      );

      expect(result['set-cookie']).toBeUndefined();
      expect(result.connection).toBeUndefined();
    });

    it('drops headers that are neither allow-listed nor x- headers', () => {
      const result = sanitizeResponseHeaders({ 'some-internal-header': 'value' }, 'req-1');

      expect(result['some-internal-header']).toBeUndefined();
    });

    it('always overwrites x-request-id with the Gateway request id', () => {
      const result = sanitizeResponseHeaders({ 'x-request-id': 'upstream-value' }, 'canonical-id');

      expect(result['x-request-id']).toBe('canonical-id');
    });
  });
});
