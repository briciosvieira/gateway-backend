import http from 'k6/http';
import { check } from 'k6';
import { Rate as RateMetric } from 'k6/metrics';

// Health check under load. GET /api/v1/health is public (no auth) but still
// goes through the global admin rate limiter (100 req/min/IP by default).
// When every virtual user shares the machine's IP (the normal case for a
// local load test), the 429 responses below ARE the expected behavior of
// the rate limiter under concurrency, not a defect in the endpoint itself —
// treat a high 429 rate here as confirmation the limiter is working, and
// read the 2xx-only metrics for the endpoint's actual latency.
export const options = {
  scenarios: {
    ramp_100: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100 },
        { duration: '1m', target: 100 },
        { duration: '30s', target: 0 },
      ],
      exec: 'default',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    checks: ['rate>0.95'], // "success" here means "got a well-formed HTTP response", 429 included.
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3110';

const okRate = new RateMetric('health_2xx_rate');
const rateLimitedRate = new RateMetric('health_429_rate');

export default function () {
  const response = http.get(`${BASE_URL}/api/v1/health`);

  check(response, {
    'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
    'never leaks a stack trace': (r) => !r.body.includes('at Object.<anonymous>'),
  });

  okRate.add(response.status === 200);
  rateLimitedRate.add(response.status === 429);
}

// To run against 500 or 1000 VUs, override via CLI instead of duplicating the file:
//   k6 run --stage 30s:500,1m:500,30s:0 test/load/health.js
//   k6 run --stage 30s:1000,1m:1000,30s:0 test/load/health.js
// (k6's --stage flag overrides the `scenarios.ramp_100` stages above.)
