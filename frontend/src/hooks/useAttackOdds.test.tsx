/**
 * The odds a panel shows come from the server (`game:attack_odds`), asked
 * again whenever an army on either end of a pair changes; only the latest
 * answer to this panel's own question counts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useAttackOdds, formatWinChance } from './useAttackOdds';
import { useGameStore, type GameState } from '../store/gameStore';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

const emit = vi.fn();
const listeners = new Set<(payload: unknown) => void>();
vi.mock('../services/socket', () => ({
  getSocket: () => ({
    emit,
    on: (_event: string, fn: (payload: unknown) => void) => listeners.add(fn),
    off: (_event: string, fn: (payload: unknown) => void) => listeners.delete(fn),
  }),
}));

const answer = (payload: unknown) => act(() => listeners.forEach((fn) => fn(payload)));
const lastRequest = () => emit.mock.calls.at(-1)![1] as { gameId: string; requestId: string; pairs: unknown };

function board(units: { a: number; b: number }, phase = 'attack'): GameState {
  return {
    game_id: 'g1',
    phase,
    current_player_index: 0,
    territories: {
      a: { territory_id: 'a', owner_id: 'me', unit_count: units.a },
      b: { territory_id: 'b', owner_id: 'ai', unit_count: units.b },
    },
    players: [],
  } as unknown as GameState;
}

const PAIRS = [{ fromId: 'a', toId: 'b' }];
const setFlag = (on: boolean) =>
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, combat_explain_enabled: on } }));

describe('useAttackOdds', () => {
  beforeEach(() => {
    emit.mockClear();
    listeners.clear();
    setFlag(true);
    useGameStore.setState({ replayMode: false, gameState: board({ a: 6, b: 2 }) });
  });
  afterEach(() => {
    cleanup();
    setFlag(false);
    useGameStore.setState({ gameState: null });
  });

  it('asks the server and files its answer by pair', () => {
    const { result } = renderHook(() => useAttackOdds(PAIRS));
    expect(lastRequest()).toMatchObject({ gameId: 'g1', pairs: PAIRS });
    answer({ gameId: 'g1', requestId: lastRequest().requestId, odds: [{ fromId: 'a', toId: 'b', p: 0.91 }] });
    expect(result.current.get('a>b')).toBe(0.91);
  });

  it('ignores another game\'s answer and an answer to an older question', () => {
    const { result } = renderHook(() => useAttackOdds(PAIRS));
    const first = lastRequest().requestId;
    answer({ gameId: 'other', requestId: first, odds: [{ fromId: 'a', toId: 'b', p: 0.5 }] });
    expect(result.current.size).toBe(0);
    // The fight moves on: a new question, and the old answer no longer counts.
    act(() => useGameStore.setState({ gameState: board({ a: 4, b: 2 }) }));
    expect(lastRequest().requestId).not.toBe(first);
    answer({ gameId: 'g1', requestId: first, odds: [{ fromId: 'a', toId: 'b', p: 0.91 }] });
    expect(result.current.size).toBe(0);
    answer({ gameId: 'g1', requestId: lastRequest().requestId, odds: [{ fromId: 'a', toId: 'b', p: 0.62 }] });
    expect(result.current.get('a>b')).toBe(0.62);
  });

  it('drops a number once the armies change, until the new one comes', () => {
    const { result } = renderHook(() => useAttackOdds(PAIRS));
    answer({ gameId: 'g1', requestId: lastRequest().requestId, odds: [{ fromId: 'a', toId: 'b', p: 0.91 }] });
    act(() => useGameStore.setState({ gameState: board({ a: 6, b: 5 }) }));
    expect(result.current.size).toBe(0);
  });

  it('asks nothing with the flag off, outside the attack phase, or in a replay', () => {
    setFlag(false);
    renderHook(() => useAttackOdds(PAIRS)).unmount();
    setFlag(true);
    useGameStore.setState({ gameState: board({ a: 6, b: 2 }, 'fortify') });
    renderHook(() => useAttackOdds(PAIRS)).unmount();
    useGameStore.setState({ replayMode: true, gameState: board({ a: 6, b: 2 }) });
    renderHook(() => useAttackOdds(PAIRS)).unmount();
    expect(emit).not.toHaveBeenCalled();
    useGameStore.setState({ replayMode: false });
  });
});

describe('formatWinChance', () => {
  it('rounds to a whole percent but never to a false certainty', () => {
    expect(formatWinChance(0.724)).toBe('72%');
    expect(formatWinChance(0.004)).toBe('<1%');
    expect(formatWinChance(0.996)).toBe('>99%');
    expect(formatWinChance(0)).toBe('0%');
    expect(formatWinChance(1)).toBe('100%');
  });
});
