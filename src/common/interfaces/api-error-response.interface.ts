export interface ApiErrorResponse {
  success: false;
  statusCode: number;
  code?: string;
  message: string | string[];
  error: string;
  path: string;
  method: string;
  requestId: string;
  timestamp: string;
}
