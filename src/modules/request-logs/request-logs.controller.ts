import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleCode } from '../../../generated/prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { FindRequestLogsQueryDto } from './dto/find-request-logs-query.dto';
import { RequestLogsService } from './request-logs.service';

@ApiTags('Request Logs')
@ApiBearerAuth()
@Controller('request-logs')
@Roles(RoleCode.ADMIN, RoleCode.OPERATOR, RoleCode.AUDITOR)
export class RequestLogsController {
  constructor(private readonly requestLogsService: RequestLogsService) {}

  @Get()
  @ApiOperation({ summary: 'List request logs with pagination, filters and search' })
  findAll(@Query() query: FindRequestLogsQueryDto) {
    return this.requestLogsService.findAll(query);
  }

  @Get('by-request-id/:requestId')
  @ApiOperation({ summary: 'Get a request log by its Request ID' })
  findByRequestId(@Param('requestId') requestId: string) {
    return this.requestLogsService.findByRequestId(requestId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a request log by ID' })
  findOne(@Param('id', ParseUUIDPipe) requestLogId: string) {
    return this.requestLogsService.findOne(requestLogId);
  }
}
