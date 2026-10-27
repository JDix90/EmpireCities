/** Small pieces of the replay page's controls, kept apart so they can be tested. */

export const REPLAY_SPEED_OPTIONS = [0.5, 1, 2, 4, 8] as const;
export type ReplaySpeed = (typeof REPLAY_SPEED_OPTIONS)[number];

/** Phase ids as the game calls them in the HUD, not raw snake_case. */
const REPLAY_PHASE_LABELS: Record<string, string> = {
  territory_select: 'territory draft',
  reinforce: 'reinforcement',
  attack: 'attack',
  fortify: 'fortify',
};

/**
 * The line over the map naming whose phase the frame shows. The last frame is
 * the end of the game, which belongs to no one: it used to read "Lady Hoshiko
 * (AI)'s game over phase".
 */
export function replayPhaseLabel(phase: string, playerName: string | undefined): string {
  if (phase === 'game_over') return 'Game over';
  return `${playerName ?? 'Unknown'}'s ${REPLAY_PHASE_LABELS[phase] ?? phase} phase`;
}

/**
 * The highlight chips under the map, at most `max`, one per turn and label.
 * The server makes a highlight of every decision that moved the board, so three
 * captures in one turn arrive as three "T2: Decisive attack — gained ground"
 * entries. Each chip only jumps to its turn, so the copies did the same thing
 * three times over and pushed the map off a phone's screen.
 */
export function distinctHighlights<T extends { turn: number; label: string }>(highlights: T[], max = 5): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const h of highlights) {
    const key = `${h.turn}\u0000${h.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
    if (out.length >= max) break;
  }
  return out;
}

/** The phone's single speed button steps through the speeds and wraps round. */
export function nextReplaySpeed(speed: ReplaySpeed): ReplaySpeed {
  const i = REPLAY_SPEED_OPTIONS.indexOf(speed);
  return REPLAY_SPEED_OPTIONS[(i + 1) % REPLAY_SPEED_OPTIONS.length];
}
