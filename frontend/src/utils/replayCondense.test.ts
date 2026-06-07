import { describe, it, expect } from 'vitest';
import { buildCondensedTimeline } from './replayCondense';
import type { GameState } from '../store/gameStore';
import type { PlayerState, TerritoryState } from '../store/gameStore';

interface SnapOpts {
  turn?: number;
  /** owner_id per territory id. */
  owners?: Record<string, string | null>;
  /** unit_count per territory id (defaults to 1). */
  units?: Record<string, number>;
  /** player_ids that are eliminated in this frame. */
  eliminated?: string[];
  /** win probabilities per player at this frame. */
  probs?: Record<string, number>;
}

const PLAYERS = ['p1', 'p2', 'p3'];
const TERRITORIES = ['a', 'b', 'c', 'd'];

function snap(opts: SnapOpts): GameState {
  const territories: Record<string, TerritoryState> = {};
  for (const tid of TERRITORIES) {
    territories[tid] = {
      territory_id: tid,
      owner_id: opts.owners?.[tid] ?? 'p1',
      unit_count: opts.units?.[tid] ?? 1,
      unit_type: 'infantry',
    };
  }

  const players: PlayerState[] = PLAYERS.map((pid, idx) => ({
    player_id: pid,
    player_index: idx,
    username: pid,
    color: '#fff',
    is_ai: false,
    is_eliminated: opts.eliminated?.includes(pid) ?? false,
    territory_count: 1,
    cards: [],
    mmr: 1000,
  }));

  const state: Partial<GameState> = {
    game_id: 'g1',
    turn_number: opts.turn ?? 0,
    current_player_index: 0,
    players,
    territories,
  };
  if (opts.probs) {
    state.win_probability_history = [{ step: 0, turn: opts.turn ?? 0, probabilities: opts.probs }];
  }
  return state as GameState;
}

describe('buildCondensedTimeline', () => {
  it('returns an empty timeline for no snapshots', () => {
    expect(buildCondensedTimeline([])).toEqual({ frames: [], totalMs: 0 });
  });

  it('keeps the single frame for a one-snapshot replay', () => {
    const t = buildCondensedTimeline([snap({ turn: 1 })]);
    expect(t.frames).toHaveLength(1);
    expect(t.frames[0].index).toBe(0);
  });

  it('always keeps the first and last frame as anchors', () => {
    const snaps = [
      snap({ turn: 1 }),
      snap({ turn: 2 }),
      snap({ turn: 3 }),
      snap({ turn: 4 }),
    ];
    const t = buildCondensedTimeline(snaps);
    expect(t.frames[0].index).toBe(0);
    expect(t.frames[0].reason).toBe('start');
    expect(t.frames[t.frames.length - 1].index).toBe(snaps.length - 1);
    expect(t.frames[t.frames.length - 1].reason).toBe('finish');
  });

  it('selects salient frames (captures, eliminations) over filler', () => {
    const snaps = [
      snap({ turn: 1, owners: { a: 'p1', b: 'p2', c: 'p3', d: 'p1' } }), // start
      snap({ turn: 2, owners: { a: 'p1', b: 'p2', c: 'p3', d: 'p1' } }), // filler (no change)
      // p1 captures b from p2 — salient
      snap({ turn: 3, owners: { a: 'p1', b: 'p1', c: 'p3', d: 'p1' } }),
      snap({ turn: 4, owners: { a: 'p1', b: 'p1', c: 'p3', d: 'p1' } }), // filler
      // p3 eliminated — salient
      snap({ turn: 5, owners: { a: 'p1', b: 'p1', c: 'p1', d: 'p1' }, eliminated: ['p3'] }),
      snap({ turn: 6, owners: { a: 'p1', b: 'p1', c: 'p1', d: 'p1' }, eliminated: ['p3'] }), // finish
    ];
    const t = buildCondensedTimeline(snaps);
    const keptIndices = t.frames.map((f) => f.index);
    expect(keptIndices).toContain(2); // capture frame
    expect(keptIndices).toContain(4); // elimination frame
    expect(t.frames.find((f) => f.index === 4)?.reason).toBe('elimination');
    expect(t.frames.find((f) => f.index === 2)?.reason).toBe('capture');
  });

  it('returns frames sorted ascending by index', () => {
    const snaps = Array.from({ length: 12 }, (_, i) =>
      snap({ turn: i, owners: i % 2 === 0 ? { b: 'p1' } : { b: 'p2' } }),
    );
    const t = buildCondensedTimeline(snaps);
    const indices = t.frames.map((f) => f.index);
    const sorted = [...indices].sort((a, b) => a - b);
    expect(indices).toEqual(sorted);
  });

  it('budgets the total runtime under the target', () => {
    // Many salient frames (a capture every turn) over a long match.
    const snaps = Array.from({ length: 300 }, (_, i) =>
      snap({ turn: i, owners: { a: i % 2 === 0 ? 'p1' : 'p2', b: i % 3 === 0 ? 'p3' : 'p1' } }),
    );
    const targetMs = 30_000;
    const t = buildCondensedTimeline(snaps, { targetMs });
    expect(t.totalMs).toBeLessThanOrEqual(targetMs);
    expect(t.frames.length).toBeGreaterThan(2);
  });

  it('scores win-probability swings as momentum shifts', () => {
    const snaps = [
      snap({ turn: 1, probs: { p1: 0.5, p2: 0.5 } }),
      snap({ turn: 2, probs: { p1: 0.52, p2: 0.48 } }), // small wobble (filler)
      snap({ turn: 3, probs: { p1: 0.9, p2: 0.1 } }), // big swing
      snap({ turn: 4, probs: { p1: 0.9, p2: 0.1 } }),
    ];
    const t = buildCondensedTimeline(snaps);
    const swingFrame = t.frames.find((f) => f.index === 2);
    expect(swingFrame).toBeDefined();
    expect(swingFrame?.reason).toBe('swing');
  });
});
