import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';

export interface MockUpstreamRouteConfig {
  statusCode?: number;
  body?: unknown;
  headers?: Record<string, string>;
  delayMs?: number;
  failuresBeforeSuccess?: number;
}

export interface MockUpstreamServer {
  url: string;
  port: number;
  close: () => Promise<void>;
  setRoute: (path: string, config: MockUpstreamRouteConfig) => void;
  getRequestCount: (path: string) => number;
}

/**
 * Minimal local HTTP server standing in for a real integration partner.
 * Routes are registered per-path with a canned response; `failuresBeforeSuccess`
 * lets a route simulate a connection reset for the first N attempts before
 * succeeding, matching the shape the Gateway Proxy's retry logic expects.
 */
export function startMockUpstreamServer(): Promise<MockUpstreamServer> {
  const routes = new Map<string, MockUpstreamRouteConfig>();
  const requestCounts = new Map<string, number>();

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = req.url ?? '/';
    const config = routes.get(path);

    requestCounts.set(path, (requestCounts.get(path) ?? 0) + 1);
    const attemptNumber = requestCounts.get(path) ?? 1;

    if (!config) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'route not configured on mock upstream' }));
      return;
    }

    if (config.failuresBeforeSuccess && attemptNumber <= config.failuresBeforeSuccess) {
      req.destroy();
      return;
    }

    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const respond = (): void => {
        res.writeHead(config.statusCode ?? 200, {
          'content-type': 'application/json',
          ...config.headers,
        });
        res.end(config.body !== undefined ? JSON.stringify(config.body) : undefined);
      };

      if (config.delayMs) {
        setTimeout(respond, config.delayMs);
      } else {
        respond();
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        reject(new Error('Failed to determine mock upstream server port.'));
        return;
      }

      const port = address.port;

      resolve({
        url: `http://127.0.0.1:${port}`,
        port,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          }),
        setRoute: (path: string, config: MockUpstreamRouteConfig) => {
          routes.set(path, config);
        },
        getRequestCount: (path: string) => requestCounts.get(path) ?? 0,
      });
    });

    server.on('error', reject);
  });
}
