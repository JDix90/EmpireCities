/**
 * Public, unauthenticated read API for the settled Daily archive.
 *
 * Registered under the same `/api/daily` prefix as daily.routes.ts but kept in
 * its own plugin: every route in the other file sits behind `authenticate`, and
 * a public route living in that list is exactly the kind of thing that gets
 * skimmed over in review. Separate file, separate blast radius.
 *
 * Nothing here reads the caller's identity, so nothing here is personalized —
 * the responses are safe to cache at any layer.
 */
import type { FastifyInstance } from 'fastify';
import {
  getDailyArchiveEntry,
  listDailyArchive,
  isArchivableDate,
} from './dailyArchiveData';

/** Settled results can still gain a late finisher, so cache warmly, not forever. */
const CACHE_CONTROL = 'public, max-age=3600';
const SITE_URL = process.env.PUBLIC_SITE_URL || 'https://borderfall.gg';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function dailyArchiveRoutes(fastify: FastifyInstance): Promise<void> {
  // ── GET /api/daily/archive ──────────────────────────────────────────────
  // Recent settled days, newest first. Powers the /daily/archive index page.
  fastify.get<{ Querystring: { limit?: string } }>(
    '/archive',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const limitRaw = parseInt(request.query?.limit ?? '60', 10);
      const limit = Number.isFinite(limitRaw) ? limitRaw : 60;
      const days = await listDailyArchive(limit);
      return reply.header('Cache-Control', CACHE_CONTROL).send({ days });
    },
  );

  // ── GET /api/daily/archive/:date ────────────────────────────────────────
  // One settled day. 404s for malformed dates, today's live puzzle, future
  // dates, and days that were never generated — all the same, on purpose.
  fastify.get<{ Params: { date: string } }>(
    '/archive/:date',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { date } = request.params;
      if (!isArchivableDate(date)) {
        return reply.status(404).send({ error: 'No archived challenge for that date' });
      }
      const entry = await getDailyArchiveEntry(date);
      if (!entry) {
        return reply.status(404).send({ error: 'No archived challenge for that date' });
      }
      return reply.header('Cache-Control', CACHE_CONTROL).send(entry);
    },
  );

  // ── GET /api/daily/sitemap.xml ──────────────────────────────────────────
  // The archive grows by one URL a day, which a checked-in static sitemap
  // cannot express. nginx exposes this at the tidier /sitemap-daily.xml, and
  // robots.txt points crawlers at that. A sitemap declared in robots.txt may
  // live at any path on the same host, so the indirection costs nothing.
  fastify.get(
    '/sitemap.xml',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (_request, reply) => {
      const days = await listDailyArchive(366);
      const urls = days
        .map(
          (d) =>
            `  <url>\n    <loc>${esc(`${SITE_URL}/daily/${d.challenge_date}`)}</loc>\n`
            + `    <lastmod>${esc(d.challenge_date)}</lastmod>\n`
            + '    <changefreq>yearly</changefreq>\n    <priority>0.6</priority>\n  </url>',
        )
        .join('\n');

      const xml =
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + `  <url>\n    <loc>${esc(`${SITE_URL}/daily/archive`)}</loc>\n`
        + '    <changefreq>daily</changefreq>\n    <priority>0.7</priority>\n  </url>\n'
        + (urls ? `${urls}\n` : '')
        + '</urlset>\n';

      return reply
        .header('Content-Type', 'application/xml; charset=utf-8')
        .header('Cache-Control', CACHE_CONTROL)
        .send(xml);
    },
  );
}
