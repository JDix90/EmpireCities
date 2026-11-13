/**
 * Full Game pacing report: reads the round-by-round traces the bot arena writes
 * (scripts/simAiArena.ts, ARENA_TRACE) and measures how long games run, how
 * they end, how far the table gets through the eras, where the rounds go, and
 * how much of a game is played after its outcome is settled.
 *
 * It only reads traces: no game is played here, and nothing in src/ is touched.
 *
 * Run (from backend/):
 *   ARENA_RULES=full-default ARENA_GAMES=400 ARENA_TRACE=/tmp/default.trace.jsonl \
 *     pnpm exec tsx scripts/simAiArena.ts
 *   pnpm exec tsx scripts/fullGamePacing.ts default=/tmp/default.trace.jsonl [label=path ...]
 *
 * Settings (environment):
 *   PACING_JSON     a file to write every configuration's summary to, as JSON
 *   PACING_DETAIL   1 to print each configuration's full breakdown (default: the
 *                     comparison table only when more than one trace is given)
 *   PACING_ACCEPT_SURRENDER  1 to read every game as ending the first time the
 *                     stand-in's turn opened with the bots' surrender on offer
 *                     (victory/surrender.ts): the game a player who always
 *                     accepts would have had.
 *   PACING_CAP      read every game as if it had been capped at this round (the
 *                     leader then wins, as at the real cap). An approximation:
 *                     bots race in the last three rounds before a real cap.
 *
 * The measures, and why each is what it is:
 *
 *   length        rounds played, and minutes for the seat standing in for the
 *                 player: its own turns at a fixed number of seconds each, plus
 *                 the other seats' turns at the live game's pacing (0.6 s a
 *                 paced step), until the game ends or the seat is out.
 *   eras          each seat's era when the game ended, and the round each era
 *                 was first reached by anyone and by the median seat.
 *   stages        the game cut at two moments: the first seat reaching the last
 *                 era, and the last living seat reaching it. Before the first
 *                 the table is still climbing; after the second there is no era
 *                 left for anyone to reach.
 *   decided       the first round in which one seat holds DECIDED_BOARD_SHARE
 *                 of the board and DECIDED_ARMY_RATIO times the armies of the
 *                 next strongest seat. Chosen because it can be read off a live
 *                 board with no knowledge of the future, and because the seat
 *                 it names goes on to win nearly every time (the report prints
 *                 how often). Rounds after it are played with the result known.
 *   quiet round   a round with no era advance, no seat leaving, no change of
 *                 territory leader, and at most QUIET_TILES territories changing
 *                 hands. A lull is LULL_ROUNDS or more quiet rounds in a row.
 *   after the ages  rounds played once every living seat is in the last era: the
 *                 part of a game with no era left for anyone to reach. A short
 *                 one is the game's last act; a long one is a game outliving
 *                 its own content.
 *   sidelined     a seat still in the game but holding under SIDELINED_SHARE of
 *                 the board: playing turns with no realistic way back. The
 *                 share of all seat-rounds spent that way says how well a game
 *                 keeps its trailing players in it.
 *   snowball      how often the seat that advanced an era first, and the seat
 *                 leading on territory as round 10 and round 20 ended, went on
 *                 to win. A fair share is one game in the number of seats.
 */
import { readFileSync, writeFileSync } from 'fs';
import { createSeededRng, hashStringToSeed } from '../src/game-engine/victory/missions';

interface GameTrace {
  seats: number;
  map: string;
  game: number;
  candidateSeat: number;
  startSeat: number;
  winnerSeat: number | null;
  condition: string | null;
  rounds: number;
  lastEra?: number;
  board: number[];
  neutral: number[];
  held: number[][];
  units: number[][];
  era: number[][];
  rivalCaptures: number[][];
  neutralCaptures: number[][];
  runs: number[][];
  steps: number[][];
  advances: [number, number, number][];
  exits: [number, number][];
  blockers: Record<string, number>[][];
  surrenderOfferRound: number;
}

export const DECIDED_BOARD_SHARE = 0.6;
export const DECIDED_ARMY_RATIO = 2;
export const QUIET_TILES = 1;
export const LULL_ROUNDS = 5;
export const SIDELINED_SHARE = 0.1;
const TURN_SECONDS = [45, 60, 90];
const STEP_SECONDS = 0.6;

const CAP = process.env.PACING_CAP ? Number(process.env.PACING_CAP) : undefined;
const ACCEPT_SURRENDER = process.env.PACING_ACCEPT_SURRENDER === '1';

// ── statistics ───────────────────────────────────────────────────────────────

