import { AuditAction, AuditEntity } from '../../../generated/prisma/client';
import { AuditLogsService } from '../../../src/modules/audit-logs/audit-logs.service';
import type { CreateAuditLogInput } from '../../../src/modules/audit-logs/interfaces/create-audit-log.interface';
import {
  createMockPrismaService,
  mockTransactionArray,
  resetMockPrismaService,
} from '../../helpers/prisma-mock.helper';
import type { MockPrismaService } from '../../helpers/prisma-mock.helper';

interface AuditLogRecordFixture {
  id: string;
  action: AuditAction;
  entity: AuditEntity;
  entityId: string | null;
  previousValue: unknown;
  newValue: unknown;
  sourceIp: string | null;
  requestId: string | null;
  description: string | null;
  createdAt: Date;
  user: {
    id: string;
    name: string;
    username: string;
    role: { code: string; name: string } | null;
  } | null;
}

function buildAuditLogFixture(
  overrides: Partial<AuditLogRecordFixture> = {},
): AuditLogRecordFixture {
  return {
    id: 'audit-log-fixture-id',
    action: AuditAction.CREATE,
    entity: AuditEntity.CLIENT,
    entityId: 'client-1',
    previousValue: null,
    newValue: { name: 'Fixture Client' },
    sourceIp: '203.0.113.10',
    requestId: 'req-1',
    description: 'Client was created.',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    user: {
      id: 'user-1',
      name: 'Fixture Admin',
      username: 'fixture.admin',
      role: { code: 'ADMIN', name: 'Administrator' },
    },
    ...overrides,
  };
}

interface FindManyCallArgs {
  where: unknown;
  skip: number;
  take: number;
}

interface CountCallArgs {
  where: unknown;
}

