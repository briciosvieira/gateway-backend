import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { GatewayRoutesController } from './gateway-routes.controller';
import { GatewayRoutesService } from './gateway-routes.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [GatewayRoutesController],
  providers: [GatewayRoutesService],
  exports: [GatewayRoutesService],
})
export class GatewayRoutesModule {}
