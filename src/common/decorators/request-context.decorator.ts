import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { RequestContext } from '../interfaces/request-context.interface';

export const CurrentRequestContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestContext => {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    const requestIdHeader = request.headers['x-request-id'];

    const requestId =
      typeof requestIdHeader === 'string' ? requestIdHeader : null;

    const forwardedFor = request.headers['x-forwarded-for'];

    const forwardedIp =
      typeof forwardedFor === 'string'
        ? forwardedFor.split(',')[0]?.trim()
        : null;

    return {
      requestId,
      sourceIp: forwardedIp ?? request.ip ?? null,
    };
  },
);
