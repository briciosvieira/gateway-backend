import { generateTemporaryPassword } from '../../../src/modules/users/utils/temporary-password/temporary-password';

describe('temporary-password', () => {
  describe('generateTemporaryPassword', () => {
    it('generates a password of at least 12 characters', () => {
      expect(generateTemporaryPassword().length).toBeGreaterThanOrEqual(12);
    });

    it('always includes at least one uppercase letter', () => {
      expect(generateTemporaryPassword()).toMatch(/[A-Z]/);
    });

    it('always includes at least one lowercase letter', () => {
      expect(generateTemporaryPassword()).toMatch(/[a-z]/);
    });

    it('always includes at least one number', () => {
      expect(generateTemporaryPassword()).toMatch(/[0-9]/);
    });

    it('always includes at least one special character', () => {
      expect(generateTemporaryPassword()).toMatch(/[@#$%&*!]/);
    });

    it('never generates the same password twice in a row', () => {
      const passwords = Array.from({ length: 20 }, () => generateTemporaryPassword());

      expect(new Set(passwords).size).toBe(passwords.length);
    });

    it('only draws its 4 seed characters from sets without visually ambiguous letters', () => {
      // The random suffix comes from base64url and may still contain 0/1/O/I/l —
      // only the four guaranteed-category seed characters avoid them by design.
      for (let i = 0; i < 20; i += 1) {
        const password = generateTemporaryPassword();

        expect(password).toMatch(/[A-HJ-NP-Z]/);
        expect(password).toMatch(/[a-hj-km-z]/);
      }
    });
  });
});
