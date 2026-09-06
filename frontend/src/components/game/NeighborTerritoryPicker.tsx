import clsx from 'clsx';
import { Anchor, Sword, Rocket, Lock, Info } from 'lucide-react';
import type { NeighborTargetRow } from '../../utils/mapAdjacencyTargets';
import { plural } from '../../utils/plural';

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
            ? 'Tap a neighbour to attack it, or ⓘ to size it up first. These work even when map lines overlap.'
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
          const isAttack = phase === 'attack' && !!onAttack;
          return (
            <div key={neighbor.territoryId} className={clsx('flex items-stretch gap-1', compact && 'shrink-0')}>
              {/*
                In the attack phase the WIDE button is the attack and the narrow
                one inspects. It used to be the other way round: the ~10rem row
                only navigated to the territory, and the actual attack was a
                36-40px sword beside it. Players (and a scripted playthrough)
                read the row as "attack this", got moved to the target's panel
                instead, and found nothing to press there — which is what pushed
                them into the four-click Select-as-Attacker route.
              */}
              <button
                type="button"
                disabled={locked}
                title={locked ? orbitLockReason : undefined}
                className={clsx(
                  'flex-1 rounded-md border text-left text-xs transition-colors touch-manipulation',
                  compact ? 'min-h-[32px] px-2 py-1' : 'min-h-[36px] px-2.5 py-1.5',
                  accent,
                  locked && 'opacity-50 cursor-not-allowed',
                )}
                aria-label={
                  locked
                    ? `${neighbor.name} locked — ${orbitLockReason ?? 'hyperspace travel required'}`
                    : isAttack
                      ? isOrbit
                        ? `Hyperspace assault on ${neighbor.targetWorldName ?? neighbor.name}`
                        : `Attack ${neighbor.name}`
                      : `Select ${neighbor.name}`
                }
                onClick={() => {
                  if (locked) return;
                  if (isAttack) onAttack!(neighbor.territoryId);
                  else onSelect(neighbor.territoryId);
                }}
              >
                <span className={clsx('font-medium flex items-center gap-1', compact ? 'max-w-[8rem]' : 'max-w-[10rem]')}>
                  {isAttack
                    ? <Sword className="w-3 h-3 shrink-0" aria-hidden="true" />
                    : isOrbit && <Rocket className="w-3 h-3 shrink-0" aria-hidden="true" />}
                  <span className="truncate min-w-0">{neighbor.name}</span>
                  {locked && <Lock className="w-3 h-3 shrink-0 ml-0.5 opacity-80" aria-hidden="true" />}
                </span>
                <span className="text-[10px] opacity-75 block whitespace-nowrap">
                  {neighbor.unitCount === -1 ? '? units' : plural(neighbor.unitCount, 'unit')}
                  {neighbor.isSea ? ' · sea' : ''}
                  {isOrbit ? ` · ${neighbor.targetWorldName ?? 'hyperspace'}` : ''}
                </span>
              </button>
              {isAttack && (
                <button
                  type="button"
                  className={clsx(
                    'rounded-md border touch-manipulation border-bf-border/70 bg-bf-dark/60',
                    'text-bf-muted hover:text-bf-text hover:border-bf-border',
                    compact ? 'min-w-[32px] min-h-[32px] px-1' : 'min-w-[36px] min-h-[36px] px-1.5',
                  )}
                  aria-label={`Inspect ${neighbor.name} before attacking`}
                  title={`Inspect ${neighbor.name}`}
                  onClick={() => onSelect(neighbor.territoryId)}
                >
                  <Info className="w-3.5 h-3.5 mx-auto" />
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
