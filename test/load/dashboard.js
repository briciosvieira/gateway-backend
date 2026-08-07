import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';

// Dashboard under load. All 9 read-only endpoints share the 100 req/min/IP
// admin default. Requires a valid ADMIN/OPERATOR/AUDITOR/VIEWER access token
// — generate one once via POST /api/v1/auth/login (outside of k6, to avoid
// tripping the 5/min login limiter) and pass it in via ACCESS_TOKEN. Tokens
// expire (JWT_ACCESS_EXPIRES_IN, 15m by default) — regenerate before re-running
// a load test that lasts longer than the token's lifetime.
export const options = {
  scenarios: {
    ramp_100: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100 },
        { duration: '1m30s', target: 100 },
        { duration: '30s', target: 0 },
      ],
      exec: 'default',
    },
  },
  thresholds: {
    'http_req_duration{status:200}': ['p(95)<700', 'p(99)<1500'],
    checks: ['rate>0.95'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3110';
const ACCESS_TOKEN = __ENV.ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  throw new Error('ACCESS_TOKEN is required — log in once and pass the access token via -e ACCESS_TOKEN=...');
}

const ENDPOINTS = [
  '/api/v1/dashboard/overview?period=last7days',
  '/api/v1/dashboard/requests-over-time?period=last7days',
  '/api/v1/dashboard/top-clients?period=last7days&limit=10',
  '/api/v1/dashboard/top-routes?period=last7days&limit=10',
  '/api/v1/dashboard/status-distribution?period=last7days',
  '/api/v1/dashboard/top-errors?period=last7days&limit=10',
  '/api/v1/dashboard/top-source-ips?period=last7days&limit=10',
  '/api/v1/dashboard/recent-requests?period=last7days',
  '/api/v1/dashboard/health',
];

const successRate = new Rate('dashboard_2xx_rate');
const rateLimitedRate = new Rate('dashboard_429_rate');
const unauthorizedRate = new Rate('dashboard_401_rate');

export default function () {
  const endpoint = ENDPOINTS[Math.floor(Math.random() * ENDPOINTS.length)];

  const response = http.get(`${BASE_URL}${endpoint}`, {
    headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
  });

  check(response, {
    'status is 200, 401 or 429': (r) => [200, 401, 429].includes(r.status),
  });

  successRate.add(response.status === 200);
  rateLimitedRate.add(response.status === 429);
  unauthorizedRate.add(response.status === 401); // signals an expired token mid-run.
}

// 500/1000 VU variants:
//   k6 run --stage 30s:500,1m30s:500,30s:0 -e ACCESS_TOKEN=... test/load/dashboard.js
//   k6 run --stage 30s:1000,1m30s:1000,30s:0 -e ACCESS_TOKEN=... test/load/dashboard.js
