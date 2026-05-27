import { describe, it, expect } from 'vitest';
import { resolveEventVisualMode, eventDurationMs, type EventVisualMode } from './mapEventEffects';
import type { MapVisualEvent } from './mapVisualEvents';

function event(partial: Partial<MapVisualEvent>): MapVisualEvent {
  return {
    id: 'test',
    kind: 'event',
    territoryId: 't1',
    ...partial,
  };
}

describe('resolveEventVisualMode', () => {
  it('maps truce variant to truce_pulse', () => {
    expect(resolveEventVisualMode(event({ variant: 'truce' }))).toBe('truce_pulse');
  });

  it('maps stability_change to region_highlight', () => {
    expect(resolveEventVisualMode(event({ variant: 'stability_change' }))).toBe('region_highlight');
  });

  it('maps enemy_units_removed to strike_hit', () => {
    expect(resolveEventVisualMode(event({ variant: 'enemy_units_removed' }))).toBe('strike_hit');
  });

  it('maps global disaster to global_disaster', () => {
    expect(resolveEventVisualMode(event({
      global: true,
      variant: 'region_disaster',
    }))).toBe('global_disaster');
  });

  it('maps draft bonus only to draft_bonus', () => {
    expect(resolveEventVisualMode(event({ units: 3 }))).toBe('draft_bonus');
  });

  it('maps territory deltas to territory_deltas', () => {
    expect(resolveEventVisualMode(event({
      affectedTerritories: [{ territory_id: 't1', delta: -2 }],
    }))).toBe('territory_deltas');
  });

  it('maps regionId to region_highlight', () => {
    expect(resolveEventVisualMode(event({ regionId: 'western_europe' }))).toBe('region_highlight');
  });

  it('defaults global flag to global_disaster', () => {
    expect(resolveEventVisualMode(event({ global: true }))).toBe('global_disaster');
  });
});

describe('eventDurationMs', () => {
  const modes: EventVisualMode[] = [
    'territory_deltas',
    'global_disaster',
    'region_highlight',
    'strike_hit',
    'truce_pulse',
    'draft_bonus',
  ];

  it.each(modes)('returns positive duration for %s', (mode) => {
    expect(eventDurationMs(mode)).toBeGreaterThan(0);
  });
});
