import { IsBoolean } from 'class-validator';

export class ChangePasswordRequirementDto {
  @IsBoolean()
  requirePasswordChange!: boolean;
}
