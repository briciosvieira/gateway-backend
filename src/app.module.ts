import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { throttlerConfig } from './common/rate-limit/throttler.config';
import { PrismaModule } from './database/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { FirstLoginGuard } from './modules/auth/guards/first-login.guard';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { AuditLogsModule } from './modules/audit-logs/audit-logs.module';
import { ClientsModule } from './modules/clients/clients.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { AllowedIpsModule } from './modules/allowed-ips/allowed-ips.module';
import { GatewayRoutesModule } from './modules/gateway-routes/gateway-routes.module';
import { RouteHeadersModule } from './modules/route-headers/route-headers.module';
import { GatewayProxyModule } from './modules/gateway-proxy/gateway-proxy.module';
import { RequestLogsModule } from './modules/request-logs/request-logs.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { TrustedCasModule } from './modules/trusted-cas/trusted-cas.module';
import { BrandingModule } from './modules/branding/branding.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
    }),
    ThrottlerModule.forRoot(throttlerConfig),
    PrismaModule,
    AuthModule,
    HealthModule,
    RolesModule,
    UsersModule,
    AuditLogsModule,
    ClientsModule,
    ApiKeysModule,
    AllowedIpsModule,
    GatewayRoutesModule,
    RouteHeadersModule,
    RequestLogsModule,
    TrustedCasModule,
    BrandingModule,
    GatewayProxyModule,
    DashboardModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: FirstLoginGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
})
export class AppModule {}
