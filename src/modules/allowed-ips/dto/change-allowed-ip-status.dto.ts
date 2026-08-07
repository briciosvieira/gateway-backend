import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class ChangeAllowedIpStatusDto {
  @ApiProperty({
    example: true,
  })
  @IsBoolean()
  active!: boolean;
}
