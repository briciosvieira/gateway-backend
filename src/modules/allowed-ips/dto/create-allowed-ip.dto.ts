import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateAllowedIpDto {
  @ApiProperty({
    example: '192.168.1.10',
    description: 'IPv4, IPv6 or CIDR network allowed for the client.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
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
