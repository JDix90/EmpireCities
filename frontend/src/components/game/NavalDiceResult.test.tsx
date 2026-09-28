import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import NavalDiceResult from './NavalDiceResult';
import { useGameStore, type NavalCombatResult } from '../../store/gameStore';

const battle: NavalCombatResult = {
  fromId: 'britain', toId: 'france',
  attacker_rolls: [6, 4, 2], defender_rolls: [5, 3],
  attacker_losses: 0, defender_losses: 2, attacker_won: true,
  attackerName: 'Admiral', defenderName: 'Rival',
};

describe('NavalDiceResult', () => {
  it('shows both sides’ dice as fleet dice, with losses in fleets', () => {
    render(<NavalDiceResult result={battle} attackerName="Admiral" defenderName="Rival" />);
    const block = screen.getByTestId('naval-dice-result');
    expect(block).toHaveTextContent('Fleet battle');
    expect(screen.getByLabelText('Attacking fleets rolled 6, 4, 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Defending fleets rolled 5, 3')).toBeInTheDocument();
    expect(block).toHaveTextContent('Lost 2 fleets');
    expect(block).toHaveTextContent('Every defending fleet sunk');
    // Round tokens, unlike the square land dice.
    expect(screen.getByText('6').className).toContain('rounded-full');
  });
});

describe('game store: fleet battle lifetime', () => {
  it('keeps the fleet battle for its own landing and drops it for any other battle', () => {
    const { setLastNavalCombat, setLastCombatResult } = useGameStore.getState();
    const land = (fromId: string, toId: string) => ({
      attacker_rolls: [3], defender_rolls: [2], attacker_losses: 0, defender_losses: 1,
      territory_captured: false, fromId, toId,
    });
    setLastNavalCombat(battle);
    setLastCombatResult(land('britain', 'france'));
    expect(useGameStore.getState().lastNavalCombat).toBe(battle);
    setLastCombatResult(land('spain', 'portugal'));
    expect(useGameStore.getState().lastNavalCombat).toBeNull();
  });
});