function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}
const median = (xs: number[]): number => quantile(xs, 0.5);
const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/** Wilson 95% interval for k successes in n. */
function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [NaN, NaN];
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - h) / d), Math.min(1, (c + h) / d)];
}

/** Percentile-bootstrap 95% interval for a statistic of a sample, seeded so a report repeats. */
function bootstrap(xs: number[], stat: (s: number[]) => number, label: string, draws = 1000): [number, number] {
  if (xs.length < 2) return [NaN, NaN];
  const rng = createSeededRng(hashStringToSeed(`pacing:${label}:${xs.length}`));
  const stats: number[] = [];
  for (let d = 0; d < draws; d++) {
    const sample = xs.map(() => xs[Math.floor(rng() * xs.length)]!);
    stats.push(stat(sample));
  }
  return [quantile(stats, 0.025), quantile(stats, 0.975)];
}

interface Estimate { value: number; lo: number; hi: number; n: number }
const proportion = (k: number, n: number): Estimate => { const [lo, hi] = wilson(k, n); return { value: n ? k / n : NaN, lo, hi, n }; };
const med = (xs: number[], label: string): Estimate => { const [lo, hi] = bootstrap(xs, median, label); return { value: median(xs), lo, hi, n: xs.length }; };
const avg = (xs: number[], label: string): Estimate => { const [lo, hi] = bootstrap(xs, mean, label); return { value: mean(xs), lo, hi, n: xs.length }; };
const pctl = (xs: number[], q: number, label: string): Estimate => { const [lo, hi] = bootstrap(xs, (s) => quantile(s, q), label); return { value: quantile(xs, q), lo, hi, n: xs.length }; };

// ── one game ─────────────────────────────────────────────────────────────────

interface GameMeasures {
  rounds: number;
  ending: string;
  capped: boolean;
  winnerSeat: number | null;
  candidateWon: boolean;
  candidateRounds: number;
  candidateOut: boolean;
  minutes: number[];
  /** Final era by seat; the candidate's; the winner's; the highest. */
  finalEras: number[];
  candidateEra: number;
  winnerEra: number;
  topEra: number;
  lastEra: number;
  /** Round the first seat, the median seat and the last living seat reached each era (0 = never). */
  firstReached: number[];
  halfReached: number[];
  candidateReached: number[];
  /** Round the first seat reached the last era, and the round every living seat had (0 = never). */
  firstAtLast: number;
  allAtLast: number;
  decidedRound: number;
  decidedSeatWon: boolean;
  leadLockRound: number;
  leadChanges: number;
  quiet: boolean[];
  quietShare: number;
  lullShare: number;
  longestLull: number;
  deadRounds: number;
  /** Whether the first seat to advance an era won (null if nobody advanced), and the territory leader as rounds 10 and 20 ended. */
  firstAdvancerWon: boolean | null;
  leaderAt10Won: boolean | null;
  leaderAt20Won: boolean | null;
  candidateAtLast: boolean;
  /** Seat-rounds played, and those played holding under SIDELINED_SHARE of the board. */
  seatRounds: number;
  sidelinedRounds: number;
  afterErasRounds: number;
  capturesByRound: number[];
  movedByRound: number[];
  unitsByRound: number[];
  stageRounds: [number, number, number];
  stageQuiet: [number, number, number];
  stageCaptures: [number, number, number];
  surrenderOfferRound: number;
  exits: number;
  blockers: Record<string, number>[];
}

function leaderOf(held: number[]): number | null {
  let best = -1;
  let seat: number | null = null;
  held.forEach((h, i) => { if (h > best) { best = h; seat = i; } else if (h === best) seat = null; });
  return seat;
}

