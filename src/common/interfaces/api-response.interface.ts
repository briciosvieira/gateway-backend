export interface ApiResponse<T> {
  success: true;
  message: string;
  data: T;
  requestId: string;
  timestamp: string;
}
