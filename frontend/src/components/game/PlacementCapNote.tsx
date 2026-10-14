/**
 * The stability deploy cap, explained where units are placed
 * (`placement_cap_note_enabled`). Below 50 stability a territory takes only a
 * few units per draft (backend stabilityManager.getDeployCap), and every
 * conquered territory starts at 30, so a player's new ground quietly refused
 * reinforcements with only "stability cap: 3 more here" to say why.
 */

/** Stability at which the deploy cap lifts (stabilityManager: 50 and over is uncapped). */
export const SETTLED_STABILITY = 50;

export interface PlacementCapMessage {
  title: string;
  detail: string;
}

export function placementCapMessage(stability: number | undefined, capLeft: number): PlacementCapMessage {
  const title =
    capLeft > 0
      ? `Unsettled territory: ${capLeft} more ${capLeft === 1 ? 'unit' : 'units'} here this turn`
      : 'Unsettled territory: no more units here this turn';
  const why =
    stability != null
      ? `Stability ${stability}; at ${SETTLED_STABILITY} it takes any number.`
      : `Below ${SETTLED_STABILITY} stability a territory takes only a few units a turn.`;
  const settles =
    "Conquered land starts at 30 and recovers about 5 a turn, faster with 5 or more units on it; events and rivals' influence can knock it back.";
  const rest = capLeft > 0 ? '' : ' Place the rest on settled territory.';
  return { title, detail: `${why} ${settles}${rest}` };
}

export default function PlacementCapNote({ stability, capLeft }: { stability?: number; capLeft: number }) {
  const { title, detail } = placementCapMessage(stability, capLeft);
  return (
    <div
      role="status"
      data-testid="placement-cap-note"
      className="mt-1.5 mb-2 rounded-md border border-amber-500/30 bg-amber-950/30 px-2.5 py-1.5 text-xs leading-snug"
    >
      <p className="font-semibold text-amber-200">{title}</p>
      <p className="mt-0.5 text-amber-100/70">{detail}</p>
    </div>
  );
}
