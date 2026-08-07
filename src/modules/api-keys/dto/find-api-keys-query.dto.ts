import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

const apiKeySortFields = [
  'name',
  'createdAt',
  'updatedAt',
  'expiresAt',
  'lastUsedAt',
] as const;

const sortDirections = ['asc', 'desc'] as const;

export type ApiKeySortField = (typeof apiKeySortFields)[number];

export type ApiKeySortDirection = (typeof sortDirections)[number];

export class FindApiKeysQueryDto {
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
    example: 'ghlf_a83f2d1c',
  })
  @IsOptional()
  @IsString()
  prefix?: string;

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiresFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  expiresTo?: string;

  @ApiPropertyOptional({
    enum: apiKeySortFields,
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(apiKeySortFields)
  sortBy: ApiKeySortField = 'createdAt';

  @ApiPropertyOptional({
    enum: sortDirections,
    default: 'desc',
  })
  @IsOptional()
  @IsIn(sortDirections)
  sortOrder: ApiKeySortDirection = 'desc';
}
