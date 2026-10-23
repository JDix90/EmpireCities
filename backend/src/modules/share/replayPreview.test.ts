/**
 * The crawler-facing replay page names two addresses. Search engines get the
 * plain /replay/:id as the canonical; the share link (`?source=share`, which
 * opens the highlight reel and records the visit as a share) stays on og:url
 * and the fallback link, where a link unfurl uses it.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const previewData = vi.hoisted(() => vi.fn());
vi.mock('./replayOgData', () => ({ buildReplayPreviewData: (...a: unknown[]) => previewData(...a) }));

import { registerReplayPreviewRoutes } from './replayPreview';

const attr = (html: string, re: RegExp) => html.match(re)?.[1];

describe('replay page for crawlers', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify();
    registerReplayPreviewRoutes(app);
    await app.ready();
  });
  afterAll(() => app.close());

  const get = (gameId: string) =>
    app.inject({
      method: 'GET',
      url: `/replay/${gameId}`,
      headers: { host: 'borderfall.gg', 'x-forwarded-proto': 'https', 'user-agent': 'Googlebot' },
    });

  it('names the plain replay address as canonical, and keeps the share link for unfurls', async () => {
    previewData.mockResolvedValueOnce({
      isPublic: true, winnerName: 'Ada', eraLabel: 'the Medieval Era', turnCount: 12, playerCount: 4,
    });
    const res = await get('g-123');
    expect(res.statusCode).toBe(200);
    const html = res.body;
    expect(attr(html, /<link rel="canonical" href="([^"]+)"/)).toBe('https://borderfall.gg/replay/g-123');
    expect(attr(html, /<meta property="og:url" content="([^"]+)"/)).toBe('https://borderfall.gg/replay/g-123?source=share');
    expect(attr(html, /<a href="([^"]+)"[^>]*>Open the replay/)).toBe('https://borderfall.gg/replay/g-123?source=share');
  });

  it('does the same for a replay that is not public', async () => {
    previewData.mockResolvedValueOnce(null);
    const html = (await get('g-456')).body;
    expect(attr(html, /<link rel="canonical" href="([^"]+)"/)).toBe('https://borderfall.gg/replay/g-456');
    expect(html).toContain('Borderfall — Watch the replay');
  });
});
