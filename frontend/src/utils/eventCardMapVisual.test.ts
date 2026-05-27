import { describe, it, expect } from 'vitest';
import { buildMapVisualFromEventCard } from './eventCardMapVisual';
import type { EventCard } from '../components/game/EventCardModal';

function card(partial: Partial<EventCard>): EventCard {
  return {
    card_id: 'test-card',
    title: 'Test',
    description: 'Test',
    category: 'regional',
    era_id: 'ancient',
    ...partial,
  };
}

describe('buildMapVisualFromEventCard', () => {
  it('returns null without result_summary', () => {
    expect(buildMapVisualFromEventCard(card({}))).toBeNull();
  });

  it('builds global disaster visual', () => {
    const visual = buildMapVisualFromEventCard(card({
      effect: { type: 'region_disaster', target: 'global', value: 1 },
      result_summary: [{ territory_id: '__global__', name: 'All territories', delta: -1 }],
    }));
    expect(visual?.global).toBe(true);
    expect(visual?.kind).toBe('event');
    expect(visual?.variant).toBe('region_disaster');
  });

  it('builds draft bonus without pseudo territories', () => {
    const visual = buildMapVisualFromEventCard(card({
      effect: { type: 'units_added', target: 'self', value: 4 },
      result_summary: [{
        territory_id: '__draft_pool__',
        name: 'Your reinforcement pool',
        delta: 4,
      }],
    }));
    expect(visual?.units).toBe(4);
    expect(visual?.affectedTerritories).toBeUndefined();
    expect(visual?.territoryId).toBe('__global__');
  });

  it('filters draft pool from affected territories', () => {
    const visual = buildMapVisualFromEventCard(card({
      effect: { type: 'units_removed', target: 'region', value: 1, target_id: 'europe' },
      result_summary: [
        { territory_id: '__draft_pool__', name: 'Pool', delta: 2 },
        { territory_id: 't1', name: 'Rome', delta: -1 },
        { territory_id: 't2', name: 'Carthage', delta: -2 },
      ],
    }));
    expect(visual?.affectedTerritories).toEqual([
      { territory_id: 't1', delta: -1 },
      { territory_id: 't2', delta: -2 },
    ]);
    expect(visual?.territoryId).toBe('t1');
    expect(visual?.units).toBe(2);
  });
});
