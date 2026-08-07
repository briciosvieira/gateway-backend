import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { FindClientResourceSummaryQueryBaseDto } from '../../../common/dto/find-client-resource-summary-query.base';

const apiKeyClientSummarySortFields = [
  'clientName',
  'total',
  'active',
  'inactive',
  'revoked',
] as const;

export type ApiKeyClientSummarySortField =
  (typeof apiKeyClientSummarySortFields)[number];

export class FindApiKeyClientsSummaryQueryDto extends FindClientResourceSummaryQueryBaseDto {
  @ApiPropertyOptional({
    enum: apiKeyClientSummarySortFields,
    default: 'clientName',
  })
  @IsOptional()
  @IsIn(apiKeyClientSummarySortFields)
  sortBy: ApiKeyClientSummarySortField = 'clientName';
}