function measure(g: GameTrace): GameMeasures {
  // An accepted surrender ends the game as that turn opens: the rounds before it stand.
  const surrendered = ACCEPT_SURRENDER && g.surrenderOfferRound > 1 && g.surrenderOfferRound - 1 <= Math.min(g.held.length, CAP ?? Infinity);
  const played = surrendered ? g.surrenderOfferRound - 1 : Math.min(g.held.length, CAP ?? Infinity);
  const cut = !surrendered && CAP !== undefined && g.held.length > CAP;
  const rows = <T>(xs: T[]): T[] => xs.slice(0, played);
  const held = rows(g.held);
  const units = rows(g.units);
  const era = rows(g.era);
  const board = rows(g.board);
  const seats = g.seats;
  // Traces from before `lastEra` was recorded are all of the classic spine, which tops out at 5.
  const lastEra = g.lastEra ?? Math.max(5, ...g.era.flat());
  const advances = g.advances.filter(([r]) => r <= played);
  const exits = g.exits.filter(([r]) => r <= played);
  const exitRound = new Map(exits.map(([r, s]) => [s, r]));

  // Who won: the game's own winner, or under a hypothetical cap the leader then
  // (most territories, then most units), as the real cap decides it.
  let winnerSeat = g.winnerSeat;
  let ending = g.condition ?? 'none';
  if (cut) {
    const last = played - 1;
    winnerSeat = [...Array(seats).keys()].sort((a, b) => held[last]![b]! - held[last]![a]! || units[last]![b]! - units[last]![a]!)[0]!;
    ending = 'turn_limit';
  }
  if (surrendered) {
    winnerSeat = g.candidateSeat;
    ending = 'surrender';
  }
  const capped = ending === 'turn_limit';

  // Leaders and lead changes.
  let lastLeader: number | null = null;
  let leadChanges = 0;
  let leadLockRound = 1;
  const leadChangeAt: boolean[] = [];
  for (let r = 0; r < played; r++) {
    const leader = leaderOf(held[r]!);
    const changed = leader !== null && lastLeader !== null && leader !== lastLeader;
    leadChangeAt.push(changed);
    if (changed) leadChanges += 1;
    if (leader !== null) lastLeader = leader;
    if (leader !== winnerSeat) leadLockRound = r + 2;
  }
  leadLockRound = Math.min(leadLockRound, played);

  // Decided: one seat with half the board and twice the next seat's armies.
  let decidedRound = 0;
  let decidedSeat = -1;
  for (let r = 0; r < played && !decidedRound; r++) {
    for (let s = 0; s < seats; s++) {
      if (held[r]![s]! < DECIDED_BOARD_SHARE * board[r]!) continue;
      const rival = Math.max(...units[r]!.filter((_, i) => i !== s));
      if (units[r]![s]! >= DECIDED_ARMY_RATIO * rival) { decidedRound = r + 1; decidedSeat = s; break; }
    }
  }

  // Era timeline.
  const firstReached = Array.from({ length: lastEra + 1 }, () => 0);
  const halfReached = Array.from({ length: lastEra + 1 }, () => 0);
  const candidateReached = Array.from({ length: lastEra + 1 }, () => 0);
  const reachedBy: number[][] = Array.from({ length: lastEra + 1 }, () => []);
  for (const [r, s, k] of advances) {
    if (!firstReached[k]) firstReached[k] = r;
    reachedBy[k]!.push(r);
    if (s === g.candidateSeat) candidateReached[k] = r;
  }
  for (let k = 1; k <= lastEra; k++) {
    const need = Math.ceil(seats / 2);
    if (reachedBy[k]!.length >= need) halfReached[k] = [...reachedBy[k]!].sort((a, b) => a - b)[need - 1]!;
  }
  const firstAtLast = firstReached[lastEra] ?? 0;
  let allAtLast = 0;
  for (let r = 0; r < played && !allAtLast; r++) {
    const living = [...Array(seats).keys()].filter((s) => !(exitRound.has(s) && exitRound.get(s)! <= r + 1));
    if (living.length > 0 && living.every((s) => era[r]![s]! >= lastEra)) allAtLast = r + 1;
  }

  // Round by round: what moved.
  const advanceAt = new Set(advances.map(([r]) => r));
  const exitAt = new Set(exits.map(([r]) => r));
  const quiet: boolean[] = [];
  const capturesByRound: number[] = [];
  const movedByRound: number[] = [];
  for (let r = 0; r < played; r++) {
    const captures = g.rivalCaptures[r]!.reduce((a, b) => a + b, 0) + g.neutralCaptures[r]!.reduce((a, b) => a + b, 0);
    capturesByRound.push(captures);
    const before = r === 0 ? held[0]! : held[r - 1]!;
    movedByRound.push(held[r]!.reduce((sum, h, i) => sum + Math.abs(h - before[i]!), 0));
    quiet.push(!advanceAt.has(r + 1) && !exitAt.has(r + 1) && !leadChangeAt[r] && captures <= QUIET_TILES);
  }
  let longestLull = 0;
  let inLull = 0;
  for (let r = 0, run = 0; r <= played; r++) {
    if (r < played && quiet[r]) { run += 1; continue; }
    if (run >= LULL_ROUNDS) inLull += run;
    longestLull = Math.max(longestLull, run);
    run = 0;
  }

  // Stages: climbing (to the first seat in the last era), arriving (to the last
  // living seat in it), and after the ages.
  const stageEnd = [firstAtLast || played, allAtLast || played, played];
  const stageRounds: [number, number, number] = [stageEnd[0]!, Math.max(0, stageEnd[1]! - stageEnd[0]!), Math.max(0, played - stageEnd[1]!)];
  const stageQuiet: [number, number, number] = [0, 0, 0];
  const stageCaptures: [number, number, number] = [0, 0, 0];
  for (let r = 0; r < played; r++) {
    const stage = r < stageEnd[0]! ? 0 : r < stageEnd[1]! ? 1 : 2;
    if (quiet[r]) stageQuiet[stage] += 1;
    stageCaptures[stage] += capturesByRound[r]!;
  }

  const afterErasRounds = allAtLast ? played - allAtLast : 0;
  const deadRounds = decidedRound ? played - decidedRound : 0;
  const leaderWonAt = (round: number): boolean | null => {
    if (played < round) return null;
    const leader = leaderOf(held[round - 1]!);
    return leader === null ? null : leader === winnerSeat;
  };

  // The stand-in's clock: its own turns, plus the other seats' paced steps, while it is in.
  const out = exitRound.get(g.candidateSeat);
  const candidateRounds = Math.min(played, out ?? played);
  let botSeconds = 0;
  for (let r = 0; r < candidateRounds; r++) {
    g.steps[r]!.forEach((n, s) => { if (s !== g.candidateSeat) botSeconds += n * STEP_SECONDS; });
  }

  let seatRounds = 0;
  let sidelinedRounds = 0;
  for (let r = 0; r < played; r++) {
    for (let s2 = 0; s2 < seats; s2++) {
      if (held[r]![s2]! <= 0) continue;
      seatRounds += 1;
      if (held[r]![s2]! < SIDELINED_SHARE * board[r]!) sidelinedRounds += 1;
    }
  }

  const finalEras = era[played - 1] ?? Array.from({ length: seats }, () => 0);
  return {
    rounds: played,
    ending,
    capped,
    winnerSeat,
    candidateWon: winnerSeat === g.candidateSeat,
    candidateRounds,
    candidateOut: out !== undefined && winnerSeat !== g.candidateSeat,
    minutes: TURN_SECONDS.map((t) => (candidateRounds * t + botSeconds) / 60),
    finalEras,
    candidateEra: finalEras[g.candidateSeat]!,
    winnerEra: winnerSeat === null ? 0 : finalEras[winnerSeat]!,
    topEra: Math.max(...finalEras),
    lastEra,
    firstReached,
    halfReached,
    candidateReached,
    firstAtLast,
    allAtLast,
    decidedRound,
    decidedSeatWon: decidedRound > 0 && decidedSeat === winnerSeat,
    leadLockRound,
    leadChanges,
    quiet,
    quietShare: quiet.filter(Boolean).length / played,
    lullShare: inLull / played,
    longestLull,
    deadRounds,
    firstAdvancerWon: advances.length ? advances[0]![1] === winnerSeat : null,
    leaderAt10Won: leaderWonAt(10),
    leaderAt20Won: leaderWonAt(20),
    candidateAtLast: finalEras[g.candidateSeat]! >= lastEra,
    seatRounds,
    sidelinedRounds,
    afterErasRounds,
    capturesByRound,
    movedByRound,
    unitsByRound: units.map((u) => u.reduce((a, b) => a + b, 0)),
    stageRounds,
    stageQuiet,
    stageCaptures,
    surrenderOfferRound: g.surrenderOfferRound && g.surrenderOfferRound <= played + (surrendered ? 1 : 0) ? g.surrenderOfferRound : 0,
    exits: exits.length,
    blockers: g.blockers.reduce<Record<string, number>[]>((acc, bySeat) => {
      bySeat.forEach((tally, k) => {
        const into = (acc[k] ??= {});
        for (const [key, n] of Object.entries(tally ?? {})) into[key] = (into[key] ?? 0) + n;
      });
      return acc;
    }, []),
  };
}

