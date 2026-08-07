import { X509Certificate } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { parseTrustedCaCertificate } from '../../../src/modules/trusted-cas/utils/trusted-ca-certificate.util';
import {
  createTestCertificateAuthority,
  createTestLeafCertificate,
} from '../../helpers/tls-certificate.helper';

describe('parseTrustedCaCertificate', () => {
  it('parses a valid root CA PEM and extracts metadata', () => {
    const trustedCa = createTestCertificateAuthority({
      commonName: 'Gateway Hub LF Root CA',
    });
    const expectedCertificate = new X509Certificate(trustedCa.certificatePem);

    const result = parseTrustedCaCertificate(
      'root-ca.pem',
      Buffer.from(trustedCa.certificatePem, 'utf8'),
    );

    expect(result.isRoot).toBe(true);
    expect(result.subject).toContain('CN=Gateway Hub LF Root CA');
    expect(result.issuer).toContain('CN=Gateway Hub LF Root CA');
    expect(result.fingerprintSha256).toBe(expectedCertificate.fingerprint256);
    expect(result.certificatePem).toContain('BEGIN CERTIFICATE');
  });

  it('accepts an intermediate CA and marks it as non-root', () => {
    const rootCa = createTestCertificateAuthority({
      commonName: 'Gateway Hub LF Root CA',
    });
    const intermediateCa = createTestCertificateAuthority({
      commonName: 'Gateway Hub LF Intermediate CA',
      issuerCa: rootCa,
    });

    const result = parseTrustedCaCertificate(
      'intermediate.crt',
      Buffer.from(intermediateCa.certificatePem, 'utf8'),
    );

    expect(result.isRoot).toBe(false);
    expect(result.subject).toContain('CN=Gateway Hub LF Intermediate CA');
    expect(result.issuer).toContain('CN=Gateway Hub LF Root CA');
  });

  it('rejects a regular server certificate', () => {
    const serverCertificate = createTestLeafCertificate({
      commonName: '127.0.0.1',
      hosts: ['127.0.0.1'],
    });

    expect(() =>
      parseTrustedCaCertificate(
        'server.pem',
        Buffer.from(serverCertificate.certificatePem, 'utf8'),
      ),
    ).toThrow(BadRequestException);

    expect(() =>
      parseTrustedCaCertificate(
        'server.pem',
        Buffer.from(serverCertificate.certificatePem, 'utf8'),
      ),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'CERTIFICATE_NOT_CA' }),
      }),
    );
  });

  it('rejects an expired CA certificate', () => {
    const expiredCa = createTestCertificateAuthority({
      commonName: 'Expired Gateway Hub LF Root CA',
      expired: true,
    });

    expect(() =>
      parseTrustedCaCertificate(
        'expired.cer',
        Buffer.from(expiredCa.certificatePem, 'utf8'),
      ),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'CERTIFICATE_EXPIRED' }),
      }),
    );
  });

  it('rejects empty uploads', () => {
    expect(() => parseTrustedCaCertificate('empty.pem', Buffer.alloc(0))).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'INVALID_CERTIFICATE' }),
      }),
    );
  });

  it('rejects invalid PEM payloads', () => {
    expect(() =>
      parseTrustedCaCertificate('invalid.pem', Buffer.from('not-a-certificate', 'utf8')),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'UNSUPPORTED_CERTIFICATE_FORMAT' }),
      }),
    );
  });

  it('rejects private key files by extension', () => {
    expect(() =>
      parseTrustedCaCertificate(
        'internal.key',
        Buffer.from('-----BEGIN PRIVATE KEY-----', 'utf8'),
      ),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'PRIVATE_KEY_NOT_ALLOWED' }),
      }),
    );
  });

  it('rejects private key markers inside a PEM upload', () => {
    expect(() =>
      parseTrustedCaCertificate(
        'internal.pem',
        Buffer.from('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----', 'utf8'),
      ),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'PRIVATE_KEY_NOT_ALLOWED' }),
      }),
    );
  });

  it.each(['bundle.pfx', 'bundle.p12'] as const)(
    'rejects PKCS#12 uploads (%s)',
    (filename) => {
      expect(() =>
        parseTrustedCaCertificate(filename, Buffer.from('binary', 'utf8')),
      ).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({ code: 'PRIVATE_KEY_NOT_ALLOWED' }),
        }),
      );
    },
  );

  it('rejects unsupported extensions', () => {
    const trustedCa = createTestCertificateAuthority();

    expect(() =>
      parseTrustedCaCertificate(
        'root-ca.txt',
        Buffer.from(trustedCa.certificatePem, 'utf8'),
      ),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({
          code: 'UNSUPPORTED_CERTIFICATE_FORMAT',
        }),
      }),
    );
  });
});
