import { describe, it, expect } from 'vitest';
import { canUndoDraftOnTerritory, draftUndoTerritoryId } from './draftUndo';

describe('draft undo placement', () => {
  it('resolves to the territory of the most recent placement', () => {
    expect(draftUndoTerritoryId([{ territory_id: 'a', units: 2 }, { territory_id: 'b', units: 1 }])).toBe('b');
  });

  it('is null when nothing has been placed this turn', () => {
    expect(draftUndoTerritoryId([])).toBeNull();
    expect(draftUndoTerritoryId(undefined)).toBeNull();
    expect(draftUndoTerritoryId(null)).toBeNull();
  });

  it('offers Undo only on the territory the last placement landed on', () => {
    const log = [{ territory_id: 'a', units: 2 }, { territory_id: 'b', units: 1 }];
    expect(canUndoDraftOnTerritory(log, 'b')).toBe(true);
    // Earlier placement this turn — Undo would NOT revert these units.
    expect(canUndoDraftOnTerritory(log, 'a')).toBe(false);
    // Never placed on this turn.
    expect(canUndoDraftOnTerritory(log, 'c')).toBe(false);
  });

  it('hides Undo everywhere with no placements or no selection', () => {
    expect(canUndoDraftOnTerritory([], 'a')).toBe(false);
    expect(canUndoDraftOnTerritory([{ territory_id: 'a', units: 1 }], null)).toBe(false);
  });
});
