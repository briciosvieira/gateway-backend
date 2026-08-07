import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @MinLength(12, {
    message: 'newPassword must have at least 12 characters.',
  })
  @MaxLength(100)
  @Matches(/[A-Z]/, {
    message: 'newPassword must contain at least one uppercase letter.',
  })
  @Matches(/[a-z]/, {
    message: 'newPassword must contain at least one lowercase letter.',
  })
  @Matches(/[0-9]/, {
    message: 'newPassword must contain at least one number.',
  })
  @Matches(/[^A-Za-z0-9]/, {
    message: 'newPassword must contain at least one special character.',
  })
  newPassword!: string;
}
