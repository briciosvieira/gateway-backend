import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Patch,
  PayloadTooLargeException,
  Post,
  Req,
} from '@nestjs/common';
import type { MultipartFile } from '@fastify/multipart';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
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
import { BrandingService } from './branding.service';
import {
  BRANDING_UPLOAD_LIMITS,
  type BrandingAssetKey,
} from './branding.constants';
import { UpdateBrandingDto } from './dto/update-branding.dto';

const publicBrandingSchema = {
  type: 'object',
  properties: {
    applicationName: { type: 'string', example: 'Gateway Hub LF' },
    logoUrl: {
      type: 'string',
      nullable: true,
      example: '/api/v1/branding/assets/logo?v=abc123',
    },
    faviconUrl: {
      type: 'string',
      nullable: true,
      example: '/api/v1/branding/assets/favicon?v=abc123',
    },
    brandImageUrl: {
      type: 'string',
      nullable: true,
      example: '/api/v1/branding/assets/brand-image?v=abc123',
    },
    updatedAt: { type: 'string', format: 'date-time', nullable: true },
  },
  required: [
    'applicationName',
    'logoUrl',
    'faviconUrl',
    'brandImageUrl',
    'updatedAt',
  ],
} as const;

const multipartFileSchema = {
  type: 'object',
  required: ['file'] as string[],
  properties: {
    file: {
      type: 'string',
      format: 'binary',
    },
  },
};

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

@ApiTags('Branding')
@ApiBearerAuth()
@Controller('branding')
@Roles(RoleCode.ADMIN)
export class BrandingAdminController {
  constructor(private readonly brandingService: BrandingService) {}

  @Patch()
  @ApiOperation({ summary: 'Update the global application branding name' })
  @ApiOkResponse({
    description: 'Branding name updated successfully.',
    schema: buildSuccessEnvelopeSchema(publicBrandingSchema),
  })
  updateApplicationName(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Body() dto: UpdateBrandingDto,
  ) {
    return this.brandingService.updateApplicationName(
      currentUser,
      requestContext,
      dto,
    );
  }

  @Post('logo')
  @ApiOperation({ summary: 'Upload or replace the branding logo' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: multipartFileSchema })
  @ApiOkResponse({
    description: 'Logo uploaded successfully.',
    schema: buildSuccessEnvelopeSchema(publicBrandingSchema),
  })
  @ApiBadRequestResponse({
    description: 'The uploaded logo is invalid or unsupported.',
  })
  async uploadLogo(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Req() request: FastifyRequest,
  ) {
    return this.uploadAsset('logo', currentUser, requestContext, request);
  }

  @Post('favicon')
  @ApiOperation({ summary: 'Upload or replace the branding favicon' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: multipartFileSchema })
  @ApiOkResponse({
    description: 'Favicon uploaded successfully.',
    schema: buildSuccessEnvelopeSchema(publicBrandingSchema),
  })
  @ApiBadRequestResponse({
    description: 'The uploaded favicon is invalid or unsupported.',
  })
  async uploadFavicon(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Req() request: FastifyRequest,
  ) {
    return this.uploadAsset('favicon', currentUser, requestContext, request);
  }

  @Post('brand-image')
  @ApiOperation({ summary: 'Upload or replace the branding primary image' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: multipartFileSchema })
  @ApiOkResponse({
    description: 'Brand image uploaded successfully.',
    schema: buildSuccessEnvelopeSchema(publicBrandingSchema),
  })
  @ApiBadRequestResponse({
    description: 'The uploaded brand image is invalid or unsupported.',
  })
  async uploadBrandImage(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
    @Req() request: FastifyRequest,
  ) {
    return this.uploadAsset('brandImage', currentUser, requestContext, request);
  }

  @Delete('logo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove the custom branding logo' })
  @ApiOkResponse({
    description: 'Logo removed successfully.',
    schema: buildSuccessEnvelopeSchema(publicBrandingSchema),
  })
  removeLogo(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
  ) {
    return this.brandingService.deleteAsset(
      currentUser,
      requestContext,
      'logo',
    );
  }

  @Delete('favicon')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove the custom branding favicon' })
  @ApiOkResponse({
    description: 'Favicon removed successfully.',
    schema: buildSuccessEnvelopeSchema(publicBrandingSchema),
  })
  removeFavicon(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
  ) {
    return this.brandingService.deleteAsset(
      currentUser,
      requestContext,
      'favicon',
    );
  }

  @Delete('brand-image')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove the custom branding primary image' })
  @ApiOkResponse({
    description: 'Brand image removed successfully.',
    schema: buildSuccessEnvelopeSchema(publicBrandingSchema),
  })
  removeBrandImage(
    @CurrentUser() currentUser: AuthenticatedUser,
    @CurrentRequestContext() requestContext: RequestContext,
  ) {
    return this.brandingService.deleteAsset(
      currentUser,
      requestContext,
      'brandImage',
    );
  }

  private async uploadAsset(
    assetKey: BrandingAssetKey,
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    request: FastifyRequest,
  ) {
    const file = await this.readMultipartFile(request, assetKey);
    const fileBuffer = await this.readFileBuffer(file);

    return this.brandingService.uploadAsset(
      currentUser,
      requestContext,
      assetKey,
      {
        filename: file.filename,
        mimeType: file.mimetype,
        buffer: fileBuffer,
      },
    );
  }

  private async readMultipartFile(
    request: FastifyRequest,
    assetKey: BrandingAssetKey,
  ): Promise<MultipartFile> {
    if (!request.isMultipart()) {
      throw new BadRequestException({
        message: 'multipart/form-data is required for branding uploads.',
        code: 'INVALID_MULTIPART_REQUEST',
      });
    }

    try {
      const file = await request.file({
        limits: {
          files: 1,
          fields: 2,
          parts: 3,
          fileSize: BRANDING_UPLOAD_LIMITS[assetKey],
        },
      });

      if (!file) {
        throw new BadRequestException({
          message: 'A branding file is required.',
          code: 'INVALID_BRANDING_UPLOAD',
        });
      }

      return file;
    } catch (error) {
      throw this.toPayloadTooLargeException(error);
    }
  }

  /**
   * `@fastify/multipart`'s `fileSize` limit is enforced against the stream
   * as it's consumed, not when `request.file()` resolves — a file whose
   * declared/actual size exceeds the limit only throws once `toBuffer()`
   * (or an equivalent stream read) actually pulls the bytes through. This
   * mirrors the same `FST_REQ_FILE_TOO_LARGE` → 413 mapping as
   * `readMultipartFile` above so it's caught here too, instead of escaping
   * as an unhandled `FastifyError`.
   */
  private async readFileBuffer(file: MultipartFile): Promise<Buffer> {
    try {
      return await file.toBuffer();
    } catch (error) {
      throw this.toPayloadTooLargeException(error);
    }
  }

  private toPayloadTooLargeException(error: unknown): unknown {
    if (this.isMultipartFileTooLargeError(error)) {
      return new PayloadTooLargeException({
        message:
          'The uploaded branding asset exceeds the maximum allowed size.',
        code: 'FILE_TOO_LARGE',
      });
    }

    return error;
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
