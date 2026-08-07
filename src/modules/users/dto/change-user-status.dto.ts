import { IsBoolean } from 'class-validator';

export class ChangeUserStatusDto {
  @IsBoolean()
  active!: boolean;
}
