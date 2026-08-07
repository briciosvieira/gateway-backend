import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  PayloadTooLargeException,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { MultipartFile } from '@fastify/multipart';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { RoleCode } from '../../../generated/prisma/client';
import { CurrentRequestContext } from '../../common/decorators/request-context.decorator';
import type { RequestContext } from '../../common/interfaces/request-context.interface';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { ChangeTrustedCaStatusDto } from './dto/change-trusted-ca-status.dto';
import { FindTrustedCasQueryDto } from './dto/find-trusted-cas-query.dto';
import { TrustedCasService } from './trusted-cas.service';

const TRUSTED_CA_UPLOAD_LIMITS = {
  files: 1,
  fields: 5,
  parts: 6,
  fileSize: 1024 * 1024,
} as const;

const trustedCaResourceSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string', example: 'WDC Internal Root CA' },
    fingerprintSha256: {
      type: 'string',
      example: 'AA:BB:CC:DD:EE:FF',
    },
    subject: { type: 'string', example: 'CN=WDC Internal Root CA' },
    issuer: { type: 'string', example: 'CN=WDC Internal Root CA' },
    serialNumber: { type: 'string', example: '01AB23CD45EF' },
    validFrom: { type: 'string', format: 'date-time' },
    validTo: { type: 'string', format: 'date-time' },
    isRoot: { type: 'boolean', example: true },
    active: { type: 'boolean', example: true },
    createdById: { type: 'string', format: 'uuid' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: [
    'id',
    'name',
    'fingerprintSha256',
    'subject',
    'issuer',
    'serialNumber',
    'validFrom',
    'validTo',
    'isRoot',
    'active',
    'createdById',
    'createdAt',
    'updatedAt',
  ],
} as const;

const paginatedTrustedCaSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: trustedCaResourceSchema,
    },
    pagination: {
      type: 'object',
      properties: {
        page: { type: 'integer', example: 1 },
        limit: { type: 'integer', example: 20 },
        total: { type: 'integer', example: 1 },
        totalPages: { type: 'integer', example: 1 },
      },
      required: ['page', 'limit', 'total', 'totalPages'],
    },
    filters: {
      type: 'object',
      properties: {
        search: { type: 'string', nullable: true },
        active: { type: 'boolean', nullable: true },
        validity: {
          type: 'string',
          enum: ['valid', 'expired'],
          nullable: true,
        },
        sortBy: {
          type: 'string',
          enum: ['name', 'validTo', 'createdAt', 'updatedAt'],
        },
        sortOrder: {
          type: 'string',
          enum: ['asc', 'desc'],
        },
      },
      required: ['search', 'active', 'validity', 'sortBy', 'sortOrder'],
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

@ApiTags('Trusted CAs')
@ApiBearerAuth()
@Controller('trusted-cas')
@Roles(RoleCode.ADMIN)
export class TrustedCasController {
  constructor(private readonly trustedCasService: TrustedCasService) {}

  @Post()
  @ApiOperation({ summary: 'Upload a trusted certificate authority' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['name', 'file'],
      properties: {
        name: {
          type: 'string',
          example: 'WDC Internal Root CA',
        },
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiCreatedResponse({
    description: 'Trusted CA uploaded successfully.',
    schema: buildSuccessEnvelopeSchema(trustedCaResourceSchema),
  })
  @ApiBadRequestResponse({
    description: 'The upload payload or certificate is invalid.',
  })
  @ApiConflictResponse({
    description: 'A trusted CA with the same fingerprint already exists.',
  })
  async create(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Req() request: FastifyRequest,
  ) {
    const file = await this.readMultipartFile(request);
    const trustedCaName = this.extractTrustedCaName(file);
    const fileBuffer = await file.toBuffer();

    return this.trustedCasService.create(currentUser, requestContext, {
      name: trustedCaName,
      filename: file.filename,
      buffer: fileBuffer,
    });
  }

  @Get()
  @ApiOperation({ summary: 'List trusted CAs with pagination and filters' })
  @ApiOkResponse({
    description: 'Trusted CAs returned successfully.',
    schema: buildSuccessEnvelopeSchema(paginatedTrustedCaSchema),
  })
  findAll(@Query() query: FindTrustedCasQueryDto) {
    return this.trustedCasService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a trusted CA by ID' })
  @ApiOkResponse({
    description: 'Trusted CA returned successfully.',
    schema: buildSuccessEnvelopeSchema(trustedCaResourceSchema),
  })
  findOne(@Param('id', ParseUUIDPipe) trustedCaId: string) {
    return this.trustedCasService.findOne(trustedCaId);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Activate or deactivate a trusted CA' })
  @ApiOkResponse({
    description: 'Trusted CA status updated successfully.',
    schema: buildSuccessEnvelopeSchema(trustedCaResourceSchema),
  })
  changeStatus(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Param('id', ParseUUIDPipe) trustedCaId: string,
    @Body() dto: ChangeTrustedCaStatusDto,
  ) {
    return this.trustedCasService.changeStatus(
      currentUser,
      requestContext,
      trustedCaId,
      dto,
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a trusted CA' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({
    description: 'Trusted CA deleted successfully.',
  })
  async remove(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Param('id', ParseUUIDPipe) trustedCaId: string,
  ): Promise<void> {
    await this.trustedCasService.remove(currentUser, requestContext, trustedCaId);
  }

  private async readMultipartFile(request: FastifyRequest): Promise<MultipartFile> {
    if (!request.isMultipart()) {
      throw new BadRequestException({
        message: 'multipart/form-data is required for trusted CA uploads.',
        code: 'INVALID_MULTIPART_REQUEST',
      });
    }

    try {
      const file = await request.file({
        limits: TRUSTED_CA_UPLOAD_LIMITS,
      });

      if (!file) {
        throw new BadRequestException({
          message: 'A certificate file is required.',
          code: 'INVALID_TRUSTED_CA_UPLOAD',
        });
      }

      return file;
    } catch (error) {
      if (this.isMultipartFileTooLargeError(error)) {
        throw new PayloadTooLargeException({
          message: 'The uploaded certificate file exceeds the maximum allowed size.',
          code: 'FILE_TOO_LARGE',
        });
      }

      throw error;
    }
  }

  private extractTrustedCaName(file: MultipartFile): string {
    const rawNameField = file.fields.name;
    const fieldValue =
      rawNameField && 'value' in rawNameField && typeof rawNameField.value === 'string'
        ? rawNameField.value
        : null;

    if (!fieldValue) {
      throw new BadRequestException({
        message: 'The trusted CA name field is required.',
        code: 'INVALID_TRUSTED_CA_UPLOAD',
      });
    }

    return fieldValue;
  }

  private isMultipartFileTooLargeError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'FST_REQ_FILE_TOO_LARGE'
    );
  }
}
