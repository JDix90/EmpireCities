import clsx from 'clsx';
import type { MapControlProgress } from '../../utils/mapControl';
import { ERA_LABELS } from '../../constants/gameLobbyLabels';

const eraName = (eraId: string): string => ERA_LABELS[eraId] ?? eraId;

/**
 * "You hold 42% of the map. 65% wins — 10 more territories." ("Your side holds"
 * in a team game.) With era-tied conquest it also says what the plain line
 * would get wrong: that the share does not count for the player yet, that it
 * is about to fall, or that holding it wins only when their turn comes round.
 */
export function describeMapControl(p: MapControlProgress): string {
  const who = p.side ? 'Your side holds' : 'You hold';
  const c = p.conquest;
  if (c?.lockedUntilEraId) {
    return `${who} ${p.heldPct}% of the map. ${p.thresholdPct}% wins once you reach the last era, ${eraName(c.lockedUntilEraId)}.`;
  }
  const next = c?.nextPct != null ? ` Next round ${c.nextPct}% wins.` : '';
  if (p.remaining === 0) {
    return c?.claimAtTurnStart
      ? `${who} ${p.heldPct}% of the map — ${p.thresholdPct}% wins. Hold it until your next turn begins.`
      : `${who} ${p.heldPct}% of the map — ${p.thresholdPct}% wins.`;
  }
  const more = p.remaining === 1 ? '1 more territory' : `${p.remaining} more territories`;
  return `${who} ${p.heldPct}% of the map. ${p.thresholdPct}% wins — ${more}.${next}`;
}

/** Era-tied conquest, in the sidebar: who is about to win, and how the share is moving. */
function ConquestNotes({ progress }: { progress: MapControlProgress }) {
  const c = progress.conquest;
  if (!c) return null;
  const rivals = c.rivalsOnCourse;
  return (
    <>
      {rivals.length > 0 && (
        <p className="text-[11px] text-bf-gold mt-1 leading-snug" data-testid="conquest-rival-on-course" role="status">
          {rivals.join(' and ')} {rivals.length === 1 ? 'holds' : 'hold'} the share that wins, and{' '}
          {rivals.length === 1 ? 'wins' : 'the first to move wins'} when their turn begins. Take territory from them first.
        </p>
      )}
      {c.onCourse && (
        <p className="text-[11px] text-bf-gold mt-1 leading-snug" data-testid="conquest-on-course" role="status">
          You hold the share that wins. Keep it until your next turn begins and the game is yours.
        </p>
      )}
      <p className="text-[10px] text-bf-muted/80 mt-0.5 leading-snug" data-testid="conquest-share-note">
        {c.lockedUntilEraId
          ? `Conquest opens for you in the last era, ${eraName(c.lockedUntilEraId)}. `
          : ''}
        {c.nextPct != null
          ? `The share needed falls to ${c.nextPct}% next round.`
          : c.fallsFromRound != null
            ? `The share needed starts to fall in round ${c.fallsFromRound}.`
            : progress.thresholdPct < c.basePct
              ? ''
              : 'Once a player reaches the last era, the share needed starts to fall.'}
      </p>
    </>
  );
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
        {/* "50%/65%" alone said nothing on a phone, where the sidebar that explains it is behind the menu. */}
        <span className="font-sans text-bf-muted">Map </span>
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
        <span className="text-bf-muted">{progress.side ? 'Map control (your side): ' : 'Map control: '}</span>
        <span className={progress.remaining === 0 ? 'text-bf-gold font-medium' : ''}>
          {progress.heldPct}% of {progress.thresholdPct}%
        </span>
        <span className="text-bf-muted">
          {' · '}{progress.held} of {progress.needed} territories
        </span>
      </p>
      <MapControlBar progress={progress} className="mt-1" />
      <p className="text-[10px] text-bf-muted/80 mt-0.5 leading-snug">
        {progress.conquest?.lockedUntilEraId ? (
          // "22 of its 33 territories to win" would promise a win the player
          // cannot have yet, on a board the eras have still to open.
          <>
            {progress.thresholdPct}% of the map wins once you are in the last era: {progress.needed} of its {progress.total}{' '}
            territories as the map stands, and it grows as the eras open.
          </>
        ) : (
          <>
            Hold {progress.thresholdPct}% of the map{progress.side ? ' as a side' : ''} — {progress.needed} of its {progress.total} territories — to win
            {progress.remaining > 0
              ? `. ${progress.remaining} more to go.`
              : '.'}
          </>
        )}
      </p>
      <ConquestNotes progress={progress} />
    </div>
  );
}
