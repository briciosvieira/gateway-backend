import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateApiKeyDto {
  @ApiProperty({
    example: 'Integração WhatsApp',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(150)
  name!: string;

  @ApiProperty({
    example: 'UUID_DO_CLIENTE',
  })
  @IsUUID()
  clientId!: string;

  @ApiPropertyOptional({
    example: '2027-08-05T23:59:59.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
