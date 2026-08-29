import { describe, it, expect } from 'vitest';
import { replaceOwnCombatsWithSummary } from './modalQueueOps';
import type { ModalData, TurnSummaryModalData } from '../components/game/ActionModal';
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

function summaryFor(combats: CombatResult[]): TurnSummaryModalData {
  return {
    type: 'turn_summary',
    playerName: 'Commander',
    playerColor: '#e74c3c',
    turnNumber: 4,
    combats,
    isOwnTurn: true,
  };
}

describe('replaceOwnCombatsWithSummary', () => {
  it('drops this turn\'s own combat modals and shows the summary instead', () => {
    const a = combat('a');
    const b = combat('b');
    const queue: ModalData[] = [attackerModal(a), attackerModal(b)];
    const summary = summaryFor([a, b]);

    const next = replaceOwnCombatsWithSummary(queue, [a, b], summary);

    expect(next).toEqual([summary]);
  });

  it('shows the summary immediately when the queue is empty', () => {
    const summary = summaryFor([]);
    expect(replaceOwnCombatsWithSummary([], [], summary)).toEqual([summary]);
  });

  it('keeps critical modals ahead of the summary', () => {
    const a = combat('a');
    const elimination = { type: 'elimination', playerName: 'Rival' } as unknown as ModalData;
    const summary = summaryFor([a]);

    const next = replaceOwnCombatsWithSummary([elimination, attackerModal(a)], [a], summary);

    expect(next[0]).toBe(elimination);
    expect(next[1]).toBe(summary);
    expect(next).toHaveLength(2);
  });

  it('never drops a lost-capital combat, even one of this turn\'s attacks', () => {
    const ordinary = combat('ordinary');
    const capital = combat('capital', { capitalLost: true } as Partial<CombatResult>);
    const summary = summaryFor([ordinary, capital]);

    const next = replaceOwnCombatsWithSummary(
      [attackerModal(ordinary), attackerModal(capital)],
      [ordinary, capital],
      summary,
    );

    // The capital modal is critical, so it stays — and being critical it also
    // sits ahead of the summary.
    expect(next.some((m) => m.type === 'combat' && m.result === capital)).toBe(true);
    expect(next.some((m) => m.type === 'combat' && m.result === ordinary)).toBe(false);
  });

  it('leaves unrelated modals queued behind the summary', () => {
    const mine = combat('mine');
    const theirs = combat('theirs');
    const defenderModal: ModalData = { type: 'combat', result: theirs, perspective: 'defender' };
    const summary = summaryFor([mine]);

    const next = replaceOwnCombatsWithSummary([attackerModal(mine), defenderModal], [mine], summary);

    expect(next).toEqual([summary, defenderModal]);
  });

  it('removes by identity, so an equal-looking combat from another turn survives', () => {
    const thisTurn = combat('same');
    const lookalike = combat('same'); // structurally identical, different object
    const summary = summaryFor([thisTurn]);

    const next = replaceOwnCombatsWithSummary([attackerModal(lookalike)], [thisTurn], summary);

    expect(next).toEqual([summary, attackerModal(lookalike)]);
  });

  it('still inserts the summary in lite mode, where no combat modals were queued', () => {
    const a = combat('a');
    const summary = summaryFor([a]);
    expect(replaceOwnCombatsWithSummary([], [a], summary)).toEqual([summary]);
  });
});
