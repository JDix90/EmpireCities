/**
 * Admin → Galactic Age: finished games and their analytics
 * (GET /api/admin/metrics/galaxy), read from the records finalizeGame writes
 * (game-engine/state/galaxyResults.ts, migration 048).
 *
 * Win rates are read the way the balance sim reads them
 * (backend/scripts/GALAXY-BALANCE.md): per seat, against the seat's fair share
 * of its game, 1 / sides. A side wins together, so in a free-for-all every seat
 * is a side of its own and the share is 1 / seats. Each rate carries a Wilson 95%
 * interval, since a handful of playtests reads nothing like 1,260 sim games.
 */
import { query, queryOne } from '../../db/postgres';
import type { GalaxyGameMode, GalaxySeatRole } from '../../game-engine/state/galaxyResults';
import type { GalaxyHouseRelations } from '../../types';
import { GALACTIC_AGE_GAME_SQL } from '../games/lobbyCapacity';

export interface GalaxyReportSeat {
  seat: number;
  user_id: string | null;
  /** The human's current username; null for an AI seat or a deleted account. */
  username: string | null;
  is_ai: boolean;
  ai_difficulty: string | null;
  faction_id: string | null;
  world_id: string | null;
  house: string | null;
  role: GalaxySeatRole;
  side: string | null;
  reinforce_bonus: number | null;
  won: boolean;
  eliminated: boolean;
  resigned: boolean;
  territories: number;
}

export interface GalaxyReportGame {
  game_id: string;
  finished_at: string;
  started_at: string | null;
  ended_at: string | null;
  seats: number;
  mode: GalaxyGameMode;
  relations: GalaxyHouseRelations | null;
  board: string | null;
  victory: string | null;
  turns: number;
  first_seat: number | null;
  humans: number;
  seat_results: GalaxyReportSeat[];
}

/** A win rate against the fair share, with its Wilson 95% interval. */
export interface GalaxyRate {
  key: string;
  /** Seats counted (a seat in each game it played). */
  seats: number;
  wins: number;
  /** Wins a fair share would have given these seats: Σ 1 / sides. */
  expected: number;
  rate: number;
  expected_rate: number;
  low: number;
  high: number;
}

export interface GalaxyAnalytics {
  games: number;
  /** Games won on the board: not the turn limit, a resignation, or every human out. */
  decisive: number;
  avg_turns: number | null;
  median_minutes: number | null;
  modes: Array<{
    mode: GalaxyGameMode;
    seats: number;
    relations: GalaxyHouseRelations | null;
    games: number;
    avg_turns: number;
  }>;
  endings: Array<{ victory: string; games: number }>;
  factions: GalaxyRate[];
  roles: GalaxyRate[];
  /** Schism houses by role: "Western Mandate" with a rival, alone, or Allied. */
  houses: Array<GalaxyRate & { house: string; role: GalaxySeatRole }>;
  /** "human", and each AI difficulty as "ai:<difficulty>". */
  players: GalaxyRate[];
  /** The seat that moved first, against its share. */
  first_seat: GalaxyRate | null;
  /** Games finished per UTC day. */
  by_day: Array<{ day: string; games: number }>;
}

export interface GalaxyReportFilters {
  /** Trailing window in days; null for all time. */
  days: number | null;
  seats: number | null;
  mode: GalaxyGameMode | null;
  relations: GalaxyHouseRelations | null;
}

export interface GalaxyReport {
  filters: GalaxyReportFilters;
  /** Recorded games matching the filters. */
  total_games: number;
  /** More games matched than the analytics read (GALAXY_ANALYTICS_CAP, newest first). */
  truncated: boolean;
  /** Finished Galactic Age games in the window with no record: they ended before the report existed. */
  unrecorded_games: number;
  analytics: GalaxyAnalytics;
  /** The newest games, up to GALAXY_LIST_LIMIT. */
  games: GalaxyReportGame[];
}

export const GALAXY_ANALYTICS_CAP = 5000;
export const GALAXY_LIST_LIMIT = 100;

/** Endings that are not a win on the board. */
const NOT_DECISIVE = new Set(['turn_limit', 'resignation', 'humans_eliminated', 'abandoned']);

const FACTION_ORDER = ['stellar_mandate', 'helion_navigators', 'forge_syndicate', 'void_custodians'];
const ROLE_ORDER: GalaxySeatRole[] = ['home', 'rival', 'alone', 'ally', 'whole', 'scattered'];
const DIFFICULTY_ORDER = ['easy', 'medium', 'hard', 'expert'];

