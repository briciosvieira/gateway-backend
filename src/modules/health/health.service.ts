import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { BrandingService } from '../branding/branding.service';

export interface HealthResponse {
  status: string;
  application: string;
  database: string;
  timestamp: string;
  uptime: number;
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brandingService: BrandingService,
  ) {}

  async getHealth(): Promise<HealthResponse> {
    const [, branding] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`,
      this.brandingService.getPublicBranding(),
    ]);

    return {
      status: 'ok',
      application: branding.applicationName,
      database: 'connected',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    };
  }
}
