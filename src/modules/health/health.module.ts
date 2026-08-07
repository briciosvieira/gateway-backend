import { Module } from '@nestjs/common';
import { BrandingModule } from '../branding/branding.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [BrandingModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
