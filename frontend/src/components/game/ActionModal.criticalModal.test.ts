import { describe, expect, it } from 'vitest';
import { isCriticalModal, type ModalData } from './ActionModal';
import type { CombatResult } from '../../store/gameStore';

// isCriticalModal decides what the "Skip all" backlog flush is allowed to drop.
// Critical = must be acknowledged (kept); everything else is droppable.

function combat(extra: Partial<CombatResult> = {}): ModalData {
  return {
    type: 'combat',
    perspective: 'attacker',
    result: {
      attacker_rolls: [6],
      defender_rolls: [2],
      attacker_losses: 0,
      defender_losses: 1,
      territory_captured: false,
      ...extra,
    } as CombatResult,
  };
}

describe('isCriticalModal', () => {
  it('keeps pivotal modals the player must acknowledge', () => {
    expect(isCriticalModal({ type: 'game_over' } as ModalData)).toBe(true);
    expect(isCriticalModal({ type: 'elimination' } as ModalData)).toBe(true);
    expect(isCriticalModal({ type: 'resign_confirm' } as ModalData)).toBe(true);
    expect(isCriticalModal({ type: 'draft_summary' } as ModalData)).toBe(true);
  });

  it('keeps a lost-capital combat modal', () => {
    expect(isCriticalModal(combat({ territory_captured: true, capitalLost: true }))).toBe(true);
  });

  it('drops ordinary combat results and turn summaries', () => {
    expect(isCriticalModal(combat())).toBe(false);
    expect(isCriticalModal(combat({ territory_captured: true }))).toBe(false);
    expect(isCriticalModal({ type: 'turn_summary' } as ModalData)).toBe(false);
  });

  it('filters a mixed backlog down to only the critical entries', () => {
    const queue: ModalData[] = [
      combat(),
      combat({ territory_captured: true }),
      combat({ capitalLost: true }),
      { type: 'turn_summary' } as ModalData,
      { type: 'game_over' } as ModalData,
    ];
    const kept = queue.filter(isCriticalModal);
    expect(kept).toHaveLength(2);
    expect(kept.map((m) => (m.type === 'combat' ? 'capital' : m.type))).toEqual(['capital', 'game_over']);
  });
});