// ── one configuration ────────────────────────────────────────────────────────

interface Summary {
  label: string;
  games: number;
  seats: number;
  rounds: { median: Estimate; mean: Estimate; p20: Estimate; p80: Estimate };
  endings: Record<string, Estimate>;
  capped: Estimate;
  minutes: Record<string, { median: Estimate; p80: Estimate; over90: Estimate; over120: Estimate }>;
  roundsHistogram: { rounds: string; share: number }[];
  candidate: { wins: Estimate; out: Estimate; era: Estimate; rounds: Estimate; atLast: Estimate };
  eras: {
    /** Share of all seats finishing in each era, and of games whose top seat finished there. */
    seatFinal: number[];
    seatsAtLast: Estimate;
    seatsAtLeast: Estimate[];
    gamesTopAtLast: Estimate;
    gamesAllAtLast: Estimate;
    winnerAtLast: Estimate;
    /** Games that ended with no seat past the third era (index 2): over before the WW2 era. */
    endedEarly: Estimate;
    medianSeatEra: Estimate;
    firstReached: { share: Estimate; round: Estimate }[];
    halfReached: { share: Estimate; round: Estimate }[];
  };
  decided: { share: Estimate; round: Estimate; precision: Estimate; deadRounds: Estimate; deadShare: Estimate };
  leadLock: { round: Estimate; changes: Estimate };
  quiet: { share: Estimate; lullShare: Estimate; longestLull: Estimate };
  afterEras: { rounds: Estimate; share: Estimate };
  snowball: { firstAdvancerWins: Estimate; leaderAt10Wins: Estimate; leaderAt20Wins: Estimate };
  sidelined: { share: Estimate; knockedOut: Estimate };
  stages: { rounds: Estimate[]; quietShare: number[]; capturesPerRound: number[] };
  byDecile: { rounds: string; games: number; captures: number; moved: number; quiet: number; units: number }[];
  surrender: { offered: Estimate; round: Estimate; roundsSaved: Estimate };
  blockers: { era: number; turns: number; shares: Record<string, number> }[];
}

