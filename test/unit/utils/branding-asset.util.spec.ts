import { validateBrandingAssetUpload } from '../../../src/modules/branding/utils/branding-asset.util';
import { BRANDING_UPLOAD_LIMITS } from '../../../src/modules/branding/branding.constants';

const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);
const webpBuffer = Buffer.from('RIFF1234WEBP', 'ascii');
const icoBuffer = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01]);
const validSvgBuffer = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="#111"/></svg>',
  'utf8',
);

describe('validateBrandingAssetUpload', () => {
  it.each([
    ['logo', 'logo.png', 'image/png', pngBuffer, 'logo.png'],
    ['logo', 'logo.jpg', 'image/jpeg', jpegBuffer, 'logo.jpg'],
    ['logo', 'logo.webp', 'image/webp', webpBuffer, 'logo.webp'],
    ['brandImage', 'brand.svg', 'image/svg+xml', validSvgBuffer, 'brand.svg'],
    ['favicon', '..\\icons\\favicon.ico', 'image/x-icon', icoBuffer, 'favicon.ico'],
  ] as const)(
    'accepts %s uploads when the payload is valid',
    (assetKey, filename, mimeType, buffer, expectedFileName) => {
      const result = validateBrandingAssetUpload(
        assetKey,
        filename,
        mimeType,
        buffer,
      );

      expect(result.mimeType).toBe(mimeType);
      expect(result.fileName).toBe(expectedFileName);
      expect(result.sizeBytes).toBe(buffer.length);
      expect(result.sha256).toHaveLength(64);
    },
  );

  it('rejects empty files', () => {
    expect(() =>
      validateBrandingAssetUpload('logo', 'empty.png', 'image/png', Buffer.alloc(0)),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'INVALID_BRANDING_ASSET' }),
      }),
    );
  });

  it('rejects invalid MIME types even when the extension looks valid', () => {
    expect(() =>
      validateBrandingAssetUpload('logo', 'logo.png', 'application/pdf', pngBuffer),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({
          code: 'INVALID_BRANDING_ASSET_MIME_TYPE',
        }),
      }),
    );
  });

  it('rejects files that exceed the configured size limit', () => {
    expect(() =>
      validateBrandingAssetUpload(
        'logo',
        'huge.png',
        'image/png',
        Buffer.alloc(BRANDING_UPLOAD_LIMITS.logo + 1, 0),
      ),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'FILE_TOO_LARGE' }),
      }),
    );
  });

  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject /></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(javascript:alert(1))" /></svg>',
  ])('rejects unsafe SVG content: %s', (svgContent) => {
    expect(() =>
      validateBrandingAssetUpload(
        'brandImage',
        'unsafe.svg',
        'image/svg+xml',
        Buffer.from(svgContent, 'utf8'),
      ),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'UNSAFE_SVG_NOT_ALLOWED' }),
      }),
    );
  });

  it('rejects arbitrary non-image files', () => {
    expect(() =>
      validateBrandingAssetUpload(
        'logo',
        'random.bin',
        'application/octet-stream',
        Buffer.from('not-an-image', 'utf8'),
      ),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({
          code: 'UNSUPPORTED_BRANDING_ASSET_TYPE',
        }),
      }),
    );
  });
});
