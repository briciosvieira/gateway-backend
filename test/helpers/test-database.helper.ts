import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, RoleCode } from '../../generated/prisma/client';

const ROLE_CATALOG = [
  { code: RoleCode.ADMIN, name: 'Administrator', level: 100 },
  { code: RoleCode.OPERATOR, name: 'Operator', level: 50 },
  { code: RoleCode.VIEWER, name: 'Viewer', level: 20 },
  { code: RoleCode.AUDITOR, name: 'Auditor', level: 10 },
];

/**
 * Wraps a real PrismaClient connected to DATABASE_URL_TEST (never the
 * development/production database — integration-env.setup.ts enforces the
 * override before this file is ever imported). Used by integration and e2e
 * tests to seed the fixed role catalog and wipe all test data between runs.
 */
export class TestDatabase {
  readonly prisma: PrismaClient;

  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString || !connectionString.includes('gateway_hub_test')) {
      throw new Error(
        'TestDatabase refused to initialize: DATABASE_URL does not point to the test database.',
      );
    }

    const adapter = new PrismaPg({ connectionString });
    this.prisma = new PrismaClient({ adapter });
  }

  async connect(): Promise<void> {
    await this.prisma.$connect();
    await this.ensureRolesSeeded();
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }

  async ensureRolesSeeded(): Promise<void> {
    for (const role of ROLE_CATALOG) {
      await this.prisma.role.upsert({
        where: { code: role.code },
        update: { name: role.name, level: role.level, active: true },
        create: {
          code: role.code,
          name: role.name,
          description: `${role.name} role.`,
          level: role.level,
        },
      });
    }
  }

  async getRoleId(code: RoleCode): Promise<string> {
    const role = await this.prisma.role.findUniqueOrThrow({ where: { code } });

    return role.id;
  }

  /** Deletes every test-created record, in FK-safe order. Roles are kept — they are a fixed catalog, not test data. */
  async cleanDatabase(): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.requestLog.deleteMany(),
      this.prisma.routeHeader.deleteMany(),
      this.prisma.trustedCa.deleteMany(),
      this.prisma.apiKey.deleteMany(),
      this.prisma.allowedIp.deleteMany(),
      this.prisma.gatewayRoute.deleteMany(),
      this.prisma.client.deleteMany(),
      this.prisma.auditLog.deleteMany(),
      this.prisma.refreshToken.deleteMany(),
      this.prisma.user.deleteMany(),
    ]);
  }
}
