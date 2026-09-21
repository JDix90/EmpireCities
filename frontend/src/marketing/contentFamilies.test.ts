/**
 * The generated page families — /maps, /eras/:slug and the answer pages.
 *
 * These pages are assembled from data rather than written one at a time, which
 * removes the usual typo class and introduces a worse one: a page that is
 * structurally fine and factually wrong, or a page that exists but is reachable
 * from nowhere. Nothing here checks prose. It checks the joins.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MARKETING_PAGES, ERAS, ERA_CODEX_LABELS, blocksToHtml } from './seoContent.mjs';
import { MAP_CATALOG } from './mapCatalog.generated.mjs';
import { FACTION_CODEX } from './factionCodex.generated.mjs';
import { ERA_PAGE_COPY } from './eraPages.mjs';
import { renderSitemap } from '../../scripts/generate-sitemap.mjs';

const byPath = (p: string) => MARKETING_PAGES.find((x) => x.path === p);

/**
 * The rendered page as a reader sees it: tags stripped, entities decoded.
 * Asserting against raw HTML makes a test fail on correct escaping — region
 * names like "Italia & the Islands" are published as `&amp;`, which is the
 * renderer doing its job.
 */
const renderedText = (blocks: Parameters<typeof blocksToHtml>[0]) =>
  blocksToHtml(blocks)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
const pathsUnder = (prefix: string) =>
  MARKETING_PAGES.filter((p) => p.path.startsWith(prefix)).map((p) => p.path);

describe('the sitemap', () => {
  it('matches what the generator produces', () => {
    const committed = fs.readFileSync(
      path.resolve(__dirname, '../../public/sitemap.xml'), 'utf-8',
    );
    expect(
      committed === renderSitemap()
        ? true
        : 'stale — run: node frontend/scripts/generate-sitemap.mjs',
    ).toBe(true);
  });

  it('lists every prerendered page', () => {
    const xml = renderSitemap();
    for (const page of MARKETING_PAGES) {
      expect(xml, `${page.path} missing from the sitemap`)
        .toContain(`<loc>https://borderfall.gg${page.path}</loc>`);
    }
  });

  it('lists each url exactly once', () => {
    const locs = [...renderSitemap().matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(new Set(locs).size).toBe(locs.length);
  });
});

describe('the map pages', () => {
  it('publishes one page per catalog map, plus the index', () => {
    expect(byPath('/game-maps')).toBeDefined();
    for (const map of MAP_CATALOG) {
      expect(byPath(`/game-maps/${map.slug}`), `no page for ${map.slug}`).toBeDefined();
    }
    expect(pathsUnder('/game-maps/').length).toBe(MAP_CATALOG.length);
  });

  it('gives every map page a distinct url, so each gets its own canonical', () => {
    // The output file is derived from the path, so distinct paths are the whole
    // requirement — two pages sharing one would overwrite each other, which the
    // prerender script also refuses.
    const paths = MAP_CATALOG.map((m) => `/game-maps/${m.slug}`);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of paths) expect(byPath(p), `no page at ${p}`).toBeDefined();
  });

  it('links every map from the index, so none is an orphan', () => {
    const html = blocksToHtml(byPath('/game-maps')!.blocks);
    for (const map of MAP_CATALOG) {
      expect(html, `${map.slug} is not linked from /game-maps`).toContain(`href="/game-maps/${map.slug}"`);
    }
  });

  it('renders each map’s real numbers, not a template', () => {
    for (const map of MAP_CATALOG) {
      const page = byPath(`/game-maps/${map.slug}`)!;
      expect(blocksToHtml(page.blocks), `${map.slug} territory count`)
        .toContain(`<dd>${map.territory_count}</dd>`);
      const text = renderedText(page.blocks);
      for (const region of map.regions) {
        expect(text, `${map.slug} missing region ${region.name}`).toContain(region.name);
      }
    }
  });

  it('gives every map page enough words to be worth indexing', () => {
    // The thin-page guard. A page that is a heading and a table is the failure
    // this whole approach was meant to avoid, so it is asserted rather than
    // assumed.
    for (const map of MAP_CATALOG) {
      const words = renderedText(byPath(`/game-maps/${map.slug}`)!.blocks)
        .split(/\s+/).filter(Boolean).length;
      expect(words, `${map.slug} has only ${words} words`).toBeGreaterThan(200);
    }
  });
});

describe('the era pages', () => {
  it('publishes one page per era that has factions', () => {
    for (const era of FACTION_CODEX) {
      const slug = era.era_id.replace(/_/g, '-');
      expect(byPath(`/eras/${slug}`), `no page for era ${era.era_id}`).toBeDefined();
    }
    expect(pathsUnder('/eras/').length).toBe(FACTION_CODEX.length);
  });

  it('renders only its own era’s roster', () => {
    for (const era of FACTION_CODEX) {
      const slug = era.era_id.replace(/_/g, '-');
      const html = blocksToHtml(byPath(`/eras/${slug}`)!.blocks);
      const text = renderedText(byPath(`/eras/${slug}`)!.blocks);
      for (const f of era.factions) {
        expect(text, `${era.era_id} missing ${f.name}`).toContain(f.name);
      }
      // Its own factions and no one else's: a page that quietly rendered the
      // whole codex would be 52 factions of duplicate content on ten urls.
      const dts = (html.match(/<dt>/g) ?? []).length;
      const factFields = byPath(`/eras/${slug}`)!.blocks
        .filter((b) => b.type === 'facts')
        .reduce((n, b) => n + (b as { facts: unknown[] }).facts.length, 0);
      expect(dts - factFields, `${era.era_id} faction count`).toBe(era.factions.length);
    }
  });

  it('agrees with the /eras arc about when each era happened', () => {
    // The two are separate copy — the arc on /eras and the years on the detail
    // page — and a reader seeing different dates for the same era on two of our
    // own pages is worse than either date being wrong.
    const normalize = (s: string) => s.replace(/^The /, '');
    for (const [eraId, copy] of Object.entries(ERA_PAGE_COPY)) {
      const label = ERA_CODEX_LABELS[eraId];
      const arc = ERAS.find((e) => normalize(e.label) === normalize(label ?? ''));
      if (!arc) continue; // eras the arc does not list (e.g. Italian Unification)
      expect(copy.years, `${eraId} years differ from the /eras arc`).toBe(arc.years);
    }
  });
});

describe('the answer pages', () => {
  it('links every answer page from the index', () => {
    const html = blocksToHtml(byPath('/answers')!.blocks);
    for (const p of pathsUnder('/answers/')) {
      expect(html, `${p} is not linked from /answers`).toContain(`href="${p}"`);
    }
  });

  it('opens every answer page with a standalone answer', () => {
    // Search snippets and AI answers quote the first contiguous span. A page
    // whose first block is a heading gives them nothing to lift.
    for (const p of pathsUnder('/answers/')) {
      expect(byPath(p)!.blocks[0]?.type, `${p} does not open with an answer`).toBe('answer');
    }
  });

  it('gives every answer page its own questions for structured data', () => {
    for (const p of pathsUnder('/answers/')) {
      const qa = byPath(p)!.qa;
      expect(qa?.length, `${p} has no qa`).toBeGreaterThan(0);
      for (const item of qa!) {
        expect(item.q.length, `${p} question`).toBeGreaterThan(10);
        expect(item.a.length, `${p} answer`).toBeGreaterThan(40);
      }
    }
  });
});
