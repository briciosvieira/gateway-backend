import { randomBytes } from 'node:crypto';
import forge from 'node-forge';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_VALIDITY_DAYS = 3650;

export interface TestCertificateAuthority {
  commonName: string;
  certificatePem: string;
  privateKeyPem: string;
  certificate: forge.pki.Certificate;
  privateKey: forge.pki.rsa.PrivateKey;
}

export interface TestServerCertificate {
  commonName: string;
  certificatePem: string;
  privateKeyPem: string;
}

interface CreateCertificateAuthorityOptions {
  commonName?: string;
  expired?: boolean;
  issuerCa?: TestCertificateAuthority;
  hosts?: string[];
}

interface CreateServerCertificateOptions {
  commonName?: string;
  hosts?: string[];
}

function buildCertificateAttributes(commonName: string): forge.pki.CertificateField[] {
  return [
    { name: 'commonName', value: commonName },
    { name: 'organizationName', value: 'Gateway Hub LF Tests' },
    { shortName: 'OU', value: 'Backend' },
    { name: 'countryName', value: 'BR' },
  ];
}

function buildValidityWindow(expired = false): { notBefore: Date; notAfter: Date } {
  const now = Date.now();

  if (expired) {
    return {
      notBefore: new Date(now - (2 * ONE_DAY_MS)),
      notAfter: new Date(now - ONE_DAY_MS),
    };
  }

  return {
    notBefore: new Date(now - ONE_DAY_MS),
    notAfter: new Date(now + (DEFAULT_VALIDITY_DAYS * ONE_DAY_MS)),
  };
}

function generateSerialNumber(): string {
  return randomBytes(16).toString('hex');
}

function buildAltNames(hosts: string[]): Array<{ type: 2; value: string } | { type: 7; ip: string }> {
  return hosts.map((host) => {
    const isIpv4Address = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);

    return isIpv4Address
      ? { type: 7, ip: host }
      : { type: 2, value: host };
  });
}

export function createTestCertificateAuthority(
  options: CreateCertificateAuthorityOptions = {},
): TestCertificateAuthority {
  const commonName = options.commonName ?? 'Gateway Hub LF Test Root CA';
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const certificate = forge.pki.createCertificate();
  const validity = buildValidityWindow(options.expired);
  const subjectAttributes = buildCertificateAttributes(commonName);
  const issuer = options.issuerCa ?? null;
  const hosts = options.hosts ?? [];

  certificate.version = 2;
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = generateSerialNumber();
  certificate.validity.notBefore = validity.notBefore;
  certificate.validity.notAfter = validity.notAfter;
  certificate.setSubject(subjectAttributes);
  certificate.setIssuer(issuer ? issuer.certificate.subject.attributes : subjectAttributes);
  certificate.setExtensions([
    { name: 'basicConstraints', cA: true, pathLenConstraint: 1 },
    {
      name: 'keyUsage',
      keyCertSign: true,
      cRLSign: true,
      digitalSignature: true,
      keyEncipherment: hosts.length > 0,
    },
    ...(hosts.length > 0
      ? [
          {
            name: 'extKeyUsage',
            serverAuth: true,
          },
          {
            name: 'subjectAltName',
            altNames: buildAltNames(hosts),
          },
        ]
      : []),
    { name: 'subjectKeyIdentifier' },
    { name: 'authorityKeyIdentifier', keyIdentifier: true },
  ]);
  certificate.sign(
    issuer ? issuer.privateKey : keys.privateKey,
    forge.md.sha256.create(),
  );

  return {
    commonName,
    certificatePem: forge.pki.certificateToPem(certificate),
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
    certificate,
    privateKey: keys.privateKey as forge.pki.rsa.PrivateKey,
  };
}

export function createTestServerCertificate(
  issuerCa: TestCertificateAuthority,
  options: CreateServerCertificateOptions = {},
): TestServerCertificate {
  const commonName = options.commonName ?? '127.0.0.1';
  const hosts = options.hosts ?? ['127.0.0.1', 'localhost'];
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const certificate = forge.pki.createCertificate();
  const validity = buildValidityWindow(false);

  certificate.version = 2;
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = generateSerialNumber();
  certificate.validity.notBefore = validity.notBefore;
  certificate.validity.notAfter = validity.notAfter;
  certificate.setSubject(buildCertificateAttributes(commonName));
  certificate.setIssuer(issuerCa.certificate.subject.attributes);
  certificate.setExtensions([
    { name: 'basicConstraints', cA: false },
    {
      name: 'keyUsage',
      digitalSignature: true,
      keyEncipherment: true,
    },
    {
      name: 'extKeyUsage',
      serverAuth: true,
    },
    {
      name: 'subjectAltName',
      altNames: buildAltNames(hosts),
    },
    { name: 'subjectKeyIdentifier' },
    { name: 'authorityKeyIdentifier', keyIdentifier: true },
  ]);
  certificate.sign(issuerCa.privateKey, forge.md.sha256.create());

  return {
    commonName,
    certificatePem: forge.pki.certificateToPem(certificate),
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

export function createTestLeafCertificate(
  options: CreateServerCertificateOptions = {},
): TestServerCertificate {
  const leafCa = createTestCertificateAuthority({
    commonName: options.commonName ?? 'Gateway Hub LF Test Leaf',
  });
  const leafCertificate = createTestServerCertificate(leafCa, options);

  return leafCertificate;
}
