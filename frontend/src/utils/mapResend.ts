/**
 * Whether a `game:map` payload carries the map the client already holds.
 *
 * The server sends the whole map on every join and rejoin: a reconnect after the
 * network drops or the app comes back from the background, a GAME_NOT_FOUND
 * resync, and the second join every page load makes. Swapping in the fresh copy
 * anyway rebuilds everything keyed on the map object. That includes the Pixi
 * scene on the 2D map and each globe's territory geometry, which takes seconds on
 * a phone (the Space Age board has two globes). The payloads are plain JSON, so
 * equal serializations mean equal maps. A difference in key order only costs the
 * rebuild this exists to skip.
 */
export function isSameMap(current: unknown, incoming: unknown): boolean {
  if (current === incoming) return true;
  if (!current || !incoming) return false;
  return JSON.stringify(current) === JSON.stringify(incoming);
}
