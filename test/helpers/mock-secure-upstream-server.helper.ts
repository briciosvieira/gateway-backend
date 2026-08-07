import { createServer } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Server } from 'node:https';

export interface MockSecureUpstreamRouteConfig {
  statusCode?: number;
  body?: unknown;
  headers?: Record<string, string>;
  delayMs?: number;
  failuresBeforeSuccess?: number;
}

export interface MockSecureUpstreamServer {
  url: string;
  port: number;
  close: () => Promise<void>;
  setRoute: (path: string, config: MockSecureUpstreamRouteConfig) => void;
  getRequestCount: (path: string) => number;
}

interface StartMockSecureUpstreamServerOptions {
  certificatePem: string;
  privateKeyPem: string;
}

export function startMockSecureUpstreamServer(
  options: StartMockSecureUpstreamServerOptions,
): Promise<MockSecureUpstreamServer> {
  const routes = new Map<string, MockSecureUpstreamRouteConfig>();
  const requestCounts = new Map<string, number>();

  const server: Server = createServer(
    {
      cert: options.certificatePem,
      key: options.privateKeyPem,
    },
    (req: IncomingMessage, res: ServerResponse) => {
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

      req.on('data', () => undefined);
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
    },
  );

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (!address || typeof address === 'string') {
        reject(new Error('Failed to determine secure mock upstream server port.'));
        return;
      }

      const port = address.port;

      resolve({
        url: `https://127.0.0.1:${port}`,
        port,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => (error ? closeReject(error) : closeResolve()));
          }),
        setRoute: (path: string, config: MockSecureUpstreamRouteConfig) => {
          routes.set(path, config);
        },
        getRequestCount: (path: string) => requestCounts.get(path) ?? 0,
      });
    });

    server.on('error', reject);
  });
}
