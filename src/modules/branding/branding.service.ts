import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, AuditEntity } from '../../../generated/prisma/client';
import type { Prisma } from '../../../generated/prisma/client';
import type { RequestContext } from '../../common/interfaces/request-context.interface';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import type { UpdateBrandingDto } from './dto/update-branding.dto';
import {
  BRANDING_ASSET_LABELS,
  type BrandingAssetKey,
  DEFAULT_APPLICATION_NAME,
  SITE_BRANDING_ID,
} from './branding.constants';
import type { CreateBrandingAssetUploadInput } from './interfaces/create-branding-asset-upload.interface';
import type { ValidatedBrandingAsset } from './interfaces/validated-branding-asset.interface';
import { validateBrandingAssetUpload } from './utils/branding-asset.util';

const brandingSelect = {
  id: true,
  applicationName: true,
  logoMimeType: true,
  logoFileName: true,
  logoSizeBytes: true,
  logoSha256: true,
  faviconMimeType: true,
  faviconFileName: true,
  faviconSizeBytes: true,
  faviconSha256: true,
  brandImageMimeType: true,
  brandImageFileName: true,
  brandImageSizeBytes: true,
  brandImageSha256: true,
  updatedAt: true,
} as const;

type BrandingRecord = Prisma.SiteBrandingGetPayload<{ select: typeof brandingSelect }>;

type BrandingAssetCreateMutation = {
  logoData?: Uint8Array<ArrayBuffer>;
  logoMimeType?: string;
  logoFileName?: string;
  logoSizeBytes?: number;
  logoSha256?: string;
  faviconData?: Uint8Array<ArrayBuffer>;
  faviconMimeType?: string;
  faviconFileName?: string;
  faviconSizeBytes?: number;
  faviconSha256?: string;
  brandImageData?: Uint8Array<ArrayBuffer>;
  brandImageMimeType?: string;
  brandImageFileName?: string;
  brandImageSizeBytes?: number;
  brandImageSha256?: string;
};

type BrandingAssetUpdateMutation = {
  logoData?: Uint8Array<ArrayBuffer> | null;
  logoMimeType?: string | null;
  logoFileName?: string | null;
  logoSizeBytes?: number | null;
  logoSha256?: string | null;
  faviconData?: Uint8Array<ArrayBuffer> | null;
  faviconMimeType?: string | null;
  faviconFileName?: string | null;
  faviconSizeBytes?: number | null;
  faviconSha256?: string | null;
  brandImageData?: Uint8Array<ArrayBuffer> | null;
  brandImageMimeType?: string | null;
  brandImageFileName?: string | null;
  brandImageSizeBytes?: number | null;
  brandImageSha256?: string | null;
};

type BrandingAssetResponse = {
  data: Buffer;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  updatedAt: Date;
};

@Injectable()
export class BrandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async getPublicBranding() {
    const branding = await this.prisma.siteBranding.findUnique({
      where: { id: SITE_BRANDING_ID },
      select: brandingSelect,
    });

