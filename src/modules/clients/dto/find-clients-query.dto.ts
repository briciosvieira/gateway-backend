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

const clientSortFields = ['name', 'code', 'createdAt', 'updatedAt'] as const;

const sortDirections = ['asc', 'desc'] as const;

export type ClientSortField = (typeof clientSortFields)[number];

export type SortDirection = (typeof sortDirections)[number];

export class FindClientsQueryDto {
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
    example: 'logistica',
    description: 'Searches name, code, contact name and contact email.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    example: 'Parceiro',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    example: 'PARCEIRO_LOGISTICO',
  })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({
    example: 'João',
  })
  @IsOptional()
  @IsString()
  contactName?: string;

  @ApiPropertyOptional({
    example: '@empresa.com',
  })
  @IsOptional()
  @IsString()
  contactEmail?: string;

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
    enum: clientSortFields,
    default: 'createdAt',
  })
  @IsOptional()
  @IsIn(clientSortFields)
  sortBy: ClientSortField = 'createdAt';

  @ApiPropertyOptional({
    enum: sortDirections,
    default: 'desc',
  })
  @IsOptional()
  @IsIn(sortDirections)
  sortOrder: SortDirection = 'desc';
}
