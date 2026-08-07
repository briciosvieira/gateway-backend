import { Controller, Get, Req, Res } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SkipResponseWrapper } from '../../common/decorators/skip-response-wrapper.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { BrandingService } from './branding.service';

const publicBrandingSchema = {
  type: 'object',
  properties: {
    applicationName: { type: 'string', example: 'Duda Gateway Hub' },
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
@Controller('branding')
@Public()
export class BrandingPublicController {
  constructor(private readonly brandingService: BrandingService) {}

  @Get()
  @ApiOperation({ summary: 'Get the public branding configuration' })
  @ApiOkResponse({
    description: 'Public branding returned successfully.',
    schema: buildSuccessEnvelopeSchema(publicBrandingSchema),
  })
  getPublicBranding() {
    return this.brandingService.getPublicBranding();
  }

  @Get('assets/logo')
  @SkipResponseWrapper()
  @ApiOperation({ summary: 'Get the public logo asset' })
  @ApiProduces('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml')
  @ApiOkResponse({
    description: 'Logo binary returned successfully.',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiNotFoundResponse({ description: 'Logo asset is not configured.' })
  getLogo(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.sendAsset('logo', request, reply);
  }

  @Get('assets/favicon')
  @SkipResponseWrapper()
  @ApiOperation({ summary: 'Get the public favicon asset' })
  @ApiProduces(
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/svg+xml',
    'image/x-icon',
    'image/vnd.microsoft.icon',
  )
  @ApiOkResponse({
    description: 'Favicon binary returned successfully.',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiNotFoundResponse({ description: 'Favicon asset is not configured.' })
  getFavicon(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.sendAsset('favicon', request, reply);
  }

  @Get('assets/brand-image')
  @SkipResponseWrapper()
  @ApiOperation({ summary: 'Get the public brand image asset' })
  @ApiProduces('image/png', 'image/jpeg', 'image/webp', 'image/svg+xml')
  @ApiOkResponse({
    description: 'Brand image binary returned successfully.',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiNotFoundResponse({ description: 'Brand image asset is not configured.' })
  getBrandImage(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return this.sendAsset('brandImage', request, reply);
  }

  private async sendAsset(
    assetKey: 'logo' | 'favicon' | 'brandImage',
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const asset = await this.brandingService.getAsset(assetKey);
    const etag = `"${asset.sha256}"`;
    const lastModified = asset.updatedAt.toUTCString();
    const ifNoneMatch = request.headers['if-none-match'];
    const ifModifiedSince = request.headers['if-modified-since'];

    // These assets are meant to be embedded via <img src> from the admin
    // frontend, which runs on a different origin/port (and, in production,
    // potentially a different subdomain). Helmet's default
    // `Cross-Origin-Resource-Policy: same-origin` (set globally in
    // main.ts) blocks exactly that kind of cross-origin, no-cors image
    // load — overriding it here, only for these three public asset
    // routes, is what makes the logo/favicon/brand image actually render
    // instead of a broken-image icon. The rest of the API's CORP policy is
    // untouched.
    reply.header('cross-origin-resource-policy', 'cross-origin');

    if (
      (typeof ifNoneMatch === 'string' &&
        ifNoneMatch.replaceAll('"', '') === asset.sha256) ||
      (typeof ifModifiedSince === 'string' &&
        new Date(ifModifiedSince).getTime() >= asset.updatedAt.getTime())
    ) {
      reply.status(304);
      reply.header('etag', etag);
      reply.header('last-modified', lastModified);
      reply.header('cache-control', 'public, max-age=31536000, immutable');
      reply.send();
      return;
    }

    reply.status(200);
    reply.header('content-type', asset.mimeType);
    reply.header('content-length', String(asset.sizeBytes));
    reply.header('etag', etag);
    reply.header('last-modified', lastModified);
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    reply.send(asset.data);
  }
}
