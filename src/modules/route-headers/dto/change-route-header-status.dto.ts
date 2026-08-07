import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class ChangeRouteHeaderStatusDto {
  @ApiProperty({
    example: true,
  })
  @IsBoolean()
  active!: boolean;
}
