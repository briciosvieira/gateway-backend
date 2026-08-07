import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleCode } from '../../../generated/prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { DashboardService } from './dashboard.service';
import { DashboardPeriodDto, DashboardTopListQueryDto } from './dto/dashboard-period.dto';

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
@Roles(RoleCode.ADMIN, RoleCode.OPERATOR, RoleCode.AUDITOR, RoleCode.VIEWER)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  @ApiOperation({ summary: 'General counters and success/error metrics for the period' })
  getOverview(@Query() query: DashboardPeriodDto) {
    return this.dashboardService.getOverview(query);
  }

  @Get('requests-over-time')
  @ApiOperation({ summary: 'Request volume time series, automatically bucketed by period' })
  getRequestsOverTime(@Query() query: DashboardPeriodDto) {
    return this.dashboardService.getRequestsOverTime(query);
  }

  @Get('top-clients')
  @ApiOperation({ summary: 'Clients ranked by request volume in the period' })
  getTopClients(@Query() query: DashboardTopListQueryDto) {
    return this.dashboardService.getTopClients(query);
  }

  @Get('top-routes')
  @ApiOperation({ summary: 'Gateway routes ranked by request volume in the period' })
  getTopRoutes(@Query() query: DashboardTopListQueryDto) {
    return this.dashboardService.getTopRoutes(query);
  }

  @Get('status-distribution')
  @ApiOperation({ summary: 'Request count grouped by HTTP status code in the period' })
  getStatusDistribution(@Query() query: DashboardPeriodDto) {
    return this.dashboardService.getStatusDistribution(query);
  }

  @Get('top-errors')
  @ApiOperation({ summary: 'Most frequent gateway error codes in the period' })
  getTopErrors(@Query() query: DashboardTopListQueryDto) {
    return this.dashboardService.getTopErrors(query);
  }

  @Get('top-source-ips')
  @ApiOperation({ summary: 'Source IPs ranked by request volume in the period' })
  getTopSourceIps(@Query() query: DashboardTopListQueryDto) {
    return this.dashboardService.getTopSourceIps(query);
  }

  @Get('recent-requests')
  @ApiOperation({ summary: 'Last 20 request logs in the period' })
  getRecentRequests(@Query() query: DashboardPeriodDto) {
    return this.dashboardService.getRecentRequests(query);
  }

  @Get('health')
  @ApiOperation({ summary: 'Gateway and database health summary' })
  getHealth() {
    return this.dashboardService.getHealth();
  }
}
