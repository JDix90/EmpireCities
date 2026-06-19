/**
 * Borderfall — quick launch-readiness load test (k6).
 *
 * SAFE BY DESIGN: hits only read-only, unauthenticated endpoints (`/`, `/ready`,
 * `/health`). It creates no users, games, or rows — so it is safe to run against
 * production shortly before launch. It will NOT exercise gameplay, sockets, AI, or
 * write throughput; for that, script a guest→create-game scenario against STAGING.
 *
 * What it DOES prove: the reverse proxy, web container, backend event loop, and the
 * Postgres+Redis connection pools can sustain N concurrent requests on the current
 * (single 4 GB) node without errors or latency blowup. That's the failure mode a
 * marketing spike hits first.
 *
 * Install k6 (one binary): `brew install k6`  (or https://k6.io/docs/get-started/installation)
 *
 * Run (defaults: ramp to 100 VUs, ~4 min, against prod):
 *   k6 run scripts/loadtest.js
 *
 * Override:
 *   BASE_URL=https://staging.borderfall.gg MAX_VUS=200 k6 run scripts/loadtest.js
 *   MAX_VUS=50 k6 run scripts/loadtest.js          # gentler first pass
 *
 * Read the summary: a PASS is `http_req_failed` < 1% and `/ready` p95 in the low
 * hundreds of ms. If errors climb or p95 spikes as VUs rise, you've found the
 * ceiling of the single node — scale up the droplet or turn on a second backend
 * before you point paid traffic at it.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = (__ENV.BASE_URL || 'https://borderfall.gg').replace(/\/$/, '');
const MAX_VUS = parseInt(__ENV.MAX_VUS || '100', 10);

export const options = {
  // Gentle ramp → hold → push → hold → drain. Stop early with Ctrl-C if errors spike.
  stages: [
    { duration: '30s', target: Math.ceil(MAX_VUS / 2) },
    { duration: '1m', target: Math.ceil(MAX_VUS / 2) },
    { duration: '30s', target: MAX_VUS },
    { duration: '1m', target: MAX_VUS },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    // Hard pass/fail signals — k6 exits non-zero if these are breached.
    http_req_failed: ['rate<0.01'],
    'http_req_duration{endpoint:ready}': ['p(95)<1000'],
    'http_req_duration{endpoint:landing}': ['p(95)<1500'],
  },
};

export default function () {
  // /ready exercises the full stack (backend + Postgres + Redis ping) the cheapest way.
  const ready = http.get(`${BASE_URL}/ready`, { tags: { endpoint: 'ready' } });
  check(ready, { 'ready 200': (r) => r.status === 200 });

  // The landing page is where cold marketing traffic actually lands.
  const landing = http.get(`${BASE_URL}/`, { tags: { endpoint: 'landing' } });
  check(landing, { 'landing 200': (r) => r.status === 200 });

  sleep(1);
}
