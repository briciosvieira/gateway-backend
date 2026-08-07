import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AuditLogsService } from '../../../src/modules/audit-logs/audit-logs.service';
import { BrandingService } from '../../../src/modules/branding/branding.service';
import {
  DEFAULT_APPLICATION_NAME,
  SITE_BRANDING_ID,
} from '../../../src/modules/branding/branding.constants';
import { authenticatedAdminFixture } from '../../fixtures/users.fixture';
import {
  createMockPrismaService,
  resetMockPrismaService,
} from '../../helpers/prisma-mock.helper';
import type { MockPrismaService } from '../../helpers/prisma-mock.helper';

const requestContext = {
  sourceIp: '203.0.113.10',
  requestId: 'req-branding-1',
};

const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

const brandingRecord = {
  id: SITE_BRANDING_ID,
  applicationName: 'Partner Gateway',
  logoMimeType: 'image/png',
  logoFileName: 'logo.png',
  logoSizeBytes: pngBuffer.length,
  logoSha256: 'logo-sha-1',
  faviconMimeType: null,
  faviconFileName: null,
  faviconSizeBytes: null,
  faviconSha256: null,
  brandImageMimeType: null,
  brandImageFileName: null,
  brandImageSizeBytes: null,
  brandImageSha256: null,
  updatedAt: new Date('2026-08-07T12:00:00.000Z'),
};

describe('BrandingService', () => {
  let service: BrandingService;
  let prisma: MockPrismaService;
  let auditLogsService: { create: jest.Mock };

  beforeEach(() => {
    prisma = createMockPrismaService();
    auditLogsService = { create: jest.fn().mockResolvedValue(undefined) };

    service = new BrandingService(
      prisma,
      auditLogsService as unknown as AuditLogsService,
    );
  });

  afterEach(() => {
    resetMockPrismaService(prisma);
    jest.clearAllMocks();
  });

  it('returns the default public branding when no branding row exists', async () => {
    prisma.siteBranding.findUnique.mockResolvedValue(null);

    await expect(service.getPublicBranding()).resolves.toEqual({
      applicationName: DEFAULT_APPLICATION_NAME,
      logoUrl: null,
      faviconUrl: null,
      brandImageUrl: null,
      updatedAt: null,
    });
  });

  it('updates and trims the application name before persisting and auditing it', async () => {
    prisma.siteBranding.findUnique.mockResolvedValue(null);
    prisma.siteBranding.upsert.mockResolvedValue({
      ...brandingRecord,
      applicationName: 'Partner Gateway',
      logoMimeType: null,
      logoFileName: null,
      logoSizeBytes: null,
      logoSha256: null,
    } as never);

    const result = await service.updateApplicationName(
      authenticatedAdminFixture,
      requestContext,
      { applicationName: '  Partner Gateway  ' },
    );

    expect(prisma.siteBranding.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SITE_BRANDING_ID },
        create: expect.objectContaining({
          applicationName: 'Partner Gateway',
        }),
        update: expect.objectContaining({
          applicationName: 'Partner Gateway',
        }),
      }),
    );
    expect(auditLogsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        entityId: SITE_BRANDING_ID,
        previousValue: { applicationName: DEFAULT_APPLICATION_NAME },
        newValue: { applicationName: 'Partner Gateway' },
      }),
    );
    expect(result.applicationName).toBe('Partner Gateway');
  });

  it('rejects invalid application names', async () => {
    await expect(
      service.updateApplicationName(authenticatedAdminFixture, requestContext, {
        applicationName: '   ',
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.updateApplicationName(authenticatedAdminFixture, requestContext, {
        applicationName: '<b>Gateway</b>',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('uploads a logo, stores metadata only in the audit log and returns the public URL', async () => {
    prisma.siteBranding.findUnique.mockResolvedValue(null);
    prisma.siteBranding.upsert.mockResolvedValue(brandingRecord as never);

    const result = await service.uploadAsset(
      authenticatedAdminFixture,
      requestContext,
      'logo',
      {
        filename: '..\\branding\\logo.png',
        mimeType: 'image/png',
        buffer: pngBuffer,
      },
    );

    const upsertCall = prisma.siteBranding.upsert.mock.calls[0]?.[0];
    const createLogoData = upsertCall?.create.logoData;
    const auditPayload = auditLogsService.create.mock.calls[0]?.[0];

    expect(createLogoData).toBeInstanceOf(Uint8Array);
    expect(auditPayload?.newValue).toEqual(
      expect.objectContaining({
        assetType: 'logo',
        mimeType: 'image/png',
        fileName: 'logo.png',
        sizeBytes: pngBuffer.length,
      }),
    );
    expect(auditPayload?.newValue).not.toHaveProperty('data');
    expect(result.logoUrl).toBe('/api/v1/branding/assets/logo?v=logo-sha-1');
  });

  it('removes an existing asset and resets the public URL to null', async () => {
    prisma.siteBranding.findUnique.mockResolvedValue(brandingRecord as never);
    prisma.siteBranding.update.mockResolvedValue({
      ...brandingRecord,
      logoMimeType: null,
      logoFileName: null,
      logoSizeBytes: null,
      logoSha256: null,
    } as never);

    const result = await service.deleteAsset(
      authenticatedAdminFixture,
      requestContext,
      'logo',
    );

    expect(prisma.siteBranding.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SITE_BRANDING_ID },
        data: expect.objectContaining({
          logoData: null,
          logoMimeType: null,
          logoFileName: null,
          logoSizeBytes: null,
          logoSha256: null,
        }),
      }),
    );
    expect(result.logoUrl).toBeNull();
  });

  it('returns binary branding assets with buffer data', async () => {
    prisma.siteBranding.findUnique.mockResolvedValue({
      updatedAt: brandingRecord.updatedAt,
      logoData: new Uint8Array(pngBuffer),
      logoMimeType: 'image/png',
      logoSizeBytes: pngBuffer.length,
      logoSha256: 'logo-sha-1',
      faviconData: null,
      faviconMimeType: null,
      faviconSizeBytes: null,
      faviconSha256: null,
      brandImageData: null,
      brandImageMimeType: null,
      brandImageSizeBytes: null,
      brandImageSha256: null,
    } as never);

    const result = await service.getAsset('logo');

    expect(Buffer.isBuffer(result.data)).toBe(true);
    expect(result.mimeType).toBe('image/png');
    expect(result.sha256).toBe('logo-sha-1');
  });

  it('throws NotFoundException when trying to fetch an asset that does not exist', async () => {
    prisma.siteBranding.findUnique.mockResolvedValue(null);

    await expect(service.getAsset('logo')).rejects.toThrow(NotFoundException);
  });
});
