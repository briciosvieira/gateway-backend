export type GatewayErrorCode =
  | 'API_KEY_REQUIRED'
  | 'INVALID_API_KEY'
  | 'IP_NOT_ALLOWED'
  | 'CLIENT_INACTIVE'
  | 'GATEWAY_ROUTE_NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_UNAVAILABLE'
  | 'INVALID_UPSTREAM_RESPONSE'
  | 'INTERNAL_GATEWAY_ERROR';

export interface GatewayErrorResult {
  statusCode: number;
  code: GatewayErrorCode;
  message: string;
  allowedMethods?: string;
  attempts?: number;
}

export function isGatewayErrorResult<T extends { statusCode: number }>(
  result: T | GatewayErrorResult,
): result is GatewayErrorResult {
  return 'code' in result;
}
