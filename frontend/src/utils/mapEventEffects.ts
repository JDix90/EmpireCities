import type { MapVisualEvent } from './mapVisualEvents';

export type EventVisualMode =
  | 'territory_deltas'
  | 'global_disaster'
  | 'region_highlight'
  | 'strike_hit'
  | 'truce_pulse'
  | 'draft_bonus';

/** Map event-card effect types to animation behavior. */
export function resolveEventVisualMode(event: MapVisualEvent): EventVisualMode {
  const variant = event.variant ?? '';

  if (variant === 'truce') return 'truce_pulse';
  if (variant === 'stability_change') return 'region_highlight';
  if (variant === 'enemy_units_removed') return 'strike_hit';
  if (variant === 'region_disaster' || (event.global && variant.includes('disaster'))) {
    return 'global_disaster';
  }
  if ((event.units ?? 0) > 0 && !event.affectedTerritories?.length) return 'draft_bonus';
  if (event.affectedTerritories?.length) return 'territory_deltas';
  if (event.global) return 'global_disaster';
  if (event.regionId) return 'region_highlight';
  return 'territory_deltas';
}

export function eventDurationMs(mode: EventVisualMode): number {
  switch (mode) {
    case 'global_disaster':
      return 3600;
    case 'region_highlight':
      return 3000;
    case 'strike_hit':
      return 2800;
    case 'truce_pulse':
      return 2400;
    case 'draft_bonus':
      return 2200;
    default:
      return 3400;
  }
}
