import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateAllowedIpDto {
  @ApiPropertyOptional({
    example: '192.168.1.20',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
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
