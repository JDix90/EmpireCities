/**
 * First turn clock (`first_turn_clock_wait_enabled`): the first turn starts its
 * clock when the game-start briefing closes (the server honours that ready
 * signal however late on turn 1), so the HUD holds the countdown at the full
 * turn while the briefing is open, instead of counting down behind it.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GameHUD from './GameHUD';
import { useGameStore, type GameState } from '../../store/gameStore';
import { useAuthStore } from '../../store/authStore';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';

vi.mock('../../services/socket', () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn() }),
}));

function player(id: string, idx: number) {
  return {
    player_id: id, player_index: idx, username: id, color: '#fff', is_ai: false,
    is_eliminated: false, territory_count: 3, cards: [], mmr: 1000,
    capital_territory_id: null, secret_mission: null,
  };
}

/** A 5-minute turn that began 40 seconds ago: the real clock reads 4:20. */
function makeState(overrides: Partial<GameState> = {}): GameState {
  const startedAt = Date.now() - 40_000;
  return {
    game_id: 'g1', era: 'ancient', map_id: 'm1', phase: 'draft',
    current_player_index: 0, turn_number: 1,
    players: [player('me', 0), player('rival', 1)],
    territories: {},
    card_set_redemption_count: 0,
    turn_started_at: startedAt,
    phase_deadline_at: startedAt + 300_000,
    settings: { turn_timer_seconds: 300 } as GameState['settings'],
    ...overrides,
  } as GameState;
}

function hud(startBriefingOpen: boolean) {
  return (
    <MemoryRouter>
      <GameHUD
        onAdvancePhase={() => {}}
        onRedeemCards={() => {}}
        lastCombatLog={[]}
        startBriefingOpen={startBriefingOpen}
      />
    </MemoryRouter>
  );
}

const clock = () => screen.getByText(/^\d+:\d\d$/).textContent;

const setFlag = (on: boolean) =>
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, first_turn_clock_wait_enabled: on } }));

describe('the first turn clock', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    useAuthStore.setState({ user: { user_id: 'me', username: 'me', level: 1, xp: 0, mmr: 1000 } } as never);
    useGameStore.setState({ gameState: makeState(), draftUnitsRemaining: 0, lastCombatResult: null } as never);
  });

  afterEach(() => {
    cleanup();
    setFlag(true);
    vi.useRealTimers();
  });

  it('holds at the full turn while the briefing is open on the player\'s first turn', () => {
    setFlag(true);
    render(hud(true));
    expect(clock()).toBe('5:00');
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(clock()).toBe('5:00');
  });

  it('counts down once the briefing closes', () => {
    setFlag(true);
    const { rerender } = render(hud(true));
    rerender(hud(false));
    expect(clock()).toBe('4:20');
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(clock()).toBe('4:17');
  });

  it('counts down on a later turn, and on someone else\'s first turn', () => {
    setFlag(true);
    useGameStore.setState({ gameState: makeState({ turn_number: 2 }) } as never);
    const { unmount } = render(hud(true));
    expect(clock()).toBe('4:20');
    unmount();

    useGameStore.setState({ gameState: makeState({ current_player_index: 1 }) } as never);
    render(hud(true));
    expect(clock()).toBe('4:20');
  });

  it('counts down behind the briefing as before with the flag off', () => {
    setFlag(false);
    render(hud(true));
    expect(clock()).toBe('4:20');
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(clock()).toBe('4:17');
  });
});
