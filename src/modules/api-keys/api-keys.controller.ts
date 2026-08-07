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
import { ApiKeysService } from './api-keys.service';
import { ChangeApiKeyStatusDto } from './dto/change-api-key-status.dto';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { FindApiKeyClientsSummaryQueryDto } from './dto/find-api-key-clients-summary-query.dto';
import { FindApiKeysQueryDto } from './dto/find-api-keys-query.dto';
import { RegenerateApiKeyDto } from './dto/regenerate-api-key.dto';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';

const apiKeyClientSummaryItemSchema = {
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
    total: { type: 'integer', example: 5 },
    active: { type: 'integer', example: 3 },
    inactive: { type: 'integer', example: 1 },
    revoked: { type: 'integer', example: 1 },
  },
  required: ['client', 'total', 'active', 'inactive', 'revoked'],
} as const;

const paginatedApiKeyClientSummarySchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: apiKeyClientSummaryItemSchema,
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
          enum: ['clientName', 'total', 'active', 'inactive', 'revoked'],
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

const buildSuccessEnvelopeSchema = (dataSchema: object) => ({
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

@ApiTags('API Keys')
@ApiBearerAuth()
@Controller('api-keys')
@Roles(RoleCode.ADMIN, RoleCode.OPERATOR, RoleCode.VIEWER, RoleCode.AUDITOR)
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  @Roles(RoleCode.ADMIN, RoleCode.OPERATOR)
  @ApiOperation({ summary: 'Create an API Key for a client' })
  create(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Body() dto: CreateApiKeyDto,
  ) {
    return this.apiKeysService.create(currentUser, requestContext, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List API Keys with pagination and filters' })
  findAll(@Query() query: FindApiKeysQueryDto) {
    return this.apiKeysService.findAll(query);
  }

  @Get('clients-summary')
  @ApiOperation({ summary: 'List API Key summaries aggregated by client' })
  @ApiOkResponse({
    description: 'API Key client summaries returned successfully.',
    schema: buildSuccessEnvelopeSchema(paginatedApiKeyClientSummarySchema),
  })
  findClientsSummary(@Query() query: FindApiKeyClientsSummaryQueryDto) {
    return this.apiKeysService.findClientsSummary(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an API Key by ID' })
  findOne(@Param('id', ParseUUIDPipe) apiKeyId: string) {
    return this.apiKeysService.findOne(apiKeyId);
  }

  @Patch(':id')
  @Roles(RoleCode.ADMIN, RoleCode.OPERATOR)
  @ApiOperation({ summary: 'Update an API Key name or expiration' })
  update(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Param('id', ParseUUIDPipe) apiKeyId: string,
    @Body() dto: UpdateApiKeyDto,
  ) {
    return this.apiKeysService.update(currentUser, requestContext, apiKeyId, dto);
  }

  @Patch(':id/status')
  @Roles(RoleCode.ADMIN, RoleCode.OPERATOR)
  @ApiOperation({ summary: 'Activate or deactivate an API Key' })
  changeStatus(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Param('id', ParseUUIDPipe) apiKeyId: string,
    @Body() dto: ChangeApiKeyStatusDto,
  ) {
    return this.apiKeysService.changeStatus(
      currentUser,
      requestContext,
      apiKeyId,
      dto,
    );
  }

  @Post(':id/revoke')
  @Roles(RoleCode.ADMIN, RoleCode.OPERATOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Permanently revoke an API Key' })
  revoke(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Param('id', ParseUUIDPipe) apiKeyId: string,
  ) {
    return this.apiKeysService.revoke(currentUser, requestContext, apiKeyId);
  }

  @Post(':id/regenerate')
  @Roles(RoleCode.ADMIN, RoleCode.OPERATOR)
  @ApiOperation({ summary: 'Regenerate an API Key, creating a new secret' })
  regenerate(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Param('id', ParseUUIDPipe) apiKeyId: string,
    @Body() dto: RegenerateApiKeyDto,
  ) {
    return this.apiKeysService.regenerate(
      currentUser,
      requestContext,
      apiKeyId,
      dto,
    );
  }

  @Delete(':id')
  @Roles(RoleCode.ADMIN)
  @ApiOperation({ summary: 'Delete an API Key' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Param('id', ParseUUIDPipe) apiKeyId: string,
  ): Promise<void> {
    await this.apiKeysService.remove(currentUser, requestContext, apiKeyId);
  }
}
