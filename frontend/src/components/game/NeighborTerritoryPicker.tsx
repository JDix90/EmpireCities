import clsx from 'clsx';
import { Anchor, Sword, Rocket, Lock } from 'lucide-react';
import type { NeighborTargetRow } from '../../utils/mapAdjacencyTargets';

interface NeighborTerritoryPickerProps {
  phase: 'attack' | 'fortify';
  sourceName: string;
  neighbors: NeighborTargetRow[];
  denseMap?: boolean;
  compact?: boolean;
  onSelect: (territoryId: string) => void;
  onAttack?: (toTerritoryId: string) => void;
  /** Galaxy: the viewing player can't yet traverse hyperspace lanes. */
  orbitLocked?: boolean;
  /** Why orbit targets are locked (e.g. "Hyperspace travel requires: Hyperspace Chart tech"). */
  orbitLockReason?: string;
}

export default function NeighborTerritoryPicker({
  phase,
  sourceName,
  neighbors,
  denseMap = false,
  compact = false,
  onSelect,
  onAttack,
  orbitLocked = false,
  orbitLockReason,
}: NeighborTerritoryPickerProps) {
  if (neighbors.length === 0) return null;

  const title = phase === 'attack'
    ? `Attack from ${sourceName}`
    : `Fortify from ${sourceName}`;

  return (
    <div className={clsx(
      'rounded-lg border border-bf-border/80 bg-bf-dark/50 space-y-2',
      compact ? 'p-2' : 'p-2.5',
    )}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-bf-muted">
          {title}
        </p>
        {denseMap && (
          <span className="text-[10px] text-amber-300/80 shrink-0">Dense map</span>
        )}
      </div>
      {!compact && (
        <p className="text-[11px] text-bf-muted/90 leading-snug">
          {phase === 'attack'
            ? 'Choose a neighboring territory to attack. These buttons work even when map lines overlap.'
            : 'Choose a neighboring friendly territory to move troops into.'}
        </p>
      )}
      {compact && (
        <p className="text-[10px] text-bf-muted/80 leading-snug">
          {phase === 'attack' ? 'Tap a neighbor to attack' : 'Tap a neighbor to fortify'}
        </p>
      )}
      <div className={clsx(
        compact
          ? 'flex gap-1.5 overflow-x-auto pb-0.5 -mx-0.5 px-0.5 flex-nowrap scrollbar-thin'
          : 'flex flex-wrap gap-1.5',
      )}>
        {neighbors.map((neighbor) => {
          const isOrbit = neighbor.isOrbit;
          const locked = orbitLocked && isOrbit;
          const accent = isOrbit
            ? 'border-violet-600/55 bg-violet-950/40 text-violet-100 hover:border-violet-400/70 hover:bg-violet-900/45'
            : phase === 'attack'
              ? 'border-red-700/50 bg-red-950/35 text-red-100 hover:border-red-500/70 hover:bg-red-900/40'
              : 'border-emerald-700/45 bg-emerald-950/30 text-emerald-100 hover:border-emerald-500/60 hover:bg-emerald-900/35';
          return (
            <div key={neighbor.territoryId} className={clsx('flex items-stretch gap-1', compact && 'shrink-0')}>
              <button
                type="button"
                disabled={locked}
                title={locked ? orbitLockReason : undefined}
                className={clsx(
                  'rounded-md border text-left text-xs transition-colors touch-manipulation',
                  compact ? 'min-h-[32px] px-2 py-1' : 'min-h-[36px] px-2.5 py-1.5',
                  accent,
                  locked && 'opacity-50 cursor-not-allowed',
                )}
                onClick={() => { if (!locked) onSelect(neighbor.territoryId); }}
              >
                <span className={clsx('font-medium flex items-center gap-1', compact ? 'max-w-[8rem]' : 'max-w-[10rem]')}>
                  {isOrbit && <Rocket className="w-3 h-3 shrink-0" aria-hidden="true" />}
                  <span className="truncate min-w-0">{neighbor.name}</span>
                  {locked && <Lock className="w-3 h-3 shrink-0 ml-0.5 opacity-80" aria-hidden="true" />}
                </span>
                <span className="text-[10px] opacity-75 block whitespace-nowrap">
                  {neighbor.unitCount === -1 ? '? units' : `${neighbor.unitCount} units`}
                  {neighbor.isSea ? ' · sea' : ''}
                  {isOrbit ? ` · ${neighbor.targetWorldName ?? 'hyperspace'}` : ''}
                </span>
              </button>
              {phase === 'attack' && onAttack && (
                <button
                  type="button"
                  disabled={locked}
                  title={locked ? orbitLockReason : undefined}
                  className={clsx(
                    'rounded-md border touch-manipulation',
                    isOrbit
                      ? 'border-violet-500/60 bg-violet-900/50 text-violet-100 hover:bg-violet-800/60'
                      : 'border-red-600/60 bg-red-900/50 text-red-100 hover:bg-red-800/60',
                    compact ? 'min-w-[36px] min-h-[32px] px-1.5' : 'min-w-[40px] min-h-[36px] px-2',
                    locked && 'opacity-50 cursor-not-allowed',
                  )}
                  aria-label={
                    locked
                      ? `${neighbor.name} locked — ${orbitLockReason ?? 'hyperspace travel required'}`
                      : isOrbit
                        ? `Hyperspace assault on ${neighbor.targetWorldName ?? neighbor.name}`
                        : `Attack ${neighbor.name}`
                  }
                  onClick={() => { if (!locked) onAttack(neighbor.territoryId); }}
                >
                  {locked ? <Lock className="w-3.5 h-3.5 mx-auto" /> : <Sword className="w-3.5 h-3.5 mx-auto" />}
                </button>
              )}
              {phase === 'fortify' && neighbor.isSea && (
                <span className="self-center text-blue-300/80 px-1" title="Sea connection">
                  <Anchor className="w-3.5 h-3.5" />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
