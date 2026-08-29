import {
  isCriticalModal,
  type ModalData,
  type TurnSummaryModalData,
} from '../components/game/ActionModal';
import type { CombatResult } from '../store/gameStore';

/**
 * Fold the turn's own attacks into the end-of-turn summary.
 *
 * The modal queue is FIFO and only `queue[0]` renders, so appending the summary
 * left it behind every un-dismissed combat modal from the turn it describes —
 * it surfaced well into the NEXT turn, as a full-screen overlay that ate the
 * click meant for the board. The summary already aggregates the very same
 * `CombatResult` objects those modals carry, so dropping them loses nothing.
 *
 * Removal is by object identity, not index: the queue may have shifted between
 * the attack and the turn ending.
 *
 * The summary goes after any leading critical modals (an elimination or era
 * advance queued in the same tick still lands first), and ahead of everything
 * else, so it reads as the recap of the turn that just ended.
 */
export function replaceOwnCombatsWithSummary(
  queue: ModalData[],
  ownCombats: readonly CombatResult[],
  summary: TurnSummaryModalData,
): ModalData[] {
  const folded = new Set<CombatResult>(ownCombats);
  const remaining = queue.filter((modal) => {
    if (modal.type !== 'combat') return true;
    if (modal.perspective !== 'attacker') return true;
    // Never silently drop a modal the player must acknowledge.
    if (isCriticalModal(modal)) return true;
    return !folded.has(modal.result);
  });

  let insertAt = 0;
  while (insertAt < remaining.length && isCriticalModal(remaining[insertAt])) insertAt += 1;

  return [...remaining.slice(0, insertAt), summary, ...remaining.slice(insertAt)];
}
