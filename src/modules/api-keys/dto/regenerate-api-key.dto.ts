import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class RegenerateApiKeyDto {
  @ApiPropertyOptional({
    example: true,
    default: true,
    description: 'Defines whether the previous key must be revoked immediately.',
  })
  @IsOptional()
  @IsBoolean()
  revokePrevious?: boolean = true;
}
