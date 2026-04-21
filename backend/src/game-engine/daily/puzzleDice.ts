import { randomInt } from 'crypto';
import type { GameState } from '../../types';

/** Mulberry32 — deterministic PRNG for Tier B puzzle dice. */
function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pre-generated d6 rolls (1–6) for puzzle combat — long enough for legion re-rolls and rifle doctrine.
 */
export function buildDiceQueue(seed: number, count: number): number[] {
  const rnd = mulberry32(seed >>> 0);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(1 + Math.floor(rnd() * 6));
  }
  return out;
}

/**
 * Die roller for resolveCombat — consumes {@link GameState.puzzle_dice_queue} when present.
 */
export function createPuzzleDieRoll(state: GameState): () => number {
  const q = state.puzzle_dice_queue;
  if (!q?.length) {
    return () => randomInt(1, 7);
  }
  return () => {
    const idx = state.puzzle_dice_index ?? 0;
    const v = q[idx % q.length];
    state.puzzle_dice_index = idx + 1;
    return v;
  };
}
