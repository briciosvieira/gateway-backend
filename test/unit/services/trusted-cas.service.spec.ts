import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { AuditLogsService } from '../../../src/modules/audit-logs/audit-logs.service';
import type { TrustedCaDispatcherService } from '../../../src/modules/trusted-cas/trusted-ca-dispatcher.service';
import { TrustedCasService } from '../../../src/modules/trusted-cas/trusted-cas.service';
import { parseTrustedCaCertificate } from '../../../src/modules/trusted-cas/utils/trusted-ca-certificate.util';
import { authenticatedAdminFixture } from '../../fixtures/users.fixture';
import {
  createMockPrismaService,
  mockTransactionArray,
  resetMockPrismaService,
} from '../../helpers/prisma-mock.helper';
import type { MockPrismaService } from '../../helpers/prisma-mock.helper';

jest.mock('../../../src/modules/trusted-cas/utils/trusted-ca-certificate.util', () => ({
  parseTrustedCaCertificate: jest.fn(),
}));

const mockParseTrustedCaCertificate = jest.mocked(parseTrustedCaCertificate);

const requestContext = {
  sourceIp: '203.0.113.10',
  requestId: 'req-trusted-ca-1',
};

const parsedCertificate = {
  certificatePem: '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n',
  fingerprintSha256: 'AA:BB:CC:DD',
  subject: 'CN=Gateway Hub LF Root CA',
  issuer: 'CN=Gateway Hub LF Root CA',
  serialNumber: '01AB23CD',
  validFrom: new Date('2026-01-01T00:00:00.000Z'),
  validTo: new Date('2036-01-01T00:00:00.000Z'),
  isRoot: true,
};

