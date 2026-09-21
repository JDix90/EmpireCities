import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARKETING_PAGES, ERA_CODEX_LABELS, blocksToHtml } from './seoContent.mjs';
import { FACTION_CODEX, FACTION_COUNT } from './factionCodex.generated.mjs';
import { ERA_LABELS } from '../constants/gameLobbyLabels';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_HTML = path.resolve(__dirname, '../../index.html');

/**
 * Keeps `frontend/index.html` honest about what the site actually says.
 *
 * The production build overwrites title / description / og:* / twitter:* /
 * canonical for every marketing route from `seoContent.mjs` (see
 * `scripts/prerender-marketing.mjs`), so the tags sitting in `index.html` never
 * reach a crawler on those routes. That makes them easy to leave stale, and a
 * stale one is actively misleading: `index.html` is the file a person opens to
 * learn how the site describes itself, and it said "Every border is temporary"
 * long after production had switched to copy naming the genre, the price and
 * the browser. Someone reading only that file draws the wrong conclusion about
 * what search engines and AI answer engines are being told.
 *
 * Two invariants, both cheap:
 *
 * 1. The dev-shell values equal the landing page's published values, so the dev
 *    server, a local Open Graph preview and production all agree.
 * 2. Each tag is in the exact shape `prerender-marketing.mjs` greps for. That
 *    script replaces a tag by regex and *appends* one when the regex misses, so
 *    reordering the attributes here would silently ship two description tags
 *    rather than failing the build.
 */

const html = fs.readFileSync(INDEX_HTML, 'utf-8');

const landing = MARKETING_PAGES.find((p) => p.path === '/');

/** Mirrors `setMeta` in scripts/prerender-marketing.mjs — keep the two in step. */
function metaRegex(attr: 'name' | 'property', key: string): RegExp {
  return new RegExp(`(<meta\\s+${attr}="${key}"\\s+content=")([^"]*)(")`, 'i');
}

function metaContent(attr: 'name' | 'property', key: string): string | null {
  const match = html.match(metaRegex(attr, key));
  return match ? match[2] : null;
}

describe('index.html agrees with the published marketing copy', () => {
  it('has a landing entry to compare against', () => {
    expect(landing).toBeDefined();
    expect(landing?.title).toBeTruthy();
    expect(landing?.description).toBeTruthy();
  });

  const cases: [string, 'name' | 'property', string, 'title' | 'description'][] = [
    ['description', 'name', 'description', 'description'],
    ['og:title', 'property', 'og:title', 'title'],
    ['og:description', 'property', 'og:description', 'description'],
    ['twitter:title', 'name', 'twitter:title', 'title'],
    ['twitter:description', 'name', 'twitter:description', 'description'],
  ];

  for (const [label, attr, key, field] of cases) {
    it(`${label} matches the landing page's ${field}`, () => {
      expect(metaContent(attr, key)).toBe(landing![field]);
    });
  }

  it('the <title> matches the landing page title', () => {
    const match = html.match(/<title>([\s\S]*?)<\/title>/i);
    expect(match?.[1]).toBe(landing!.title);
  });

  it('every tag the prerender script rewrites is present in the shape it greps for', () => {
    // A miss here does not fail the build — setMeta appends a second tag
    // instead — so the duplicate would only show up in the served HTML.
    for (const [label, attr, key] of cases) {
      expect(metaRegex(attr, key).test(html), `${label} not in the expected attribute order`).toBe(true);
    }
    expect(/<link\s+rel="canonical"\s+href="/i.test(html), 'canonical link').toBe(true);
    expect(html.includes('<div id="root"></div>'), 'prerender aborts without this exact div').toBe(true);
  });

  it('every description is a length a search engine will actually show', () => {
    // Bing's URL Inspection reports "Meta Description too long or too short" as
    // an ERROR, and it flagged seven of these pages at once — the copy was
    // written to read well without anyone counting characters. Google truncates
    // around the same point. 160 is the ceiling both work to.
    for (const page of MARKETING_PAGES) {
      const n = page.description.length;
      expect(n, `${page.path} description is ${n} chars`).toBeGreaterThanOrEqual(25);
      expect(n, `${page.path} description is ${n} chars`).toBeLessThanOrEqual(160);
    }
  });

  it('no marketing tag is declared twice', () => {
    for (const [label, attr, key] of cases) {
      const all = html.match(new RegExp(`<meta\\s+${attr}="${key}"`, 'gi')) ?? [];
      expect(all.length, `${label} appears ${all.length} times`).toBe(1);
    }
  });
});

/**
 * /codex is prerendered so it can be indexed at all. It used to serve the SPA
 * shell, which meant it inherited the shell's homepage canonical and declared
 * itself a duplicate of the landing page — 52 factions of writing that could
 * never rank.
 */
describe('the faction codex page', () => {
  const codex = MARKETING_PAGES.find((p) => p.path === '/codex');

  it('is published as its own page, so it gets its own canonical', () => {
    // The canonical and the output file are both derived from `path` by
    // prerender-marketing.mjs; without an entry here there is no
    // dist/codex/index.html to carry one.
    expect(codex).toBeDefined();
    expect(codex?.path).toBe('/codex');
  });

  it('is listed in the sitemap', () => {
    const sitemap = fs.readFileSync(path.resolve(__dirname, '../../public/sitemap.xml'), 'utf-8');
    expect(sitemap).toContain('<loc>https://borderfall.gg/codex</loc>');
  });

  it('labels every era the generated data ships, in the words the app uses', () => {
    // The prerendered HTML and the React page must show identical headings:
    // ERA_CODEX_LABELS feeds the crawler, ERA_LABELS feeds the visitor, and a
    // divergence between the two is cloaking.
    for (const era of FACTION_CODEX) {
      expect(ERA_CODEX_LABELS[era.era_id], `no codex label for ${era.era_id}`).toBeTruthy();
      expect(ERA_CODEX_LABELS[era.era_id], `${era.era_id} label differs from the app's`)
        .toBe(ERA_LABELS[era.era_id]);
    }
  });

  it('renders every faction into crawlable HTML, not just a heading', () => {
    const out = blocksToHtml(codex!.blocks);
    expect((out.match(/<dt>/g) ?? []).length).toBe(FACTION_COUNT);
    expect((out.match(/<h2>/g) ?? []).length).toBe(FACTION_CODEX.length);
    // A named faction with its actual rules text, which is the whole point —
    // a list of proper nouns would rank for nothing.
    expect(out).toContain('Roman Republic');
    expect(out).toContain('<strong>Ability:</strong>');
  });

  it('escapes the generated copy rather than trusting it', () => {
    const out = blocksToHtml([{ type: 'factions' }]);
    // Lore is prose with apostrophes and quotes in it. Nothing from the
    // generated file may reach the page as live markup.
    expect(out).not.toMatch(/<script/i);
    for (const era of FACTION_CODEX) {
      for (const f of era.factions) {
        if (f.name.includes('&')) expect(out).toContain(f.name.replace(/&/g, '&amp;'));
      }
    }
  });
});
