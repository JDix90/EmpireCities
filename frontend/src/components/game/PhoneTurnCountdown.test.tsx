/**
 * The phone bar's phase button with the last minute of the turn clock
 * (`phone_turn_countdown_enabled`). Without a countdown it is the plain button
 * the bar always had; with one, the digits are a second line hidden from
 * assistive tech and the time left is the button's description.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PhonePhaseButton, phoneCountdownApplies } from './PhoneTurnCountdown';
import type { GameState } from '../../store/gameStore';

const NOW = 5_000_000;

function game(secondsLeft: number, settings: Record<string, unknown> = {}): GameState {
  return {
    phase: 'draft',
    current_player_index: 0,
    turn_started_at: NOW - 1000,
    phase_deadline_at: NOW + secondsLeft * 1000,
    players: [{ player_id: 'me', is_ai: false }],
    settings: { turn_timer_seconds: 300, ...settings },
  } as unknown as GameState;
}

function renderButton(gs: GameState, countdown = true, holdClock = false) {
  return render(
    <PhonePhaseButton label="Begin Attack →" onClick={() => {}} gameState={gs} countdown={countdown} holdClock={holdClock} />,
  );
}

describe('PhonePhaseButton', () => {
  afterEach(() => vi.useRealTimers());

  it('is the plain phase button with more than a minute left', () => {
    vi.useFakeTimers({ now: NOW });
    renderButton(game(120));
    const button = screen.getByRole('button', { name: 'Begin Attack →' });
    expect(button.getAttribute('aria-describedby')).toBeNull();
    expect(screen.queryByTestId('phone-turn-countdown')).toBeNull();
  });

  it('shows the last minute under the label without renaming the button', () => {
    vi.useFakeTimers({ now: NOW });
    renderButton(game(42));
    const button = screen.getByRole('button', { name: 'Begin Attack →' });
    expect(screen.getByTestId('phone-turn-countdown').textContent).toContain('0:42');
    expect(screen.getByTestId('phone-turn-countdown').dataset.urgent).toBeUndefined();
    const description = document.getElementById(button.getAttribute('aria-describedby')!);
    expect(description?.textContent).toBe('42 seconds left in your turn');
  });

  it('turns urgent for the last 15 seconds', () => {
    vi.useFakeTimers({ now: NOW });
    renderButton(game(15));
    expect(screen.getByTestId('phone-turn-countdown').dataset.urgent).toBe('true');
  });

  it('shows nothing when the bar should not count down', () => {
    vi.useFakeTimers({ now: NOW });
    renderButton(game(10), false);
    expect(screen.queryByTestId('phone-turn-countdown')).toBeNull();
  });
});

describe('PhonePhaseButton quiet (first_match_button_emphasis_enabled)', () => {
  it('is plain rather than gold while quiet, and still works', () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <PhonePhaseButton label="Begin Attack →" onClick={onClick} gameState={game(200)} countdown={false} holdClock={false} quiet />,
    );
    const button = screen.getByRole('button', { name: 'Begin Attack →' });
    expect(button.className).toContain('btn-secondary');
    expect(button.className).not.toContain('btn-primary');
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<PhonePhaseButton label="Begin Attack →" onClick={onClick} gameState={game(200)} countdown={false} holdClock={false} />);
    expect(screen.getByRole('button', { name: 'Begin Attack →' }).className).toContain('btn-primary');
  });
});

describe('phoneCountdownApplies', () => {
  it('needs the flag, the viewer’s own turn and a live timed game', () => {
    expect(phoneCountdownApplies(game(30), true, true)).toBe(true);
    expect(phoneCountdownApplies(game(30), true, false)).toBe(false);
    expect(phoneCountdownApplies(game(30), false, true)).toBe(false);
    expect(phoneCountdownApplies(game(30, { turn_timer_seconds: 0 }), true, true)).toBe(false);
    expect(phoneCountdownApplies(game(30, { async_mode: true }), true, true)).toBe(false);
  });
});
