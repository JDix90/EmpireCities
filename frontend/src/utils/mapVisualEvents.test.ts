import { describe, it, expect } from 'vitest';
import { normalizeMapVisualEvent, type MapVisualKind } from './mapVisualEvents';

describe('mapVisualEvents', () => {
  it('preserves the board_transform kind through normalization (the era board morph)', () => {
    const out = normalizeMapVisualEvent({
      id: 'e1',
      kind: 'board_transform',
      territoryId: 'england',
      variant: 'medieval',
      affectedTerritories: [{ territory_id: 'england', delta: 0 }],
    });
    expect(out.kind).toBe('board_transform');
    expect(out.variant).toBe('medieval');
  });

  it('falls back from the legacy `type` field to `kind`', () => {
    const out = normalizeMapVisualEvent({ id: 'e2', type: 'board_transform' as MapVisualKind, territoryId: 't' } as never);
    expect(out.kind).toBe('board_transform');
  });
});
