export interface TopClientItem {
  clientId: string;
  name: string;
  code: string;
  requests: number;
  errors: number;
  averageResponseTime: number;
}

export interface TopRouteItem {
  routeId: string;
  name: string;
  slug: string;
  method: string;
  requests: number;
  errors: number;
  averageResponseTime: number;
}

export interface StatusDistributionItem {
  statusCode: number;
  total: number;
}

export interface TopErrorItem {
  errorCode: string;
  total: number;
}

export interface TopSourceIpItem {
  sourceIp: string;
  requests: number;
}

export interface RecentRequestItem {
  requestId: string;
  client: { id: string; name: string; code: string } | null;
  route: { id: string; name: string; slug: string } | null;
  statusCode: number;
  durationMs: number;
  createdAt: Date;
}
