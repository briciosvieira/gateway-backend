import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { createHash } from 'node:crypto';
import { posix as posixPath, win32 as win32Path } from 'node:path';
import type { BrandingAssetKey } from '../branding.constants';
import { BRANDING_UPLOAD_LIMITS } from '../branding.constants';
import type { ValidatedBrandingAsset } from '../interfaces/validated-branding-asset.interface';

type DetectedAssetType = 'png' | 'jpeg' | 'webp' | 'svg' | 'ico';

interface SvgNode {
  [key: string]: unknown;
}

const SVG_XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false,
  allowBooleanAttributes: true,
});

const MIME_TYPES_BY_ASSET_TYPE: Record<DetectedAssetType, readonly string[]> = {
  png: ['image/png'],
  jpeg: ['image/jpeg', 'image/jpg'],
  webp: ['image/webp'],
  svg: ['image/svg+xml'],
  ico: ['image/x-icon', 'image/vnd.microsoft.icon'],
};

const ALLOWED_DETECTED_TYPES_BY_ASSET: Record<BrandingAssetKey, readonly DetectedAssetType[]> = {
  logo: ['png', 'jpeg', 'webp', 'svg'],
  favicon: ['png', 'jpeg', 'webp', 'svg', 'ico'],
  brandImage: ['png', 'jpeg', 'webp', 'svg'],
};

const ALLOWED_SVG_TAGS = new Set([
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'rect',
  'defs',
  'linearGradient',
  'radialGradient',
  'stop',
  'title',
  'desc',
  'clipPath',
  'mask',
]);

const ALLOWED_SVG_ATTRIBUTES = new Set([
  'xmlns',
  'viewBox',
  'width',
  'height',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'd',
  'points',
  'fill',
  'fill-rule',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'opacity',
  'transform',
  'preserveAspectRatio',
  'version',
  'id',
  'class',
  'gradientUnits',
  'gradientTransform',
  'offset',
  'stop-color',
  'stop-opacity',
  'clipPathUnits',
  'maskUnits',
  'maskContentUnits',
]);

const DANGEROUS_SVG_TAGS = new Set([
  'script',
  'foreignObject',
  'iframe',
  'object',
  'embed',
  'audio',
  'video',
  'image',
  'a',
  'animate',
  'animateMotion',
  'animateTransform',
  'set',
  'use',
  'style',
]);

const DANGEROUS_SVG_ATTRIBUTE_PREFIXES = ['on'];
const DANGEROUS_PROTOCOLS = ['javascript:', 'data:', 'vbscript:'];
const DANGEROUS_SVG_ATTRIBUTE_NAMES = new Set([
  'href',
  'xlink:href',
  'src',
  'style',
]);

