import type { GameState } from '../store/gameStore';

/**
 * Returns indices into `states` representing the "time-lapse" frames: one frame
 * per unique (turn_number, current_player_index) pair, taking the *last* such
 * frame so the viewer sees the completed state of each player's turn rather
 * than mid-action snapshots.
 *
 * Stable, sorted ascending. Produces an empty array for an empty input.
 */
export function buildTimeLapseIndices(states: ReadonlyArray<GameState>): number[] {
  const lastByKey = new Map<string, number>();
  for (let i = 0; i < states.length; i++) {
    const s = states[i];
    const key = `${s.turn_number ?? 0}:${s.current_player_index ?? 0}`;
    lastByKey.set(key, i);
  }
  return Array.from(lastByKey.values()).sort((a, b) => a - b);
}

/** Index of the next time-lapse stop strictly after `currentIdx`, or null at end. */
export function nextTimeLapseIndex(
  timeLapseIndices: ReadonlyArray<number>,
  currentIdx: number,
): number | null {
  for (const idx of timeLapseIndices) {
    if (idx > currentIdx) return idx;
  }
  return null;
}

/** Index of the previous time-lapse stop strictly before `currentIdx`, or null at start. */
export function prevTimeLapseIndex(
  timeLapseIndices: ReadonlyArray<number>,
  currentIdx: number,
): number | null {
  let prev: number | null = null;
  for (const idx of timeLapseIndices) {
    if (idx >= currentIdx) break;
    prev = idx;
  }
  return prev;
}
