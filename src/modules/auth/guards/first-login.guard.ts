import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { ALLOW_FIRST_LOGIN_KEY } from '../decorators/allow-first-login.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

interface AuthenticatedRequest extends FastifyRequest {
  user?: AuthenticatedUser;
}

@Injectable()
export class FirstLoginGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const allowFirstLogin = this.reflector.getAllAndOverride<boolean>(
      ALLOW_FIRST_LOGIN_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (request.user?.firstLogin && !allowFirstLogin) {
      throw new ForbiddenException({
        message: 'Password change is required before accessing this resource.',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }

    return true;
  }
}
