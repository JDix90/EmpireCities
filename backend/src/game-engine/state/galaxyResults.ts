/**
 * The admin report's record of a finished Galactic Age game (migration 048):
 * the board it dealt, each seat's faction, house, role and side, and who won.
 * finalizeGame writes it once; the admin report (modules/admin/galaxyReport.ts)
 * reads it.
 *
 * A finished game's state snapshots are pruned after GAME_STATE_RETENTION_DAYS,
 * and the dealt board lives nowhere else, so it is kept here as the game ends.
 * Every other game records nothing: `summarizeGalaxyGame` answers null before
 * anything touches the database.
 */
import { withTransaction } from '../../db/postgres';
import { isGalacticAgeGame } from '../../modules/games/lobbyCapacity';
import type { GalaxyHouseRelations, GameState } from '../../types';
import { getEraFactions } from '../eras';
import { GALAXY_CLASSIC_SEATS, GALAXY_HOME_WORLD_IDS, GALAXY_SCHISM_SEATS } from './galaxyModes';
import { schismHouseOf, schismRivalOf, schismSplitKey, schismWholeWorldOf } from './galaxySchism';
import { teamOf } from './teams';

/**
 * The board a game dealt, by seat count and options (docs/GALACTIC_AGE_MODES.md).
 * `scattered` is any start without home worlds: Home Worlds off, or the
 * Territory Draft.
 */
export const GALAXY_GAME_MODES = ['colonies', 'home_worlds', '2v2', 'partial_schism', 'schism', 'scattered'] as const;
export type GalaxyGameMode = (typeof GALAXY_GAME_MODES)[number];

/**
 * What a seat was on its board:
 *   home: alone on its home world (Colonies, four seats, 2v2);
 *   rival: a house sharing its world with a rival (the Concord or Civil War);
 *   alone: a house alone on its world, the other half unclaimed;
 *   ally: an Allied house, one of a side of two;
 *   whole: an Allied seat holding its world whole, a side of one;
 *   scattered: no home world.
 */
export type GalaxySeatRole = 'home' | 'rival' | 'alone' | 'ally' | 'whole' | 'scattered';

export interface GalaxySeatResult {
  /** Turn order: team boards reseat players, so this is not game_players.player_index. */
  seat: number;
  /** The human's user id; null for an AI seat. */
  user_id: string | null;
  is_ai: boolean;
  ai_difficulty: string | null;
  faction_id: string | null;
  world_id: string | null;
  /** Schism: the house's name, e.g. "Western Mandate". */
  house: string | null;
  role: GalaxySeatRole;
  /** Team games: the seat's team_id. */
  side: string | null;
  /** Units a turn the seat's own board number added (Schism houses and whole worlds). */
  reinforce_bonus: number | null;
  /** Credited with the win: a side wins together. */
  won: boolean;
  eliminated: boolean;
  resigned: boolean;
  territories: number;
}

export interface GalaxyGameResult {
  seats: number;
  mode: GalaxyGameMode;
  relations: GalaxyHouseRelations | null;
  /** Partial Schism: the worlds that split (schismSplitKey). */
  board: string | null;
  victory: string | null;
  turns: number;
  /** The seat that moved first. */
  first_seat: number | null;
  humans: number;
  seat_results: GalaxySeatResult[];
}

/**
 * A game the report covers: the Galactic Age on its own boards. An era-advancement
 * game that climbs into the era's content (Space to Stars) is a different game.
 */
export function isGalaxyReportGame(state: Pick<GameState, 'era' | 'map_id' | 'settings'>): boolean {
  return isGalacticAgeGame(state.era, state.map_id) && !state.settings?.era_advancement_enabled;
}

/**
 * Each galaxy faction's home world, read off the board: the one world all of
 * its home regions lie on (as factionHomeWorld reads the map).
 */
function factionWorlds(state: GameState): Map<string, string> {
  const worldOfRegion = new Map<string, string>();
  for (const t of Object.values(state.territories)) {
    if (t.region_id && t.world_id) worldOfRegion.set(t.region_id, t.world_id);
  }
  const out = new Map<string, string>();
  for (const faction of getEraFactions('galaxy_age')) {
    const worlds = new Set(
      (faction.home_region_ids ?? []).map((r) => worldOfRegion.get(r)).filter((w): w is string => !!w),
    );
    const world = worlds.size === 1 ? [...worlds][0]! : null;
    if (world && GALAXY_HOME_WORLD_IDS.has(world)) out.set(faction.faction_id, world);
  }
  return out;
}

