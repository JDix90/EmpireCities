/**
 * The v2 bench: prove a set-piece on every date it is served and say why the
 * gate refused the days it refused.
 *
 *   pnpm -C backend exec tsx scripts/benchDailyV2.ts bleeding_missouri
 *   pnpm -C backend exec tsx scripts/benchDailyV2.ts the_border_states --reading tactical --days 730
 *   pnpm -C backend exec tsx scripts/benchDailyV2.ts --all
 *
 * Set-piece mode proves every date in the horizon whose v2 candidate is one
 * of the named set-pieces, exactly as the schedule would (proveV2Day, the
 * date's own sizing and tier), and prints each attempt's numbers and the
 * gate causes it missed on, then the pass rate per reading and the causes
 * across the failed days. Edit a plan or a board, run it again.
 *
 * --all is the coverage report: every date in the horizon classified (graded,
 * plan failed the gate, no plan, not gradeable, Thursday or Sunday, calendar),
 * pass rates for every planned reading worst first, and the unplanned
 * readings by the days they would grade. --verbose adds the per-date lines.
 *
 * Options: --from YYYY-MM-DD (default today, UTC), --days N (default 365),
 * --jobs N (default one per CPU; each job is a forked process), --reading
 * tactical|hold|region|chain (set-piece mode only).
 *
 * --all --write-calendar also writes what the run found to
 * src/content/dailyV2Calendar.ts, the calendar the schedule serves from
 * (docs/DAILY_PUZZLE_V2.md §5.3). Regenerate it over its own range:
 *
 *   pnpm -C backend exec tsx scripts/benchDailyV2.ts --all --from 2026-09-21 --days 467 --write-calendar
 *
 * The Tuesday rotation walks planned set-pieces only, so adding or removing a
 * plan moves which set-piece later Tuesdays serve. The bench always reads the
 * schedule as the code stands.
 */
import { fork, type ChildProcess } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { availableParallelism } from 'os';
import { join } from 'path';
import type { GameMap } from '../src/types';
import { DAILY_SET_PIECES } from '../src/content/dailySetPieces';
import { territoryDisplayName } from '../src/game-engine/daily/dailyGenerator';
import {
  attemptCauses,
  BENCH_CAUSES,
  calendarFingerprint,
  calendarFromProofs,
  classifyDate,
  renderCalendarModule,
  summarizeCoverage,
  tallyCauses,
  tallyReadings,
  tallyWeekdays,
  unplannedReadings,
  type CauseTally,
  type ClassifiedDate,
  type DateProof,
} from '../src/game-engine/daily/dailyBench';
import type { DailyVerb } from '../src/game-engine/daily/dailySchedule';
import { pickSetPieceForDateV2, proveV2Day, type V2Attempt } from '../src/game-engine/daily/dailyScheduleV2';
import { describeAction } from '../src/game-engine/daily/puzzle/actions';
import { contextFromSpec } from '../src/game-engine/daily/puzzle/bridge';

// ── Proving one date (in a worker, or in-process with --jobs 1) ─────────────

