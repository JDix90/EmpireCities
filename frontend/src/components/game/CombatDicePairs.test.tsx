/**
 * A battle result says how its roll was decided (combat_explain_enabled): the
 * dice compared highest against highest, who won each pair, that a tie goes
 * to the defender, and which dice had nothing to face.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { CombatResultView } from './ActionModal';
import { pairDice } from './CombatDicePairs';
import { useGameStore, type CombatResult, type GameState } from '../../store/gameStore';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';

const emit = vi.fn();
const listeners = new Map<string, (payload: unknown) => void>();
vi.mock('../../services/socket', () => ({
  getSocket: () => ({
    emit,
    on: (event: string, fn: (payload: unknown) => void) => listeners.set(event, fn),
    off: (event: string) => listeners.delete(event),
  }),
}));

describe('pairDice', () => {
  it('pairs highest against highest and gives ties to the defender', () => {
    expect(pairDice([4, 6, 5], [2, 6])).toEqual({
      pairs: [
        { attacker: 6, defender: 6, winner: 'defender', tie: true },
        { attacker: 5, defender: 2, winner: 'attacker', tie: false },
      ],
      attackerUnpaired: 1,
      defenderUnpaired: 0,
    });
  });

  it('counts the defender\'s spare dice when it rolls more', () => {
    expect(pairDice([3], [5, 1])).toMatchObject({ attackerUnpaired: 0, defenderUnpaired: 1, pairs: [{ winner: 'defender', tie: false }] });
  });
});

function result(overrides: Partial<CombatResult> = {}): CombatResult {
  // The review's roll: 6-5-4 against 6-2, one loss each.
  return {
    attacker_rolls: [6, 5, 4],
    defender_rolls: [6, 2],
    attacker_losses: 1,
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
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, combat_explain_enabled: on } }));
const settle = () => act(() => { vi.advanceTimersByTime(5_000); });

describe('the battle result explains its roll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    emit.mockClear();
    listeners.clear();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    useGameStore.setState({
      replayMode: false,
      gameState: {
        game_id: 'g1',
        phase: 'attack',
        current_player_index: 0,
        territories: { kent: { territory_id: 'kent', owner_id: 'me', unit_count: 2 }, sussex: { territory_id: 'sussex', owner_id: 'ai', unit_count: 3 } },
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

  it('says the sixes tied and went to the defender, the 5 beat the 2, and the 4 faced nothing', () => {
    setFlag(true);
    render(<CombatResultView result={result()} perspective="attacker" onDismiss={() => {}} />);
    settle();
    const box = screen.getByTestId('combat-dice-pairs');
    expect(box).toHaveTextContent('Highest against highest · ties go to the defender');
    const pairs = within(box).getAllByTestId('combat-dice-pair');
    expect(pairs.map((p) => p.textContent)).toEqual(['6ties6→ defender', '5beats2']);
    expect(pairs.map((p) => p.dataset.winner)).toEqual(['defender', 'attacker']);
    expect(within(box).getByTestId('combat-unpaired')).toHaveTextContent('1 attacking die had nothing to face');
  });

  it('marks a blitz\'s dice as its last roll', () => {
    setFlag(true);
    render(<CombatResultView result={result({ blitz_exchanges: 4 })} perspective="attacker" onDismiss={() => {}} />);
    settle();
    expect(screen.getByTestId('combat-dice-pairs')).toHaveTextContent('Last roll of 4: highest against highest');
  });

  it('shows the chance of taking it on "Attack again", from the server\'s answer for the board as it stands', () => {
    setFlag(true);
    render(
      <CombatResultView
        result={result()}
        perspective="attacker"
        onDismiss={() => {}}
        repeatAttack={{ fromId: 'kent', toId: 'sussex' }}
        onRepeatAttack={() => {}}
      />,
    );
    settle();
    expect(emit).toHaveBeenCalledWith('game:attack_odds', expect.objectContaining({ gameId: 'g1', pairs: [{ fromId: 'kent', toId: 'sussex' }] }));
    const { requestId } = emit.mock.calls.at(-1)![1] as { requestId: string };
    act(() => listeners.get('game:attack_odds')!({ gameId: 'g1', requestId, odds: [{ fromId: 'kent', toId: 'sussex', p: 0.183 }] }));
    expect(screen.getByTestId('repeat-win-chance')).toHaveTextContent('18% to take');
  });

  it('is the result as before with the flag off: no pairs, no odds asked for', () => {
    setFlag(false);
    render(
      <CombatResultView
        result={result()}
        perspective="attacker"
        onDismiss={() => {}}
        repeatAttack={{ fromId: 'kent', toId: 'sussex' }}
        onRepeatAttack={() => {}}
      />,
    );
    settle();
    expect(screen.queryByTestId('combat-dice-pairs')).toBeNull();
    expect(screen.queryByTestId('repeat-win-chance')).toBeNull();
    expect(emit).not.toHaveBeenCalled();
  });
});
