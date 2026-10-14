/**
 * Battle result (`battle_armies_enabled`): the result showed dice and losses
 * only, so a player had to remember how many armies were left, and a blitz
 * showed its last exchange's dice under every exchange's losses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { CombatResultView } from './ActionModal';
import { useGameStore, type CombatResult, type GameState } from '../../store/gameStore';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';

function result(overrides: Partial<CombatResult> = {}): CombatResult {
  return {
    attacker_rolls: [6, 5, 2],
    defender_rolls: [4, 3],
    attacker_losses: 0,
    defender_losses: 2,
    territory_captured: false,
    fromId: 'kent',
    toId: 'sussex',
    fromName: 'Kent',
    toName: 'Sussex',
    attackerName: 'Me',
    defenderName: 'Baron',
    ...overrides,
  } as CombatResult;
}

function board(kent: number, sussex: number) {
  useGameStore.setState({
    gameState: {
      territories: {
        kent: { territory_id: 'kent', owner_id: 'me', unit_count: kent },
        sussex: { territory_id: 'sussex', owner_id: 'ai', unit_count: sussex },
      },
      players: [],
    } as unknown as GameState,
  });
}

const setFlag = (on: boolean) =>
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, battle_armies_enabled: on } }));

/** Past the dice settling, however many dice rolled. */
const settle = () => act(() => { vi.advanceTimersByTime(5_000); });

describe('battle result armies', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    board(7, 1);
  });
  afterEach(() => {
    vi.useRealTimers();
    setFlag(true);
    useGameStore.setState({ gameState: null });
  });

  it('shows the armies left beside both names once the dice settle, with the flag on', () => {
    setFlag(true);
    render(<CombatResultView result={result()} perspective="attacker" onDismiss={() => {}} />);
    // Not while the dice are still rolling: the board already holds the outcome.
    expect(screen.queryByTestId('combat-from-units')).toBeNull();
    settle();
    expect(screen.getByTestId('combat-from-units').textContent).toBe('7 left');
    expect(screen.getByTestId('combat-to-units').textContent).toBe('1 left');
  });

  it('follows the board, as after an Attack again', () => {
    setFlag(true);
    render(<CombatResultView result={result()} perspective="attacker" onDismiss={() => {}} />);
    settle();
    act(() => board(6, 0));
    expect(screen.getByTestId('combat-from-units').textContent).toBe('6 left');
    expect(screen.getByTestId('combat-to-units').textContent).toBe('0 left');
  });

  it('keeps a fog-hidden count hidden', () => {
    setFlag(true);
    board(7, -1);
    render(<CombatResultView result={result()} perspective="attacker" onDismiss={() => {}} />);
    settle();
    expect(screen.getByTestId('combat-from-units')).toBeTruthy();
    expect(screen.queryByTestId('combat-to-units')).toBeNull();
  });

  it('shows nothing on a replayed incoming attack, which the board may be ahead of', () => {
    setFlag(true);
    render(<CombatResultView result={result()} perspective="defender" onDismiss={() => {}} />);
    settle();
    expect(screen.queryByTestId('combat-from-units')).toBeNull();
  });

  it('labels a blitz\'s dice as the last roll and its losses as the total', () => {
    setFlag(true);
    render(
      <CombatResultView
        result={result({ blitz_exchanges: 6, attacker_losses: 3, defender_losses: 5 })}
        perspective="attacker"
        onDismiss={() => {}}
      />,
    );
    settle();
    expect(screen.getByTestId('combat-last-roll').textContent).toBe('Last roll of 6');
    expect(screen.getByText(/3 troops in all/)).toBeTruthy();
    expect(screen.getByText(/5 defenders in all/)).toBeTruthy();
  });

  it('is the result as before with the flag off', () => {
    setFlag(false);
    render(
      <CombatResultView
        result={result({ blitz_exchanges: 6, attacker_losses: 3 })}
        perspective="attacker"
        onDismiss={() => {}}
      />,
    );
    settle();
    expect(screen.queryByTestId('combat-from-units')).toBeNull();
    expect(screen.queryByTestId('combat-last-roll')).toBeNull();
    expect(screen.queryByText(/in all/)).toBeNull();
  });
});
