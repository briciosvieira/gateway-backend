import { BadRequestException } from '@nestjs/common';
import { X509Certificate } from 'node:crypto';
import { extname } from 'node:path';
import type { TrustedCaCertificateMetadata } from '../interfaces/trusted-ca-certificate-metadata.interface';

const ALLOWED_CERTIFICATE_EXTENSIONS = new Set(['.pem', '.crt', '.cer']);
const BLOCKED_CERTIFICATE_EXTENSIONS = new Set(['.key', '.pfx', '.p12']);
const PRIVATE_KEY_MARKERS = [
  '-----BEGIN PRIVATE KEY-----',
  '-----BEGIN RSA PRIVATE KEY-----',
  '-----BEGIN EC PRIVATE KEY-----',
  '-----BEGIN ENCRYPTED PRIVATE KEY-----',
];
const CERTIFICATE_BLOCK_PATTERN =
  /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

export function parseTrustedCaCertificate(
  filename: string,
  content: Buffer,
): TrustedCaCertificateMetadata {
  const normalizedFilename = filename.trim();
  const fileExtension = extname(normalizedFilename).toLowerCase();

  if (BLOCKED_CERTIFICATE_EXTENSIONS.has(fileExtension)) {
    throw new BadRequestException({
      message: 'Private keys and PKCS#12 files are not allowed.',
      code: 'PRIVATE_KEY_NOT_ALLOWED',
    });
  }

  if (!ALLOWED_CERTIFICATE_EXTENSIONS.has(fileExtension)) {
    throw new BadRequestException({
      message: 'Only PEM, CRT and CER certificate files are supported.',
      code: 'UNSUPPORTED_CERTIFICATE_FORMAT',
    });
  }

  if (content.length === 0) {
    throw new BadRequestException({
      message: 'The uploaded certificate file is empty.',
      code: 'INVALID_CERTIFICATE',
    });
  }

  const pemContent = content.toString('utf8').trim();

  if (!pemContent) {
    throw new BadRequestException({
      message: 'The uploaded certificate file is empty.',
      code: 'INVALID_CERTIFICATE',
    });
  }

  if (PRIVATE_KEY_MARKERS.some((marker) => pemContent.includes(marker))) {
    throw new BadRequestException({
      message: 'Private keys are not allowed in trusted CA uploads.',
      code: 'PRIVATE_KEY_NOT_ALLOWED',
    });
  }

  const certificateBlocks = pemContent.match(CERTIFICATE_BLOCK_PATTERN) ?? [];

  if (certificateBlocks.length !== 1) {
    throw new BadRequestException({
      message: 'The uploaded certificate must contain exactly one PEM-encoded certificate.',
      code: 'UNSUPPORTED_CERTIFICATE_FORMAT',
    });
  }

  let certificate: X509Certificate;

  try {
    certificate = new X509Certificate(certificateBlocks[0]);
  } catch {
    throw new BadRequestException({
      message: 'The uploaded certificate could not be parsed.',
      code: 'INVALID_CERTIFICATE',
    });
  }

  if (!certificate.ca) {
    throw new BadRequestException({
      message: 'The uploaded certificate is not a certificate authority.',
      code: 'CERTIFICATE_NOT_CA',
    });
  }

  const validTo = certificate.validToDate;

  if (validTo.getTime() <= Date.now()) {
    throw new BadRequestException({
      message: 'Expired certificates cannot be registered as trusted CAs.',
      code: 'CERTIFICATE_EXPIRED',
    });
  }

  return {
    certificatePem: `${certificate.toString().trim()}\n`,
    fingerprintSha256: certificate.fingerprint256,
    subject: certificate.subject,
    issuer: certificate.issuer,
    serialNumber: certificate.serialNumber,
    validFrom: certificate.validFromDate,
    validTo,
    isRoot: certificate.subject === certificate.issuer,
  };
}
