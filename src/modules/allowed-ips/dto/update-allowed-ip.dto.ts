import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateAllowedIpDto {
  @ApiPropertyOptional({
    example: '192.168.1.20',
    description:
      'IPv4/IPv6 address, CIDR network, or hostname (e.g. "api.cliente.com.br") allowed for ' +
      'the client. See CreateAllowedIpDto for the full format rules.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(253)
  address?: string;

  @ApiPropertyOptional({
    example: 'Novo servidor externo do parceiro.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
