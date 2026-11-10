import { describe, it, expect } from 'vitest';
import {
  formatClock,
  phoneCountdownVisible,
  secondsUntil,
  turnClockDeadline,
} from './useTurnCountdown';
import type { GameState } from '../store/gameStore';

function state(overrides: Partial<GameState> = {}, settings: Record<string, unknown> = {}): GameState {
  return {
    phase: 'draft',
    current_player_index: 0,
    turn_started_at: 1_000_000,
    phase_deadline_at: 1_300_000,
    players: [{ player_id: 'me', is_ai: false }, { player_id: 'bot', is_ai: true }],
    settings: { turn_timer_seconds: 300, ...settings },
    ...overrides,
  } as unknown as GameState;
}

describe('turnClockDeadline', () => {
  it('reads the server deadline on a human turn', () => {
    expect(turnClockDeadline(state())).toBe(1_300_000);
  });

  it('has no clock in an untimed game (solo_untimed_enabled builds solo games with 0)', () => {
    expect(turnClockDeadline(state({}, { turn_timer_seconds: 0 }))).toBeNull();
  });

  it('has no clock on a bot turn, at game over, or when the server says the clock is off', () => {
    expect(turnClockDeadline(state({ current_player_index: 1 }))).toBeNull();
    expect(turnClockDeadline(state({ phase: 'game_over' }))).toBeNull();
    expect(turnClockDeadline(state({ phase_deadline_at: null }))).toBeNull();
  });

  it('falls back to turn_started_at only when the server sent no deadline field', () => {
    expect(turnClockDeadline(state({ phase_deadline_at: undefined }))).toBe(1_000_000 + 300_000);
  });
});

describe('phone countdown helpers', () => {
  it('rounds up so 0:00 only shows once time is up', () => {
    expect(secondsUntil(10_000, 9_001)).toBe(1);
    expect(secondsUntil(10_000, 10_000)).toBe(0);
    expect(secondsUntil(10_000, 12_000)).toBe(0);
  });

  it('shows the last minute only', () => {
    expect(phoneCountdownVisible(null)).toBe(false);
    expect(phoneCountdownVisible(61)).toBe(false);
    expect(phoneCountdownVisible(60)).toBe(true);
    expect(phoneCountdownVisible(0)).toBe(true);
  });

  it('formats minutes and seconds', () => {
    expect(formatClock(60)).toBe('1:00');
    expect(formatClock(9)).toBe('0:09');
  });
});