const mapCache = new Map<string, GameMap>();
async function loadMap(mapId: string): Promise<GameMap | null> {
  if (!mapCache.has(mapId)) {
    mapCache.set(mapId, JSON.parse(readFileSync(join(__dirname, `../../database/maps/${mapId}.json`), 'utf-8')) as GameMap);
  }
  return mapCache.get(mapId)!;
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;

async function proveDate(date: string): Promise<DateProof | null> {
  const pick = pickSetPieceForDateV2(date);
  if (!pick) return null;
  const t0 = Date.now();
  const { proven, attempts } = await proveV2Day(date, pick, { loadMap, simulate: null });
  const proof: DateProof = {
    date,
    set_piece_id: pick.set_piece.id,
    verb: pick.verb,
    decisions: pick.tier.decisions,
    ok: proven !== null,
    attempts,
    ms: Date.now() - t0,
  };
  if (proven) {
    proof.landing = { attempt: proven.attempt, shift: proven.shift };
    const map = (await loadMap(proven.spec.map_id))!;
    const ctx = contextFromSpec(proven.spec, map);
    const name = (id: string) => territoryDisplayName(map, id);
    proof.detail = proven.analysis.decisions.map((d) =>
      `turn ${d.turn}: ${describeAction(ctx, d.best, name)} ${pct(d.bestEquity)}, `
        + `against ${d.alternative ? `"${describeAction(ctx, d.alternative, name)}" ${pct(d.alternativeEquity)}` : 'nothing'}`);
  }
  return proof;
}

type ToWorker = { date: string } | { done: true };
type FromWorker = { date: string; proof: DateProof | null } | { date: string; error: string };

function runWorker(): void {
  process.on('message', (msg: ToWorker) => {
    if ('done' in msg) {
      process.disconnect();
      return;
    }
    proveDate(msg.date).then(
      (proof) => process.send!({ date: msg.date, proof } satisfies FromWorker),
      (err: unknown) => process.send!({ date: msg.date, error: err instanceof Error ? err.stack ?? err.message : String(err) } satisfies FromWorker),
    );
  });
}

// ── Proving many dates ──────────────────────────────────────────────────────

function progress(done: number, total: number): void {
  if (process.stderr.isTTY) process.stderr.write(`\r  proved ${done}/${total}${done === total ? '\n' : ''}`);
}

async function proveInProcess(dates: string[]): Promise<DateProof[]> {
  const proofs: DateProof[] = [];
  for (const [i, date] of dates.entries()) {
    const proof = await proveDate(date);
    if (proof) proofs.push(proof);
    progress(i + 1, dates.length);
  }
  return proofs;
}

/** One forked worker per job, each handed the next date as it finishes one: a day costs anywhere from a tenth of a second to over a minute. */
function proveInWorkers(dates: string[], jobs: number): Promise<DateProof[]> {
  return new Promise((resolve, reject) => {
    const queue = [...dates];
    const proofs: DateProof[] = [];
    const workers: ChildProcess[] = [];
    let settled = 0;
    let failed = false;
    const fail = (err: Error) => {
      if (failed) return;
      failed = true;
      for (const w of workers) w.kill();
      reject(err);
    };
    const feed = (worker: ChildProcess) => {
      const date = queue.shift();
      worker.send((date ? { date } : { done: true }) satisfies ToWorker);
    };
    for (let i = 0; i < Math.min(jobs, dates.length); i++) {
      const worker = fork(__filename, ['--worker'], { execArgv: process.execArgv });
      workers.push(worker);
      worker.on('message', (msg: FromWorker) => {
        if ('error' in msg) {
          fail(new Error(`${msg.date}: ${msg.error}`));
          return;
        }
        if (msg.proof) proofs.push(msg.proof);
        settled += 1;
        progress(settled, dates.length);
        feed(worker);
      });
      worker.on('exit', (code, signal) => {
        if (code !== 0) fail(new Error(`a bench worker stopped early (${signal ?? `exit code ${code}`})`));
        else if (!failed && workers.every((w) => w.exitCode !== null || w.signalCode !== null)) resolve(proofs);
      });
      feed(worker);
    }
    if (dates.length === 0) resolve(proofs);
  });
}

// ── Printing ────────────────────────────────────────────────────────────────

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekdayName = (date: string): string => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

function attemptLine(a: V2Attempt, target: number): string {
  if (!a.verdict) return `attempt ${a.attempt}  budget exceeded after ${(a.nodes ?? 0).toLocaleString('en-US')} nodes`;
  const m = a.measured;
  const numbers = m
    ? `equity ${pct(m.equity)}  obvious ${pct(m.obvious)} (gap ${Math.round((m.equity - m.obvious) * 100)})  near ${m.near_best}  decisions ${m.decisions}/${target}  `
    : '';
  return `attempt ${a.attempt}  ${numbers}${a.verdict.ok ? 'accepted' : attemptCauses(a).join(' ')}`;
}

function printProof(proof: DateProof): void {
  const head = `${proof.date} ${weekdayName(proof.date)}  ${proof.set_piece_id}  ${proof.verb}  ${proof.decisions} decisions`;
  const outcome = proof.ok ? `OK on attempt ${proof.attempts[proof.attempts.length - 1].attempt}` : 'FAILED';
  console.log(`${head}  ${outcome}  ${seconds(proof.ms)}`);
  if (!proof.ok && proof.attempts.length === 0) console.log('    no attempt: the day could not be sized');
  for (const a of proof.attempts) console.log(`    ${attemptLine(a, proof.decisions)}`);
  for (const line of proof.detail ?? []) console.log(`    ${line}`);
}

function causeCells(tally: CauseTally): string {
  return BENCH_CAUSES.filter((c) => tally[c]).map((c) => `${c} ${tally[c]!.any}/${tally[c]!.every}`).join('  ');
}

function printCauses(proofs: DateProof[]): void {
  const failed = proofs.filter((p) => !p.ok).length;
  if (failed === 0) return;
  const tally = tallyCauses(proofs);
  console.log(`\nCauses on the ${failed} failed ${failed === 1 ? 'day' : 'days'}, in some attempt / in every attempt:`);
  const width = Math.max(...BENCH_CAUSES.map((c) => c.length));
  for (const c of BENCH_CAUSES) {
    const row = tally[c];
    if (row) console.log(`  ${c.padEnd(width)}  ${String(row.any).padStart(3)} / ${row.every}`);
  }
}

function printReadings(proofs: DateProof[]): void {
  const rows = tallyReadings(proofs);
  const width = Math.max(...rows.map((r) => `${r.set_piece_id} ${r.verb}`.length));
  for (const r of rows) {
    const label = `${r.set_piece_id} ${r.verb}`.padEnd(width);
    const causes = causeCells(r.causes);
    console.log(`  ${label}  ${`${r.passed}/${r.served}`.padStart(5)}${causes ? `  ${causes}` : ''}`);
  }
}

function printCoverage(dates: ClassifiedDate[], proofs: DateProof[]): void {
  const c = summarizeCoverage(dates, proofs);
  const rows: Array<[string, number]> = [
    ['graded', c.graded],
    ['plan failed the gate', c.gate_failed],
    ['no plan for the reading', c.no_plan],
    ['not gradeable (economy, tech)', c.not_gradeable],
    ['Thursday or Sunday', c.v1_weekday],
    ['dated calendar entry', c.calendar],
  ];
  if (c.unproven) rows.push(['planned, not proven', c.unproven]);
  const width = Math.max(...rows.map(([label]) => label.length));
  for (const [label, n] of rows) console.log(`  ${label.padEnd(width)}  ${String(n).padStart(3)}`);
  console.log(`\nGraded / planned by weekday: ${tallyWeekdays(proofs).map((w) => `${WEEKDAYS[w.weekday]} ${w.passed}/${w.served}`).join('  ')}`);
  console.log('\nPassed / served per planned reading, worst first, with the causes on its failed days (some attempt / every attempt):');
  printReadings(proofs);
  printCauses(proofs);
  const unplanned = unplannedReadings(dates);
  if (unplanned.length) {
    console.log('\nReadings served with no plan, by days served:');
    for (const u of unplanned) console.log(`  ${String(u.days).padStart(3)}  ${u.set_piece_id} ${u.verb}`);
  }
}

// ── Arguments ───────────────────────────────────────────────────────────────

interface Args {
  ids: string[];
  all: boolean;
  from: string;
  days: number;
  jobs: number;
  reading: DailyVerb | null;
  verbose: boolean;
  writeCalendar: boolean;
}

const READINGS: readonly DailyVerb[] = ['tactical', 'hold', 'region', 'chain'];

function usage(message: string): never {
  console.error(`${message}\n\nusage: benchDailyV2.ts <set-piece-id>... | --all [--write-calendar]  [--from YYYY-MM-DD] [--days N] [--jobs N] [--reading ${READINGS.join('|')}] [--verbose]`);
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    ids: [],
    all: false,
    from: new Date().toISOString().slice(0, 10),
    days: 365,
    jobs: availableParallelism(),
    reading: null,
    verbose: false,
    writeCalendar: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = (): string => argv[++i] ?? usage(`${arg} needs a value`);
    if (arg === '--all') args.all = true;
    else if (arg === '--verbose') args.verbose = true;
    else if (arg === '--write-calendar') args.writeCalendar = true;
    else if (arg === '--from') args.from = value();
    else if (arg === '--days') args.days = Number(value());
    else if (arg === '--jobs') args.jobs = Number(value());
    else if (arg === '--reading') args.reading = value() as DailyVerb;
    else if (arg.startsWith('--')) usage(`unknown option ${arg}`);
    else args.ids.push(arg);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.from) || Number.isNaN(Date.parse(`${args.from}T00:00:00Z`))) usage(`--from wants YYYY-MM-DD, got ${args.from}`);
  if (!Number.isInteger(args.days) || args.days < 1) usage('--days wants a positive whole number');
  if (!Number.isInteger(args.jobs) || args.jobs < 1) usage('--jobs wants a positive whole number');
  if (args.reading && !READINGS.includes(args.reading)) usage(`--reading wants one of ${READINGS.join(', ')}`);
  if (args.all === (args.ids.length > 0)) usage('name one or more set-pieces, or pass --all');
  if (args.writeCalendar && !args.all) usage('--write-calendar goes with --all');
  const known = new Set(DAILY_SET_PIECES.map((sp) => sp.id));
  for (const id of args.ids) {
    if (known.has(id)) continue;
    const near = [...known].filter((k) => k.includes(id) || id.includes(k));
    usage(`unknown set-piece "${id}"${near.length ? ` (did you mean ${near.join(', ')}?)` : ''}`);
  }
  return args;
}

