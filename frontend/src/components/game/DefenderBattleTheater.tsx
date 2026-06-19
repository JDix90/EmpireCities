import { useEffect } from 'react';
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
/** Queue depth at which incoming attacks drain at fast-combat speed. */
const HURRY_THRESHOLD = 4;

export default function DefenderBattleTheater({
  queue,
  onAdvance,
  onSkipAll,
}: {
  queue: CombatResult[];
  onAdvance: () => void;
  /** Clear the whole backlog at once (this theater + any modals + globe queue). */
  onSkipAll?: () => void;
}) {
  const current = queue[0];
  const hurry = queue.length >= HURRY_THRESHOLD;

  // Keyboard parity with the blocking combat modals (which dismiss on
  // Enter/Space/Escape): desktop players expect the same keys to skip the
  // theater. Guards: never steal keys from chat or other inputs, and yield
  // to a blocking modal that already handled the event (those handlers
  // call preventDefault before dismissing).
  useEffect(() => {
    if (!current) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
        e.preventDefault();
        onAdvance();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [current, onAdvance]);

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
          hurry={hurry}
        />
        {queue.length > 1 && (
          onSkipAll ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onSkipAll(); }}
              className="block mx-auto mt-2 text-center text-xs text-bf-muted hover:text-bf-gold transition-colors"
            >
              Skip {queue.length - 1} more {queue.length - 1 === 1 ? 'battle' : 'battles'} →
            </button>
          ) : (
            <p className="text-center text-xs text-bf-muted mt-2">
              +{queue.length - 1} more {queue.length - 1 === 1 ? 'battle' : 'battles'}
            </p>
          )
        )}
      </div>
    </div>
  );
}
