/**
 * The committed map catalog must match the map definitions it came from.
 *
 * `frontend/src/marketing/mapCatalog.generated.mjs` is published as static,
 * crawlable HTML on /maps and /maps/:slug. Nothing at runtime rebuilds it — the
 * frontend image has no database/ directory and the build must not call the
 * live API — so a map edit that forgets to re-run the generator would ship a
 * page that contradicts the map people actually play, indefinitely and
 * invisibly.
 *
 * Comparing the rendered BYTES rather than re-deriving the data is deliberate:
 * a test that rebuilt the file by its own route could pass while the committed
 * file was wrong.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildEraMaps, buildMapCatalog, renderMapCatalogModule, slugForMapId,
  ERA_MAP_IDS, MAP_PAGE_IDS,
} from './mapCatalog';
import { MAP_CATALOG_OUTPUT_PATH, MAPS_SOURCE_DIR } from '../../../scripts/generateMapCatalog';

const catalog = buildMapCatalog(MAPS_SOURCE_DIR);
const eraMaps = buildEraMaps(MAPS_SOURCE_DIR);

describe('map catalog export', () => {
  it('matches the committed generated file', () => {
    const committed = readFileSync(MAP_CATALOG_OUTPUT_PATH, 'utf8');
    const expected = renderMapCatalogModule(catalog, eraMaps);
    expect(
      committed === expected
        ? true
        : 'stale — run: pnpm -C backend exec tsx scripts/generateMapCatalog.ts',
    ).toBe(true);
  });

  it('publishes exactly the curated maps, in the listed order', () => {
    expect(catalog.map((m) => m.map_id)).toEqual([...MAP_PAGE_IDS]);
  });

  it('gives every map the fields its page renders', () => {
    for (const m of catalog) {
      expect(m.slug, `${m.map_id} slug`).toMatch(/^[a-z0-9-]+$/);
      expect(m.name.length, `${m.map_id} name`).toBeGreaterThan(0);
      // The description is the page's opening paragraph. A short one leaves a
      // page that is a heading and a table, which is the thin page this whole
      // approach is meant to avoid.
      expect(m.description.length, `${m.map_id} description`).toBeGreaterThan(120);
      expect(m.territory_count, `${m.map_id} territories`).toBeGreaterThan(0);
      expect(m.regions.length, `${m.map_id} regions`).toBeGreaterThan(0);
      for (const r of m.regions) {
        expect(r.name, `${m.map_id} region name`).toBeTruthy();
        expect(r.territory_count, `${m.map_id}/${r.name} size`).toBeGreaterThan(0);
      }
    }
  });

  it('gives every map a distinct slug', () => {
    const slugs = catalog.map((m) => m.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('strips the source prefix when making a slug', () => {
    expect(slugForMapId('community_roman_empire_117')).toBe('roman-empire-117');
    expect(slugForMapId('era_ww2')).toBe('ww2');
    // Only a LEADING prefix, and only once: a map about a community is not a
    // map whose id should lose the word in the middle.
    expect(slugForMapId('community_era_of_community')).toBe('era-of-community');
  });

  it('leaves rendering internals out of the published projection', () => {
    // Polygons and camera settings are hundreds of kilobytes of numbers that no
    // reader will ever see, and they churn whenever a map is nudged visually.
    const raw = JSON.stringify(catalog);
    expect(raw).not.toContain('polygon');
    expect(raw).not.toContain('center_point');
    expect(raw).not.toContain('canvas_width');
    expect(raw).not.toContain('globe_view');
  });

  it('ships a board for every era, with regions a page can quote', () => {
    for (const eraId of Object.keys(ERA_MAP_IDS)) {
      const m = eraMaps[eraId];
      expect(m, `no board projected for era ${eraId}`).toBeDefined();
      expect(m.territory_count, `${eraId} territories`).toBeGreaterThan(0);
      expect(m.regions.length, `${eraId} regions`).toBeGreaterThan(0);
    }
  });

  it('gives the era boards no page of their own', () => {
    // The distinction the two lists exist to make: era boards are data for a
    // page that already exists, not twelve more urls.
    const pageIds = new Set<string>(MAP_PAGE_IDS);
    for (const mapId of Object.values(ERA_MAP_IDS)) {
      expect(pageIds.has(mapId), `${mapId} is both an era board and a page`).toBe(false);
    }
  });

  it('fails loudly when a listed map has no definition', () => {
    // The whole point of the hard error: a dropped map would otherwise become a
    // sitemap entry pointing at a page that cannot render.
    expect(() => buildMapCatalog('/nonexistent-maps-dir')).toThrow();
    expect(() => buildEraMaps('/nonexistent-maps-dir')).toThrow();
  });
});
