import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const dashboardPeriodPresets = [
  'today',
  'last7days',
  'last30days',
  'last90days',
  'custom',
] as const;

export type DashboardPeriodPreset = (typeof dashboardPeriodPresets)[number];

export class DashboardPeriodDto {
  @ApiPropertyOptional({
    enum: dashboardPeriodPresets,
    default: 'last7days',
  })
  @IsOptional()
  @IsIn(dashboardPeriodPresets)
  period: DashboardPeriodPreset = 'last7days';

  @ApiPropertyOptional({
    example: '2026-08-01T00:00:00.000Z',
    description: 'Required when period is "custom".',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    example: '2026-08-31T23:59:59.999Z',
    description: 'Required when period is "custom".',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}

export class DashboardTopListQueryDto extends DashboardPeriodDto {
  @ApiPropertyOptional({
    example: 10,
    default: 10,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;
}
