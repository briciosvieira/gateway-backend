import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AllowedHostnameResolverService } from './allowed-hostname-resolver.service';
import { AllowedIpsController } from './allowed-ips.controller';
import { AllowedIpsService } from './allowed-ips.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [AllowedIpsController],
  providers: [AllowedIpsService, AllowedHostnameResolverService],
  exports: [AllowedIpsService, AllowedHostnameResolverService],
})
export class AllowedIpsModule {}
