import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ChangePasswordDto } from '../../../src/modules/auth/dto/change-password.dto';

async function validateNewPassword(newPassword: string): Promise<string[]> {
  const dto = plainToInstance(ChangePasswordDto, {
    currentPassword: 'CurrentPassword@123',
    newPassword,
  });

  const errors = await validate(dto);
  const newPasswordError = errors.find((error) => error.property === 'newPassword');

  return newPasswordError ? Object.values(newPasswordError.constraints ?? {}) : [];
}

describe('password policy (ChangePasswordDto.newPassword)', () => {
  it('rejects a password shorter than 12 characters', async () => {
    const errors = await validateNewPassword('Short1@a');

    expect(errors).toContain('newPassword must have at least 12 characters.');
  });

  it('accepts a password with exactly 12 characters and full complexity', async () => {
    const errors = await validateNewPassword('Aa1!Aa1!Aa1!');

    expect(errors).toHaveLength(0);
  });

  it('rejects a password missing an uppercase letter', async () => {
    const errors = await validateNewPassword('lowercase1!only');

    expect(errors).toContain('newPassword must contain at least one uppercase letter.');
  });

  it('rejects a password missing a lowercase letter', async () => {
    const errors = await validateNewPassword('UPPERCASE1!ONLY');

    expect(errors).toContain('newPassword must contain at least one lowercase letter.');
  });

  it('rejects a password missing a number', async () => {
    const errors = await validateNewPassword('NoNumbersHere!!');

    expect(errors).toContain('newPassword must contain at least one number.');
  });

  it('rejects a password missing a special character', async () => {
    const errors = await validateNewPassword('NoSpecialChar123');

    expect(errors).toContain('newPassword must contain at least one special character.');
  });

  it('rejects a password longer than 100 characters', async () => {
    const errors = await validateNewPassword(`Aa1!${'a'.repeat(100)}`);

    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts a fully compliant, realistic password', async () => {
    const errors = await validateNewPassword('MyStrong@Passw0rd');

    expect(errors).toHaveLength(0);
  });
});
