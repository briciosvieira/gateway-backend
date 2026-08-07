import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { GatewayHttpMethod } from '../../../../generated/prisma/client';

const gatewayRouteSortFields = [
  'name',
  'slug',
  'createdAt',
  'updatedAt',
  'timeoutMs',
] as const;

const sortDirections = ['asc', 'desc'] as const;

export type GatewayRouteSortField = (typeof gatewayRouteSortFields)[number];

export type GatewayRouteSortDirection = (typeof sortDirections)[number];

export class FindGatewayRoutesQueryDto {
  @ApiPropertyOptional({
    example: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    example: 20,
    default: 20,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({
    example: 'whatsapp',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({
    enum: GatewayHttpMethod,
  })
  @IsOptional()
  @IsEnum(GatewayHttpMethod)
  method?: GatewayHttpMethod;

  @ApiPropertyOptional({
    example: true,
  })
  @IsOptional()
  @Transform(({ value }): boolean | undefined => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    if (value === true || value === 'true') {
      return true;
    }

    if (value === false || value === 'false') {
      return false;
    }

    return value as boolean;
  })
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    enum: gatewayRouteSortFields,
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(gatewayRouteSortFields)
  sortBy: GatewayRouteSortField = 'createdAt';

  @ApiPropertyOptional({
    enum: sortDirections,
    default: 'desc',
  })
  @IsOptional()
  @IsIn(sortDirections)
  sortOrder: GatewayRouteSortDirection = 'desc';
}
