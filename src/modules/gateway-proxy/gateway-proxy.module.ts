import { Module } from '@nestjs/common';
import { RequestLogsModule } from '../request-logs/request-logs.module';
import { RouteHeadersModule } from '../route-headers/route-headers.module';
import { TrustedCasModule } from '../trusted-cas/trusted-cas.module';
import { GatewayProxyController } from './gateway-proxy.controller';
import { GatewayProxyService } from './gateway-proxy.service';

@Module({
  imports: [RouteHeadersModule, RequestLogsModule, TrustedCasModule],
  controllers: [GatewayProxyController],
  providers: [GatewayProxyService],
  exports: [GatewayProxyService],
})
export class GatewayProxyModule {}
