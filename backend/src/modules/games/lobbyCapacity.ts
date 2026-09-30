/**
 * One definition of "how many seats does this lobby have, and can a stranger
 * take one".
 *
 * The seat cap used to be re-derived inline at each call site
 * (`Math.min(8, Math.max(2, settings.max_players ?? 8))` in `/:gameId/join` and
 * `/:gameId/invite`) while `GET /games/public` had no notion of it at all. That
 * disagreement is what put a full lobby in the "Open Games" list and answered
 * the click with 409 "Game is full" — the list and the join gate were reading
 * different rules. Both now read this one.
 */

import { GALAXY_CLASSIC_SEATS, GALAXY_MAX_SEATS, GALAXY_MIN_SEATS, GALAXY_SEAT_COUNTS } from '../../game-engine/state/galaxyModes';

/** Seats a lobby has when `settings_json` says nothing — the games table's own default. */
export const DEFAULT_MAX_PLAYERS = 8;
/** Hard bounds on a seat cap, whatever a stored settings blob claims. */
export const MIN_MAX_PLAYERS = 2;
export const MAX_MAX_PLAYERS = 8;

/**
 * The seat cap for a lobby, clamped. A non-numeric or absent `max_players`
 * falls back to {@link DEFAULT_MAX_PLAYERS} — campaign never writes the key,
 * so this path is live, not defensive.
 */
export function effectiveMaxPlayers(settings: Record<string, unknown> | string | null | undefined): number {
  let parsed: Record<string, unknown> | null | undefined;
  if (typeof settings === 'string') {
    try {
      parsed = JSON.parse(settings) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
  } else {
    parsed = settings;
  }
  const raw = parsed?.max_players;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_MAX_PLAYERS;
  return Math.min(MAX_MAX_PLAYERS, Math.max(MIN_MAX_PLAYERS, Math.floor(raw)));
}

/** A Galactic Age game: its era, or the galaxy board under another era id. */
export function isGalacticAgeGame(eraId: string | null | undefined, mapId: string | null | undefined): boolean {
  return eraId === 'galaxy_age' || mapId === 'era_galaxy';
}

/**
 * The SQL twin of {@link isGalacticAgeGame} for table alias `g`. Open Games
 * never lists one: the era is admin-only, and a lobby that waits for humans
 * waits for the ones it was sent to — however it came to be Galactic (created
 * that way, or switched by a Map & Era vote).
 */
export const GALACTIC_AGE_GAME_SQL = `(g.era_id = 'galaxy_age' OR g.map_id = 'era_galaxy')`;

/**
 * The Galactic Age seats two to eight players. Its four worlds are four home
 * worlds: below four the ones nobody calls home open as neutral colonies, and
 * from five up the Schism has two houses share a world, one world per seat over
 * four (game-engine/state/galaxyModes.ts, galaxySchism.ts).
 */
export const GALAXY_PLAYER_COUNT_ERROR =
  `Galactic Age seats ${GALAXY_MIN_SEATS} to ${GALAXY_MAX_SEATS} players — one per home world up to ${GALAXY_CLASSIC_SEATS}, and from ${GALAXY_CLASSIC_SEATS + 1} the Schism, two houses to a shared world`;

/** Null when a Galactic Age game can seat this many players, the error otherwise. */
export function galaxySeatCountError(seats: number): string | null {
  return GALAXY_SEAT_COUNTS.includes(seats) ? null : GALAXY_PLAYER_COUNT_ERROR;
}

/**
 * The seat cap `/:gameId/join` and `/:gameId/invite` enforce: the lobby's own
 * cap, and never more than a Galactic Age game can seat. For the Galactic Age
 * that is the largest seat count it plays within the lobby's cap, which since
 * every count from two to eight has a board is the cap itself; kept as a rule
 * so a seat is never sold on a count that has none.
 */
export function lobbySeatCap(
  settings: Record<string, unknown> | string | null | undefined,
  eraId: string | null | undefined,
  mapId: string | null | undefined,
): number {
  const cap = effectiveMaxPlayers(settings);
  if (!isGalacticAgeGame(eraId, mapId)) return cap;
  return Math.max(GALAXY_MIN_SEATS, ...GALAXY_SEAT_COUNTS.filter((n) => n <= cap));
}

/**
 * Seats one faction may take in a lobby: two in a Galactic Age lobby that can
 * seat a Schism (five or more seats: a faction picked twice splits its world
 * between two houses), one everywhere else. The waiting room's faction pick
 * holds each faction to this. At five to seven seats only one world per seat
 * over four splits, and the deal draws which pairs stand when more factions
 * were picked twice (galaxySchism.ts dealSchismFactions).
 */
export function seatsPerFaction(
  settings: Record<string, unknown> | string | null | undefined,
  eraId: string | null | undefined,
  mapId: string | null | undefined,
): number {
  return isGalacticAgeGame(eraId, mapId) && lobbySeatCap(settings, eraId, mapId) > GALAXY_CLASSIC_SEATS ? 2 : 1;
}

/**
 * Game types a stranger may join from the lobby's "Open Games" list.
 *
 * Campaign missions, daily challenges and tutorials are all inserted as
 * `game_type = 'solo'` with `status = 'waiting'` and a human at seat 0, which
 * is indistinguishable from an open lobby by status alone. They are somebody's
 * single-player session, so they are not advertised — and campaign, which never
 * writes `max_players`, was genuinely joinable before this filter existed.
 *
 * Create stores a game with AI as `solo`, invite-only until it starts, when
 * the real type is set from who took a seat. So no waiting lobby is `hybrid`
 * today. It stays listed so that one would be, should create ever make one:
 * human seats open alongside bots are the point of an under-filled lobby.
 */
export const PUBLIC_LOBBY_GAME_TYPES = ['multiplayer', 'hybrid'] as const;

/**
 * The SQL twin of {@link effectiveMaxPlayers}, for the seat cap of table alias
 * `g`. Kept beside the TS so the two cannot drift; `lobbyCapacity.test.ts`
 * pins the TS side and `publicGames.routes.test.ts` pins this one against a
 * real database.
 */
export const EFFECTIVE_MAX_PLAYERS_SQL = `
  CASE WHEN jsonb_typeof(g.settings_json::jsonb -> 'max_players') = 'number'
       THEN LEAST(${MAX_MAX_PLAYERS}, GREATEST(${MIN_MAX_PLAYERS},
              floor((g.settings_json::jsonb ->> 'max_players')::numeric)))::int
       ELSE ${DEFAULT_MAX_PLAYERS} END`;
