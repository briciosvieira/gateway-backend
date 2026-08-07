import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { AllowedIpsController } from './allowed-ips.controller';
import { AllowedIpsService } from './allowed-ips.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [AllowedIpsController],
  providers: [AllowedIpsService],
  exports: [AllowedIpsService],
})
export class AllowedIpsModule {}