/** Wilson score interval for k successes in n trials (95%). */
export function wilsonInterval(k: number, n: number, z = 1.96): [number, number] {
  if (n <= 0) return [0, 0];
  const p = k / n;
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  const denom = 1 + z2 / n;
  return [Math.max(0, (centre - margin) / denom), Math.min(1, (centre + margin) / denom)];
}

/** A seat's fair share of its game: 1 / sides, where a seat with no side is a side of its own. */
function fairShare(game: GalaxyReportGame): number {
  const sides = new Set(game.seat_results.map((s) => s.side ?? `seat:${s.seat}`));
  return sides.size > 0 ? 1 / sides.size : 0;
}

class RateTally {
  private readonly cells = new Map<string, { seats: number; wins: number; expected: number }>();

  add(key: string, won: boolean, share: number): void {
    const cell = this.cells.get(key) ?? { seats: 0, wins: 0, expected: 0 };
    cell.seats += 1;
    cell.wins += won ? 1 : 0;
    cell.expected += share;
    this.cells.set(key, cell);
  }

  rates(order: (key: string) => number = () => 0): GalaxyRate[] {
    return [...this.cells.entries()]
      .map(([key, c]) => rateOf(key, c.wins, c.seats, c.expected))
      .sort((a, b) => order(a.key) - order(b.key) || a.key.localeCompare(b.key));
  }
}

function rateOf(key: string, wins: number, seats: number, expected: number): GalaxyRate {
  const [low, high] = wilsonInterval(wins, seats);
  return {
    key,
    seats,
    wins,
    expected,
    rate: seats ? wins / seats : 0,
    expected_rate: seats ? expected / seats : 0,
    low,
    high,
  };
}

