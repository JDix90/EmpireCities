import { Check, Rocket } from 'lucide-react';
import { getSpaceProgramProgress, type FrontendMapData } from '../../utils/orbitAccess';
import type { GameState } from '../../store/gameStore';

/**
 * The Space Age Moon ladder, always visible while it is still locked.
 *
 * The gate itself was only ever surfaced on a territory panel banner for a
 * selected Moon tile, and the error handler clears the selection before
 * toasting the rejection — so the one place that named the requirements
 * vanished at the moment the player needed it. A player could spend the whole
 * 63-point Space Program branch without the game ever telling them what it
 * was for.
 */
export default function SpaceProgramTracker({
  gameState,
  mapData,
  playerId,
  className,
}: {
  gameState: GameState | null;
  mapData: FrontendMapData | null | undefined;
  playerId: string | null | undefined;
  className?: string;
}) {
  const progress = getSpaceProgramProgress(mapData, gameState, playerId, gameState?.era ?? '');
  if (!progress.applicable) return null;

  if (progress.isLunarPioneer) {
    return (
      <div className={className}>
        <p className="text-xs text-violet-200/90 flex items-center gap-1.5">
          <Rocket className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Moon access unlocked — your colonists never left.
        </p>
      </div>
    );
  }

  if (progress.allowed) {
    return (
      <div className={className}>
        <p className="text-xs text-violet-200/90 flex items-center gap-1.5">
          <Rocket className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          Moon access unlocked — attack across an orbit lane to land.
        </p>
      </div>
    );
  }

  const done = progress.rungs.filter((r) => r.done).length;

  return (
    <div className={className}>
      <div
        className="rounded-lg border border-violet-700/40 bg-violet-950/25 px-2.5 py-2"
        data-testid="space-program-tracker"
      >
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-xs font-semibold text-violet-100 flex items-center gap-1.5">
            <Rocket className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            Space Program
          </h3>
          <span className="text-[11px] text-violet-300/80 tabular-nums">{done}/{progress.rungs.length}</span>
        </div>

        {progress.strandedWithoutPad && (
          <p className="mt-1.5 text-[11px] text-amber-300/90">
            Your Launch Pad is gone. You keep your Moon territories and can still fight and
            reinforce there, but you cannot cross a lane until you build another.
          </p>
        )}

        <ol className="mt-1.5 flex flex-col gap-1">
          {progress.rungs.map((rung) => (
            <li key={rung.key} className="flex items-start gap-1.5 text-[11px] leading-snug">
              <span
                className={`mt-[1px] w-3 h-3 shrink-0 rounded-sm border flex items-center justify-center ${
                  rung.done ? 'border-emerald-500/70 bg-emerald-600/30' : 'border-violet-600/50'
                }`}
                aria-hidden="true"
              >
                {rung.done && <Check className="w-2.5 h-2.5 text-emerald-300" />}
              </span>
              <span className={rung.done ? 'text-violet-300/70 line-through' : 'text-violet-100/90'}>
                {rung.label}
                {rung.detail && (
                  <span className="block text-[10px] text-violet-300/70 no-underline">{rung.detail}</span>
                )}
              </span>
            </li>
          ))}
        </ol>

        <p className="mt-1.5 text-[10px] text-violet-300/70 leading-snug">
          A Launch Pad opens an orbit lane from its own territory. Cape Canaveral, Kourou and
          Gobi already have one.
        </p>
      </div>
    </div>
  );
}
