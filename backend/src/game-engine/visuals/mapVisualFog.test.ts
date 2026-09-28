import { describe, it, expect } from 'vitest';
import { redactMapVisualForViewer, type MapVisualEventPayload } from './mapVisualEvents';

const reinforce: MapVisualEventPayload = { id: 'v1', kind: 'reinforce', territoryId: 'a', units: 2, totalAfter: 7, playerId: 'p1' };
const fortify: MapVisualEventPayload = { id: 'v2', kind: 'fortify', territoryId: 'b', fromTerritoryId: 'a', units: 3 };

describe('redactMapVisualForViewer', () => {
  it('keeps the numbers for a viewer who can see the territory', () => {
    expect(redactMapVisualForViewer(reinforce, new Set(['a']))).toEqual(reinforce);
  });

  it('strips units and totals for a viewer who cannot, keeping the animation', () => {
    expect(redactMapVisualForViewer(reinforce, new Set(['z']))).toEqual({ id: 'v1', kind: 'reinforce', territoryId: 'a', playerId: 'p1' });
  });

  it('needs both ends of a move in view', () => {
    expect(redactMapVisualForViewer(fortify, new Set(['b'])).units).toBeUndefined();
    expect(redactMapVisualForViewer(fortify, new Set(['a', 'b'])).units).toBe(3);
  });

  it('gives spectators no counts', () => {
    expect(redactMapVisualForViewer(reinforce, null).totalAfter).toBeUndefined();
  });
});
