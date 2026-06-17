/**
 * Strip participant-only / integrity-sensitive fields from a `GET /api/games/:gameId`
 * row before returning it to a viewer.
 *
 * That route is gated only by `authenticate`, so any logged-in user who knows
 * (or enumerates via `/api/games/live`) a gameId can reach it. Lobby browsers
 * and spectators legitimately need basic game metadata, so rather than 403 the
 * whole route we redact the secrets it previously returned via `SELECT g.*`:
 *
 *  - `join_code` is the private invite credential for friend lobbies — only
 *    participants may see it.
 *  - The daily-challenge deterministic dice seed (`settings_json.seed` and
 *    `settings_json.daily_challenge_spec.dice_queue_seed`) is stripped for
 *    EVERYONE. `/api/daily/today` already withholds it (`toPublicSpec`) so a
 *    player cannot precompute the shared daily's combat rolls; this route used
 *    to return the unstripped `settings_json`, defeating that protection.
 *
 * Mutates `game` in place.
 */
export function redactGameRowForViewer(game: Record<string, unknown>, isParticipant: boolean): void {
  if (!isParticipant) {
    delete game.join_code;
  }

  const stripSeed = (settings: Record<string, unknown>): void => {
    delete settings.seed;
    const spec = settings.daily_challenge_spec;
    if (spec && typeof spec === 'object') {
      delete (spec as Record<string, unknown>).dice_queue_seed;
    }
  };

  const settings = game.settings_json;
  if (settings && typeof settings === 'object') {
    stripSeed(settings as Record<string, unknown>);
  } else if (typeof settings === 'string') {
    // Preserve the original string shape if the column came back unparsed.
    try {
      const parsed = JSON.parse(settings) as Record<string, unknown>;
      stripSeed(parsed);
      game.settings_json = JSON.stringify(parsed);
    } catch {
      /* leave unparseable settings untouched */
    }
  }
}
