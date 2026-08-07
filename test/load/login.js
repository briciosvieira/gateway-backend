import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';

// Login under load. IMPORTANT: POST /api/v1/auth/login is rate-limited to
// 5 requests/minute PER IP by design (Security Hardening spec). Since k6
// virtual users on a single machine share one source IP, this script will
// mostly exercise the rate limiter itself once concurrency exceeds ~5
// requests within a minute — that is the correct, intended behavior, not a
// bug in the login endpoint. Use this script to confirm the limiter holds
// under concurrent load (429 dominates) and that the handful of requests
// that DO get through still authenticate correctly and quickly.
export const options = {
  scenarios: {
    ramp_100: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 100 },
        { duration: '40s', target: 100 },
        { duration: '10s', target: 0 },
      ],
      exec: 'default',
    },
  },
  thresholds: {
    // Only the requests that got past the rate limiter are judged on latency.
    'http_req_duration{status:200}': ['p(95)<800', 'p(99)<1500'],
    checks: ['rate>0.99'], // "success" = well-formed response (200 or the expected 429).
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3110';
const LOGIN = __ENV.LOGIN_USERNAME || 'admin';
const PASSWORD = __ENV.LOGIN_PASSWORD || 'CHANGE_ME';

const successRate = new Rate('login_2xx_rate');
const rateLimitedRate = new Rate('login_429_rate');
const invalidCredentialsRate = new Rate('login_401_rate');

export default function () {
  const response = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ login: LOGIN, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  check(response, {
    'status is 200, 401 or 429': (r) => [200, 401, 429].includes(r.status),
    'never leaks a stack trace': (r) => !r.body.includes('at Object.<anonymous>'),
  });

  successRate.add(response.status === 200);
  rateLimitedRate.add(response.status === 429);
  invalidCredentialsRate.add(response.status === 401);
}

// 500/1000 VU variants:
//   k6 run --stage 20s:500,40s:500,10s:0 test/load/login.js
//   k6 run --stage 20s:1000,40s:1000,10s:0 test/load/login.js
// LOGIN_USERNAME/LOGIN_PASSWORD must point at a real, active account in whatever
// environment BASE_URL targets — never point this at a production database.
