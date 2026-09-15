import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { GatewayHttpMethod } from '../../../../generated/prisma/client';

export class UpdateGatewayRouteDto {
  @ApiPropertyOptional({
    example: 'Envio de WhatsApp Produção',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({
    example: '/send-whatsapp',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  slug?: string;

  @ApiPropertyOptional({
    example: 'http://n8n.interno.local/webhook/send-whatsapp',
  })
  @IsOptional()
  @IsString()
  @IsUrl({
    require_protocol: true,
    protocols: ['http', 'https'],
  })
  @MaxLength(2000)
  destinationUrl?: string;

  @ApiPropertyOptional({
    enum: GatewayHttpMethod,
    example: GatewayHttpMethod.POST,
  })
  @IsOptional()
  @IsEnum(GatewayHttpMethod)
  method?: GatewayHttpMethod;

  @ApiPropertyOptional({
    example: 'Rota atualizada.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({
    example: 30000,
  })
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(120000)
  timeoutMs?: number;

  @ApiPropertyOptional({
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  retryCount?: number;

  @ApiPropertyOptional({
    example: false,
    description:
      'Whether this route requires the X-API-Key header. Only ADMIN can change this value.',
  })
  @IsOptional()
  @IsBoolean()
  requiresApiKey?: boolean;

  @ApiPropertyOptional({
    example: false,
    description:
      'Whether this route requires the source IP/hostname to match an active Allowed IP entry for the client.',
  })
  @IsOptional()
  @IsBoolean()
  requiresAllowedIp?: boolean;
}
