import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { PrismaClient, RoleCode } from '../generated/prisma/client';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not configured.');
}

const adapter = new PrismaPg({
  connectionString,
});

const prisma = new PrismaClient({
  adapter,
});

async function seedRoles(): Promise<void> {
  const roles = [
    {
      code: RoleCode.ADMIN,
      name: 'Administrator',
      description: 'Full access to the Gateway Hub LF.',
      level: 100,
    },
    {
      code: RoleCode.OPERATOR,
      name: 'Operator',
      description:
        'Operational access and management of non-administrator users.',
      level: 50,
    },
    {
      code: RoleCode.VIEWER,
      name: 'Viewer',
      description: 'Read-only access to permitted resources.',
      level: 20,
    },
    {
      code: RoleCode.AUDITOR,
      name: 'Auditor',
      description: 'Read-only access to logs and audit records.',
      level: 10,
    },
  ];

  for (const role of roles) {
    await prisma.role.upsert({
      where: {
        code: role.code,
      },
      update: {
        name: role.name,
        description: role.description,
        level: role.level,
        active: true,
      },
      create: role,
    });
  }

  console.log('Roles synchronized successfully.');
}

const INITIAL_ADMIN_NAME = 'Administrator';
const INITIAL_ADMIN_USERNAME = 'administrator';
const INITIAL_ADMIN_EMAIL = 'administrator@gatewayhub.local';
const INITIAL_ADMIN_PASSWORD = 'Admin@123';

/**
 * Creates the single fixed bootstrap administrator only when it does not
 * exist yet. This never runs an `update` branch on purpose — once created,
 * this record must never be touched again by the seed, even if it was
 * hashed under an older algorithm/version or its fields were edited by an
 * operator, so that re-running `docker compose up --build` (or any restart)
 * can never reset a password the administrator has already changed.
 */
async function seedInitialAdmin(): Promise<void> {
  const adminRole = await prisma.role.findUnique({
    where: {
      code: RoleCode.ADMIN,
    },
  });

  if (!adminRole) {
    throw new Error('ADMIN role was not found.');
  }

  const existingAdmin = await prisma.user.findUnique({
    where: {
      username: INITIAL_ADMIN_USERNAME,
    },
  });

  if (existingAdmin) {
    console.log('Initial administrator already exists. Skipping creation.');
    return;
  }

  const passwordHash = await argon2.hash(INITIAL_ADMIN_PASSWORD);

  await prisma.user.create({
    data: {
      name: INITIAL_ADMIN_NAME,
      username: INITIAL_ADMIN_USERNAME,
      email: INITIAL_ADMIN_EMAIL,
      passwordHash,
      roleId: adminRole.id,
      active: true,
      firstLogin: true,
    },
  });

  console.log('Initial administrator created successfully.');
}

async function main(): Promise<void> {
  await seedRoles();
  await seedInitialAdmin();
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
