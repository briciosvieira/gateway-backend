import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateApiKeyDto {
  @ApiPropertyOptional({
    example: 'Integração WhatsApp Produção',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({
    example: '2027-08-05T23:59:59.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
