import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class ChangeClientStatusDto {
  @ApiProperty({
    example: true,
    description: 'Defines whether the client is active.',
  })
  @IsBoolean()
  active!: boolean;
}
