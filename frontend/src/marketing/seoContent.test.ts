import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARKETING_PAGES } from './seoContent.mjs';

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

  it('no marketing tag is declared twice', () => {
    for (const [label, attr, key] of cases) {
      const all = html.match(new RegExp(`<meta\\s+${attr}="${key}"`, 'gi')) ?? [];
      expect(all.length, `${label} appears ${all.length} times`).toBe(1);
    }
  });
});
