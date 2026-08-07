import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export const clientResourceSummaryStatuses = ['active', 'inactive'] as const;
export const clientResourceSummarySortDirections = ['asc', 'desc'] as const;

export type ClientResourceSummaryStatus =
  (typeof clientResourceSummaryStatuses)[number];

export type ClientResourceSummarySortDirection =
  (typeof clientResourceSummarySortDirections)[number];

export abstract class FindClientResourceSummaryQueryBaseDto {
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
    example: 'cliente-a',
    description: 'Searches client name and client code.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    enum: clientResourceSummaryStatuses,
    description:
      'Aggregated resource status: active means active count > 0; inactive means total > 0 and active count = 0.',
  })
  @IsOptional()
  @IsIn(clientResourceSummaryStatuses)
  status?: ClientResourceSummaryStatus;

  @ApiPropertyOptional({
    enum: clientResourceSummarySortDirections,
    default: 'asc',
  })
  @IsOptional()
  @IsIn(clientResourceSummarySortDirections)
  sortOrder: ClientResourceSummarySortDirection = 'asc';
}
