import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { SKIP_RESPONSE_WRAPPER_KEY } from '../decorators/skip-response-wrapper.decorator';
import type { ApiResponse } from '../interfaces/api-response.interface';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T> | T
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T> | T> {
    const skipWrapper = this.reflector.getAllAndOverride<boolean>(
      SKIP_RESPONSE_WRAPPER_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (skipWrapper) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();

    const requestId =
      typeof request.headers['x-request-id'] === 'string'
        ? request.headers['x-request-id']
        : 'unknown';

    return next.handle().pipe(
      map((data) => ({
        success: true,
        message: 'Request completed successfully.',
        data,
        requestId,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
