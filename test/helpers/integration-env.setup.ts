import { config } from 'dotenv';
import { join } from 'node:path';

config({ path: join(__dirname, '..', '..', '.env') });

if (!process.env.DATABASE_URL_TEST) {
  throw new Error(
    'DATABASE_URL_TEST is not configured. Set it in .env before running integration or e2e tests.',
  );
}

// Integration and e2e tests must never touch the development/production database.
// Overriding DATABASE_URL here means every module that reads it (PrismaService,
// prisma.config.ts) transparently points at the test database instead.
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
process.env.NODE_ENV = 'test';
