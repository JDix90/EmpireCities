import { isCriticalModal, type ModalData } from '../components/game/ActionModal';
import type { CombatResult } from '../store/gameStore';

/**
 * The turn end: drop the turn's own attack results still waiting in the modal
 * queue. The queue is FIFO and only `queue[0]` renders, so they would surface
 * well into the next turn, as full-screen overlays over moves the player made
 * themselves seconds ago. The HUD's log keeps every line, and on desktop the
 * recap panel's "Your turn" row sums them up (docs/MOBILE_UX_PLAN.md M-12).
 *
 * Removal is by object identity, not index: the queue may have shifted between
 * the attack and the turn ending. A modal the player must acknowledge (a lost
 * capital) is never dropped.
 */
export function dropOwnCombats(queue: ModalData[], ownCombats: readonly CombatResult[]): ModalData[] {
  const folded = new Set<CombatResult>(ownCombats);
  return queue.filter((modal) => {
    if (modal.type !== 'combat') return true;
    if (modal.perspective !== 'attacker') return true;
    if (isCriticalModal(modal)) return true;
    return !folded.has(modal.result);
  });
}

