import { generateClientCode } from '../../../src/modules/clients/utils/client-code.util';

describe('client-code.util', () => {
  describe('generateClientCode', () => {
    it('converts a simple name to lowercase, hyphenated form', () => {
      expect(generateClientCode('Acme E7 Corp Renamed')).toBe('acme-e7-corp-renamed');
    });

    it('removes accents', () => {
      expect(generateClientCode('Empresa São José')).toBe('empresa-sao-jose');
    });

    it('trims, collapses multiple spaces and strips special characters', () => {
      expect(generateClientCode('  ACME   Comércio & Serviços  ')).toBe(
        'acme-comercio-servicos',
      );
    });

    it('removes standalone symbols like the ordinal indicator without leaving double hyphens', () => {
      expect(generateClientCode('Cliente Nº 01')).toBe('cliente-n-01');
    });

    it('collapses hyphens the caller already typed', () => {
      expect(generateClientCode('Multi--Word   Name')).toBe('multi-word-name');
    });

    it('strips leading and trailing hyphens', () => {
      expect(generateClientCode('-Leading and Trailing-')).toBe('leading-and-trailing');
    });

    it('returns an empty string when the name has no letters or digits', () => {
      expect(generateClientCode('!!! @@@ ###')).toBe('');
    });

    it('returns an empty string for a blank name', () => {
      expect(generateClientCode('   ')).toBe('');
    });

    it('keeps digits', () => {
      expect(generateClientCode('Partner 2026')).toBe('partner-2026');
    });

    it('is stable for a name that is already a valid code', () => {
      expect(generateClientCode('already-a-valid-code')).toBe('already-a-valid-code');
    });
  });
});
