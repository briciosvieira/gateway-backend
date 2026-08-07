export const DEFAULT_APPLICATION_NAME = 'Gateway Hub LF';
export const SITE_BRANDING_ID = 'site-branding';

export const BRANDING_ASSET_KEYS = ['logo', 'favicon', 'brandImage'] as const;

export type BrandingAssetKey = (typeof BRANDING_ASSET_KEYS)[number];

export const BRANDING_ASSET_LABELS: Record<BrandingAssetKey, string> = {
  logo: 'logo',
  favicon: 'favicon',
  brandImage: 'brand image',
};

export const BRANDING_UPLOAD_LIMITS: Record<BrandingAssetKey, number> = {
  logo: 2 * 1024 * 1024,
  favicon: 512 * 1024,
  brandImage: 10 * 1024 * 1024,
};