function gameMode(state: GameState, worldOfFaction: Map<string, string>): GalaxyGameMode {
  const mode = state.galaxy_mode;
  if (mode?.id === 'colonies') return 'colonies';
  if (mode?.id === 'schism') return state.players.length >= GALAXY_SCHISM_SEATS ? 'schism' : 'partial_schism';
  if (state.teams?.length) return '2v2';
  // Four seats on their home worlds leave no mode on the state: every seat on
  // its own faction's world, which only the home-world deal gives.
  const settings = state.settings;
  const homeWorlds = state.players.map((p) => (p.faction_id ? worldOfFaction.get(p.faction_id) : undefined));
  const dealt = state.players.length === GALAXY_CLASSIC_SEATS
    && !!settings.factions_enabled && !settings.territory_selection && !settings.galaxy_plain_lanes
    && homeWorlds.every((w) => !!w) && new Set(homeWorlds).size === homeWorlds.length;
  return dealt ? 'home_worlds' : 'scattered';
}

/**
 * The record of a finished Galactic Age game, or null for any other game.
 * `winnerIds` are the credited winners (a side wins together).
 */
export function summarizeGalaxyGame(state: GameState, winnerIds: readonly string[]): GalaxyGameResult | null {
  if (!isGalaxyReportGame(state)) return null;
  const worldOfFaction = factionWorlds(state);
  const mode = gameMode(state, worldOfFaction);
  const schism = state.galaxy_mode?.id === 'schism' ? state.galaxy_mode : null;
  const relations = schism?.relations ?? null;

  let board: string | null = null;
  if (schism && mode === 'partial_schism') {
    const housesOn = new Map<string, number>();
    for (const h of schism.houses) housesOn.set(h.world_id, (housesOn.get(h.world_id) ?? 0) + 1);
    board = schismSplitKey([...housesOn].filter(([, n]) => n === 2).map(([world]) => world));
  }

  const credited = new Set(winnerIds);
  const seat_results = state.players.map((p, seat): GalaxySeatResult => {
    const house = schism ? schismHouseOf(state, p.player_id) : null;
    const whole = schism ? schismWholeWorldOf(state, p.player_id) : null;
    let role: GalaxySeatRole;
    if (house) role = schismRivalOf(state, p.player_id) ? (relations === 'allied' ? 'ally' : 'rival') : 'alone';
    else if (whole) role = 'whole';
    else role = mode === 'scattered' ? 'scattered' : 'home';
    const factionWorld = p.faction_id ? worldOfFaction.get(p.faction_id) ?? null : null;
    return {
      seat,
      user_id: p.is_ai ? null : p.player_id,
      is_ai: p.is_ai,
      ai_difficulty: p.is_ai ? p.ai_difficulty ?? null : null,
      faction_id: p.faction_id ?? null,
      world_id: house?.world_id ?? whole?.world_id ?? (role === 'scattered' ? null : factionWorld),
      house: house?.name ?? null,
      role,
      side: teamOf(state, p.player_id)?.team_id ?? null,
      reinforce_bonus: house?.reinforce_bonus ?? whole?.reinforce_bonus ?? null,
      won: credited.has(p.player_id),
      eliminated: !!p.is_eliminated,
      resigned: !!p.has_resigned,
      territories: p.territory_count,
    };
  });

  return {
    seats: state.players.length,
    mode,
    relations,
    board,
    victory: state.victory_condition ?? null,
    turns: state.turn_number,
    first_seat: state.starting_player_index ?? null,
    humans: state.players.filter((p) => !p.is_ai).length,
    seat_results,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Record a finished Galactic Age game for the admin report, once: a game already
 * on record is left as it is. Returns whether a record was written. Every other
 * game returns false without touching the database.
 *
 * A seat's user id is kept only while the account exists (the subselect), as in
 * game_players, so the record never fails on an account deleted mid-game.
 */
export async function recordGalaxyGameResult(
  gameId: string,
  state: GameState,
  winnerIds: readonly string[],
): Promise<boolean> {
  const result = summarizeGalaxyGame(state, winnerIds);
  if (!result) return false;
  return withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO galaxy_game_results
         (game_id, seats, mode, relations, board, victory, turns, first_seat, humans)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (game_id) DO NOTHING`,
      [gameId, result.seats, result.mode, result.relations, result.board, result.victory,
        result.turns, result.first_seat, result.humans],
    );
    if (!inserted.rowCount) return false;
    for (const s of result.seat_results) {
      await client.query(
        `INSERT INTO galaxy_game_result_seats
           (game_id, seat, user_id, is_ai, ai_difficulty, faction_id, world_id, house, role, side,
            reinforce_bonus, won, eliminated, resigned, territories)
         VALUES ($1, $2, (SELECT u.user_id FROM users u WHERE u.user_id = $3::uuid), $4, $5, $6, $7, $8,
                 $9, $10, $11, $12, $13, $14, $15)`,
        [gameId, s.seat, s.user_id && UUID.test(s.user_id) ? s.user_id : null, s.is_ai, s.ai_difficulty,
          s.faction_id, s.world_id, s.house, s.role, s.side, s.reinforce_bonus, s.won, s.eliminated,
          s.resigned, s.territories],
      );
    }
    return true;
  });
}