    return this.toPublicBranding(branding);
  }

  async updateApplicationName(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    dto: UpdateBrandingDto,
  ) {
    const normalizedApplicationName = this.normalizeApplicationName(dto.applicationName);
    const currentBranding = await this.prisma.siteBranding.findUnique({
      where: { id: SITE_BRANDING_ID },
      select: brandingSelect,
    });

    const currentApplicationName = currentBranding?.applicationName ?? DEFAULT_APPLICATION_NAME;

    if (currentApplicationName === normalizedApplicationName) {
      return this.toPublicBranding(currentBranding);
    }

    const updatedBranding = await this.prisma.siteBranding.upsert({
      where: { id: SITE_BRANDING_ID },
      create: {
        id: SITE_BRANDING_ID,
        applicationName: normalizedApplicationName,
        createdById: currentUser.id,
        updatedById: currentUser.id,
      },
      update: {
        applicationName: normalizedApplicationName,
        updatedById: currentUser.id,
      },
      select: brandingSelect,
    });

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.UPDATE,
      entity: AuditEntity.SYSTEM_SETTING,
      entityId: SITE_BRANDING_ID,
      previousValue: { applicationName: currentApplicationName },
      newValue: { applicationName: updatedBranding.applicationName },
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: 'Branding application name was updated.',
    });

    return this.toPublicBranding(updatedBranding);
  }

  async uploadAsset(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    assetKey: BrandingAssetKey,
    input: CreateBrandingAssetUploadInput,
  ) {
    const validatedAsset = validateBrandingAssetUpload(
      assetKey,
      input.filename,
      input.mimeType,
      input.buffer,
    );

    const currentBranding = await this.prisma.siteBranding.findUnique({
      where: { id: SITE_BRANDING_ID },
      select: brandingSelect,
    });

    const updatedBranding = await this.prisma.siteBranding.upsert({
      where: { id: SITE_BRANDING_ID },
      create: {
        id: SITE_BRANDING_ID,
        applicationName: currentBranding?.applicationName ?? DEFAULT_APPLICATION_NAME,
        createdById: currentUser.id,
        updatedById: currentUser.id,
        ...this.buildAssetCreateMutation(assetKey, validatedAsset),
      },
      update: {
        updatedById: currentUser.id,
        ...this.buildAssetUpdateMutation(assetKey, validatedAsset),
      },
      select: brandingSelect,
    });

    const previousMetadata = this.extractAssetMetadata(assetKey, currentBranding);
    const newMetadata = this.extractAssetMetadata(assetKey, updatedBranding);

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.UPDATE,
      entity: AuditEntity.SYSTEM_SETTING,
      entityId: SITE_BRANDING_ID,
      previousValue: previousMetadata ? { assetType: assetKey, ...previousMetadata } : { assetType: assetKey, configured: false },
      newValue: newMetadata ? { assetType: assetKey, ...newMetadata } : { assetType: assetKey, configured: false },
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `Branding ${BRANDING_ASSET_LABELS[assetKey]} was ${
        previousMetadata ? 'replaced' : 'uploaded'
      }.`,
    });

    return this.toPublicBranding(updatedBranding);
  }

  async deleteAsset(
    currentUser: AuthenticatedUser,
    requestContext: RequestContext,
    assetKey: BrandingAssetKey,
  ) {
    const currentBranding = await this.prisma.siteBranding.findUnique({
      where: { id: SITE_BRANDING_ID },
      select: brandingSelect,
    });

    const previousMetadata = this.extractAssetMetadata(assetKey, currentBranding);

    if (!currentBranding || !previousMetadata) {
      throw new NotFoundException(`Branding ${BRANDING_ASSET_LABELS[assetKey]} was not found.`);
    }

    const updatedBranding = await this.prisma.siteBranding.update({
      where: { id: SITE_BRANDING_ID },
      data: {
        updatedById: currentUser.id,
        ...this.buildAssetRemovalMutation(assetKey),
      },
      select: brandingSelect,
    });

    await this.auditLogsService.create({
      userId: currentUser.id,
      action: AuditAction.UPDATE,
      entity: AuditEntity.SYSTEM_SETTING,
      entityId: SITE_BRANDING_ID,
      previousValue: { assetType: assetKey, ...previousMetadata },
      newValue: { assetType: assetKey, configured: false },
      sourceIp: requestContext.sourceIp,
      requestId: requestContext.requestId,
      description: `Branding ${BRANDING_ASSET_LABELS[assetKey]} was removed.`,
    });

    return this.toPublicBranding(updatedBranding);
  }

  async getAsset(assetKey: BrandingAssetKey): Promise<BrandingAssetResponse> {
    const branding = await this.prisma.siteBranding.findUnique({
      where: { id: SITE_BRANDING_ID },
      select: {
        updatedAt: true,
        logoData: true,
        logoMimeType: true,
        logoSizeBytes: true,
        logoSha256: true,
        faviconData: true,
        faviconMimeType: true,
        faviconSizeBytes: true,
        faviconSha256: true,
        brandImageData: true,
        brandImageMimeType: true,
        brandImageSizeBytes: true,
        brandImageSha256: true,
      },
    });

    if (!branding) {
      throw new NotFoundException(`Branding ${BRANDING_ASSET_LABELS[assetKey]} was not found.`);
    }

    const asset = this.extractAssetBinary(assetKey, branding);

    if (!asset) {
      throw new NotFoundException(`Branding ${BRANDING_ASSET_LABELS[assetKey]} was not found.`);
    }

    return asset;
  }

  private toPublicBranding(branding: BrandingRecord | null) {
    return {
      applicationName: branding?.applicationName ?? DEFAULT_APPLICATION_NAME,
      logoUrl: this.buildAssetUrl('logo', branding?.logoSha256 ?? null),
      faviconUrl: this.buildAssetUrl('favicon', branding?.faviconSha256 ?? null),
      brandImageUrl: this.buildAssetUrl('brandImage', branding?.brandImageSha256 ?? null),
      updatedAt: branding?.updatedAt ?? null,
    };
  }

  private buildAssetUrl(assetKey: BrandingAssetKey, sha256: string | null): string | null {
    if (!sha256) {
      return null;
    }

    const assetPath = assetKey === 'brandImage' ? 'brand-image' : assetKey;

    return `/api/v1/branding/assets/${assetPath}?v=${encodeURIComponent(sha256)}`;
  }

  private normalizeApplicationName(value: string): string {
    const normalizedValue = value.trim();

    if (normalizedValue.length < 2 || normalizedValue.length > 100) {
      throw new BadRequestException({
        message: 'applicationName must be between 2 and 100 characters.',
        code: 'INVALID_BRANDING_APPLICATION_NAME',
      });
    }

    if (normalizedValue.includes('<') || normalizedValue.includes('>')) {
      throw new BadRequestException({
        message: 'applicationName must not contain HTML.',
        code: 'INVALID_BRANDING_APPLICATION_NAME',
      });
    }

    return normalizedValue;
  }

  private buildAssetCreateMutation(
    assetKey: BrandingAssetKey,
    asset: ValidatedBrandingAsset,
  ): BrandingAssetCreateMutation {
    const prismaBytes = this.toPrismaBytes(asset.data);

    if (assetKey === 'logo') {
      return {
        logoData: prismaBytes,
        logoMimeType: asset.mimeType,
        logoFileName: asset.fileName,
        logoSizeBytes: asset.sizeBytes,
        logoSha256: asset.sha256,
      };
    }

    if (assetKey === 'favicon') {
      return {
        faviconData: prismaBytes,
        faviconMimeType: asset.mimeType,
        faviconFileName: asset.fileName,
        faviconSizeBytes: asset.sizeBytes,
        faviconSha256: asset.sha256,
      };
    }

    return {
      brandImageData: prismaBytes,
      brandImageMimeType: asset.mimeType,
      brandImageFileName: asset.fileName,
      brandImageSizeBytes: asset.sizeBytes,
      brandImageSha256: asset.sha256,
    };
  }

  private buildAssetUpdateMutation(
    assetKey: BrandingAssetKey,
    asset: ValidatedBrandingAsset,
  ): BrandingAssetUpdateMutation {
    return this.buildAssetRemovalMutation(assetKey, asset);
  }

  private buildAssetRemovalMutation(
    assetKey: BrandingAssetKey,
    asset?: ValidatedBrandingAsset,
  ): BrandingAssetUpdateMutation {
    const prismaBytes = asset ? this.toPrismaBytes(asset.data) : null;

    if (assetKey === 'logo') {
      return {
        logoData: prismaBytes,
        logoMimeType: asset?.mimeType ?? null,
        logoFileName: asset?.fileName ?? null,
        logoSizeBytes: asset?.sizeBytes ?? null,
        logoSha256: asset?.sha256 ?? null,
      };
    }

    if (assetKey === 'favicon') {
      return {
        faviconData: prismaBytes,
        faviconMimeType: asset?.mimeType ?? null,
        faviconFileName: asset?.fileName ?? null,
        faviconSizeBytes: asset?.sizeBytes ?? null,
        faviconSha256: asset?.sha256 ?? null,
      };
    }

    return {
      brandImageData: prismaBytes,
      brandImageMimeType: asset?.mimeType ?? null,
      brandImageFileName: asset?.fileName ?? null,
      brandImageSizeBytes: asset?.sizeBytes ?? null,
      brandImageSha256: asset?.sha256 ?? null,
    };
  }

  private toPrismaBytes(buffer: Buffer): Uint8Array<ArrayBuffer> {
    const arrayBuffer = new ArrayBuffer(buffer.byteLength);
    const bytes = new Uint8Array(arrayBuffer);
    bytes.set(buffer);
    return bytes;
  }

  private extractAssetMetadata(
    assetKey: BrandingAssetKey,
    branding: BrandingRecord | null,
  ): { mimeType: string; fileName: string; sizeBytes: number; sha256: string } | null {
    if (!branding) {
      return null;
    }

    if (assetKey === 'logo' && branding.logoMimeType && branding.logoFileName && branding.logoSizeBytes && branding.logoSha256) {
      return {
        mimeType: branding.logoMimeType,
        fileName: branding.logoFileName,
        sizeBytes: branding.logoSizeBytes,
        sha256: branding.logoSha256,
      };
    }

    if (
      assetKey === 'favicon' &&
      branding.faviconMimeType &&
      branding.faviconFileName &&
      branding.faviconSizeBytes &&
      branding.faviconSha256
    ) {
      return {
        mimeType: branding.faviconMimeType,
        fileName: branding.faviconFileName,
        sizeBytes: branding.faviconSizeBytes,
        sha256: branding.faviconSha256,
      };
    }

    if (
      assetKey === 'brandImage' &&
      branding.brandImageMimeType &&
      branding.brandImageFileName &&
      branding.brandImageSizeBytes &&
      branding.brandImageSha256
    ) {
      return {
        mimeType: branding.brandImageMimeType,
        fileName: branding.brandImageFileName,
        sizeBytes: branding.brandImageSizeBytes,
        sha256: branding.brandImageSha256,
      };
    }

    return null;
  }

  private extractAssetBinary(
    assetKey: BrandingAssetKey,
    branding: {
      updatedAt: Date;
      logoData: Uint8Array | null;
      logoMimeType: string | null;
      logoSizeBytes: number | null;
      logoSha256: string | null;
      faviconData: Uint8Array | null;
      faviconMimeType: string | null;
      faviconSizeBytes: number | null;
      faviconSha256: string | null;
      brandImageData: Uint8Array | null;
      brandImageMimeType: string | null;
      brandImageSizeBytes: number | null;
      brandImageSha256: string | null;
    },
  ): BrandingAssetResponse | null {
    if (
      assetKey === 'logo' &&
      branding.logoData &&
      branding.logoMimeType &&
      branding.logoSizeBytes &&
      branding.logoSha256
    ) {
      return {
        data: Buffer.from(branding.logoData),
        mimeType: branding.logoMimeType,
        sizeBytes: branding.logoSizeBytes,
        sha256: branding.logoSha256,
        updatedAt: branding.updatedAt,
      };
    }

    if (
      assetKey === 'favicon' &&
      branding.faviconData &&
      branding.faviconMimeType &&
      branding.faviconSizeBytes &&
      branding.faviconSha256
    ) {
      return {
        data: Buffer.from(branding.faviconData),
        mimeType: branding.faviconMimeType,
        sizeBytes: branding.faviconSizeBytes,
        sha256: branding.faviconSha256,
        updatedAt: branding.updatedAt,
      };
    }

    if (
      assetKey === 'brandImage' &&
      branding.brandImageData &&
      branding.brandImageMimeType &&
      branding.brandImageSizeBytes &&
      branding.brandImageSha256
    ) {
      return {
        data: Buffer.from(branding.brandImageData),
        mimeType: branding.brandImageMimeType,
        sizeBytes: branding.brandImageSizeBytes,
        sha256: branding.brandImageSha256,
        updatedAt: branding.updatedAt,
      };
    }

    return null;
  }
}