const trustedCaFixture = {
  id: 'trusted-ca-1',
  name: 'Gateway Hub LF Root CA',
  fingerprintSha256: parsedCertificate.fingerprintSha256,
  subject: parsedCertificate.subject,
  issuer: parsedCertificate.issuer,
  serialNumber: parsedCertificate.serialNumber,
  validFrom: parsedCertificate.validFrom,
  validTo: parsedCertificate.validTo,
  isRoot: true,
  active: true,
  createdById: authenticatedAdminFixture.id,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('TrustedCasService', () => {
  let service: TrustedCasService;
  let prisma: MockPrismaService;
  let auditLogsService: { create: jest.Mock };
  let trustedCaDispatcherService: { invalidateDispatcher: jest.Mock };

  beforeEach(() => {
    prisma = createMockPrismaService();
    auditLogsService = { create: jest.fn().mockResolvedValue(undefined) };
    trustedCaDispatcherService = {
      invalidateDispatcher: jest.fn().mockResolvedValue(undefined),
    };

    service = new TrustedCasService(
      prisma,
      auditLogsService as unknown as AuditLogsService,
      trustedCaDispatcherService as unknown as TrustedCaDispatcherService,
    );

    mockParseTrustedCaCertificate.mockReturnValue(parsedCertificate);
  });

  afterEach(() => {
    resetMockPrismaService(prisma);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('creates a trusted CA, invalidates the dispatcher cache and returns public metadata only', async () => {
      prisma.trustedCa.findUnique.mockResolvedValue(null);
      prisma.trustedCa.create.mockResolvedValue(trustedCaFixture as never);

      const result = await service.create(authenticatedAdminFixture, requestContext, {
        name: '  Gateway Hub LF Root CA  ',
        filename: 'root-ca.pem',
        buffer: Buffer.from('certificate', 'utf8'),
      });

      expect(result).toEqual(trustedCaFixture);
      expect(result).not.toHaveProperty('certificatePem');
      expect(prisma.trustedCa.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Gateway Hub LF Root CA',
          certificatePem: parsedCertificate.certificatePem,
          fingerprintSha256: parsedCertificate.fingerprintSha256,
          createdById: authenticatedAdminFixture.id,
        }),
        select: expect.any(Object),
      });
      expect(trustedCaDispatcherService.invalidateDispatcher).toHaveBeenCalledTimes(1);
      expect(auditLogsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          entity: 'TRUSTED_CA',
          entityId: trustedCaFixture.id,
        }),
      );
    });

    it('rejects duplicate fingerprints with TRUSTED_CA_ALREADY_EXISTS', async () => {
      prisma.trustedCa.findUnique.mockResolvedValue({ id: trustedCaFixture.id } as never);

      await expect(
        service.create(authenticatedAdminFixture, requestContext, {
          name: trustedCaFixture.name,
          filename: 'root-ca.pem',
          buffer: Buffer.from('certificate', 'utf8'),
        }),
      ).rejects.toThrow(ConflictException);

      expect(prisma.trustedCa.create).not.toHaveBeenCalled();
      expect(trustedCaDispatcherService.invalidateDispatcher).not.toHaveBeenCalled();
    });

    it('rejects names that become too short after trimming', async () => {
      await expect(
        service.create(authenticatedAdminFixture, requestContext, {
          name: '  a ',
          filename: 'root-ca.pem',
          buffer: Buffer.from('certificate', 'utf8'),
        }),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.trustedCa.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('returns paginated trusted CAs and echoes the filters', async () => {
      mockTransactionArray(prisma, [[trustedCaFixture], 1]);

      const result = await service.findAll({
        page: 1,
        limit: 20,
        search: 'Gateway',
        active: true,
        validity: 'valid',
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });

      expect(result.items).toEqual([trustedCaFixture]);
      expect(result.pagination.totalPages).toBe(1);
      expect(result.filters).toEqual({
        search: 'Gateway',
        active: true,
        validity: 'valid',
        sortBy: 'createdAt',
        sortOrder: 'desc',
      });
    });
  });

  describe('findOne', () => {
    it('returns the trusted CA when it exists', async () => {
      prisma.trustedCa.findUnique.mockResolvedValue(trustedCaFixture as never);

      await expect(service.findOne(trustedCaFixture.id)).resolves.toEqual(trustedCaFixture);
    });

    it('throws NotFoundException when the trusted CA does not exist', async () => {
      prisma.trustedCa.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
    });
  });

  describe('changeStatus', () => {
    it('returns the current trusted CA unchanged when the target status is already applied', async () => {
      prisma.trustedCa.findUnique.mockResolvedValue(trustedCaFixture as never);

      const result = await service.changeStatus(
        authenticatedAdminFixture,
        requestContext,
        trustedCaFixture.id,
        { active: true },
      );

      expect(result).toEqual(trustedCaFixture);
      expect(prisma.trustedCa.update).not.toHaveBeenCalled();
      expect(trustedCaDispatcherService.invalidateDispatcher).not.toHaveBeenCalled();
    });

    it('deactivates the trusted CA and invalidates the dispatcher cache', async () => {
      prisma.trustedCa.findUnique.mockResolvedValue(trustedCaFixture as never);
      prisma.trustedCa.update.mockResolvedValue({
        ...trustedCaFixture,
        active: false,
      } as never);

      const result = await service.changeStatus(
        authenticatedAdminFixture,
        requestContext,
        trustedCaFixture.id,
        { active: false },
      );

      expect(result.active).toBe(false);
      expect(trustedCaDispatcherService.invalidateDispatcher).toHaveBeenCalledTimes(1);
      expect(auditLogsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEACTIVATE',
          entityId: trustedCaFixture.id,
        }),
      );
    });
  });

  describe('remove', () => {
    it('deletes the trusted CA and invalidates the dispatcher cache', async () => {
      prisma.trustedCa.findUnique.mockResolvedValue(trustedCaFixture as never);
      prisma.trustedCa.delete.mockResolvedValue(trustedCaFixture as never);

      await service.remove(authenticatedAdminFixture, requestContext, trustedCaFixture.id);

      expect(prisma.trustedCa.delete).toHaveBeenCalledWith({
        where: { id: trustedCaFixture.id },
      });
      expect(trustedCaDispatcherService.invalidateDispatcher).toHaveBeenCalledTimes(1);
      expect(auditLogsService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DELETE',
          entityId: trustedCaFixture.id,
        }),
      );
    });
  });
});
