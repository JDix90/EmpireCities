/**
 * Crawler-facing HTML shell for /replay/:gameId. nginx routes social/chat
 * crawler user-agents here (humans get the SPA index.html) so link unfurls get
 * per-replay Open Graph tags + a dynamic preview image. The page also renders a
 * human-readable fallback and a <link rel="canonical"> back to the SPA route.
 */
import type { FastifyInstance } from 'fastify';
import { buildReplayPreviewData } from './replayOgData';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function baseUrl(headers: Record<string, unknown>): string {
  const proto = (headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || 'https';
  const host = (headers['x-forwarded-host'] as string) || (headers['host'] as string) || 'borderfall.gg';
  return `${proto}://${host}`;
}

export function registerReplayPreviewRoutes(app: FastifyInstance): void {
  app.get<{ Params: { gameId: string } }>('/replay/:gameId', async (request, reply) => {
    const { gameId } = request.params;
    const origin = baseUrl(request.headers as Record<string, unknown>);
    const canonical = `${origin}/replay/${encodeURIComponent(gameId)}?source=share`;

    let title = 'Borderfall — Watch the replay';
    let description = 'Watch this Borderfall match replay — a condensed highlight reel of the campaign.';
    let image = `${origin}/og-image.svg`;

    try {
      const data = await buildReplayPreviewData(gameId);
      // Only surface per-replay details for publicly-shared replays; otherwise
      // fall back to the generic Borderfall card (no winner/player leakage).
      if (data && data.isPublic) {
        title = `${data.winnerName} won in ${data.eraLabel} — Borderfall`;
        description = `${data.winnerName} claimed victory across ${data.turnCount} turns against ${Math.max(0, data.playerCount - 1)} rivals. Watch the highlight reel on Borderfall.`;
        image = `${origin}/api/share/${encodeURIComponent(gameId)}/og-image.png`;
      }
    } catch (err) {
      request.log.error({ err, gameId }, 'replay preview data load failed');
    }

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<link rel="canonical" href="${esc(canonical)}" />
<meta name="description" content="${esc(description)}" />
<meta property="og:type" content="video.other" />
<meta property="og:site_name" content="Borderfall" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(canonical)}" />
<meta property="og:image" content="${esc(image)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${esc(image)}" />
</head>
<body style="margin:0;background:#0a0f18;color:#e8eaf0;font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;">
<main style="max-width:560px;padding:32px;">
<h1 style="font-family:Georgia,serif;color:#c9a84c;">${esc(title)}</h1>
<p style="color:#9aa3b2;">${esc(description)}</p>
<p><a href="${esc(canonical)}" style="color:#c9a84c;">Open the replay →</a></p>
</main>
</body>
</html>`;

    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Cache-Control', 'public, max-age=300')
      .send(html);
  });
}