describe('AuditLogsService', () => {
  let service: AuditLogsService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new AuditLogsService(prisma);
  });

  afterEach(() => {
    resetMockPrismaService(prisma);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('creates an audit log using all fields when they are provided', async () => {
      const input: CreateAuditLogInput = {
        userId: 'user-1',
        action: AuditAction.UPDATE,
        entity: AuditEntity.CLIENT,
        entityId: 'client-1',
        previousValue: { name: 'Old Name' },
        newValue: { name: 'New Name' },
        sourceIp: '203.0.113.10',
        requestId: 'req-1',
        description: 'Client was updated.',
      };

      await service.create(input);

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          action: AuditAction.UPDATE,
          entity: AuditEntity.CLIENT,
          entityId: 'client-1',
          previousValue: { name: 'Old Name' },
          newValue: { name: 'New Name' },
          sourceIp: '203.0.113.10',
          requestId: 'req-1',
          description: 'Client was updated.',
        },
      });
    });

    it('defaults optional fields to null when they are not provided', async () => {
      const input: CreateAuditLogInput = {
        action: AuditAction.LOGIN,
        entity: AuditEntity.USER,
      };

      await service.create(input);

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: null,
          action: AuditAction.LOGIN,
          entity: AuditEntity.USER,
          entityId: null,
          previousValue: undefined,
          newValue: undefined,
          sourceIp: null,
          requestId: null,
          description: null,
        },
      });
    });

    it('resolves without returning a value', async () => {
      const input: CreateAuditLogInput = {
        action: AuditAction.LOGOUT,
        entity: AuditEntity.USER,
      };

      await expect(service.create(input)).resolves.toBeUndefined();
    });
  });

  describe('findAll', () => {
    it('builds an empty where clause when no filters are provided', async () => {
      mockTransactionArray(prisma, [[], 0]);

      await service.findAll({ page: 1, limit: 20 });

      const findManyArgs = prisma.auditLog.findMany.mock.calls[0][0] as FindManyCallArgs;
      const countArgs = prisma.auditLog.count.mock.calls[0][0] as CountCallArgs;

      expect(findManyArgs.where).toEqual({});
      expect(countArgs.where).toEqual({});
    });

    it('filters by action when provided', async () => {
      mockTransactionArray(prisma, [[], 0]);

      await service.findAll({ page: 1, limit: 20, action: AuditAction.DELETE });

      const findManyArgs = prisma.auditLog.findMany.mock.calls[0][0] as FindManyCallArgs;
      expect(findManyArgs.where).toEqual({ action: AuditAction.DELETE });
    });

    it('filters by entity when provided', async () => {
      mockTransactionArray(prisma, [[], 0]);

      await service.findAll({ page: 1, limit: 20, entity: AuditEntity.API_KEY });

      const findManyArgs = prisma.auditLog.findMany.mock.calls[0][0] as FindManyCallArgs;
      expect(findManyArgs.where).toEqual({ entity: AuditEntity.API_KEY });
    });

    it('filters by userId when provided', async () => {
      mockTransactionArray(prisma, [[], 0]);

      await service.findAll({ page: 1, limit: 20, userId: 'user-1' });

      const findManyArgs = prisma.auditLog.findMany.mock.calls[0][0] as FindManyCallArgs;
      expect(findManyArgs.where).toEqual({ userId: 'user-1' });
    });

    it('filters by entityId when provided', async () => {
      mockTransactionArray(prisma, [[], 0]);

      await service.findAll({ page: 1, limit: 20, entityId: 'client-1' });

      const findManyArgs = prisma.auditLog.findMany.mock.calls[0][0] as FindManyCallArgs;
      expect(findManyArgs.where).toEqual({ entityId: 'client-1' });
    });

    it('filters by requestId when provided', async () => {
      mockTransactionArray(prisma, [[], 0]);

      await service.findAll({ page: 1, limit: 20, requestId: 'req-1' });

      const findManyArgs = prisma.auditLog.findMany.mock.calls[0][0] as FindManyCallArgs;
      expect(findManyArgs.where).toEqual({ requestId: 'req-1' });
    });

    it('filters by createdAt gte when only startDate is provided', async () => {
      mockTransactionArray(prisma, [[], 0]);

      await service.findAll({
        page: 1,
        limit: 20,
        startDate: '2026-01-01T00:00:00.000Z',
      });

      const findManyArgs = prisma.auditLog.findMany.mock.calls[0][0] as FindManyCallArgs;
      expect(findManyArgs.where).toEqual({
        createdAt: { gte: new Date('2026-01-01T00:00:00.000Z') },
      });
    });

    it('filters by createdAt lte when only endDate is provided', async () => {
      mockTransactionArray(prisma, [[], 0]);

      await service.findAll({
        page: 1,
        limit: 20,
        endDate: '2026-01-31T23:59:59.000Z',
      });

      const findManyArgs = prisma.auditLog.findMany.mock.calls[0][0] as FindManyCallArgs;
      expect(findManyArgs.where).toEqual({
        createdAt: { lte: new Date('2026-01-31T23:59:59.000Z') },
      });
    });

    it('filters by createdAt gte and lte when both startDate and endDate are provided', async () => {
      mockTransactionArray(prisma, [[], 0]);

      await service.findAll({
        page: 1,
        limit: 20,
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-31T23:59:59.000Z',
      });

      const findManyArgs = prisma.auditLog.findMany.mock.calls[0][0] as FindManyCallArgs;
      expect(findManyArgs.where).toEqual({
        createdAt: {
          gte: new Date('2026-01-01T00:00:00.000Z'),
          lte: new Date('2026-01-31T23:59:59.000Z'),
        },
      });
    });

    it('combines every filter together when all of them are provided', async () => {
      mockTransactionArray(prisma, [[], 0]);

      await service.findAll({
        page: 1,
        limit: 20,
        action: AuditAction.UPDATE,
        entity: AuditEntity.CLIENT,
        userId: 'user-1',
        entityId: 'client-1',
        requestId: 'req-1',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-01-31T23:59:59.000Z',
      });

      const findManyArgs = prisma.auditLog.findMany.mock.calls[0][0] as FindManyCallArgs;
      const countArgs = prisma.auditLog.count.mock.calls[0][0] as CountCallArgs;

      const expectedWhere = {
        action: AuditAction.UPDATE,
        entity: AuditEntity.CLIENT,
        userId: 'user-1',
        entityId: 'client-1',
        requestId: 'req-1',
        createdAt: {
          gte: new Date('2026-01-01T00:00:00.000Z'),
          lte: new Date('2026-01-31T23:59:59.000Z'),
        },
      };

      expect(findManyArgs.where).toEqual(expectedWhere);
      expect(countArgs.where).toEqual(expectedWhere);
    });

    it('applies skip and take based on page and limit', async () => {
      mockTransactionArray(prisma, [[], 0]);

      await service.findAll({ page: 3, limit: 10 });

      const findManyArgs = prisma.auditLog.findMany.mock.calls[0][0] as FindManyCallArgs;
      expect(findManyArgs.skip).toBe(20);
      expect(findManyArgs.take).toBe(10);
    });

    it('returns paginated items with computed totalPages', async () => {
      const record = buildAuditLogFixture();
      mockTransactionArray(prisma, [[record], 1]);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result.items).toEqual([record]);
      expect(result.pagination).toEqual({ page: 1, limit: 10, total: 1, totalPages: 1 });
    });

    it('returns totalPages 0 when there are no results', async () => {
      mockTransactionArray(prisma, [[], 0]);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result.pagination.totalPages).toBe(0);
    });

    it('computes totalPages by rounding up when total is not a multiple of limit', async () => {
      mockTransactionArray(prisma, [[buildAuditLogFixture()], 11]);

      const result = await service.findAll({ page: 1, limit: 10 });

      expect(result.pagination.totalPages).toBe(2);
    });
  });

  describe('findOne', () => {
    it('returns the audit log when found', async () => {
      const record = buildAuditLogFixture();
      prisma.auditLog.findUnique.mockResolvedValue(record as never);

      await expect(service.findOne(record.id)).resolves.toEqual(record);
    });

    it('returns null when the audit log is not found', async () => {
      prisma.auditLog.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).resolves.toBeNull();
    });
  });
});
