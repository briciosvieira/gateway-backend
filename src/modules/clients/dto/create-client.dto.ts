import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateClientDto {
  @ApiProperty({
    example: 'Parceiro Logístico',
    description:
      'Client display name. The unique identifier ("code", shown to the frontend as "Identificador") is generated automatically from this name and can never be set by the caller.',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(150)
  name!: string;

  @ApiPropertyOptional({
    example: 'Client used by the logistics integration.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    example: 'João da Silva',
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  contactName?: string;

  @ApiPropertyOptional({
    example: 'joao@empresa.com',
  })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  contactEmail?: string;
}
