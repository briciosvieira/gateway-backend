import { parseAllowedHostname } from '../../../src/modules/allowed-ips/utils/hostname-address.util';

describe('hostname-address.util', () => {
  describe('parseAllowedHostname', () => {
    it('accepts a well-formed hostname', () => {
      expect(parseAllowedHostname('api.cliente.com.br')).toBe('api.cliente.com.br');
    });

    it.each(['saida.parceiro.net', 'gateway.exemplo.local'])(
      'accepts %s',
      (hostname) => {
        expect(parseAllowedHostname(hostname)).toBe(hostname);
      },
    );

    it('trims surrounding whitespace', () => {
      expect(parseAllowedHostname('  api.cliente.com.br  ')).toBe('api.cliente.com.br');
    });

    it('normalizes to lowercase', () => {
      expect(parseAllowedHostname('API.Cliente.COM.br')).toBe('api.cliente.com.br');
    });

    it('rejects a value with an https:// protocol', () => {
      expect(() => parseAllowedHostname('https://api.cliente.com.br')).toThrow();
    });

    it('rejects a value with an http:// protocol', () => {
      expect(() => parseAllowedHostname('http://api.cliente.com.br')).toThrow();
    });

    it('rejects a value with a path', () => {
      expect(() => parseAllowedHostname('api.cliente.com.br/webhook')).toThrow();
    });

    it('rejects a value with a port', () => {
      expect(() => parseAllowedHostname('api.cliente.com.br:443')).toThrow();
    });

    it('rejects a value with a query string', () => {
      expect(() => parseAllowedHostname('api.cliente.com.br?token=abc')).toThrow();
    });

    it('rejects a value containing spaces', () => {
      expect(() => parseAllowedHostname('api cliente.com.br')).toThrow();
    });

    it('rejects a wildcard hostname', () => {
      expect(() => parseAllowedHostname('*.cliente.com.br')).toThrow();
    });

    it('rejects a single-label value (no dot)', () => {
      expect(() => parseAllowedHostname('localhost')).toThrow();
    });

    it('rejects a value with consecutive dots', () => {
      expect(() => parseAllowedHostname('api..cliente.com.br')).toThrow();
    });

    it('rejects a value with a purely numeric top-level label (looks like a malformed IP)', () => {
      expect(() => parseAllowedHostname('300.300.300.300')).toThrow();
    });

    it('rejects an empty value', () => {
      expect(() => parseAllowedHostname('   ')).toThrow();
    });
  });
});
