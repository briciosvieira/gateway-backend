import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

const routeHeaderSortFields = ['headerName', 'createdAt', 'updatedAt'] as const;

const sortDirections = ['asc', 'desc'] as const;

export type RouteHeaderSortField = (typeof routeHeaderSortFields)[number];

export type RouteHeaderSortDirection = (typeof sortDirections)[number];

function toOptionalBoolean({ value }: { value: unknown }): boolean | undefined {
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
}

export class FindRouteHeadersQueryDto {
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
    example: 'api-key',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  gatewayRouteId?: string;

  @ApiPropertyOptional({
    example: 'X-Api-Key',
  })
  @IsOptional()
  @IsString()
  headerName?: string;

  @ApiPropertyOptional({
    example: true,
  })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({
    example: true,
  })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  sensitive?: boolean;

  @ApiPropertyOptional({
    enum: routeHeaderSortFields,
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(routeHeaderSortFields)
  sortBy: RouteHeaderSortField = 'createdAt';

  @ApiPropertyOptional({
    enum: sortDirections,
    default: 'desc',
  })
  @IsOptional()
  @IsIn(sortDirections)
  sortOrder: RouteHeaderSortDirection = 'desc';
}
