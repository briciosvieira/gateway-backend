import { Module } from '@nestjs/common';
import { AuditLogsModule } from '../audit-logs/audit-logs.module';
import { RouteHeadersController } from './route-headers.controller';
import { RouteHeadersService } from './route-headers.service';

@Module({
  imports: [AuditLogsModule],
  controllers: [RouteHeadersController],
  providers: [RouteHeadersService],
  exports: [RouteHeadersService],
})
export class RouteHeadersModule {}
