/**
 * Write public/sitemap.xml from MARKETING_PAGES — plain Node, zero deps.
 *
 *   node frontend/scripts/generate-sitemap.mjs
 *
 * Hand-maintaining this file stopped being reasonable at forty URLs. The
 * failure it invites is quiet and expensive: a page that is prerendered,
 * linked and live but absent from the sitemap simply waits longer to be
 * found, and nothing anywhere reports it. seoContent.test.ts compares the
 * committed file against this script's output, so the two cannot drift.
 *
 * Priorities are assigned by rule rather than per URL. They are a hint that
 * search engines treat loosely at the best of times, and a rule that reads
 * "answer pages rank below the pages they support" is easier to keep honest
 * than forty hand-tuned numbers.
 *
 * The per-day Daily archive URLs are NOT here: they grow daily and come from
 * the database via sitemap-daily.xml, which robots.txt declares separately.
 */

import { MARKETING_PAGES, SITE_URL } from '../src/marketing/seoContent.mjs';

/**
 * Pages that are crawlable but not in MARKETING_PAGES, because something other
 * than the prerender script renders them. /daily/archive is served to crawlers
 * by the backend (see the crawler block in docker/nginx.prod.conf).
 */
const EXTRA_URLS = [
  { path: '/daily/archive', changefreq: 'daily', priority: '0.7' },
];

/** First match wins, so put the specific prefixes above the general ones. */
const RULES = [
  { test: (p) => p === '/', changefreq: 'weekly', priority: '1.0' },
  { test: (p) => p === '/privacy' || p === '/terms', changefreq: 'yearly', priority: '0.3' },
  { test: (p) => p === '/about', changefreq: 'monthly', priority: '0.5' },
  { test: (p) => p === '/codex', changefreq: 'monthly', priority: '0.6' },
  // Family indexes sit above the pages inside them.
  { test: (p) => p === '/answers' || p === '/eras' || p === '/game-maps' || p === '/how-to-play',
    changefreq: 'monthly', priority: '0.8' },
  { test: (p) => p.startsWith('/answers/') || p.startsWith('/eras/') || p.startsWith('/game-maps/'),
    changefreq: 'monthly', priority: '0.7' },
];

function hintsFor(path) {
  const rule = RULES.find((r) => r.test(path));
  if (!rule) {
    throw new Error(
      `[sitemap] no priority rule matches "${path}". Add one to RULES rather than `
      + 'letting a new page family inherit a number by accident.',
    );
  }
  return rule;
}

export function renderSitemap() {
  const entries = [
    ...MARKETING_PAGES.map((page) => ({ path: page.path, ...hintsFor(page.path) })),
    ...EXTRA_URLS,
  ];
  const urls = entries.map(({ path, changefreq, priority }) => (
    '  <url>\n'
    + `    <loc>${SITE_URL}${path === '/' ? '/' : path}</loc>\n`
    + `    <changefreq>${changefreq}</changefreq>\n`
    + `    <priority>${priority}</priority>\n`
    + '  </url>'
  ));
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- GENERATED FILE — DO NOT EDIT BY HAND.
     Regenerate: node frontend/scripts/generate-sitemap.mjs
     Source: MARKETING_PAGES in src/marketing/seoContent.mjs.
     The per-day Daily archive URLs are generated from the database instead
     (sitemap-daily.xml, declared in robots.txt) because they grow daily. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}

// Only write when invoked directly — the drift test imports renderSitemap from
// here, and an import must not rewrite the file it is about to check.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const { writeFile } = await import('node:fs/promises');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const out = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sitemap.xml');
  const xml = renderSitemap();
  await writeFile(out, xml, 'utf8');
  console.log(`[sitemap] wrote ${out}`);
  console.log(`[sitemap] ${(xml.match(/<url>/g) ?? []).length} urls`);
}
