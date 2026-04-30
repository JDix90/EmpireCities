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
 *
 * Invariant: when a puzzle scenario provides a deterministic queue, every
 * roll for that puzzle must come from the queue in order. If we ever exhaust
 * the queue we fall back to crypto.randomInt so the game stays playable, but
 * we log loudly so the puzzle author can grow the queue. We also defend
 * against malformed queue entries (NaN, fractional, out-of-range) by
 * throwing during construction — those bugs should never silently determine
 * combat outcomes.
 */
export function createPuzzleDieRoll(state: GameState): () => number {
  const q = state.puzzle_dice_queue;
  if (!q?.length) {
    return () => randomInt(1, 7);
  }

  for (let i = 0; i < q.length; i++) {
    const v = q[i];
    if (!Number.isInteger(v) || v! < 1 || v! > 6) {
      throw new Error(
        `[puzzleDice] Invalid die value at index ${i}: ${v}. Queue must be integers in [1, 6].`,
      );
    }
  }

  let warned = false;
  return () => {
    const idx = state.puzzle_dice_index ?? 0;
    if (idx >= q.length) {
      if (!warned) {
        warned = true;
        console.warn(
          `[puzzleDice] Dice queue exhausted (length=${q.length}, idx=${idx}). ` +
            'Falling back to crypto.randomInt — extend buildDiceQueue() count for this puzzle.',
        );
      }
      state.puzzle_dice_index = idx + 1;
      return randomInt(1, 7);
    }
    const v = q[idx]!;
    state.puzzle_dice_index = idx + 1;
    return v;
  };
}