function summarize(label: string, traces: GameTrace[]): Summary {
  const ms = traces.map(measure);
  const n = ms.length;
  const seats = traces[0]!.seats;
  const lastEra = Math.max(...ms.map((m) => m.lastEra));
  const tag = (k: string): string => `${label}:${k}`;
  const share = (pick: (m: GameMeasures) => boolean): Estimate => proportion(ms.filter(pick).length, n);

  const endings: Record<string, Estimate> = {};
  for (const e of new Set(ms.map((m) => m.ending))) endings[e] = share((m) => m.ending === e);

  const allSeatEras = ms.flatMap((m) => m.finalEras);
  const seatFinal = Array.from({ length: lastEra + 1 }, (_, k) => allSeatEras.filter((e) => e === k).length / allSeatEras.length);

  const reached = (pick: (m: GameMeasures) => number[]): { share: Estimate; round: Estimate }[] =>
    Array.from({ length: lastEra + 1 }, (_, k) => {
      const rounds = ms.map((m) => pick(m)[k] ?? 0).filter((r) => r > 0);
      return { share: proportion(rounds.length, n), round: med(rounds, tag(`reach${k}`)) };
    });

  const decided = ms.filter((m) => m.decidedRound > 0);
  const offered = ms.filter((m) => m.surrenderOfferRound > 0);

  // Ten-round bands: what a round in each band looks like, over the games still running.
  const longest = Math.max(...ms.map((m) => m.rounds));
  const byDecile: Summary['byDecile'] = [];
  for (let from = 0; from < longest; from += 10) {
    const live = ms.filter((m) => m.rounds > from);
    if (live.length < Math.max(5, n * 0.05)) break;
    const slice = (xs: number[] | boolean[]): number[] => (xs as (number | boolean)[]).slice(from, from + 10).map(Number);
    byDecile.push({
      rounds: `${from + 1}-${from + 10}`,
      games: live.length,
      captures: mean(live.flatMap((m) => slice(m.capturesByRound))),
      moved: mean(live.flatMap((m) => slice(m.movedByRound))),
      quiet: mean(live.flatMap((m) => slice(m.quiet))),
      units: mean(live.flatMap((m) => slice(m.unitsByRound))),
    });
  }

  const stageTotals = [0, 1, 2].map((s) => ({
    rounds: ms.reduce((a, m) => a + m.stageRounds[s]!, 0),
    quiet: ms.reduce((a, m) => a + m.stageQuiet[s]!, 0),
    captures: ms.reduce((a, m) => a + m.stageCaptures[s]!, 0),
  }));

  const blockerTotals: Record<string, number>[] = [];
  for (const m of ms) m.blockers.forEach((tally, k) => {
    const into = (blockerTotals[k] ??= {});
    for (const [key, v] of Object.entries(tally)) into[key] = (into[key] ?? 0) + v;
  });

  return {
    label,
    games: n,
    seats,
    rounds: {
      median: med(ms.map((m) => m.rounds), tag('rounds')),
      mean: avg(ms.map((m) => m.rounds), tag('roundsMean')),
      p20: pctl(ms.map((m) => m.rounds), 0.2, tag('rounds20')),
      p80: pctl(ms.map((m) => m.rounds), 0.8, tag('rounds80')),
    },
    endings,
    capped: share((m) => m.capped),
    minutes: Object.fromEntries(TURN_SECONDS.map((t, i) => [String(t), {
      median: med(ms.map((m) => m.minutes[i]!), tag(`min${t}`)),
      p80: pctl(ms.map((m) => m.minutes[i]!), 0.8, tag(`min80${t}`)),
      over90: share((m) => m.minutes[i]! > 90),
      over120: share((m) => m.minutes[i]! > 120),
    }])),
    candidate: {
      wins: share((m) => m.candidateWon),
      out: share((m) => m.candidateOut),
      era: avg(ms.map((m) => m.candidateEra), tag('candEra')),
      rounds: med(ms.map((m) => m.candidateRounds), tag('candRounds')),
      atLast: share((m) => m.candidateAtLast),
    },
    roundsHistogram: Array.from({ length: Math.ceil(longest / 10) }, (_, i) => ({
      rounds: `${i * 10 + 1}-${i * 10 + 10}`,
      share: ms.filter((m) => Math.floor((m.rounds - 1) / 10) === i).length / n,
    })),
    eras: {
      seatFinal,
      seatsAtLast: proportion(allSeatEras.filter((e) => e >= lastEra).length, allSeatEras.length),
      seatsAtLeast: Array.from({ length: lastEra + 1 }, (_, k) => proportion(allSeatEras.filter((e) => e >= k).length, allSeatEras.length)),
      gamesTopAtLast: share((m) => m.topEra >= lastEra),
      gamesAllAtLast: share((m) => m.allAtLast > 0),
      winnerAtLast: share((m) => m.winnerEra >= lastEra),
      endedEarly: share((m) => m.topEra < Math.min(3, lastEra)),
      medianSeatEra: avg(ms.map((m) => median(m.finalEras)), tag('medSeatEra')),
      firstReached: reached((m) => m.firstReached),
      halfReached: reached((m) => m.halfReached),
    },
    decided: {
      share: proportion(decided.length, n),
      round: med(decided.map((m) => m.decidedRound), tag('decided')),
      precision: proportion(decided.filter((m) => m.decidedSeatWon).length, decided.length),
      deadRounds: med(ms.map((m) => m.deadRounds), tag('dead')),
      deadShare: avg(ms.map((m) => m.deadRounds / m.rounds), tag('deadShare')),
    },
    leadLock: {
      round: med(ms.map((m) => m.leadLockRound), tag('lock')),
      changes: avg(ms.map((m) => m.leadChanges), tag('changes')),
    },
    quiet: {
      share: avg(ms.map((m) => m.quietShare), tag('quiet')),
      lullShare: avg(ms.map((m) => m.lullShare), tag('lull')),
      longestLull: med(ms.map((m) => m.longestLull), tag('longestLull')),
    },
    afterEras: {
      rounds: med(ms.map((m) => m.afterErasRounds), tag('afterEras')),
      share: avg(ms.map((m) => m.afterErasRounds / m.rounds), tag('afterErasShare')),
    },
    sidelined: {
      share: avg(ms.map((m) => m.sidelinedRounds / Math.max(1, m.seatRounds)), tag('sidelined')),
      knockedOut: avg(ms.map((m) => m.exits / seats), tag('knockedOut')),
    },
    snowball: {
      firstAdvancerWins: proportion(ms.filter((m) => m.firstAdvancerWon === true).length, ms.filter((m) => m.firstAdvancerWon !== null).length),
      leaderAt10Wins: proportion(ms.filter((m) => m.leaderAt10Won === true).length, ms.filter((m) => m.leaderAt10Won !== null).length),
      leaderAt20Wins: proportion(ms.filter((m) => m.leaderAt20Won === true).length, ms.filter((m) => m.leaderAt20Won !== null).length),
    },
    stages: {
      rounds: [0, 1, 2].map((s) => avg(ms.map((m) => m.stageRounds[s]!), tag(`stage${s}`))),
      quietShare: stageTotals.map((t) => (t.rounds ? t.quiet / t.rounds : NaN)),
      capturesPerRound: stageTotals.map((t) => (t.rounds ? t.captures / t.rounds : NaN)),
    },
    byDecile,
    surrender: {
      offered: proportion(offered.length, n),
      round: med(offered.map((m) => m.surrenderOfferRound), tag('offer')),
      roundsSaved: med(offered.map((m) => m.rounds - m.surrenderOfferRound), tag('offerSaved')),
    },
    blockers: blockerTotals.map((tally, k) => {
      const turns = Object.values(tally).reduce((a, b) => a + b, 0);
      // Each gate's share of the turns it was unmet on (a turn can be short of several).
      const shares: Record<string, number> = {};
      for (const gate of ['gold', 'tech', 'buildings', 'stability', 'lead', 'ready']) {
        const hit = Object.entries(tally).filter(([key]) => key.split('+').includes(gate)).reduce((a, [, v]) => a + v, 0);
        shares[gate] = turns ? hit / turns : 0;
      }
      return { era: k, turns, shares };
    }),
  };
}

