import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { FindClientResourceSummaryQueryBaseDto } from '../../../common/dto/find-client-resource-summary-query.base';

const allowedIpClientSummarySortFields = [
  'clientName',
  'total',
  'active',
  'inactive',
] as const;

export type AllowedIpClientSummarySortField =
  (typeof allowedIpClientSummarySortFields)[number];

export class FindAllowedIpClientsSummaryQueryDto extends FindClientResourceSummaryQueryBaseDto {
  @ApiPropertyOptional({
    enum: allowedIpClientSummarySortFields,
    default: 'clientName',
  })
  @IsOptional()
  @IsIn(allowedIpClientSummarySortFields)
  sortBy: AllowedIpClientSummarySortField = 'clientName';
}
