import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateAllowedIpDto {
  @ApiProperty({
    example: '177.207.247.1',
    description:
      'IPv4/IPv6 address (e.g. "177.207.247.1"), CIDR network (e.g. "177.207.247.0/24"), or ' +
      'hostname (e.g. "api.cliente.com.br") allowed for the client. A hostname is resolved via ' +
      'forward DNS (A/AAAA) and every resulting IP is treated as allowed while the resolution ' +
      'stays cached. Only a bare hostname is accepted — no protocol, path, port or query string.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(253)
  address!: string;

  @ApiProperty({
    example: 'UUID_DO_CLIENTE',
  })
  @IsUUID()
  clientId!: string;

  @ApiPropertyOptional({
    example: 'Servidor externo do parceiro.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
