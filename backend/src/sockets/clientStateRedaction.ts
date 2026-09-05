import type { PlayerState, TerritoryState } from '../types';

/** Settings keys whose value is a secret rather than a rule. */
const SECRET_SETTINGS_KEYS = ['seed'] as const;


/**
 * Redact per-player private fields from a state snapshot for a given viewer.
 *
 * Used by `buildClientState` for both player and spectator/public views:
 *
 *  - `viewerId === null` → a spectator / public snapshot. **Card hands are
 *    private to each player and must never appear in a spectator view — in any
 *    game, fogged or not.** A spectator is not a player, so every hand is
 *    emptied. (Previously the spectator path returned full hands, letting any
 *    authenticated user `game:spectate_join` and read every player's cards.)
 *  - `secret_mission` is revealed only to its owner, to eliminated players, or
 *    at game_over; otherwise nulled. (`mission_seed_salt` is stripped by the
 *    caller.) This matches the prior behaviour exactly for player views.
 *
 * Returns a new array; players that need redaction are shallow-cloned, so the
 * authoritative server state is never mutated.
 */
export function redactPlayersForViewer(
  players: PlayerState[],
  viewerId: string | null,
  phase: string,
): PlayerState[] {
  return players.map((p) => {
    // Spectators (no viewing player) never see any hand.
    const base: PlayerState = viewerId === null ? { ...p, cards: [] } : p;
    const revealMission =
      (viewerId !== null && p.player_id === viewerId) || p.is_eliminated || phase === 'game_over';
    return revealMission ? base : { ...base, secret_mission: null };
  });
}

/**
 * Mask the exact per-territory intel of every territory NOT in `visibleIds`,
 * keeping `owner_id` (board control) intact. Used by `buildClientState` for both
 * the per-player fog view (visible = owned + adjacent + recon) and the spectator
 * fog view (visible = empty → all exact counts masked, so a spectator sees who
 * controls what but not troop/building/fleet strength).
 *
 * `unit_count: -1` is the "hidden" sentinel the client renders; buildings,
 * fleets, stability and production/population are scouting intel and stay masked
 * until the territory becomes visible. Returns a new map; hidden territories are
 * shallow-cloned so the authoritative server state is never mutated.
 */
export function maskHiddenTerritories(
  territories: Record<string, TerritoryState>,
  visibleIds: ReadonlySet<string>,
): Record<string, TerritoryState> {
  const out: Record<string, TerritoryState> = { ...territories };
  for (const [tid, tState] of Object.entries(territories)) {
    if (!visibleIds.has(tid)) {
      out[tid] = {
        ...tState,
        unit_count: -1,
        naval_units: undefined,
        buildings: [],
        production_bonus: undefined,
        stability: undefined,
        population: undefined,
      };
    }
  }
  return out;
}

/**
 * Strip the integrity-sensitive settings from a snapshot bound for a client.
 *
 * A daily challenge's dice stream is deterministic on purpose (every player
 * gets the same rolls), and `daily_challenge_spec.dice_queue_seed` is what
 * generates it. `/api/daily/today` withholds it and `GET /api/games/:id`
 * redacts it, so the live socket has to as well: a client that reads the seed
 * from `game:state` or the waiting-lobby snapshot can replay the PRNG and
 * know every roll before it attacks. `settings.seed` goes with it for the
 * same reason. The client reads neither field. Returns a new object; the
 * authoritative settings are never mutated.
 */
export function redactSettingsForClient<T extends object>(settings: T): T {
  const out: Record<string, unknown> = { ...(settings as Record<string, unknown>) };
  for (const key of SECRET_SETTINGS_KEYS) delete out[key];
  const spec = out.daily_challenge_spec;
  if (spec && typeof spec === 'object') {
    const { dice_queue_seed: _seed, ...rest } = spec as Record<string, unknown>;
    out.daily_challenge_spec = rest;
  }
  return out as T;
}
