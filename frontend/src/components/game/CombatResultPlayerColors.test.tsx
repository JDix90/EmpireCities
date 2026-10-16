/**
 * Battle colours by player (`battle_player_colors_enabled`): a battle result
 * drew the attacker in red and the defender in blue, so it read backwards for a
 * player who was blue on the map attacking a red one. With the flag on each
 * side's name and dice take that player's map colour.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { CombatResultView } from './ActionModal';
import { useGameStore, type CombatResult, type GameState } from '../../store/gameStore';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';

function result(overrides: Partial<CombatResult> = {}): CombatResult {
  return {
    attacker_rolls: [6, 5],
    defender_rolls: [4],
    attacker_losses: 0,
    defender_losses: 1,
    territory_captured: false,
    fromId: 'kent',
    toId: 'sussex',
    fromName: 'Kent',
    toName: 'Sussex',
    attackerId: 'me',
    attackerName: 'Me',
    defenderId: 'ai',
    defenderName: 'Baron',
    ...overrides,
  } as CombatResult;
}

const setFlag = (on: boolean) =>
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, battle_player_colors_enabled: on } }));

/** Past the dice settling. */
const settle = () => act(() => { vi.advanceTimersByTime(5_000); });

/** The settled dice under a side's name. */
const diceOf = (nameTestId: string) =>
  Array.from(screen.getByTestId(nameTestId).nextElementSibling!.children) as HTMLElement[];

describe('battle colours by player', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    // The attacker is blue on the map and the defender red: the case that read backwards.
    useGameStore.setState({
      gameState: {
        territories: {},
        players: [
          { player_id: 'me', username: 'Me', color: '#3498db' },
          { player_id: 'ai', username: 'Baron', color: '#e74c3c' },
        ],
      } as unknown as GameState,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    setFlag(false);
    useGameStore.setState({ gameState: null });
  });

  it('draws each side\'s name and dice in that player\'s map colour', () => {
    setFlag(true);
    render(<CombatResultView result={result()} perspective="attacker" onDismiss={() => {}} />);
    settle();
    const attacker = screen.getByTestId('combat-attacker-name');
    const defender = screen.getByTestId('combat-defender-name');
    expect(attacker.style.color).toBe('rgb(52, 152, 219)');
    expect(defender.style.color).toBe('rgb(231, 76, 60)');
    expect(attacker.className).not.toContain('text-red-400');
    for (const die of diceOf('combat-attacker-name')) {
      expect(die.style.backgroundColor).toBe('rgba(52, 152, 219, 0.25)');
      expect(die.className).not.toContain('bg-red-500');
    }
    for (const die of diceOf('combat-defender-name')) {
      expect(die.style.backgroundColor).toBe('rgba(231, 76, 60, 0.25)');
    }
  });

  it('keeps blue for a neutral defender, who has no map colour', () => {
    setFlag(true);
    render(<CombatResultView result={result({ defenderId: 'neutral', defenderName: 'Neutral' })} perspective="attacker" onDismiss={() => {}} />);
    settle();
    const defender = screen.getByTestId('combat-defender-name');
    expect(defender.className).toContain('text-blue-400');
    expect(diceOf('combat-defender-name')[0].className).toContain('bg-blue-500/25');
  });

  it('is red and blue as before with the flag off', () => {
    setFlag(false);
    render(<CombatResultView result={result()} perspective="attacker" onDismiss={() => {}} />);
    settle();
    expect(screen.getByTestId('combat-attacker-name').className).toContain('text-red-400');
    expect(screen.getByTestId('combat-defender-name').className).toContain('text-blue-400');
    expect(diceOf('combat-attacker-name')[0].className).toContain('bg-red-500/25');
    expect(diceOf('combat-attacker-name')[0].style.backgroundColor).toBe('');
  });
});