// ── printing ─────────────────────────────────────────────────────────────────

const f0 = (x: number): string => (Number.isFinite(x) ? x.toFixed(0) : 'n/a');
const f1 = (x: number): string => (Number.isFinite(x) ? x.toFixed(1) : 'n/a');
const p0 = (x: number): string => (Number.isFinite(x) ? `${(100 * x).toFixed(0)}%` : 'n/a');
const est = (e: Estimate, fmt: (x: number) => string = f0): string => `${fmt(e.value)} [${fmt(e.lo)}, ${fmt(e.hi)}]`;
const estP = (e: Estimate): string => est(e, p0);

function printDetail(s: Summary): void {
  const last = s.eras.firstReached.length - 1;
  console.log(`\n══ ${s.label}: ${s.games} games, ${s.seats} seats${CAP ? `, read as capped at round ${CAP}` : ''}${ACCEPT_SURRENDER ? ', read as ending when the stand-in is first offered the bots\' surrender' : ''} ══`);
  console.log('Every figure is "value [95% interval]": Wilson for shares, a 1,000-draw bootstrap for medians and means.');
  console.log(`\nLength`);
  console.log(`  rounds                 median ${est(s.rounds.median)}, mean ${est(s.rounds.mean, f1)}, 20th pct ${f0(s.rounds.p20.value)}, 80th pct ${f0(s.rounds.p80.value)}`);
  console.log(`  ended by               ${Object.entries(s.endings).sort((a, b) => b[1].value - a[1].value).map(([k, e]) => `${k} ${estP(e)}`).join(', ')}`);
  for (const t of TURN_SECONDS) {
    const m = s.minutes[String(t)]!;
    console.log(`  minutes at ${t} s a turn  median ${est(m.median)}, 80th pct ${est(m.p80)}, over 90 min ${estP(m.over90)}, over 120 min ${estP(m.over120)}`);
  }
  console.log(`  rounds, by tens        ${s.roundsHistogram.filter((h) => h.share > 0).map((h) => `${h.rounds}: ${p0(h.share)}`).join(', ')}`);
  console.log(`  stand-in seat          wins ${estP(s.candidate.wins)}, knocked out ${estP(s.candidate.out)}, plays ${est(s.candidate.rounds)} rounds, ends in era ${est(s.candidate.era, f1)}, reaches the last era ${estP(s.candidate.atLast)}`);
  console.log(`\nEras (index 0 Ancient … ${last} the last)`);
  console.log(`  seats finishing in     ${s.eras.seatFinal.map((x, k) => `era ${k}: ${p0(x)}`).join(', ')}`);
  console.log(`  seats in the last era  ${estP(s.eras.seatsAtLast)}; games where someone is ${estP(s.eras.gamesTopAtLast)}; games where every living seat is ${estP(s.eras.gamesAllAtLast)}; winners ${estP(s.eras.winnerAtLast)}`);
  console.log(`  over before the WW2 era ${estP(s.eras.endedEarly)} of games (no seat past era 2 when the game ended)`);
  console.log(`  first seat reaches     ${s.eras.firstReached.slice(1).map((e, i) => `era ${i + 1}: ${p0(e.share.value)} of games, round ${est(e.round)}`).join('; ')}`);
  console.log(`  half the table reaches ${s.eras.halfReached.slice(1).map((e, i) => `era ${i + 1}: ${p0(e.share.value)}, round ${est(e.round)}`).join('; ')}`);
  console.log(`\nStages                    climbing | arriving | after the ages`);
  console.log(`  mean rounds            ${s.stages.rounds.map((e) => est(e, f1)).join(' | ')}`);
  console.log(`  quiet rounds           ${s.stages.quietShare.map(p0).join(' | ')}`);
  console.log(`  captures a round       ${s.stages.capturesPerRound.map(f1).join(' | ')}`);
  console.log(`\nBy ten rounds            games running, captures a round, territories changing standing a round, quiet rounds, armies on the board`);
  for (const d of s.byDecile) console.log(`  ${d.rounds.padEnd(9)} ${String(d.games).padStart(5)}  ${f1(d.captures).padStart(5)}  ${f1(d.moved).padStart(5)}  ${p0(d.quiet).padStart(5)}  ${f0(d.units).padStart(6)}`);
  console.log(`\nDecided (one seat with ${p0(DECIDED_BOARD_SHARE)} of the board and ${DECIDED_ARMY_RATIO}× the next seat's armies)`);
  console.log(`  games that get there   ${estP(s.decided.share)}, at round ${est(s.decided.round)}; that seat wins ${estP(s.decided.precision)}`);
  console.log(`  rounds played after    median ${est(s.decided.deadRounds)}; ${estP(s.decided.deadShare)} of a game on average`);
  console.log(`  lead                   changes hands ${est(s.leadLock.changes, f1)} times a game; the winner leads for good from round ${est(s.leadLock.round)}`);
  console.log(`\nQuiet`);
  console.log(`  quiet rounds           ${estP(s.quiet.share)} of a game; in lulls of ${LULL_ROUNDS}+ rounds ${estP(s.quiet.lullShare)}; longest lull ${est(s.quiet.longestLull)} rounds`);
  console.log(`  after the ages         ${est(s.afterEras.rounds)} rounds (${estP(s.afterEras.share)} of a game) played after every living seat is in the last era`);
  console.log(`\nTrailing seats`);
  console.log(`  sidelined              ${estP(s.sidelined.share)} of seat-rounds are played holding under ${p0(SIDELINED_SHARE)} of the board; ${estP(s.sidelined.knockedOut)} of seats are knocked out before the end`);
  console.log(`\nSnowball (fair share ${p0(1 / s.seats)})`);
  console.log(`  goes on to win         first seat to advance an era ${estP(s.snowball.firstAdvancerWins)}; territory leader after round 10 ${estP(s.snowball.leaderAt10Wins)}, after round 20 ${estP(s.snowball.leaderAt20Wins)}`);
  console.log(`\nSurrender offer to the stand-in (victory/surrender.ts)`);
  console.log(`  offered in             ${estP(s.surrender.offered)} of games, at round ${est(s.surrender.round)}, with ${est(s.surrender.roundsSaved)} rounds still to play`);
  console.log(`\nWhat held a seat in each era (share of its turns short of each gate; a turn can be short of several)`);
  for (const b of s.blockers) {
    if (!b.turns) continue;
    console.log(`  leaving era ${b.era}          ${(b.turns / s.games / s.seats).toFixed(1)} turns a seat: ${Object.entries(b.shares).map(([k, v]) => `${k} ${p0(v)}`).join(', ')}`);
  }
}

