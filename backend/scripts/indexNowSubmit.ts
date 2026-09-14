/**
 * Push URLs to IndexNow (Bing et al.) from the command line.
 *
 *   pnpm -C backend exec tsx scripts/indexNowSubmit.ts            # preview
 *   pnpm -C backend exec tsx scripts/indexNowSubmit.ts --apply    # actually send
 *   pnpm -C backend exec tsx scripts/indexNowSubmit.ts --apply https://borderfall.gg/answers
 *
 * With no URL arguments it reads both sitemaps live from the site, which is the
 * useful default: it submits exactly what the site currently claims to publish,
 * rather than a list that can drift from it.
 *
 * Preview by default, `--apply` to send — same shape as
 * pruneFeatureFlagOverrides.ts. Submitting is idempotent and safe to repeat,
 * but it is still an outbound call to a third party about someone else's crawl
 * budget, so it is a deliberate keystroke.
 *
 * Requires INDEXNOW_KEY (and optionally PUBLIC_SITE_URL) in the environment.
 * Read-only against our own database — it touches none.
 */
import { getIndexNowConfig, submitUrls, filterSubmittableUrls } from '../src/services/indexNow';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const explicit = args.filter((a) => !a.startsWith('--'));

const SITE = (process.env.PUBLIC_SITE_URL || 'https://borderfall.gg').replace(/\/+$/, '');
const SITEMAPS = [`${SITE}/sitemap.xml`, `${SITE}/sitemap-daily.xml`];

async function urlsFromSitemap(url: string): Promise<string[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`  ${url} → HTTP ${res.status} (skipped)`);
      return [];
    }
    const xml = await res.text();
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
    console.log(`  ${url} → ${locs.length} URL(s)`);
    return locs;
  } catch (err) {
    console.warn(`  ${url} → ${(err as Error).message} (skipped)`);
    return [];
  }
}

async function main(): Promise<void> {
  const cfg = getIndexNowConfig();
  if (!cfg) {
    console.error(
      'INDEXNOW_KEY is unset or malformed. Set it to the key you generated in\n'
      + 'Bing Webmaster Tools — the same value served at <site>/<key>.txt.',
    );
    process.exit(1);
  }

  console.log(`\n=== IndexNow submit ===`);
  console.log(`host:        ${cfg.host}`);
  console.log(`keyLocation: ${cfg.keyLocation}`);

  // Fail early and loudly if the key file is not actually reachable: IndexNow
  // rejects the whole batch when it cannot verify host control, and a 404 here
  // is the single most likely cause (usually "committed but not deployed").
  try {
    const res = await fetch(cfg.keyLocation);
    const body = res.ok ? (await res.text()).trim() : '';
    if (!res.ok) {
      console.error(`\nKey file NOT reachable: HTTP ${res.status} at ${cfg.keyLocation}`);
      console.error('IndexNow will reject every submission until that URL serves the key.');
      console.error('If you just committed it, the site still needs a deploy.');
      process.exit(1);
    }
    if (body !== cfg.key) {
      console.error(`\nKey file content mismatch at ${cfg.keyLocation}`);
      console.error(`  served: ${JSON.stringify(body.slice(0, 80))}`);
      console.error(`  expected: ${JSON.stringify(cfg.key)}`);
      process.exit(1);
    }
    console.log(`key file:    reachable and matches ✓`);
  } catch (err) {
    console.error(`\nCould not fetch ${cfg.keyLocation}: ${(err as Error).message}`);
    process.exit(1);
  }

  let candidates: string[];
  if (explicit.length > 0) {
    candidates = explicit;
    console.log(`\nsource: ${explicit.length} URL(s) given on the command line`);
  } else {
    console.log(`\nsource: sitemaps`);
    candidates = (await Promise.all(SITEMAPS.map(urlsFromSitemap))).flat();
  }

  const urls = filterSubmittableUrls(candidates, cfg.host);
  const dropped = candidates.length - urls.length;
  console.log(`\n${urls.length} submittable URL(s)${dropped > 0 ? ` (${dropped} dropped: off-host, malformed or duplicate)` : ''}`);
  for (const u of urls.slice(0, 10)) console.log(`  ${u}`);
  if (urls.length > 10) console.log(`  … and ${urls.length - 10} more`);

  if (urls.length === 0) {
    console.log('\nNothing to submit.\n');
    return;
  }

  if (!apply) {
    console.log('\nPreview only. Re-run with --apply to submit.\n');
    return;
  }

  const result = await submitUrls(urls);
  if (result.status !== null && result.status < 400) {
    console.log(`\nAccepted: ${result.submitted} URL(s), HTTP ${result.status}.`);
    console.log('Indexing is still Bing\'s decision — this only guarantees it was told.\n');
  } else {
    console.error(`\nNot accepted (HTTP ${result.status ?? 'n/a'}${result.error ? `, ${result.error}` : ''}).\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[indexNowSubmit] failed:', err);
  process.exit(1);
});
