import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../../generated/prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnApplicationShutdown
{
  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL is not configured.');
    }

    // The pg driver defaults to a 10-connection pool, which starved under
    // concurrent load (Gateway Proxy and Dashboard each issue several
    // queries per request). Raised via env var so it can be tuned per
    // environment without a code change; 20 is a safe default well under
    // PostgreSQL's own default max_connections (100).
    const poolMax = Number(process.env.DATABASE_POOL_MAX) || 20;

    const adapter = new PrismaPg({
      connectionString,
      max: poolMax,
    });

    super({
      adapter,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
