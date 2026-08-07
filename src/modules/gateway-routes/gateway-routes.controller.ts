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
import { ChangeGatewayRouteStatusDto } from './dto/change-gateway-route-status.dto';
import { CreateGatewayRouteDto } from './dto/create-gateway-route.dto';
import { FindGatewayRouteClientsSummaryQueryDto } from './dto/find-gateway-route-clients-summary-query.dto';
import { FindGatewayRoutesQueryDto } from './dto/find-gateway-routes-query.dto';
import { UpdateGatewayRouteDto } from './dto/update-gateway-route.dto';
import { GatewayRoutesService } from './gateway-routes.service';

const gatewayRouteClientSummaryItemSchema = {
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
    total: { type: 'integer', example: 2 },
    active: { type: 'integer', example: 2 },
    inactive: { type: 'integer', example: 0 },
  },
  required: ['client', 'total', 'active', 'inactive'],
} as const;

const paginatedGatewayRouteClientSummarySchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: gatewayRouteClientSummaryItemSchema,
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

const buildGatewayRouteEnvelopeSchema = (dataSchema: object) => ({
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

@ApiTags('Gateway Routes')
@ApiBearerAuth()
@Controller('gateway-routes')
@Roles(RoleCode.ADMIN, RoleCode.OPERATOR, RoleCode.VIEWER, RoleCode.AUDITOR)
export class GatewayRoutesController {
  constructor(private readonly gatewayRoutesService: GatewayRoutesService) {}

  @Post()
  @Roles(RoleCode.ADMIN, RoleCode.OPERATOR)
  @ApiOperation({ summary: 'Create a gateway route for a client' })
  create(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Body() dto: CreateGatewayRouteDto,
  ) {
    return this.gatewayRoutesService.create(currentUser, requestContext, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List gateway routes with pagination and filters' })
  findAll(@Query() query: FindGatewayRoutesQueryDto) {
    return this.gatewayRoutesService.findAll(query);
  }

  @Get('clients-summary')
  @ApiOperation({ summary: 'List Gateway Route summaries aggregated by client' })
  @ApiOkResponse({
    description: 'Gateway Route client summaries returned successfully.',
    schema: buildGatewayRouteEnvelopeSchema(
      paginatedGatewayRouteClientSummarySchema,
    ),
  })
  findClientsSummary(@Query() query: FindGatewayRouteClientsSummaryQueryDto) {
    return this.gatewayRoutesService.findClientsSummary(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a gateway route by ID' })
  findOne(@Param('id', ParseUUIDPipe) gatewayRouteId: string) {
    return this.gatewayRoutesService.findOne(gatewayRouteId);
  }

  @Patch(':id')
  @Roles(RoleCode.ADMIN, RoleCode.OPERATOR)
  @ApiOperation({ summary: 'Update a gateway route' })
  update(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Param('id', ParseUUIDPipe) gatewayRouteId: string,
    @Body() dto: UpdateGatewayRouteDto,
  ) {
    return this.gatewayRoutesService.update(
      currentUser,
      requestContext,
      gatewayRouteId,
      dto,
    );
  }

  @Patch(':id/status')
  @Roles(RoleCode.ADMIN, RoleCode.OPERATOR)
  @ApiOperation({ summary: 'Activate or deactivate a gateway route' })
  changeStatus(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Param('id', ParseUUIDPipe) gatewayRouteId: string,
    @Body() dto: ChangeGatewayRouteStatusDto,
  ) {
    return this.gatewayRoutesService.changeStatus(
      currentUser,
      requestContext,
      gatewayRouteId,
      dto,
    );
  }

  @Delete(':id')
  @Roles(RoleCode.ADMIN)
  @ApiOperation({
    summary: 'Delete a gateway route',
    description: 'Only ADMIN. Fails with 409 while the route still has Route Headers.',
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Param('id', ParseUUIDPipe) gatewayRouteId: string,
  ): Promise<void> {
    await this.gatewayRoutesService.remove(
      currentUser,
      requestContext,
      gatewayRouteId,
    );
  }
}
