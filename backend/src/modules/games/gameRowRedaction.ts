import { redactSettingsForClient } from '../../sockets/clientStateRedaction';

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
 *  - A daily challenge's secrets in `settings_json` are stripped for EVERYONE:
 *    the deterministic dice seeds (`seed`, `daily_challenge_spec.dice_queue_seed`),
 *    which would let a player precompute the shared daily's combat rolls, and
 *    on a v2 day the answer key (`daily_challenge_spec.v2.solution`). This goes
 *    through `redactSettingsForClient`, the same redactor the live socket uses,
 *    so this route cannot withhold less than the game itself does. It used to
 *    strip the seeds by hand and so missed the answer key when v2 arrived.
 *
 * Mutates `game` in place.
 */
export function redactGameRowForViewer(game: Record<string, unknown>, isParticipant: boolean): void {
  if (!isParticipant) {
    delete game.join_code;
  }

  const settings = game.settings_json;
  if (settings && typeof settings === 'object') {
    game.settings_json = redactSettingsForClient(settings as Record<string, unknown>);
  } else if (typeof settings === 'string') {
    // Preserve the original string shape if the column came back unparsed.
    try {
      const parsed: unknown = JSON.parse(settings);
      if (parsed && typeof parsed === 'object') {
        game.settings_json = JSON.stringify(redactSettingsForClient(parsed as Record<string, unknown>));
      }
    } catch {
      /* leave unparseable settings untouched */
    }
  }
}
