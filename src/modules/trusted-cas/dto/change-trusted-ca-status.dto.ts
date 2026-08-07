import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class ChangeTrustedCaStatusDto {
  @ApiProperty({
    example: true,
    description: 'Defines whether the trusted CA is active.',
  })
  @IsBoolean()
  active!: boolean;
}
