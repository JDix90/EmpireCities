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

/**
 * Game types a stranger may join from the lobby's "Open Games" list.
 *
 * Campaign missions, daily challenges and tutorials are all inserted as
 * `game_type = 'solo'` with `status = 'waiting'` and a human at seat 0, which
 * is indistinguishable from an open lobby by status alone. They are somebody's
 * single-player session, so they are not advertised — and campaign, which never
 * writes `max_players`, was genuinely joinable before this filter existed.
 *
 * `hybrid` (human seats open alongside bots) stays listed: that is the whole
 * point of an under-filled lobby.
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
