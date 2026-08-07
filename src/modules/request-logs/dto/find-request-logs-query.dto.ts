import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { RequestLogResult, RequestOrigin } from '../../../../generated/prisma/client';

const requestLogSortFields = [
  'attemptedAt',
  'createdAt',
  'durationMs',
  'statusCode',
  'attempts',
] as const;

const sortDirections = ['asc', 'desc'] as const;

export type RequestLogSortField = (typeof requestLogSortFields)[number];

export type RequestLogSortDirection = (typeof sortDirections)[number];

export class FindRequestLogsQueryDto {
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  apiKeyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  gatewayRouteId?: string;

  @ApiPropertyOptional({
    example: '192.168.1.10',
  })
  @IsOptional()
  @IsString()
  sourceIp?: string;

  @ApiPropertyOptional({
    enum: RequestOrigin,
  })
  @IsOptional()
  @IsEnum(RequestOrigin)
  requestOrigin?: RequestOrigin;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  destinationHost?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  destinationIp?: string;

  @ApiPropertyOptional({
    example: 'POST',
  })
  @IsOptional()
  @IsString()
  method?: string;

  @ApiPropertyOptional({
    example: 200,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(599)
  statusCode?: number;

  @ApiPropertyOptional({
    enum: RequestLogResult,
  })
  @IsOptional()
  @IsEnum(RequestLogResult)
  result?: RequestLogResult;

  @ApiPropertyOptional({
    example: 'INVALID_API_KEY',
  })
  @IsOptional()
  @IsString()
  errorCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  requestId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    enum: requestLogSortFields,
    default: 'attemptedAt',
  })
  @IsOptional()
  @IsIn(requestLogSortFields)
  sortBy: RequestLogSortField = 'attemptedAt';

  @ApiPropertyOptional({
    enum: sortDirections,
    default: 'desc',
  })
  @IsOptional()
  @IsIn(sortDirections)
  sortOrder: RequestLogSortDirection = 'desc';
}
