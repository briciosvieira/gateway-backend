import { RoleCode } from '../../../generated/prisma/client';
import { RolesService } from '../../../src/modules/roles/roles.service';
import { authenticatedAdminFixture, authenticatedOperatorFixture } from '../../fixtures/users.fixture';
import { createMockPrismaService, resetMockPrismaService } from '../../helpers/prisma-mock.helper';
import type { MockPrismaService } from '../../helpers/prisma-mock.helper';

describe('RolesService', () => {
  let service: RolesService;
  let prisma: MockPrismaService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new RolesService(prisma);
  });

  afterEach(() => {
    resetMockPrismaService(prisma);
    jest.clearAllMocks();
  });

  describe('findAvailable', () => {
    it('includes ADMIN in the available codes when the current user is an ADMIN', async () => {
      prisma.role.findMany.mockResolvedValue([]);

      await service.findAvailable(authenticatedAdminFixture);

      expect(prisma.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            active: true,
            code: { in: [RoleCode.ADMIN, RoleCode.OPERATOR, RoleCode.VIEWER, RoleCode.AUDITOR] },
          }),
        }),
      );
    });

    it('excludes ADMIN from the available codes for a non-ADMIN user', async () => {
      prisma.role.findMany.mockResolvedValue([]);

      await service.findAvailable(authenticatedOperatorFixture);

      expect(prisma.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            code: { in: [RoleCode.OPERATOR, RoleCode.VIEWER, RoleCode.AUDITOR] },
          }),
        }),
      );
    });

    it('returns the roles resolved by Prisma', async () => {
      const roles = [{ id: 'role-1', code: RoleCode.OPERATOR, name: 'Operator', description: null, level: 50 }];
      prisma.role.findMany.mockResolvedValue(roles as never);

      await expect(service.findAvailable(authenticatedOperatorFixture)).resolves.toEqual(roles);
    });
  });
});
