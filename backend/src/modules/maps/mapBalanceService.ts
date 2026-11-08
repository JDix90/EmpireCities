/**
 * Balance reports for the map editor: one simulation at a time per server,
 * the same request shared while it runs, and the result kept for an hour
 * against the map's content, so re-opening the editor shows the report
 * without playing the games again.
 */
import { createHash } from 'crypto';
import { getRedis } from '../../db/redis';
import type { GameMap } from '../../types';
import { BALANCE_DEFAULTS, type BalanceSimOptions, type BalanceSimReport } from './mapBalanceSim';
import { simulateBalanceOffThread } from './mapBalanceThread';

const CACHE_TTL_SECONDS = 60 * 60;

/** What the request may choose; the rest is fixed so a report means the same thing every time. */
export interface BalanceRequest {
  games?: number;
  seats?: number;
  difficulty?: BalanceSimOptions['difficulty'];
  maxRounds?: number;
}

/** The most games one report plays; the route's schema and the game count share it. */
export const MAX_BALANCE_GAMES = BALANCE_DEFAULTS.maxGames;

/**
 * Games as whole rotations of the first move. The starting seat advances
 * every game, so a count that is not a multiple of the seats hands some
 * seats an extra first move and the wins-by-seat bars stop meaning the
 * deal. A requested count rounds to the nearest whole rotation, at least
 * one and at most what the cap allows; the default is about
 * BALANCE_DEFAULTS.games games and never fewer than
 * BALANCE_DEFAULTS.rotations first moves per seat.
 */
export function balanceGameCount(seats: number, requested?: number): number {
  const maxRotations = Math.max(1, Math.floor(MAX_BALANCE_GAMES / seats));
  const rotations = typeof requested === 'number' && Number.isFinite(requested)
    ? Math.round(requested / seats)
    : Math.max(BALANCE_DEFAULTS.rotations, Math.round(BALANCE_DEFAULTS.games / seats));
  return seats * Math.min(maxRotations, Math.max(1, rotations));
}

export function resolveBalanceOptions(mapId: string, request: BalanceRequest): BalanceSimOptions {
  const clamp = (v: number | undefined, lo: number, hi: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
  const difficulty = request.difficulty && ['easy', 'medium', 'hard'].includes(request.difficulty)
    ? request.difficulty
    : BALANCE_DEFAULTS.difficulty;
  const seats = clamp(request.seats, 2, 6, BALANCE_DEFAULTS.seats);
  return {
    games: balanceGameCount(seats, request.games),
    seats,
    maxRounds: clamp(request.maxRounds, 10, 80, BALANCE_DEFAULTS.maxRounds),
    difficulty,
    era: BALANCE_DEFAULTS.era,
    seed: `balance:${mapId}`,
    deadlineMs: BALANCE_DEFAULTS.deadlineMs,
  };
}

/** The content that decides a report: the board and the options, not the name. */
export function balanceCacheKey(map: GameMap, options: BalanceSimOptions): string {
  const hash = createHash('sha1')
    .update(JSON.stringify({
      territories: map.territories,
      connections: map.connections,
      regions: map.regions,
      games: options.games,
      seats: options.seats,
      maxRounds: options.maxRounds,
      difficulty: options.difficulty,
      era: options.era,
    }))
    .digest('hex');
  return `map:balance:${map.map_id}:${hash}`;
}

const inFlight = new Map<string, Promise<BalanceSimReport>>();

export class BalanceBusyError extends Error {
  constructor() {
    super('A balance simulation is already running; try again in a moment');
    this.name = 'BalanceBusyError';
  }
}

export type BalanceResult = { report: BalanceSimReport; cached: boolean };

/**
 * The report for `map` under `options`: from the cache when the board has not
 * changed, otherwise played once and shared with every caller who asks while
 * it runs. A second different simulation while one runs is refused — the
 * worker is one thread, and a queue would let one author hold it.
 */
export async function getBalanceReport(
  map: GameMap,
  options: BalanceSimOptions,
  simulate: (map: GameMap, options: BalanceSimOptions) => Promise<BalanceSimReport> = simulateBalanceOffThread,
): Promise<BalanceResult> {
  const key = balanceCacheKey(map, options);
  try {
    const cached = await getRedis().get(key);
    if (cached) return { report: JSON.parse(cached) as BalanceSimReport, cached: true };
  } catch {
    /* no cache: play it */
  }

  const running = inFlight.get(key);
  if (running) return { report: await running, cached: false };
  if (inFlight.size > 0) throw new BalanceBusyError();

  const run = simulate(map, options).then(async (report) => {
    try {
      await getRedis().setex(key, CACHE_TTL_SECONDS, JSON.stringify(report));
    } catch {
      /* non-fatal */
    }
    return report;
  });
  inFlight.set(key, run);
  try {
    return { report: await run, cached: false };
  } finally {
    inFlight.delete(key);
  }
}

/** For tests: forget any run in progress. */
export function resetBalanceRuns(): void {
  inFlight.clear();
}
