/**
 * Fog-of-war client helpers.
 *
 * The server masks territories the viewing player cannot see by sending
 * `unit_count: -1` (and stripping buildings / fleets / stability / population).
 * Treat that sentinel as "hidden" everywhere the UI renders per-territory intel so
 * scouting an adjacent enemy territory does not leak fort types, fleet counts, or
 * economy/stability that the player has not actually revealed.
 */
export function isFogHidden(tState: { unit_count: number } | null | undefined): boolean {
  return tState?.unit_count === -1;
}
