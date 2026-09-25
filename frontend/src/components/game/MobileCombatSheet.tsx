import { X } from 'lucide-react';
import { CombatResultView, type CombatModalData, type DismissReason } from './ActionModal';

/**
 * The player's own attack result on a phone (docs/MOBILE_UX_PLAN.md M-12,
 * phase 3): the same dice, callouts and Attack again / Blitz as the desktop
 * card, anchored above the bottom bar instead of centred over the map. It is
 * not modal: there is no backdrop and the map stays live behind it, so the
 * territory that just changed hands is on screen while the result is read.
 * It goes away on Done, on the next attack, on a map selection or when the
 * phase turns over; GamePage owns those rules. Done is the one tap the
 * overlay budget counts, as tier 2; the card's own Continue button stays on
 * the desktop, where there is no map to tap instead.
 */
export default function MobileCombatSheet({
  data,
  viewKey,
  onDismiss,
  onRepeatCombat,
  onBlitzCombat,
}: {
  data: CombatModalData | null;
  /** Changes with each result, so a repeat of the same battle rolls its dice again. */
  viewKey?: number;
  onDismiss: (reason?: DismissReason) => void;
  onRepeatCombat?: (fromId: string, toId: string) => void;
  onBlitzCombat?: (fromId: string, toId: string) => void;
}) {
  if (!data) return null;
  const repeat = data.repeatAttack;
  return (
    <div
      data-testid="combat-sheet"
      role="dialog"
      aria-label="Your attack"
      className="fixed mobile-sheet-above-nav inset-x-0 z-[38] max-h-[55vh] overflow-y-auto rounded-t-2xl border-t border-bf-border bg-bf-surface/[0.97] shadow-2xl animate-slide-up px-3 pt-3 pb-2"
    >
      <button
        type="button"
        onClick={() => onDismiss()}
        className="absolute top-1 right-1 min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full text-bf-muted hover:text-bf-text"
        aria-label="Done"
        data-testid="combat-sheet-done"
      >
        <X className="w-4 h-4" />
      </button>
      <CombatResultView
        key={viewKey}
        compact
        result={data.result}
        perspective="attacker"
        onDismiss={onDismiss}
        autoAdvance={data.autoAdvance}
        hurry={data.autoAdvance}
        repeatAttack={repeat}
        onRepeatAttack={
          repeat && onRepeatCombat
            ? () => {
                onDismiss('action');
                onRepeatCombat(repeat.fromId, repeat.toId);
              }
            : undefined
        }
        onBlitzAttack={
          repeat && onBlitzCombat
            ? () => {
                onDismiss('action');
                onBlitzCombat(repeat.fromId, repeat.toId);
              }
            : undefined
        }
      />
    </div>
  );
}
