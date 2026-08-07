import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { TrustedCaDispatcherService } from './trusted-ca-dispatcher.service';
import { TrustedCasController } from './trusted-cas.controller';
import { TrustedCasService } from './trusted-cas.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [TrustedCasController],
  providers: [TrustedCasService, TrustedCaDispatcherService],
  exports: [TrustedCasService, TrustedCaDispatcherService],
})
export class TrustedCasModule {}
