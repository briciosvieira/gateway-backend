import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiErrorResponse } from 'src/common/interfaces/api-error-response.interface';

interface HttpExceptionPayload {
  message?: string | string[];
  error?: string;
  code?: string;
}

const GENERIC_INTERNAL_ERROR_MESSAGE = 'Internal server error.';
const RATE_LIMIT_EXCEEDED_CODE = 'RATE_LIMIT_EXCEEDED';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const httpContext = host.switchToHttp();

    const request = httpContext.getRequest<FastifyRequest>();
    const reply = httpContext.getResponse<FastifyReply>();

    const isHttpException = exception instanceof HttpException;

    const statusCode = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = isHttpException ? exception.getResponse() : null;

    const payload =
      typeof exceptionResponse === 'object' && exceptionResponse !== null
        ? (exceptionResponse as HttpExceptionPayload)
        : null;

    if (!isHttpException) {
      this.logger.error(
        exception instanceof Error ? exception.stack ?? exception.message : exception,
      );
    }

    const message = isHttpException
      ? payload?.message ?? exception.message
      : GENERIC_INTERNAL_ERROR_MESSAGE;

    const error = isHttpException
      ? payload?.error ?? exception.name
      : 'Internal Server Error';

    const code =
      payload?.code ??
      (statusCode === HttpStatus.TOO_MANY_REQUESTS
        ? RATE_LIMIT_EXCEEDED_CODE
        : undefined);

    const requestId =
      typeof request.headers['x-request-id'] === 'string'
        ? request.headers['x-request-id']
        : 'unknown';

    const response: ApiErrorResponse = {
      success: false,
      statusCode,
      ...(code ? { code } : {}),
      message,
      error,
      path: request.url,
      method: request.method,
      requestId,
      timestamp: new Date().toISOString(),
    };

    void reply.status(statusCode).send(response);
  }
}
