/**
 * Verifies that the live map API responses match the committed golden fixtures.
 *
 * Run AFTER `pnpm run seed:maps` with the backend server running:
 *
 *   pnpm run verify:maps-golden
 *
 * Optional env vars:
 *   API_URL    — base URL of the running backend (default: http://localhost:3001)
 *   API_TOKEN  — JWT access token for authenticated endpoints
 *
 * Exits 0 on success, 1 if any fixture differs from the live response.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../backend/.env') });

const API_URL = (process.env.API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const API_TOKEN = process.env.API_TOKEN ?? '';
const FIXTURES_DIR = path.resolve(__dirname, '../backend/test/fixtures/maps-api');

// ── normalizer ────────────────────────────────────────────────────────────────

const VOLATILE = new Set(['created_at', 'updated_at', 'background_image_url']);

function stripVolatile(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !VOLATILE.has(k)));
}

function sortByMapId(list: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...list].sort((a, b) => String(a.map_id).localeCompare(String(b.map_id)));
}

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

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function get(url: string): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (API_TOKEN) headers['Authorization'] = `Bearer ${API_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  return res.json();
}

// ── compare ───────────────────────────────────────────────────────────────────

function loadFixture(filename: string): unknown {
  const p = path.join(FIXTURES_DIR, filename);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

let failures = 0;

function compare(label: string, fixture: unknown, live: unknown): void {
  if (fixture === null) {
    console.log(`  ⚠️  ${label}: no fixture file — run capture:maps-golden first`);
    return;
  }
  try {
    assert.deepStrictEqual(live, fixture);
    console.log(`  ✓ ${label}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${label}: MISMATCH`);
    // Print a concise diff by comparing JSON lines
    const expected = JSON.stringify(fixture, null, 2).split('\n');
    const actual = JSON.stringify(live, null, 2).split('\n');
    const maxLines = Math.max(expected.length, actual.length);
    let diffLines = 0;
    for (let i = 0; i < maxLines && diffLines < 30; i++) {
      if (expected[i] !== actual[i]) {
        diffLines++;
        console.error(`    line ${i + 1}  expected: ${expected[i] ?? '(missing)'}`);
        console.error(`    line ${i + 1}  actual:   ${actual[i] ?? '(missing)'}`);
      }
    }
    if (diffLines === 30) console.error('    … (diff truncated at 30 lines)');
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!fs.existsSync(FIXTURES_DIR)) {
    console.error(`[verify-golden] Fixtures directory not found: ${FIXTURES_DIR}`);
    console.error('[verify-golden] Run `pnpm run capture:maps-golden` first.');
    process.exit(1);
  }

  console.log(`[verify-golden] API_URL=${API_URL}`);
  if (API_TOKEN) console.log('[verify-golden] API_TOKEN set — verifying authenticated endpoints too');

  console.log('\nVerifying…');

  compare(
    'eras-list',
    loadFixture('eras-list.json'),
    normalizeEras(await get(`${API_URL}/api/maps/eras`)),
  );

  compare(
    'community-list',
    loadFixture('community-list.json'),
    normalizeCommunity(await get(`${API_URL}/api/maps/community?page=1&limit=10&sort=play_count`)),
  );

  compare(
    'public-list',
    loadFixture('public-list.json'),
    normalizePublic(await get(`${API_URL}/api/maps/public?sort=rating&page=1`)),
  );

  // Verify per-era detail fixtures (only if fixture files exist)
  if (API_TOKEN) {
    const erasBody = (await get(`${API_URL}/api/maps/eras`)) as { maps: { map_id: string }[] };
    for (const summary of erasBody.maps) {
      const fixture = loadFixture(`map-${summary.map_id}-detail.json`);
      if (fixture !== null) {
        const live = await get(`${API_URL}/api/maps/${summary.map_id}`);
        compare(`${summary.map_id} detail`, fixture, normalizeDetail(live));
      }
    }
  }

  console.log('');
  if (failures === 0) {
    console.log('[verify-golden] ✅ All fixtures match the live API.');
    process.exit(0);
  } else {
    console.error(`[verify-golden] ❌ ${failures} fixture(s) differ from the live API.`);
    console.error('[verify-golden] If the change is intentional, re-run: pnpm run capture:maps-golden');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[verify-golden] Unexpected error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
