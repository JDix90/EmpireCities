/**
 * Crawler-facing HTML for /daily/archive and /daily/YYYY-MM-DD.
 *
 * nginx routes crawler user-agents here and serves the SPA to everyone else —
 * the same split /replay/:gameId already uses. The difference is intent: a
 * replay shell exists so a pasted link unfurls, whereas these pages exist to
 * BE read. The Daily mints one authored puzzle and one real result set per day
 * and then throws both away at midnight; published, that is a dated, unique,
 * quotable page per day, which is the kind of thing both search crawlers and
 * answer engines retrieve.
 *
 * So the body here is a real document, not a placeholder: the same heading,
 * prose and results table the React page renders from the same public API.
 * Content parity is the point — dynamic serving that shows crawlers something
 * other than what humans get is cloaking, and `Vary: User-Agent` tells caches
 * the response depends on who asked.
 */
import type { FastifyInstance } from 'fastify';
import {
  getDailyArchiveEntry,
  listDailyArchive,
  isArchivableDate,
  type DailyArchiveEntry,
} from './dailyArchiveData';

function esc(s: string): string {
  return String(s)
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

/** Long-form date for prose ("12 September 2026"), UTC to match challenge_date. */
function prettyDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

const ARCHETYPE_LABELS: Record<string, string> = {
  domination: 'Domination',
  military_capture: 'Capture',
  hold_territory: 'Hold',
  control_region: 'Region control',
  capture_chain: 'Capture chain',
  economy_build: 'Economy',
  tech_research: 'Research',
};

function archetypeLabel(a: string): string {
  return ARCHETYPE_LABELS[a] ?? 'Puzzle';
}

const PAGE_CSS = `
  :root { color-scheme: dark; }
  body { margin:0; background:#0a0f18; color:#b6bdcc;
         font-family:Inter,system-ui,-apple-system,sans-serif; line-height:1.7; }
  main { max-width:46rem; margin:0 auto; padding:3rem 1.25rem 4rem; }
  h1 { font-family:Cinzel,Georgia,serif; color:#c9a84c; font-size:2rem;
       margin:0 0 .25rem; line-height:1.25; }
  h2 { font-family:Cinzel,Georgia,serif; color:#c9a84c; font-size:1.25rem;
       margin:2rem 0 .5rem; }
  .sub { color:#8892a4; font-style:italic; margin:0 0 1.5rem; }
  p { margin:0 0 1rem; }
  dl { margin:0 0 1rem; }
  dt { color:#8892a4; font-size:.9em; margin-top:.75rem; }
  dd { margin:0; color:#e8eaf0; }
  .wrap { overflow-x:auto; }
  table { border-collapse:collapse; width:100%; margin:0 0 1rem; font-size:.95em; }
  th, td { text-align:left; padding:.5rem .75rem; border-bottom:1px solid #1e2532; }
  th { color:#8892a4; font-weight:600; font-size:.85em;
       text-transform:uppercase; letter-spacing:.04em; }
  nav { display:flex; gap:1rem; flex-wrap:wrap; margin-top:2rem; }
  a { color:#c9a84c; }
  ul { padding-left:1.25rem; }
  li { margin:0 0 .5rem; }
`;

function shell(opts: {
  title: string;
  description: string;
  canonical: string;
  origin: string;
  body: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(opts.title)}</title>
<link rel="canonical" href="${esc(opts.canonical)}" />
<meta name="description" content="${esc(opts.description)}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="Borderfall" />
<meta property="og:title" content="${esc(opts.title)}" />
<meta property="og:description" content="${esc(opts.description)}" />
<meta property="og:url" content="${esc(opts.canonical)}" />
<meta property="og:image" content="${esc(`${opts.origin}/og-image.png`)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(opts.title)}" />
<meta name="twitter:description" content="${esc(opts.description)}" />
<meta name="twitter:image" content="${esc(`${opts.origin}/og-image.png`)}" />
<style>${PAGE_CSS}</style>
</head>
<body>
<main>
${opts.body}
</main>
</body>
</html>
`;
}

function entryBody(entry: DailyArchiveEntry, origin: string): string {
  const { spec, results } = entry;
  const when = prettyDate(entry.challenge_date);

  const facts: Array<[string, string]> = [
    ['Date', when],
    ['Puzzle type', archetypeLabel(spec.archetype)],
    ['Era', spec.era_label],
    ['Opponents', `${Math.max(0, spec.player_count - 1)} AI${spec.ai_difficulty ? ` (${spec.ai_difficulty})` : ''}`],
    ['Turn limit', spec.max_turns > 0 ? `${spec.max_turns} turns` : 'None'],
  ];
  if (spec.par_turns != null) facts.push(['Par', `${spec.par_turns} turns`]);

  const outcome = results.attempts === 0
    ? 'No registered commander logged a result on this one.'
    : `${results.wins} of ${results.attempts} registered commander${results.attempts === 1 ? '' : 's'} solved it`
      + `${results.win_rate != null ? ` (${results.win_rate}%)` : ''}`
      + `${results.median_winning_turns != null ? `, taking a median of ${results.median_winning_turns} turns` : ''}`
      + '.';

  const rows = results.leaderboard
    .map(
      (l, i) =>
        `<tr><td>${i + 1}</td><td>${esc(l.username)}</td>`
        + `<td>${l.won ? 'Solved' : 'Failed'}</td>`
        + `<td>${l.puzzle_score ?? '—'}</td>`
        + `<td>${l.turn_count ?? '—'}</td></tr>`,
    )
    .join('\n');

  const table = results.leaderboard.length
    ? `<h2>Results</h2>
<div class="wrap"><table>
<thead><tr><th>#</th><th>Commander</th><th>Outcome</th><th>Score</th><th>Turns</th></tr></thead>
<tbody>
${rows}
</tbody>
</table></div>`
    : '';

  return `<h1>${esc(spec.title)}</h1>
<p class="sub">Borderfall Daily Challenge — ${esc(when)}</p>
${spec.intro ? `<p>${esc(spec.intro)}</p>` : ''}
${spec.goal ? `<p><strong>Objective:</strong> ${esc(spec.goal)}</p>` : ''}
<p>${esc(outcome)}</p>
<h2>The setup</h2>
<dl>
${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('\n')}
</dl>
${table}
<h2>Play today's challenge</h2>
<p>Borderfall sets a new puzzle every day: a hand-built position on a world map,
the same one for everyone, solvable in a few minutes. It is free, runs in the
browser, and you can play as a guest without making an account.</p>
<nav>
<a href="${esc(origin)}/daily">Today's challenge</a>
<a href="${esc(origin)}/daily/archive">Past challenges</a>
<a href="${esc(origin)}/how-to-play">How to play</a>
<a href="${esc(origin)}/">Borderfall</a>
</nav>`;
}

export function registerDailyArchivePreviewRoutes(app: FastifyInstance): void {
  // ── /daily/archive — the index ──────────────────────────────────────────
  app.get('/daily/archive', async (request, reply) => {
    const origin = baseUrl(request.headers as Record<string, unknown>);
    const canonical = `${origin}/daily/archive`;

    let items = '';
    try {
      const days = await listDailyArchive(60);
      items = days.length
        ? `<ul>\n${days
            .map(
              (d) =>
                `<li><a href="${esc(origin)}/daily/${esc(d.challenge_date)}">`
                + `${esc(d.challenge_date)} — ${esc(d.title)}</a>`
                + ` <span style="color:#8892a4">(${esc(archetypeLabel(d.archetype))}, ${esc(d.era_label)}`
                + `${d.attempts > 0 ? `, ${d.wins}/${d.attempts} solved` : ''})</span></li>`,
            )
            .join('\n')}\n</ul>`
        : '<p>The first archived challenge will appear here tomorrow.</p>';
    } catch (err) {
      request.log.error({ err }, 'daily archive index load failed');
      items = '<p>The archive is briefly unavailable.</p>';
    }

    const html = shell({
      title: 'Borderfall Daily Challenge Archive — Every Past Puzzle',
      description:
        'Every past Borderfall Daily Challenge: the puzzle, the objective, how many '
        + 'commanders solved it, and in how many turns. A new one is set each day, free in your browser.',
      canonical,
      origin,
      body: `<h1>Daily Challenge Archive</h1>
<p class="sub">One puzzle a day, and how everyone did on it.</p>
<p>Borderfall sets a new Daily Challenge every day — a hand-built position on a
world map with a single objective, the same puzzle for every player, usually
solvable in a few minutes. This is the record of the ones already settled:
what the puzzle asked, how many commanders solved it, and how long it took them.</p>
<h2>Past challenges</h2>
${items}
<nav>
<a href="${esc(origin)}/daily">Today's challenge</a>
<a href="${esc(origin)}/how-to-play">How to play</a>
<a href="${esc(origin)}/">Borderfall</a>
</nav>`,
    });

    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Vary', 'User-Agent')
      .header('Cache-Control', 'public, max-age=3600')
      .send(html);
  });

  // ── /daily/:date — one settled day ──────────────────────────────────────
  app.get<{ Params: { date: string } }>('/daily/:date', async (request, reply) => {
    const { date } = request.params;
    const origin = baseUrl(request.headers as Record<string, unknown>);

    // A live or bogus date gets the archive index rather than a thin 404 page:
    // the crawler followed a /daily/* URL and there is a real page to give it.
    if (!isArchivableDate(date)) {
      return reply.redirect(302, '/daily/archive');
    }

    let entry: DailyArchiveEntry | null = null;
    try {
      entry = await getDailyArchiveEntry(date);
    } catch (err) {
      request.log.error({ err, date }, 'daily archive entry load failed');
    }
    if (!entry) return reply.redirect(302, '/daily/archive');

    const { spec, results } = entry;
    const solved = results.attempts > 0
      ? `${results.wins} of ${results.attempts} solved it.`
      : 'Results are in the archive.';

    const html = shell({
      title: `${spec.title} — Borderfall Daily Challenge, ${entry.challenge_date}`,
      description:
        `${spec.goal || spec.intro || 'The Borderfall Daily Challenge'} `
        + `${solved} A free turn-based strategy puzzle you play in your browser.`,
      canonical: `${origin}/daily/${encodeURIComponent(entry.challenge_date)}`,
      origin,
      body: entryBody(entry, origin),
    });

    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Vary', 'User-Agent')
      .header('Cache-Control', 'public, max-age=3600')
      .send(html);
  });
}
