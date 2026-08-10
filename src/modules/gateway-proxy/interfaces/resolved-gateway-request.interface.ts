import type { AllowedIpType } from '../../../../generated/prisma/client';

export interface ResolvedGatewayRoute {
  id: string;
  slug: string;
  method: string;
  destinationUrl: string;
  timeoutMs: number;
  retryCount: number;
  active: boolean;
  requiresApiKey: boolean;
  clientId: string;
}

export interface ResolvedGatewayClient {
  id: string;
  active: boolean;
}

export interface ResolvedApiKey {
  id: string;
  clientId: string;
}

export interface ResolvedAllowedIp {
  address: string;
  type: AllowedIpType;
}

export interface ResolvedRouteHeader {
  name: string;
  value: string;
}

export interface ResolvedGatewayRequest {
  route: ResolvedGatewayRoute;
  client: ResolvedGatewayClient;
  apiKey: ResolvedApiKey;
  allowedIps: ResolvedAllowedIp[];
  routeHeaders: ResolvedRouteHeader[];
  requestId: string;
  sourceIp: string;
}
