import clsx from 'clsx';
import type { MapControlProgress } from '../../utils/mapControl';

/** "You hold 42% of the map. 65% wins — 10 more territories." */
export function describeMapControl(p: MapControlProgress): string {
  if (p.remaining === 0) return `You hold ${p.heldPct}% of the map — ${p.thresholdPct}% wins.`;
  const more = p.remaining === 1 ? '1 more territory' : `${p.remaining} more territories`;
  return `You hold ${p.heldPct}% of the map. ${p.thresholdPct}% wins — ${more}.`;
}

/** Share of the map held, with a tick where the threshold sits. */
function MapControlBar({ progress, className }: { progress: MapControlProgress; className?: string }) {
  return (
    <span
      className={clsx('relative block h-1.5 rounded-full bg-bf-border overflow-hidden', className)}
      aria-hidden
    >
      <span
        className="absolute inset-y-0 left-0 rounded-full bg-bf-gold"
        style={{ width: `${Math.min(100, progress.heldPct)}%` }}
      />
      <span
        className="absolute inset-y-0 w-0.5 bg-bf-text"
        style={{ left: `calc(${progress.thresholdPct}% - 1px)` }}
      />
    </span>
  );
}

function meterProps(progress: MapControlProgress) {
  return {
    role: 'meter' as const,
    'aria-label': 'Map control',
    'aria-valuemin': 0,
    'aria-valuemax': 100,
    'aria-valuenow': progress.heldPct,
    'aria-valuetext': describeMapControl(progress),
  };
}

/**
 * The top-bar glance: share held against the share that wins. Always on screen,
 * on a phone too — the sidebar that carries the full line sits behind the Menu
 * drawer there.
 */
export function MapControlChip({ progress }: { progress: MapControlProgress }) {
  return (
    <span
      {...meterProps(progress)}
      data-testid="map-control-chip"
      title={describeMapControl(progress)}
      className="shrink-0 inline-flex items-center gap-1.5 text-xs text-bf-muted"
    >
      {/* The bar needs 46px a portrait phone's top bar does not have; the figures carry it there. */}
      <MapControlBar progress={progress} className="w-10 hidden xs:block" />
      <span className="font-mono whitespace-nowrap">
        <span className={progress.remaining === 0 ? 'text-bf-gold font-medium' : 'text-bf-text'}>
          {progress.heldPct}%
        </span>
        /{progress.thresholdPct}%
      </span>
    </span>
  );
}

/** The sidebar's Objectives entry: the same numbers, with the territory count spelled out. */
export function MapControlObjective({ progress }: { progress: MapControlProgress }) {
  return (
    <div className="mb-2" data-testid="map-control-progress" {...meterProps(progress)}>
      <p className="text-xs text-bf-text">
        <span className="text-bf-muted">Map control: </span>
        <span className={progress.remaining === 0 ? 'text-bf-gold font-medium' : ''}>
          {progress.heldPct}% of {progress.thresholdPct}%
        </span>
        <span className="text-bf-muted">
          {' · '}{progress.held} of {progress.needed} territories
        </span>
      </p>
      <MapControlBar progress={progress} className="mt-1" />
      <p className="text-[10px] text-bf-muted/80 mt-0.5 leading-snug">
        Hold {progress.thresholdPct}% of the map — {progress.needed} of its {progress.total} territories — to win
        {progress.remaining > 0
          ? `. ${progress.remaining} more to go.`
          : '.'}
      </p>
    </div>
  );
}
