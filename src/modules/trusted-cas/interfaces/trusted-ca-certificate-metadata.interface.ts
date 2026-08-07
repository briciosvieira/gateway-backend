export interface TrustedCaCertificateMetadata {
  certificatePem: string;
  fingerprintSha256: string;
  subject: string;
  issuer: string;
  serialNumber: string;
  validFrom: Date;
  validTo: Date;
  isRoot: boolean;
}
