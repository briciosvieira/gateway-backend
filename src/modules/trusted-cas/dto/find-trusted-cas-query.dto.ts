import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const trustedCaSortFields = ['name', 'validTo', 'createdAt', 'updatedAt'] as const;
const trustedCaValidityFilters = ['valid', 'expired'] as const;
const sortDirections = ['asc', 'desc'] as const;

export type TrustedCaSortField = (typeof trustedCaSortFields)[number];
export type TrustedCaValidityFilter = (typeof trustedCaValidityFilters)[number];
export type TrustedCaSortDirection = (typeof sortDirections)[number];

export class FindTrustedCasQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({
    example: 'WDC Internal',
    description: 'Searches name, subject, issuer, serial number and fingerprint.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: true })
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
    enum: trustedCaValidityFilters,
    description: 'Filters trusted CAs by current certificate validity.',
  })
  @IsOptional()
  @IsIn(trustedCaValidityFilters)
  validity?: TrustedCaValidityFilter;

  @ApiPropertyOptional({ enum: trustedCaSortFields, default: 'createdAt' })
  @IsOptional()
  @IsIn(trustedCaSortFields)
  sortBy: TrustedCaSortField = 'createdAt';

  @ApiPropertyOptional({ enum: sortDirections, default: 'desc' })
  @IsOptional()
  @IsIn(sortDirections)
  sortOrder: TrustedCaSortDirection = 'desc';
}
