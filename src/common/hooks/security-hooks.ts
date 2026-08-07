import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiErrorResponse } from '../interfaces/api-error-response.interface';

const ALLOWED_HTTP_METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
]);

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH']);

const ADMIN_PREFIX = '/api/v1';
const HEALTH_PATH = '/api/v1/health';
const GATEWAY_PREFIX = '/gateway';

/**
 * Endpoints that legitimately receive `multipart/form-data` instead of JSON.
 * `POST /api/v1/trusted-cas` reads the certificate file via Fastify's
 * `request.file()` (see `TrustedCasController.create`), which requires a
 * multipart body — without this exception the JSON-only policy below
 * rejects every upload with a 415 before it ever reaches the controller.
 */
const MULTIPART_ROUTES = new Set(['POST /api/v1/trusted-cas']);

function getRequestId(request: FastifyRequest): string {
  const requestId = request.headers['x-request-id'];

  return typeof requestId === 'string' ? requestId : 'unknown';
}

function buildErrorPayload(
  request: FastifyRequest,
  statusCode: number,
  message: string,
  error: string,
): ApiErrorResponse {
  return {
    success: false,
    statusCode,
    message,
    error,
    path: request.url,
    method: request.method,
    requestId: getRequestId(request),
    timestamp: new Date().toISOString(),
  };
}

function getPathWithoutQuery(request: FastifyRequest): string {
  const [path] = request.url.split('?');

  return path ?? request.url;
}

function isAdminPath(path: string): boolean {
  return path.startsWith(ADMIN_PREFIX) && !path.startsWith(GATEWAY_PREFIX);
}

function hasRequestBody(request: FastifyRequest): boolean {
  const contentLength = request.headers['content-length'];
  const transferEncoding = request.headers['transfer-encoding'];

  if (typeof transferEncoding === 'string') {
    return true;
  }

  if (typeof contentLength !== 'string') {
    return false;
  }

  return Number(contentLength) > 0;
}

/**
 * Rejects any HTTP method outside the supported set with a 405, before the
 * request reaches routing. Applies to every route, including the public
 * Gateway Proxy, which only ever expects these same methods.
 */
export function registerMethodWhitelistHook(instance: FastifyInstance): void {
  instance.addHook(
    'onRequest',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      if (!ALLOWED_HTTP_METHODS.has(request.method)) {
        await reply
          .status(405)
          .send(
            buildErrorPayload(
              request,
              405,
              `HTTP method ${request.method} is not allowed.`,
              'Method Not Allowed',
            ),
          );
      }
    },
  );
}

/**
 * Restricts admin endpoints (under /api/v1) to application/json bodies,
 * except the routes listed in `MULTIPART_ROUTES` which also accept
 * multipart/form-data. Swagger, Health and the Gateway Proxy are
 * intentionally excluded — the Proxy forwards arbitrary upstream payloads
 * and must not be constrained by an administrative content-type policy.
 */
export function registerContentTypeValidationHook(
  instance: FastifyInstance,
): void {
  instance.addHook(
    'onRequest',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const path = getPathWithoutQuery(request);

      if (
        !isAdminPath(path) ||
        path === HEALTH_PATH ||
        !METHODS_WITH_BODY.has(request.method) ||
        !hasRequestBody(request)
      ) {
        return;
      }

      const contentType = request.headers['content-type'];
      const normalizedContentType =
        typeof contentType === 'string' ? contentType.toLowerCase() : '';

      const isMultipartRoute = MULTIPART_ROUTES.has(
        `${request.method} ${path}`,
      );

      const isAccepted = isMultipartRoute
        ? normalizedContentType.startsWith('application/json') ||
          normalizedContentType.startsWith('multipart/form-data')
        : normalizedContentType.startsWith('application/json');

      if (!isAccepted) {
        const message = isMultipartRoute
          ? 'Only application/json or multipart/form-data is accepted on this endpoint.'
          : 'Only application/json is accepted on this endpoint.';

        await reply
          .status(415)
          .send(
            buildErrorPayload(request, 415, message, 'Unsupported Media Type'),
          );
      }
    },
  );
}

/**
 * Adds the gateway version to every response (when enabled — production
 * should keep this off, since the running version is internal information)
 * and marks the health endpoint as never cacheable.
 */
export function registerResponseHeadersHook(
  instance: FastifyInstance,
  version: string,
  exposeVersionHeader: boolean,
): void {
  instance.addHook(
    'onSend',
    async (
      request: FastifyRequest,
      reply: FastifyReply,
      payload: unknown,
    ): Promise<unknown> => {
      if (exposeVersionHeader) {
        reply.header('X-Gateway-Version', version);
      }

      if (getPathWithoutQuery(request) === HEALTH_PATH) {
        reply.header('Cache-Control', 'no-store');
      }

      return payload;
    },
  );
}
