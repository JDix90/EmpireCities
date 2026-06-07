import type { GameState } from '../store/gameStore';
import { diffReplayMapVisuals } from './replayMapVisualDiff';

/**
 * Why a frame survived condensing. Drives caption text and dwell duration.
 */
export type CondenseReason =
  | 'start'
  | 'finish'
  | 'elimination'
  | 'capture'
  | 'swing'
  | 'highlight'
  | 'keyframe';

export interface CondensedFrame {
  /** Index into the original (full) snapshots array. */
  index: number;
  /** How long to dwell on this frame during auto-play, in ms. */
  dwellMs: number;
  reason: CondenseReason;
  /** Raw salience score (higher = more important). */
  score: number;
}

export interface CondensedTimeline {
  frames: CondensedFrame[];
  /** Sum of dwellMs across kept frames. */
  totalMs: number;
}

export interface CondenseOptions {
  /** Target total runtime in ms. Default 55s. */
  targetMs?: number;
  /** Server highlight turn numbers (from match_replay_highlights). */
  highlightTurns?: number[];
}

const DEFAULT_TARGET_MS = 55_000;
const MIN_DWELL_MS = 350;
const SWING_THRESHOLD = 0.05;

const DWELL_BY_REASON: Record<CondenseReason, number> = {
  start: 2400,
  finish: 3200,
  elimination: 2200,
  swing: 1800,
  highlight: 1600,
  capture: 1300,
  keyframe: 800,
};

function latestProbabilities(state: GameState): Record<string, number> | null {
  const hist = state.win_probability_history;
  if (!hist || hist.length === 0) return null;
  return hist[hist.length - 1]?.probabilities ?? null;
}

/** Largest per-player change in win probability between two frames (0..1). */
function maxProbSwing(prev: GameState, next: GameState): number {
  const a = latestProbabilities(prev);
  const b = latestProbabilities(next);
  if (!a || !b) return 0;
  let max = 0;
  for (const pid of Object.keys(b)) {
    const delta = Math.abs((b[pid] ?? 0) - (a[pid] ?? 0));
    if (delta > max) max = delta;
  }
  return max;
}

/** Count players newly eliminated between two frames. */
function countEliminations(prev: GameState, next: GameState): number {
  const wasEliminated = new Map(prev.players.map((p) => [p.player_id, p.is_eliminated]));
  let n = 0;
  for (const p of next.players) {
    if (p.is_eliminated && !wasEliminated.get(p.player_id)) n++;
  }
  return n;
}

interface ScoredFrame {
  index: number;
  score: number;
  reason: CondenseReason;
}

/**
 * Reduce a full ordered list of replay snapshots to a sub-`targetMs` highlight
 * reel. Always keeps the opening and final frames; scores the rest by captures,
 * eliminations, win-probability swings, and server highlight turns; drops
 * filler; then assigns a variable dwell (longer on big moments) and scales the
 * whole timeline down if it still exceeds the budget.
 */
export function buildCondensedTimeline(
  snapshots: GameState[],
  options: CondenseOptions = {},
): CondensedTimeline {
  const targetMs = options.targetMs ?? DEFAULT_TARGET_MS;
  const highlightTurns = new Set(options.highlightTurns ?? []);
  const n = snapshots.length;

  if (n === 0) return { frames: [], totalMs: 0 };
  if (n === 1) {
    return {
      frames: [{ index: 0, dwellMs: DWELL_BY_REASON.finish, reason: 'finish', score: 1000 }],
      totalMs: DWELL_BY_REASON.finish,
    };
  }

  const scored: ScoredFrame[] = [
    { index: 0, score: 1000, reason: 'start' },
    { index: n - 1, score: 1000, reason: 'finish' },
  ];

  for (let i = 1; i < n - 1; i++) {
    const prev = snapshots[i - 1];
    const cur = snapshots[i];
    let score = 0;
    let reason: CondenseReason = 'keyframe';

    const eliminations = countEliminations(prev, cur);
    if (eliminations > 0) {
      score += 8 * eliminations;
      reason = 'elimination';
    }

    const visuals = diffReplayMapVisuals(prev, cur);
    const captures = visuals.filter((v) => v.kind === 'capture').length;
    if (captures > 0) {
      score += 3 * captures;
      if (reason === 'keyframe') reason = 'capture';
    }

    const swing = maxProbSwing(prev, cur);
    if (swing > SWING_THRESHOLD) {
      score += swing * 12;
      if (reason === 'keyframe') reason = 'swing';
    }

    if (highlightTurns.has(cur.turn_number)) {
      score += 5;
      if (reason === 'keyframe') reason = 'highlight';
    }

    if (score > 0) scored.push({ index: i, score, reason });
  }

  // Budget the frame count so even max dwell can't blow the runtime.
  const maxFrames = Math.max(2, Math.floor(targetMs / MIN_DWELL_MS));

  const anchors = scored.filter((s) => s.reason === 'start' || s.reason === 'finish');
  const rest = scored
    .filter((s) => s.reason !== 'start' && s.reason !== 'finish')
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, maxFrames - anchors.length));

  const selected = [...anchors, ...rest]
    .filter((s, idx, arr) => arr.findIndex((x) => x.index === s.index) === idx)
    .sort((a, b) => a.index - b.index);

  let frames: CondensedFrame[] = selected.map((s) => ({
    index: s.index,
    reason: s.reason,
    score: s.score,
    dwellMs: DWELL_BY_REASON[s.reason],
  }));

  let totalMs = frames.reduce((sum, f) => sum + f.dwellMs, 0);

  if (totalMs > targetMs) {
    // Floor of MIN_DWELL per frame is guaranteed <= targetMs by the maxFrames
    // cap. Distribute the remaining budget proportionally to each frame's
    // "wanted" extra dwell, flooring each share so the total never overshoots.
    const floorTotal = frames.length * MIN_DWELL_MS;
    const extraBudget = Math.max(0, targetMs - floorTotal);
    const totalWanted = frames.reduce((sum, f) => sum + (f.dwellMs - MIN_DWELL_MS), 0);
    frames = frames.map((f) => {
      if (totalWanted <= 0) return { ...f, dwellMs: MIN_DWELL_MS };
      const give = Math.floor(extraBudget * ((f.dwellMs - MIN_DWELL_MS) / totalWanted));
      return { ...f, dwellMs: MIN_DWELL_MS + give };
    });
    totalMs = frames.reduce((sum, f) => sum + f.dwellMs, 0);
  }

  return { frames, totalMs };
}

/** Short human-readable caption for a condensed frame. */
export function condenseReasonLabel(reason: CondenseReason): string {
  switch (reason) {
    case 'start':
      return 'Opening positions';
    case 'finish':
      return 'Final result';
    case 'elimination':
      return 'Player eliminated';
    case 'capture':
      return 'Territory captured';
    case 'swing':
      return 'Momentum shift';
    case 'highlight':
      return 'Key moment';
    default:
      return 'Turn';
  }
}