function printTable(rows: Summary[]): void {
  const cols: [string, (s: Summary) => string][] = [
    ['configuration', (s) => s.label],
    ['games', (s) => String(s.games)],
    ['rounds: median (20th-80th)', (s) => `${est(s.rounds.median)} (${f0(s.rounds.p20.value)}-${f0(s.rounds.p80.value)})`],
    ['min at 60 s: median, 80th', (s) => `${f0(s.minutes['60']!.median.value)}, ${f0(s.minutes['60']!.p80.value)}`],
    ['ends on the cap', (s) => estP(s.capped)],
    ['over before WW2', (s) => estP(s.eras.endedEarly)],
    ['seats in last era', (s) => estP(s.eras.seatsAtLast)],
    ['winner in last era', (s) => estP(s.eras.winnerAtLast)],
    ['rounds after decided', (s) => `${est(s.decided.deadRounds)}; ${p0(s.decided.deadShare.value)}`],
    ['rounds after the ages', (s) => `${est(s.afterEras.rounds)}; ${p0(s.afterEras.share.value)}`],
    ['quiet rounds', (s) => estP(s.quiet.share)],
    ['sidelined seat-rounds', (s) => estP(s.sidelined.share)],
    ['stand-in wins', (s) => estP(s.candidate.wins)],
  ];
  console.log(`\n| ${cols.map(([h]) => h).join(' | ')} |`);
  console.log(`|${cols.map(() => '---').join('|')}|`);
  for (const s of rows) console.log(`| ${cols.map(([, pick]) => pick(s)).join(' | ')} |`);
}

const inputs = process.argv.slice(2).map((arg) => {
  const at = arg.indexOf('=');
  if (at < 0) throw new Error(`"${arg}": expected label=path`);
  return { label: arg.slice(0, at), path: arg.slice(at + 1) };
});
if (inputs.length === 0) throw new Error('usage: fullGamePacing.ts label=trace.jsonl [label=trace.jsonl ...]');

const summaries = inputs.map(({ label, path }) => {
  const traces = readFileSync(path, 'utf-8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as GameTrace);
  return summarize(label, traces);
});
if (process.env.PACING_DETAIL === '1' || summaries.length === 1) summaries.forEach(printDetail);
if (summaries.length > 1) printTable(summaries);
if (process.env.PACING_JSON) writeFileSync(process.env.PACING_JSON, JSON.stringify(summaries, null, 1));
