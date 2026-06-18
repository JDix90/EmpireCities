/**
 * Build-time prerender for the public marketing routes — plain Node, zero deps.
 *
 * Why this instead of vite-react-ssg / @prerenderer+puppeteer:
 *   - The app is a deeply browser-coupled SPA (zustand-persist, firebase, pixi,
 *     three, react-globe.gl/WebGL, Capacitor). Making the whole app SSR/SSG-safe
 *     (vite-react-ssg) is a large, risky refactor; rendering the real pages in
 *     headless Chromium (puppeteer) is heavy and flaky inside the alpine Docker
 *     builder. Both threaten "the build still succeeds".
 *   - This script keeps the SPA 100% client-rendered. It takes the Vite-built
 *     `dist/index.html` (which already carries the hashed JS/CSS asset tags),
 *     and for each marketing route writes a copy with: a per-page <title>,
 *     description, canonical + Open Graph URL, optional JSON-LD, and REAL
 *     heading/paragraph HTML injected into #root. A no-JS crawler sees words;
 *     a real browser boots the SPA, which replaces #root with the live React
 *     page. Game/app routes are never touched.
 *
 * Output: dist/index.html (landing), dist/how-to-play/index.html, dist/eras/index.html.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MARKETING_PAGES,
  blocksToHtml,
  SITE_URL,
  OG_IMAGE,
  FAQ,
  SOCIAL_LINKS,
} from '../src/marketing/seoContent.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, '..', 'dist');

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Replace a <meta name|property=...> content, or insert it before </head> if absent. */
function setMeta(html, attr, key, value) {
  const re = new RegExp(`(<meta\\s+${attr}="${key}"\\s+content=")[^"]*(")`, 'i');
  if (re.test(html)) {
    return html.replace(re, `$1${escapeAttr(value)}$2`);
  }
  const tag = `    <meta ${attr}="${key}" content="${escapeAttr(value)}" />\n`;
  return html.replace('</head>', `${tag}  </head>`);
}

/** Replace an existing <link rel="canonical">, or insert one before </head>. */
function setCanonical(html, url) {
  const re = /(<link\s+rel="canonical"\s+href=")[^"]*(")/i;
  if (re.test(html)) {
    return html.replace(re, `$1${escapeAttr(url)}$2`);
  }
  return html.replace('</head>', `    <link rel="canonical" href="${escapeAttr(url)}" />\n  </head>`);
}

/** Escape `<` so JSON can never break out of the <script> tag, then wrap it. */
function jsonLdScript(data) {
  const json = JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
  return `    <script type="application/ld+json">\n${json}\n    </script>\n`;
}

function videoGameJsonLd(page) {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: 'Borderfall',
    alternateName: 'Borderfall.gg',
    description: page.description,
    genre: 'Strategy',
    gamePlatform: 'Web browser',
    applicationCategory: 'GameApplication',
    operatingSystem: 'Any',
    playMode: 'MultiPlayer',
    url: `${SITE_URL}/`,
    image: OG_IMAGE,
    inLanguage: 'en',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
    },
    // `sameAs` links the official profiles to this entity once they exist;
    // omitted while SOCIAL_LINKS is empty (never point sameAs at a 404).
    ...(SOCIAL_LINKS.length > 0 ? { sameAs: SOCIAL_LINKS } : {}),
  };
  return jsonLdScript(data);
}

/** FAQPage structured data, mirroring the visible FAQ on the page. */
function faqPageJsonLd(faq) {
  return jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  });
}

function bodyHtml(page) {
  const heading = `      <h1>${escapeAttr(page.h1)}</h1>\n`;
  const tagline = page.tagline ? `      <p class="bf-tagline">${escapeAttr(page.tagline)}</p>\n` : '';
  const blocks = blocksToHtml(page.blocks)
    .split('\n')
    .map((line) => `      ${line}`)
    .join('\n');
  // The wrapper is hidden from sighted users the instant the SPA boots (React
  // replaces #root), but is fully present in the served HTML for crawlers.
  return (
    `<div id="root"><main class="bf-prerender" data-prerendered="true">\n`
    + heading
    + tagline
    + `${blocks}\n`
    + `    </main></div>`
  );
}

async function run() {
  const shellPath = join(DIST, 'index.html');
  let shell;
  try {
    shell = await readFile(shellPath, 'utf8');
  } catch {
    console.error(`[prerender] ${shellPath} not found — run "vite build" first.`);
    process.exit(1);
  }

  if (!shell.includes('<div id="root"></div>')) {
    console.error('[prerender] Could not find <div id="root"></div> in built index.html. Aborting (no files written).');
    process.exit(1);
  }

  for (const page of MARKETING_PAGES) {
    let html = shell;

    // <head>: title, description, canonical, OG/Twitter URL + title + description.
    html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeAttr(page.title)}</title>`);
    html = setMeta(html, 'name', 'description', page.description);
    html = setMeta(html, 'property', 'og:title', page.title);
    html = setMeta(html, 'property', 'og:description', page.description);
    html = setMeta(html, 'property', 'og:url', `${SITE_URL}${page.path}`);
    html = setMeta(html, 'name', 'twitter:title', page.title);
    html = setMeta(html, 'name', 'twitter:description', page.description);
    html = setCanonical(html, `${SITE_URL}${page.path}`);

    if (page.jsonLd) {
      html = html.replace('</head>', `${videoGameJsonLd(page)}  </head>`);
    }
    if (page.faq) {
      html = html.replace('</head>', `${faqPageJsonLd(FAQ)}  </head>`);
    }

    // Body: inject crawlable content into #root.
    html = html.replace('<div id="root"></div>', bodyHtml(page));

    const outPath = join(DIST, page.file);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, html, 'utf8');
    console.log(`[prerender] wrote ${page.file}  (${page.path})`);
  }
}

run().catch((err) => {
  console.error('[prerender] failed:', err);
  process.exit(1);
});
