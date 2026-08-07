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

async function seedInitialAdmin(): Promise<void> {
  const name = process.env.INITIAL_ADMIN_NAME;
  const username = process.env.INITIAL_ADMIN_USERNAME;
  const email = process.env.INITIAL_ADMIN_EMAIL;
  const password = process.env.INITIAL_ADMIN_PASSWORD;

  if (!name || !username || !email || !password) {
    throw new Error(
      'Initial administrator environment variables are not configured.',
    );
  }

  const adminRole = await prisma.role.findUnique({
    where: {
      code: RoleCode.ADMIN,
    },
  });

  if (!adminRole) {
    throw new Error('ADMIN role was not found.');
  }

  const normalizedUsername = username.trim().toLowerCase();
  const normalizedEmail = email.trim().toLowerCase();

  const existingAdmin = await prisma.user.findFirst({
    where: {
      OR: [
        {
          username: normalizedUsername,
        },
        {
          email: normalizedEmail,
        },
      ],
    },
  });

  if (existingAdmin) {
    console.log('Initial administrator already exists.');
    return;
  }

  const passwordHash = await argon2.hash(password);

  await prisma.user.create({
    data: {
      name: name.trim(),
      username: normalizedUsername,
      email: normalizedEmail,
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
