import type { RequestLogResult, RequestOrigin } from '../../../../generated/prisma/client';

export interface CreateRequestLogInput {
  requestId: string;
  attemptedAt: Date;
  requestOrigin?: RequestOrigin | null;
  sourceHost?: string | null;
  clientId?: string | null;
  apiKeyId?: string | null;
  gatewayRouteId?: string | null;
  sourceIp: string;
  method: string;
  publicPath: string;
  publicEndpoint?: string | null;
  destinationHost?: string | null;
  destinationUrl?: string | null;
  destinationIp?: string | null;
  statusCode: number;
  upstreamStatusCode?: number | null;
  durationMs: number;
  attempts: number;
  result: RequestLogResult;
  errorCode?: string | null;
  errorMessage?: string | null;
  requestHeaders?: unknown;
  requestQuery?: unknown;
  requestBody?: unknown;
  responseHeaders?: unknown;
  responseBody?: unknown;
  requestSizeBytes?: number | null;
  responseSizeBytes?: number | null;
}
