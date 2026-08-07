import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { FindClientResourceSummaryQueryBaseDto } from '../../../common/dto/find-client-resource-summary-query.base';

const gatewayRouteClientSummarySortFields = [
  'clientName',
  'total',
  'active',
  'inactive',
] as const;

export type GatewayRouteClientSummarySortField =
  (typeof gatewayRouteClientSummarySortFields)[number];

export class FindGatewayRouteClientsSummaryQueryDto extends FindClientResourceSummaryQueryBaseDto {
  @ApiPropertyOptional({
    enum: gatewayRouteClientSummarySortFields,
    default: 'clientName',
  })
  @IsOptional()
  @IsIn(gatewayRouteClientSummarySortFields)
  sortBy: GatewayRouteClientSummarySortField = 'clientName';
}
