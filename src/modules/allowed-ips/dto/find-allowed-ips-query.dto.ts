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
import { AllowedIpType } from '../../../../generated/prisma/client';

const allowedIpSortFields = ['address', 'createdAt', 'updatedAt'] as const;

const sortDirections = ['asc', 'desc'] as const;

export type AllowedIpSortField = (typeof allowedIpSortFields)[number];

export type AllowedIpSortDirection = (typeof sortDirections)[number];

export class FindAllowedIpsQueryDto {
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
    example: '192.168',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({
    enum: AllowedIpType,
  })
  @IsOptional()
  @IsEnum(AllowedIpType)
  type?: AllowedIpType;

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
    enum: allowedIpSortFields,
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(allowedIpSortFields)
  sortBy: AllowedIpSortField = 'createdAt';

  @ApiPropertyOptional({
    enum: sortDirections,
    default: 'desc',
  })
  @IsOptional()
  @IsIn(sortDirections)
  sortOrder: AllowedIpSortDirection = 'desc';
}
