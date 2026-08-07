import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RoleCode } from '../../../generated/prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditLogsService } from './audit-logs.service';
import { FindAuditLogsQueryDto } from './dto/find-audit-logs-query.dto';

@ApiTags('Audit Logs')
@ApiBearerAuth()
@Controller('audit-logs')
@Roles(RoleCode.ADMIN, RoleCode.AUDITOR, RoleCode.OPERATOR)
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @ApiOperation({ summary: 'List audit logs with pagination and filters' })
  @Get()
  findAll(@Query() query: FindAuditLogsQueryDto) {
    return this.auditLogsService.findAll(query);
  }

  @ApiOperation({ summary: 'Get an audit log by ID' })
  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const auditLog = await this.auditLogsService.findOne(id);

    if (!auditLog) {
      throw new NotFoundException('Audit log was not found.');
    }

    return auditLog;
  }
}
