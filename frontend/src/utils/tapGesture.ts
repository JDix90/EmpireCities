/** Max pointer drift (px) between down and up that still counts as a tap, not a pan. */
export const TAP_MAX_DRIFT_PX = 10;

/**
 * Did this pointer gesture select something, or was it a pan?
 *
 * Drift only — deliberately no time limit. The 2D map used to also require the
 * gesture to finish within 300 ms, which silently swallowed the slow, careful
 * press of someone deciding where to attack, and disagreed with the globe,
 * which has never had a time limit. Panning is already excluded by the drift
 * test: a drag that moves the map moves the pointer.
 */
export function isTapGesture(
  down: { x: number; y: number } | null,
  up: { x: number; y: number },
): boolean {
  if (!down) return false;
  return Math.hypot(up.x - down.x, up.y - down.y) <= TAP_MAX_DRIFT_PX;
}
