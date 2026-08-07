import { HealthService } from '../../../src/modules/health/health.service';
import { createMockPrismaService, resetMockPrismaService } from '../../helpers/prisma-mock.helper';
import type { MockPrismaService } from '../../helpers/prisma-mock.helper';

describe('HealthService', () => {
  let service: HealthService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new HealthService(prisma);
  });

  afterEach(() => {
    resetMockPrismaService(prisma);
    jest.clearAllMocks();
  });

  describe('getHealth', () => {
    it('returns a healthy response when the database check succeeds', async () => {
      prisma.$queryRaw.mockResolvedValue([{ result: 1 }] as never);

      const result = await service.getHealth();

      expect(result.status).toBe('ok');
      expect(result.application).toBe('Gateway Hub LF');
      expect(result.database).toBe('connected');
      expect(typeof result.uptime).toBe('number');
      expect(() => new Date(result.timestamp)).not.toThrow();
    });

    it('propagates the error when the database check fails', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));

      await expect(service.getHealth()).rejects.toThrow('connection refused');
    });
  });
});
