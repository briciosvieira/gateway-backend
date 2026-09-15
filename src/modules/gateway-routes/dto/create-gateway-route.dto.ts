import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { GatewayHttpMethod } from '../../../../generated/prisma/client';

export class CreateGatewayRouteDto {
  @ApiProperty({
    example: 'Envio de WhatsApp',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(150)
  name!: string;

  @ApiProperty({
    example: '/send-whatsapp',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  slug!: string;

  @ApiProperty({
    example: 'http://n8n.interno.local/webhook/send-whatsapp',
  })
  @IsString()
  @IsNotEmpty()
  @IsUrl({
    require_protocol: true,
    protocols: ['http', 'https'],
  })
  @MaxLength(2000)
  destinationUrl!: string;

  @ApiProperty({
    enum: GatewayHttpMethod,
    example: GatewayHttpMethod.POST,
  })
  @IsEnum(GatewayHttpMethod)
  method!: GatewayHttpMethod;

  @ApiProperty({
    example: 'UUID_DO_CLIENTE',
  })
  @IsUUID()
  clientId!: string;

  @ApiPropertyOptional({
    example: 'Rota para envio de mensagens.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    example: 30000,
    default: 30000,
    minimum: 1000,
    maximum: 120000,
  })
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(120000)
  timeoutMs?: number = 30000;

  @ApiPropertyOptional({
    example: 0,
    default: 0,
    minimum: 0,
    maximum: 5,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  retryCount?: number = 0;

  @ApiPropertyOptional({
    example: true,
    default: true,
    description:
      'Whether this route requires the X-API-Key header. Defaults to true. Only ADMIN can set this to false.',
  })
  @IsOptional()
  @IsBoolean()
  requiresApiKey?: boolean = true;

  @ApiPropertyOptional({
    example: true,
    default: true,
    description:
      'Whether this route requires the source IP/hostname to match an active Allowed IP entry for the client. Defaults to true.',
  })
  @IsOptional()
  @IsBoolean()
  requiresAllowedIp?: boolean = true;
}
