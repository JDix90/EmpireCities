import { describe, it, expect } from 'vitest';
import { dropOwnCombats } from './modalQueueOps';
import type { ModalData } from '../components/game/ActionModal';
import type { CombatResult } from '../store/gameStore';

function combat(id: string, extra: Partial<CombatResult> = {}): CombatResult {
  return {
    fromId: `from-${id}`,
    toId: `to-${id}`,
    fromName: `From ${id}`,
    toName: `To ${id}`,
    attackerDice: [6],
    defenderDice: [3],
    attackerLosses: 0,
    defenderLosses: 1,
    territoryCaptured: false,
    ...extra,
  } as unknown as CombatResult;
}

function attackerModal(result: CombatResult): ModalData {
  return { type: 'combat', result, perspective: 'attacker' };
}

describe('dropOwnCombats (the turn end)', () => {
  it("drops this turn's own combat modals", () => {
    const a = combat('a');
    const b = combat('b');
    const queue: ModalData[] = [
      { type: 'combat', result: a, perspective: 'attacker' },
      { type: 'combat', result: b, perspective: 'attacker' },
    ];
    expect(dropOwnCombats(queue, [a, b])).toEqual([]);
  });

  it('keeps critical modals, defender cards and other turns', () => {
    const mine = combat('mine');
    const older = combat('older');
    const capital: ModalData = { type: 'combat', result: { ...combat('capital'), capitalLost: true }, perspective: 'defender' };
    const incoming: ModalData = { type: 'combat', result: combat('incoming'), perspective: 'defender' };
    const elimination = { type: 'elimination' } as unknown as ModalData;
    const queue: ModalData[] = [
      elimination,
      capital,
      { type: 'combat', result: mine, perspective: 'attacker' },
      incoming,
      { type: 'combat', result: older, perspective: 'attacker' },
    ];
    expect(dropOwnCombats(queue, [mine])).toEqual([
      elimination,
      capital,
      incoming,
      { type: 'combat', result: older, perspective: 'attacker' },
    ]);
  });

  it("never drops a lost-capital combat, even one of this turn's attacks", () => {
    const capital = combat('capital', { capitalLost: true } as Partial<CombatResult>);
    const queue: ModalData[] = [attackerModal(capital)];
    expect(dropOwnCombats(queue, [capital])).toEqual(queue);
  });

  it('removes by identity, so an equal-looking combat from another turn survives', () => {
    const thisTurn = combat('same');
    const lookalike = combat('same'); // structurally identical, different object
    expect(dropOwnCombats([attackerModal(lookalike)], [thisTurn])).toEqual([attackerModal(lookalike)]);
  });
});
