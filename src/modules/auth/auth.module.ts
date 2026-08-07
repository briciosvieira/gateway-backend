import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { FirstLoginGuard } from './guards/first-login.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard, FirstLoginGuard],
  exports: [AuthService, JwtModule, JwtAuthGuard, RolesGuard, FirstLoginGuard],
})
export class AuthModule {}
