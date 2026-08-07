import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { BrandingAdminController } from './branding-admin.controller';
import { BrandingPublicController } from './branding-public.controller';
import { BrandingService } from './branding.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [BrandingPublicController, BrandingAdminController],
  providers: [BrandingService],
  exports: [BrandingService],
})
export class BrandingModule {}
