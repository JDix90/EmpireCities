import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import DefenderBattleTheater from './DefenderBattleTheater';
import type { CombatResult } from '../../store/gameStore';

function combat(overrides: Partial<CombatResult> = {}): CombatResult {
  return {
    attacker_rolls: [6, 5],
    defender_rolls: [4, 3],
    attacker_losses: 0,
    defender_losses: 2,
    territory_captured: false,
    fromName: 'Gaul',
    toName: 'Italia',
    attackerName: 'AI Bot 1',
    defenderName: 'Me',
    ...overrides,
  } as CombatResult;
}

describe('DefenderBattleTheater', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom has no matchMedia; the dice view consults it via the
    // fast-combat preference (pointer-coarseness heuristic).
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
  });
  afterEach(() => vi.useRealTimers());

  it('renders nothing with an empty queue', () => {
    const { container } = render(<DefenderBattleTheater queue={[]} onAdvance={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the incoming attack with dice and no blocking Continue button', () => {
    render(<DefenderBattleTheater queue={[combat()]} onAdvance={() => {}} />);
    expect(screen.getByText('Incoming Attack!')).toBeTruthy();
    expect(screen.queryByText('Continue')).toBeNull();
    expect(screen.getByText(/Tap to skip/)).toBeTruthy();
  });

  it('auto-advances after the dice settle and the read window passes', () => {
    const onAdvance = vi.fn();
    render(<DefenderBattleTheater queue={[combat()]} onAdvance={onAdvance} />);
    expect(onAdvance).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onAdvance).toHaveBeenCalled();
  });

  it('skips ahead on tap', () => {
    const onAdvance = vi.fn();
    render(<DefenderBattleTheater queue={[combat()]} onAdvance={onAdvance} />);
    fireEvent.click(screen.getByText('Incoming Attack!'));
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('shows how many battles are still queued', () => {
    render(
      <DefenderBattleTheater
        queue={[combat(), combat({ toName: 'Greece' }), combat({ toName: 'Hispania' })]}
        onAdvance={() => {}}
      />,
    );
    expect(screen.getByText('+2 more battles')).toBeTruthy();
  });
});
