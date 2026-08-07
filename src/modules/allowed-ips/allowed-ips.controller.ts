import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RoleCode } from '../../../generated/prisma/client';
import { CurrentRequestContext } from '../../common/decorators/request-context.decorator';
import type { RequestContext } from '../../common/interfaces/request-context.interface';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { AllowedIpsService } from './allowed-ips.service';
import { ChangeAllowedIpStatusDto } from './dto/change-allowed-ip-status.dto';
import { CreateAllowedIpDto } from './dto/create-allowed-ip.dto';
import { FindAllowedIpClientsSummaryQueryDto } from './dto/find-allowed-ip-clients-summary-query.dto';
import { FindAllowedIpsQueryDto } from './dto/find-allowed-ips-query.dto';
import { UpdateAllowedIpDto } from './dto/update-allowed-ip.dto';

const allowedIpClientSummaryItemSchema = {
  type: 'object',
  properties: {
    client: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string', example: 'duda N8N' },
        code: { type: 'string', example: 'DUDA_N8N' },
        active: { type: 'boolean', example: true },
      },
      required: ['id', 'name', 'code', 'active'],
    },
    total: { type: 'integer', example: 4 },
    active: { type: 'integer', example: 3 },
    inactive: { type: 'integer', example: 1 },
  },
  required: ['client', 'total', 'active', 'inactive'],
} as const;

const paginatedAllowedIpClientSummarySchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: allowedIpClientSummaryItemSchema,
    },
    pagination: {
      type: 'object',
      properties: {
        page: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 20 },
        total: { type: 'integer', example: 2 },
        totalPages: { type: 'integer', example: 1 },
      },
      required: ['page', 'limit', 'total', 'totalPages'],
    },
    filters: {
      type: 'object',
      properties: {
        search: { type: 'string', nullable: true },
        status: {
          type: 'string',
          enum: ['active', 'inactive'],
          nullable: true,
        },
        sortBy: {
          type: 'string',
          enum: ['clientName', 'total', 'active', 'inactive'],
        },
        sortOrder: {
          type: 'string',
          enum: ['asc', 'desc'],
        },
      },
      required: ['search', 'status', 'sortBy', 'sortOrder'],
    },
  },
  required: ['items', 'pagination', 'filters'],
} as const;

const buildAllowedIpEnvelopeSchema = (dataSchema: object) => ({
  type: 'object',
  properties: {
    success: { type: 'boolean', example: true },
    message: { type: 'string', example: 'Request completed successfully.' },
    data: dataSchema,
    requestId: { type: 'string', example: 'req-123' },
    timestamp: { type: 'string', format: 'date-time' },
  },
  required: ['success', 'message', 'data', 'requestId', 'timestamp'],
});

@ApiTags('Allowed IPs')
@ApiBearerAuth()
@Controller('allowed-ips')
@Roles(RoleCode.ADMIN, RoleCode.OPERATOR, RoleCode.VIEWER, RoleCode.AUDITOR)
export class AllowedIpsController {
  constructor(private readonly allowedIpsService: AllowedIpsService) {}

  @Post()
  @Roles(RoleCode.ADMIN, RoleCode.OPERATOR)
  @ApiOperation({ summary: 'Create an allowed IP or CIDR network for a client' })
  create(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Body() dto: CreateAllowedIpDto,
  ) {
    return this.allowedIpsService.create(currentUser, requestContext, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List allowed IPs with pagination and filters' })
  findAll(@Query() query: FindAllowedIpsQueryDto) {
    return this.allowedIpsService.findAll(query);
  }

  @Get('clients-summary')
  @ApiOperation({ summary: 'List Allowed IP summaries aggregated by client' })
  @ApiOkResponse({
    description: 'Allowed IP client summaries returned successfully.',
    schema: buildAllowedIpEnvelopeSchema(paginatedAllowedIpClientSummarySchema),
  })
  findClientsSummary(@Query() query: FindAllowedIpClientsSummaryQueryDto) {
    return this.allowedIpsService.findClientsSummary(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an allowed IP by ID' })
  findOne(@Param('id', ParseUUIDPipe) allowedIpId: string) {
    return this.allowedIpsService.findOne(allowedIpId);
  }

  @Patch(':id')
  @Roles(RoleCode.ADMIN, RoleCode.OPERATOR)
  @ApiOperation({ summary: 'Update an allowed IP address or description' })
  update(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Param('id', ParseUUIDPipe) allowedIpId: string,
    @Body() dto: UpdateAllowedIpDto,
  ) {
    return this.allowedIpsService.update(currentUser, requestContext, allowedIpId, dto);
  }

  @Patch(':id/status')
  @Roles(RoleCode.ADMIN, RoleCode.OPERATOR)
  @ApiOperation({ summary: 'Activate or deactivate an allowed IP' })
  changeStatus(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Param('id', ParseUUIDPipe) allowedIpId: string,
    @Body() dto: ChangeAllowedIpStatusDto,
  ) {
    return this.allowedIpsService.changeStatus(
      currentUser,
      requestContext,
      allowedIpId,
      dto,
    );
  }

  @Delete(':id')
  @Roles(RoleCode.ADMIN)
  @ApiOperation({ summary: 'Delete an allowed IP or CIDR network' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Param('id', ParseUUIDPipe) allowedIpId: string,
  ): Promise<void> {
    await this.allowedIpsService.remove(currentUser, requestContext, allowedIpId);
  }
}