function orderBy(list: readonly string[]): (key: string) => number {
  return (key) => {
    const i = list.indexOf(key);
    return i === -1 ? list.length : i;
  };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The analytics of a set of recorded games (pure: the report's SQL only fetches). */
export function buildGalaxyAnalytics(games: readonly GalaxyReportGame[]): GalaxyAnalytics {
  const factions = new RateTally();
  const roles = new RateTally();
  const players = new RateTally();
  const houseTally = new RateTally();
  const houseRole = new Map<string, { house: string; role: GalaxySeatRole }>();
  const firstSeat = new RateTally();
  const modes = new Map<string, GalaxyAnalytics['modes'][number] & { turnSum: number }>();
  const endings = new Map<string, number>();
  const byDay = new Map<string, number>();
  const minutes: number[] = [];
  let turnSum = 0;
  let decisive = 0;

  for (const game of games) {
    const share = fairShare(game);
    turnSum += game.turns;
    if (game.victory && !NOT_DECISIVE.has(game.victory)) decisive += 1;
    const ending = game.victory ?? 'unknown';
    endings.set(ending, (endings.get(ending) ?? 0) + 1);
    const day = game.finished_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
    if (game.started_at && game.ended_at) {
      const ms = Date.parse(game.ended_at) - Date.parse(game.started_at);
      if (Number.isFinite(ms) && ms >= 0) minutes.push(ms / 60_000);
    }
    const modeKey = `${game.mode}|${game.seats}|${game.relations ?? ''}`;
    const mode = modes.get(modeKey)
      ?? { mode: game.mode, seats: game.seats, relations: game.relations, games: 0, avg_turns: 0, turnSum: 0 };
    mode.games += 1;
    mode.turnSum += game.turns;
    modes.set(modeKey, mode);

    for (const seat of game.seat_results) {
      if (seat.faction_id) factions.add(seat.faction_id, seat.won, share);
      roles.add(seat.role, seat.won, share);
      players.add(seat.is_ai ? `ai:${seat.ai_difficulty ?? 'unknown'}` : 'human', seat.won, share);
      if (seat.house) {
        const key = `${seat.house}|${seat.role}`;
        houseTally.add(key, seat.won, share);
        houseRole.set(key, { house: seat.house, role: seat.role });
      }
    }
    const first = game.first_seat != null ? game.seat_results.find((s) => s.seat === game.first_seat) : undefined;
    if (first) firstSeat.add('first_seat', first.won, share);
  }

  const playerOrder = (key: string) => (key === 'human' ? -1 : orderBy(DIFFICULTY_ORDER)(key.slice(3)));
  return {
    games: games.length,
    decisive,
    avg_turns: games.length ? turnSum / games.length : null,
    median_minutes: median(minutes),
    modes: [...modes.values()]
      .map(({ turnSum: sum, ...m }) => ({ ...m, avg_turns: m.games ? sum / m.games : 0 }))
      .sort((a, b) => a.seats - b.seats || a.mode.localeCompare(b.mode) || (a.relations ?? '').localeCompare(b.relations ?? '')),
    endings: [...endings.entries()]
      .map(([victory, n]) => ({ victory, games: n }))
      .sort((a, b) => b.games - a.games || a.victory.localeCompare(b.victory)),
    factions: factions.rates(orderBy(FACTION_ORDER)),
    roles: roles.rates(orderBy(ROLE_ORDER)),
    houses: houseTally.rates().map((r) => ({ ...r, ...houseRole.get(r.key)! })),
    players: players.rates(playerOrder),
    first_seat: firstSeat.rates()[0] ?? null,
    by_day: [...byDay.entries()].map(([d, n]) => ({ day: d, games: n })).sort((a, b) => a.day.localeCompare(b.day)),
  };
}

interface GameRow {
  game_id: string;
  finished_at: Date | string;
  started_at: Date | string | null;
  ended_at: Date | string | null;
  seats: number;
  mode: GalaxyGameMode;
  relations: GalaxyHouseRelations | null;
  board: string | null;
  victory: string | null;
  turns: number;
  first_seat: number | null;
  humans: number;
}

type SeatRow = GalaxyReportSeat & { game_id: string };

const iso = (v: Date | string | null): string | null => (v == null ? null : new Date(v).toISOString());

/** The filters as SQL parameters $1–$4, for table alias `r`. */
const FILTER_SQL = `
  ($1::int IS NULL OR r.finished_at >= NOW() - make_interval(days => $1::int))
  AND ($2::int IS NULL OR r.seats = $2::int)
  AND ($3::text IS NULL OR r.mode = $3::text)
  AND ($4::text IS NULL OR r.relations = $4::text)`;

export async function loadGalaxyReport(filters: GalaxyReportFilters): Promise<GalaxyReport> {
  const params = [filters.days, filters.seats, filters.mode, filters.relations];
  const rows = await query<GameRow>(
    `SELECT r.game_id, r.finished_at, g.started_at, g.ended_at, r.seats, r.mode, r.relations, r.board,
            r.victory, r.turns, r.first_seat, r.humans
     FROM galaxy_game_results r
     JOIN games g ON g.game_id = r.game_id
     WHERE ${FILTER_SQL}
     ORDER BY r.finished_at DESC, r.game_id
     LIMIT $5`,
    [...params, GALAXY_ANALYTICS_CAP],
  );
  const ids = rows.map((r) => r.game_id);
  const seatRows = ids.length
    ? await query<SeatRow>(
      `SELECT s.game_id, s.seat, s.user_id, u.username, s.is_ai, s.ai_difficulty, s.faction_id, s.world_id,
              s.house, s.role, s.side, s.reinforce_bonus, s.won, s.eliminated, s.resigned, s.territories
       FROM galaxy_game_result_seats s
       LEFT JOIN users u ON u.user_id = s.user_id
       WHERE s.game_id = ANY($1::uuid[])
       ORDER BY s.game_id, s.seat`,
      [ids],
    )
    : [];
  const seatsByGame = new Map<string, GalaxyReportSeat[]>();
  for (const { game_id, ...seat } of seatRows) {
    const list = seatsByGame.get(game_id) ?? [];
    list.push(seat);
    seatsByGame.set(game_id, list);
  }
  const games: GalaxyReportGame[] = rows.map((r) => ({
    ...r,
    finished_at: iso(r.finished_at)!,
    started_at: iso(r.started_at),
    ended_at: iso(r.ended_at),
    seat_results: seatsByGame.get(r.game_id) ?? [],
  }));

  const truncated = rows.length >= GALAXY_ANALYTICS_CAP;
  const total = truncated
    ? Number((await queryOne<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM galaxy_game_results r WHERE ${FILTER_SQL}`,
      params,
    ))?.n ?? rows.length)
    : rows.length;
  // Games the report cannot describe: finished before it recorded them. Only the
  // window filters them; their seats and board are what was never recorded.
  const unrecorded = await queryOne<{ n: string }>(
    `SELECT COUNT(*)::text AS n
     FROM games g
     WHERE g.status = 'completed'
       AND ${GALACTIC_AGE_GAME_SQL}
       AND COALESCE((g.settings_json->>'era_advancement_enabled')::boolean, false) = false
       AND ($1::int IS NULL OR g.ended_at >= NOW() - make_interval(days => $1::int))
       AND NOT EXISTS (SELECT 1 FROM galaxy_game_results r WHERE r.game_id = g.game_id)`,
    [filters.days],
  );

  return {
    filters,
    total_games: total,
    truncated,
    unrecorded_games: Number(unrecorded?.n ?? 0),
    analytics: buildGalaxyAnalytics(games),
    games: games.slice(0, GALAXY_LIST_LIMIT),
  };
}