function horizon(from: string, days: number): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10));
}

// ── The calendar ────────────────────────────────────────────────────────────

const CALENDAR_PATH = join(__dirname, '../src/content/dailyV2Calendar.ts');

function writeCalendar(dates: ClassifiedDate[], proofs: DateProof[], args: Args): void {
  const fingerprint = calendarFingerprint((mapId) => readFileSync(join(__dirname, `../../database/maps/${mapId}.json`), 'utf-8'));
  const calendar = calendarFromProofs(dates, proofs, fingerprint);
  const command = `pnpm -C backend exec tsx scripts/benchDailyV2.ts --all --from ${args.from} --days ${args.days} --write-calendar`;
  writeFileSync(CALENDAR_PATH, renderCalendarModule(calendar, command));
  const accepted = Object.values(calendar.days).filter((e) => !('refused' in e)).length;
  console.log(`\nWrote the calendar, ${calendar.from} to ${calendar.to}: ${accepted} dates graded, ${Object.keys(calendar.days).length - accepted} refused (src/content/dailyV2Calendar.ts).`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dates = horizon(args.from, args.days).map(classifyDate);
  const span = `${args.days} days from ${args.from}`;
  const ids = new Set(args.ids);
  const inScope = (d: ClassifiedDate) => args.all || (d.set_piece_id !== null && ids.has(d.set_piece_id) && (!args.reading || d.verb === args.reading));
  const toProve = dates.filter((d) => d.class === 'planned' && inScope(d)).map((d) => d.date);

  const jobs = args.jobs > 1 && toProve.length > 1 ? Math.min(args.jobs, toProve.length) : 1;
  const t0 = Date.now();
  const proofs = (jobs > 1 ? await proveInWorkers(toProve, jobs) : await proveInProcess(toProve))
    .sort((a, b) => a.date.localeCompare(b.date));
  const wall = Date.now() - t0;
  const solving = proofs.reduce((sum, p) => sum + p.ms, 0);

  if (args.all) {
    if (args.verbose) {
      for (const proof of proofs) printProof(proof);
      console.log('');
    }
    console.log(`Daily v2 coverage over ${span}:`);
    printCoverage(dates, proofs);
    if (args.writeCalendar) writeCalendar(dates, proofs, args);
  } else {
    console.log(`Proving ${args.ids.join(', ')}${args.reading ? ` (${args.reading})` : ''} on every date served over ${span}\n`);
    for (const proof of proofs) printProof(proof);
    if (proofs.length) {
      console.log('\nPassed / served per reading, with the causes on its failed days (some attempt / every attempt):');
      printReadings(proofs);
      printCauses(proofs);
    }
    const unplanned = unplannedReadings(dates.filter(inScope));
    for (const u of unplanned) console.log(`\n${u.set_piece_id} ${u.verb}: served ${u.days} ${u.days === 1 ? 'day' : 'days'} with no plan for the reading, so nothing to prove.`);
    if (!proofs.length && !unplanned.length) console.log('Not served as a v2 fight on any date in the horizon.');
  }
  console.log(`\n${proofs.length} ${proofs.length === 1 ? 'day' : 'days'} proved in ${seconds(wall)} (${seconds(solving)} solving) on ${jobs} ${jobs === 1 ? 'job' : 'jobs'}`);
}

if (process.argv.includes('--worker')) runWorker();
else void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
