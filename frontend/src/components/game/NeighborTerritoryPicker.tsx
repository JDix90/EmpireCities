import clsx from 'clsx';
import { Anchor, Sword } from 'lucide-react';
import type { NeighborTargetRow } from '../../utils/mapAdjacencyTargets';

interface NeighborTerritoryPickerProps {
  phase: 'attack' | 'fortify';
  sourceName: string;
  neighbors: NeighborTargetRow[];
  denseMap?: boolean;
  onSelect: (territoryId: string) => void;
  onAttack?: (toTerritoryId: string) => void;
}

export default function NeighborTerritoryPicker({
  phase,
  sourceName,
  neighbors,
  denseMap = false,
  onSelect,
  onAttack,
}: NeighborTerritoryPickerProps) {
  if (neighbors.length === 0) return null;

  const title = phase === 'attack'
    ? `Attack from ${sourceName}`
    : `Fortify from ${sourceName}`;

  return (
    <div className="rounded-lg border border-bf-border/80 bg-bf-dark/50 p-2.5 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-bf-muted">
          {title}
        </p>
        {denseMap && (
          <span className="text-[10px] text-amber-300/80 shrink-0">Dense map</span>
        )}
      </div>
      <p className="text-[11px] text-bf-muted/90 leading-snug">
        {phase === 'attack'
          ? 'Choose a neighboring territory to attack. These buttons work even when map lines overlap.'
          : 'Choose a neighboring friendly territory to move troops into.'}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {neighbors.map((neighbor) => (
          <div key={neighbor.territoryId} className="flex items-stretch gap-1">
            <button
              type="button"
              className={clsx(
                'min-h-[36px] px-2.5 py-1.5 rounded-md border text-left text-xs transition-colors touch-manipulation',
                phase === 'attack'
                  ? 'border-red-700/50 bg-red-950/35 text-red-100 hover:border-red-500/70 hover:bg-red-900/40'
                  : 'border-emerald-700/45 bg-emerald-950/30 text-emerald-100 hover:border-emerald-500/60 hover:bg-emerald-900/35',
              )}
              onClick={() => onSelect(neighbor.territoryId)}
            >
              <span className="font-medium block truncate max-w-[9rem]">{neighbor.name}</span>
              <span className="text-[10px] opacity-75 block">
                {neighbor.unitCount === -1 ? '? units' : `${neighbor.unitCount} units`}
                {neighbor.isSea ? ' · sea' : ''}
              </span>
            </button>
            {phase === 'attack' && onAttack && (
              <button
                type="button"
                className="min-w-[40px] min-h-[36px] px-2 rounded-md border border-red-600/60 bg-red-900/50 text-red-100 hover:bg-red-800/60 touch-manipulation"
                aria-label={`Attack ${neighbor.name}`}
                onClick={() => onAttack(neighbor.territoryId)}
              >
                <Sword className="w-3.5 h-3.5 mx-auto" />
              </button>
            )}
            {phase === 'fortify' && neighbor.isSea && (
              <span className="self-center text-blue-300/80 px-1" title="Sea connection">
                <Anchor className="w-3.5 h-3.5" />
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
