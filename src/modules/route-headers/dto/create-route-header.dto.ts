import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateRouteHeaderDto {
  @ApiProperty({
    example: 'UUID_DA_GATEWAY_ROUTE',
  })
  @IsUUID()
  gatewayRouteId!: string;

  @ApiProperty({
    example: 'x-api-key',
    description: 'Header name. It will be normalized to HTTP Header-Case.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({
    example: '123456789',
    maxLength: 4000,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  value!: string;

  @ApiPropertyOptional({
    example: true,
    default: false,
    description: 'When true, the value is masked in every response.',
  })
  @IsOptional()
  @IsBoolean()
  sensitive?: boolean = false;
}
