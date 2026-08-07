import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Gateway Proxy under load. This is the endpoint actually designed for high
// throughput: the proxy rate limiter defaults to 1000 requests/minute PER
// API-Key+IP pair (not the 100/min admin default), so this script is the
// most representative "real capacity" load test in this suite.
//
// Requires a pre-provisioned Client + API Key + Gateway Route + Allowed IP
// pointing at a destination that can absorb the load (a mock upstream, or
// an endpoint you control) — provision them once via the admin API or the
// test factories, then pass their values in via env vars. This script never
// creates or deletes data itself.
export const options = {
  scenarios: {
    ramp_100: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100 },
        { duration: '2m', target: 100 },
        { duration: '30s', target: 0 },
      ],
      exec: 'default',
    },
  },
  thresholds: {
    'http_req_duration{status:200}': ['p(95)<1000', 'p(99)<2000'],
    checks: ['rate>0.95'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3110';
const API_KEY = __ENV.GATEWAY_API_KEY;
const GATEWAY_PATH = __ENV.GATEWAY_PATH || '/gateway/load-test';
const METHOD = (__ENV.GATEWAY_METHOD || 'GET').toUpperCase();

if (!API_KEY) {
  throw new Error(
    'GATEWAY_API_KEY is required — provision a real API Key + Gateway Route first and pass it via -e GATEWAY_API_KEY=...',
  );
}

const successRate = new Rate('gateway_2xx_rate');
const rateLimitedRate = new Rate('gateway_429_rate');
const upstreamErrorRate = new Rate('gateway_5xx_rate');
const proxyLatency = new Trend('gateway_proxy_latency_ms');

export default function () {
  const params = { headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' } };
  const url = `${BASE_URL}${GATEWAY_PATH}`;

  const response =
    METHOD === 'POST'
      ? http.post(url, JSON.stringify({ ping: 'load-test' }), params)
      : http.get(url, params);

  check(response, {
    'status is not a Gateway-side 4xx auth/config error': (r) =>
      ![401, 403, 404, 405].includes(r.status),
    'never leaks the destination URL or internal hostname': (r) =>
      !r.body.includes('internal.local') && !r.body.includes('destinationUrl'),
  });

  successRate.add(response.status >= 200 && response.status < 300);
  rateLimitedRate.add(response.status === 429);
  upstreamErrorRate.add(response.status >= 500);
  proxyLatency.add(response.timings.duration);
}

// 500/1000 VU variants:
//   k6 run --stage 30s:500,2m:500,30s:0 -e GATEWAY_API_KEY=... test/load/gateway.js
//   k6 run --stage 30s:1000,2m:1000,30s:0 -e GATEWAY_API_KEY=... test/load/gateway.js
