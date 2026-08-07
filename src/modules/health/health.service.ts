import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';

export interface HealthResponse {
  status: string;
  application: string;
  database: string;
  timestamp: string;
  uptime: number;
}

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async getHealth(): Promise<HealthResponse> {
    await this.prisma.$queryRaw`SELECT 1`;

    return {
      status: 'ok',
      application: 'Gateway Hub LF',
      database: 'connected',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
