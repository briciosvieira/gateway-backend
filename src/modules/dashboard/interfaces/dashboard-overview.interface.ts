export interface DashboardOverview {
  totalClients: number;
  activeClients: number;
  totalApiKeys: number;
  activeApiKeys: number;
  totalRoutes: number;
  activeRoutes: number;
  totalRequests: number;
  requestsInPeriod: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number;
  errorRate: number;
  averageResponseTime: number;
  maxResponseTime: number;
  averageAttempts: number;
}

export interface DashboardHealth {
  gatewayStatus: 'healthy' | 'unhealthy';
  database: 'healthy' | 'unhealthy';
  uptimeSeconds: number;
  version: string;
  environment: string;
}
