import { CombatResultView } from './ActionModal';
import type { CombatResult } from '../../store/gameStore';

/**
 * Live, non-blocking presentation of attacks AGAINST the local player,
 * shown during the attacker's turn — the moment the dice are actually
 * rolled, like watching an opponent roll at a real table.
 *
 * Replaces the old behavior of queueing blocking "INCOMING ATTACK!" modals
 * that demanded a Continue click each at the defender's own turn start
 * (after the strike animation, combat log, and recap panel had already
 * reported the same battles). Battles auto-advance after the dice settle;
 * tapping the card skips ahead. No backdrop: the map stays visible and the
 * rest of the screen stays interactive.
 *
 * Capital losses do NOT go through the theater — those still warrant a
 * blocking modal (see the defender branch in GamePage's combat handler).
 */
export default function DefenderBattleTheater({
  queue,
  onAdvance,
}: {
  queue: CombatResult[];
  onAdvance: () => void;
}) {
  const current = queue[0];
  if (!current) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center pointer-events-none px-4">
      <div
        className="pointer-events-auto w-full max-w-md rounded-2xl bg-bf-surface/95 backdrop-blur-sm
                   border border-orange-500/30 shadow-2xl p-5 animate-modal-in cursor-pointer"
        role="status"
        aria-live="polite"
        onClick={onAdvance}
      >
        <CombatResultView
          // Key by identity so each battle restarts the dice animation cleanly.
          key={`${current.fromName}-${current.toName}-${current.attacker_rolls.join('')}-${current.defender_rolls.join('')}`}
          result={current}
          perspective="defender"
          onDismiss={onAdvance}
          autoAdvance
        />
        {queue.length > 1 && (
          <p className="text-center text-xs text-bf-muted mt-2">
            +{queue.length - 1} more {queue.length - 1 === 1 ? 'battle' : 'battles'}
          </p>
        )}
      </div>
    </div>
  );
}
