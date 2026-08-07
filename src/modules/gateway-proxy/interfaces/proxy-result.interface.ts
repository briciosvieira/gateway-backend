export interface ProxyResult {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: Buffer;
  durationMs: number;
  attempts: number;
}
