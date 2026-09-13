/**
 * GEO prompt-panel report — do assistants recommend us, and do they get us right?
 *
 *   pnpm -C backend exec tsx scripts/geoPanelReport.ts [path]
 *
 * Reads the hand-recorded observations in docs/geo-panel/observations.json (see
 * docs/GEO-PROMPT-PANEL.md for the method and the ten prompts) and prints the
 * trend. No database, no network: the input is a committed file, because there
 * is no API that reports what a model says about you and a scraped
 * approximation would be worse than an honest monthly sample.
 *
 * Read-only.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = resolve(__dirname, '..', '..', 'docs', 'geo-panel', 'observations.json');

interface Observation {
  checked_on: string;
  assistant: string;
  prompt_id: string;
  mentioned: boolean;
  position: number | null;
  cited_url: string | null;
  accurate: boolean | null;
  notes?: string;
}

/** Our own pages vs somebody else's writeup — see the three mechanisms in the doc. */
type CitationKind = 'own' | 'third_party' | 'none';

function citationKind(url: string | null | undefined): CitationKind {
  if (!url) return 'none';
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === 'borderfall.gg' ? 'own' : 'third_party';
  } catch {
    return 'third_party';
  }
}

function pct(n: number, d: number): string {
  return d ? `${((n / d) * 100).toFixed(0)}%` : '  — ';
}

function isObservation(value: unknown): value is Observation {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.checked_on === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(o.checked_on)
    && typeof o.assistant === 'string'
    && typeof o.prompt_id === 'string'
    && typeof o.mentioned === 'boolean'
  );
}

/** Group by key, preserving a stable sorted order for the caller. */
function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}

function rate(rows: Observation[]): string {
  const hits = rows.filter((r) => r.mentioned).length;
  return `${String(hits).padStart(3)}/${String(rows.length).padEnd(3)} ${pct(hits, rows.length).padStart(4)}`;
}

async function main(): Promise<void> {
  const path = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_PATH;

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    console.error(`[geoPanel] could not read ${path}:`, (err as Error).message);
    process.exit(1);
  }

  if (!Array.isArray(parsed)) {
    console.error(`[geoPanel] ${path} must contain a JSON array of observations.`);
    process.exit(1);
  }

  const rows = parsed.filter(isObservation);
  const skipped = parsed.length - rows.length;

  console.log('\n=== Borderfall GEO prompt panel ===');
  console.log(`(source: ${path})`);
  if (skipped > 0) console.log(`(skipped ${skipped} malformed row${skipped === 1 ? '' : 's'})`);

  if (rows.length === 0) {
    console.log('\nNo observations recorded yet.');
    console.log('Run the ten prompts in docs/GEO-PROMPT-PANEL.md against each assistant,');
    console.log('append the rows to docs/geo-panel/observations.json, and re-run this.\n');
    return;
  }

  // ── Trend by month ──────────────────────────────────────────────────────
  const byMonth = groupBy(rows, (r) => r.checked_on.slice(0, 7));
  const months = [...byMonth.keys()].sort();

  console.log('\nMENTION RATE BY MONTH');
  for (const month of months) {
    const monthRows = byMonth.get(month)!;
    const hits = monthRows.filter((r) => r.mentioned).length;
    const bar = '█'.repeat(Math.round((hits / monthRows.length) * 24));
    console.log(`  ${month}  ${rate(monthRows)}  ${bar}`);
  }

  const latest = months[months.length - 1];
  const latestRows = byMonth.get(latest)!;
  console.log(`\n── latest month (${latest}) ──`);

  // ── By assistant ────────────────────────────────────────────────────────
  console.log('\nBY ASSISTANT');
  for (const [assistant, list] of [...groupBy(latestRows, (r) => r.assistant)].sort()) {
    const positions = list.filter((r) => r.mentioned && r.position != null).map((r) => r.position!);
    const avgPos = positions.length
      ? (positions.reduce((a, b) => a + b, 0) / positions.length).toFixed(1)
      : '—';
    console.log(`  ${assistant.padEnd(12)} ${rate(list)}   avg position ${avgPos}`);
  }

  // ── By prompt: which questions we win and lose ──────────────────────────
  console.log('\nBY PROMPT (which questions we are in the answer set for)');
  const byPrompt = [...groupBy(latestRows, (r) => r.prompt_id)]
    .map(([id, list]) => ({ id, list, hits: list.filter((r) => r.mentioned).length }))
    .sort((a, b) => b.hits / b.list.length - a.hits / a.list.length || a.id.localeCompare(b.id));
  for (const { id, list } of byPrompt) {
    console.log(`  ${id.padEnd(22)} ${rate(list)}`);
  }
  const shutOut = byPrompt.filter((p) => p.hits === 0).map((p) => p.id);
  if (shutOut.length) {
    console.log(`\n  Not in the answer set at all: ${shutOut.join(', ')}`);
    console.log('  → check the page exists, is indexed in Bing, and answers in its first 40 words.');
  }

  // ── Where the citations point ───────────────────────────────────────────
  const mentioned = latestRows.filter((r) => r.mentioned);
  const kinds = { own: 0, third_party: 0, none: 0 };
  for (const row of mentioned) kinds[citationKind(row.cited_url)] += 1;
  console.log('\nWHERE CITATIONS POINT (of the mentions)');
  console.log(`  our own pages     ${String(kinds.own).padStart(3)}  ${pct(kinds.own, mentioned.length)}  → retrieval is working; keep adding answer pages`);
  console.log(`  third-party       ${String(kinds.third_party).padStart(3)}  ${pct(kinds.third_party, mentioned.length)}  → listicles are doing the work; go get listed in more`);
  console.log(`  no citation       ${String(kinds.none).padStart(3)}  ${pct(kinds.none, mentioned.length)}  → recalled, not retrieved`);

  // ── Accuracy: a wrong recommendation is a bug, not a win ────────────────
  const checkable = mentioned.filter((r) => r.accurate !== null && r.accurate !== undefined);
  const wrong = checkable.filter((r) => r.accurate === false);
  console.log('\nACCURACY OF WHAT THEY SAID');
  if (checkable.length === 0) {
    console.log('  (nothing checkable recorded)');
  } else {
    console.log(`  accurate ${checkable.length - wrong.length}/${checkable.length}  ${pct(checkable.length - wrong.length, checkable.length)}`);
  }
  // Every inaccuracy on record, not just the latest month — a wrong claim
  // usually outlives the month someone noticed it.
  const allWrong = rows.filter((r) => r.mentioned && r.accurate === false);
  if (allWrong.length) {
    console.log('\n  INACCURACIES ON RECORD (highest-priority fixes):');
    for (const row of allWrong) {
      console.log(`   · ${row.checked_on} ${row.assistant}/${row.prompt_id}: ${row.notes ?? '(no note)'}`);
    }
  }

  console.log(
    '\nNOTE: ten prompts across four assistants is ~40 points a month — enough to see'
    + '\na direction over a quarter, not enough to read one month as a result.\n',
  );
}

main().catch((err) => {
  console.error('[geoPanel] failed:', err);
  process.exit(1);
});
