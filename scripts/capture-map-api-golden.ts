/**
 * Captures golden-output fixtures for map API endpoints.
 *
 * Run AFTER `pnpm run seed:maps` with the backend server running:
 *
 *   pnpm run capture:maps-golden
 *
 * Optional env vars:
 *   API_URL    — base URL of the running backend (default: http://localhost:3001)
 *   API_TOKEN  — JWT access token for authenticated endpoints (detail + rating)
 *
 * Fixtures are written to backend/test/fixtures/maps-api/ and committed to git.
 * Run `pnpm run verify:maps-golden` in CI or before a release to detect drift.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../backend/.env') });

const API_URL = (process.env.API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const API_TOKEN = process.env.API_TOKEN ?? '';

const FIXTURES_DIR = path.resolve(__dirname, '../backend/test/fixtures/maps-api');

// ── normalizer (inline to avoid tsx module resolution issues in scripts) ─────

const VOLATILE = new Set(['created_at', 'updated_at', 'background_image_url']);

function stripVolatile(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !VOLATILE.has(k)));
}

function sortByMapId(list: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...list].sort((a, b) => String(a.map_id).localeCompare(String(b.map_id)));
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────

async function get(url: string): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (API_TOKEN) headers['Authorization'] = `Bearer ${API_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  return res.json();
}

// ── normalizers ───────────────────────────────────────────────────────────────

function normalizeEras(body: unknown): unknown {
  const { maps } = body as { maps: Record<string, unknown>[] };
  return { maps: sortByMapId(maps.map(stripVolatile)) };
}

function normalizeCommunity(body: unknown): unknown {
  const { maps, total } = body as { maps: Record<string, unknown>[]; total: number };
  return { total, maps: maps.map(stripVolatile) };
}

function normalizePublic(body: unknown): unknown {
  const { maps, total, page, pages } = body as {
    maps: Record<string, unknown>[];
    total: number;
    page: number;
    pages: number;
  };
  return { total, page, pages, maps: maps.map(stripVolatile) };
}

function normalizeDetail(body: unknown): unknown {
  const { map } = body as { map: Record<string, unknown> };
  const stripped = stripVolatile(map);
  const { territories, connections, regions, ...meta } = stripped;
  return {
    ...meta,
    territory_count: Array.isArray(territories) ? territories.length : 0,
    connection_count: Array.isArray(connections) ? connections.length : 0,
    region_count: Array.isArray(regions) ? regions.length : 0,
  };
}

// ── capture ───────────────────────────────────────────────────────────────────

function write(filename: string, data: unknown): void {
  const dest = path.join(FIXTURES_DIR, filename);
  fs.writeFileSync(dest, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  console.log(`  ✓ ${filename}`);
}

async function main(): Promise<void> {
  if (!fs.existsSync(FIXTURES_DIR)) {
    fs.mkdirSync(FIXTURES_DIR, { recursive: true });
  }

  console.log(`[capture-golden] API_URL=${API_URL}`);
  if (API_TOKEN) {
    console.log('[capture-golden] API_TOKEN set — will capture authenticated endpoints');
  } else {
    console.log('[capture-golden] No API_TOKEN — skipping authenticated endpoints (set API_TOKEN env to include them)');
  }

  // ── unauthenticated endpoints ─────────────────────────────────────────────
  console.log('\nCapturing endpoints…');

  write('eras-list.json', normalizeEras(await get(`${API_URL}/api/maps/eras`)));
  write(
    'community-list.json',
    normalizeCommunity(await get(`${API_URL}/api/maps/community?page=1&limit=10&sort=play_count`)),
  );
  write(
    'public-list.json',
    normalizePublic(await get(`${API_URL}/api/maps/public?sort=rating&page=1`)),
  );

  // ── authenticated endpoints ───────────────────────────────────────────────
  if (API_TOKEN) {
    // Capture detail for each era map
    const erasBody = (await get(`${API_URL}/api/maps/eras`)) as { maps: { map_id: string }[] };
    for (const summary of erasBody.maps) {
      const detail = await get(`${API_URL}/api/maps/${summary.map_id}`);
      write(`map-${summary.map_id}-detail.json`, normalizeDetail(detail));
    }
  }

  console.log('\n[capture-golden] Done. Commit the files under backend/test/fixtures/maps-api/');
  console.log('[capture-golden] Run `pnpm run verify:maps-golden` anytime to check for drift.');
}

main().catch((err) => {
  console.error('[capture-golden] Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
