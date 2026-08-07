import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class ChangeApiKeyStatusDto {
  @ApiProperty({
    example: true,
  })
  @IsBoolean()
  active!: boolean;
}
