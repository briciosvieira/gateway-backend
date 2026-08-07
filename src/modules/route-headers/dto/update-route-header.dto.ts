import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateRouteHeaderDto {
  @ApiPropertyOptional({
    example: 'x-api-key',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    example: '987654321',
    maxLength: 4000,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  value?: string;

  @ApiPropertyOptional({
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  sensitive?: boolean;
}
