import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateClientDto {
  @ApiPropertyOptional({
    example: 'Parceiro Logístico Atualizado',
    description:
      'Updating the name never changes the identifier ("code") — it stays stable so existing integrations never break.',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({
    example: 'Updated integration client.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    example: 'Maria da Silva',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  contactName?: string;

  @ApiPropertyOptional({
    example: 'maria@empresa.com',
    nullable: true,
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  contactEmail?: string;
}