export function validateBrandingAssetUpload(
  assetKey: BrandingAssetKey,
  filename: string,
  mimeType: string,
  buffer: Buffer,
): ValidatedBrandingAsset {
  if (buffer.length === 0) {
    throw new BadRequestException({
      message: 'The uploaded branding asset is empty.',
      code: 'INVALID_BRANDING_ASSET',
    });
  }

  const maxBytes = BRANDING_UPLOAD_LIMITS[assetKey];

  if (buffer.length > maxBytes) {
    throw new PayloadTooLargeException({
      message: 'The uploaded branding asset exceeds the maximum allowed size.',
      code: 'FILE_TOO_LARGE',
    });
  }

  const detectedType = detectAssetType(buffer);

  if (!detectedType || !ALLOWED_DETECTED_TYPES_BY_ASSET[assetKey].includes(detectedType)) {
    throw new BadRequestException({
      message: 'The uploaded branding asset format is not supported.',
      code: 'UNSUPPORTED_BRANDING_ASSET_TYPE',
    });
  }

  const normalizedMimeType = mimeType.trim().toLowerCase();

  if (!MIME_TYPES_BY_ASSET_TYPE[detectedType].includes(normalizedMimeType)) {
    throw new BadRequestException({
      message: 'The uploaded branding asset MIME type is invalid.',
      code: 'INVALID_BRANDING_ASSET_MIME_TYPE',
    });
  }

  if (detectedType === 'svg') {
    validateSvgSecurity(buffer.toString('utf8'));
  }

  return {
    data: buffer,
    mimeType: normalizedMimeType,
    fileName: sanitizeFileName(filename),
    sizeBytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
}

function sanitizeFileName(value: string): string {
  const normalizedValue = win32Path.basename(posixPath.basename(value.trim()));

  return normalizedValue.length > 0 ? normalizedValue : 'branding-asset';
}

function detectAssetType(buffer: Buffer): DetectedAssetType | null {
  if (isPng(buffer)) {
    return 'png';
  }

  if (isJpeg(buffer)) {
    return 'jpeg';
  }

  if (isWebp(buffer)) {
    return 'webp';
  }

  if (isIco(buffer)) {
    return 'ico';
  }

  if (isSvg(buffer)) {
    return 'svg';
  }

  return null;
}

function isPng(buffer: Buffer): boolean {
  if (buffer.length < 8) {
    return false;
  }

  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  return pngSignature.every((byte, index) => buffer[index] === byte);
}

function isJpeg(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function isWebp(buffer: Buffer): boolean {
  return (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

function isIco(buffer: Buffer): boolean {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x00 &&
    buffer[1] === 0x00 &&
    buffer[2] === 0x01 &&
    buffer[3] === 0x00
  );
}

function isSvg(buffer: Buffer): boolean {
  const content = buffer.toString('utf8').trimStart();

  return content.startsWith('<svg') || content.startsWith('<?xml');
}

function validateSvgSecurity(svgContent: string): void {
  const trimmedContent = svgContent.trim();

  if (!trimmedContent) {
    throw new BadRequestException({
      message: 'The uploaded SVG is empty.',
      code: 'INVALID_BRANDING_ASSET',
    });
  }

  const validationResult = XMLValidator.validate(trimmedContent, {
    allowBooleanAttributes: true,
  });

  if (validationResult !== true) {
    throw new BadRequestException({
      message: 'The uploaded SVG is invalid XML.',
      code: 'INVALID_BRANDING_ASSET',
    });
  }

  if (/<!DOCTYPE/i.test(trimmedContent) || /<!ENTITY/i.test(trimmedContent)) {
    throw new BadRequestException({
      message: 'The uploaded SVG contains unsafe declarations.',
      code: 'UNSAFE_SVG_NOT_ALLOWED',
    });
  }

  const parsedSvg = SVG_XML_PARSER.parse(trimmedContent) as SvgNode;
  const rootNode = parsedSvg.svg;

  if (!rootNode || typeof rootNode !== 'object') {
    throw new BadRequestException({
      message: 'The uploaded SVG does not contain a valid <svg> root element.',
      code: 'INVALID_BRANDING_ASSET',
    });
  }

  validateSvgNode('svg', rootNode);
}

function validateSvgNode(nodeName: string, nodeValue: unknown): void {
  if (DANGEROUS_SVG_TAGS.has(nodeName) || !ALLOWED_SVG_TAGS.has(nodeName)) {
    throw new BadRequestException({
      message: 'The uploaded SVG contains disallowed elements.',
      code: 'UNSAFE_SVG_NOT_ALLOWED',
    });
  }

  if (Array.isArray(nodeValue)) {
    for (const childNode of nodeValue) {
      validateSvgNode(nodeName, childNode);
    }

    return;
  }

  if (typeof nodeValue !== 'object' || nodeValue === null) {
    return;
  }

  for (const [key, value] of Object.entries(nodeValue)) {
    if (key.startsWith('@_')) {
      validateSvgAttribute(key.slice(2), value);
      continue;
    }

    if (key === '#text') {
      continue;
    }

    validateSvgNode(key, value);
  }
}

function validateSvgAttribute(attributeName: string, value: unknown): void {
  const normalizedAttributeName = attributeName.trim();
  const normalizedLowerName = normalizedAttributeName.toLowerCase();

  if (
    DANGEROUS_SVG_ATTRIBUTE_PREFIXES.some((prefix) => normalizedLowerName.startsWith(prefix)) ||
    DANGEROUS_SVG_ATTRIBUTE_NAMES.has(normalizedLowerName) ||
    !ALLOWED_SVG_ATTRIBUTES.has(normalizedAttributeName)
  ) {
    throw new BadRequestException({
      message: 'The uploaded SVG contains disallowed attributes.',
      code: 'UNSAFE_SVG_NOT_ALLOWED',
    });
  }

  if (typeof value !== 'string') {
    return;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (
    DANGEROUS_PROTOCOLS.some((protocol) => normalizedValue.includes(protocol)) ||
    normalizedValue.includes('url(')
  ) {
    throw new BadRequestException({
      message: 'The uploaded SVG contains unsafe attribute values.',
      code: 'UNSAFE_SVG_NOT_ALLOWED',
    });
  }
}
