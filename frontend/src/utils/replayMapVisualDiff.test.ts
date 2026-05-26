import { describe, it, expect } from 'vitest';
import { diffReplayMapVisuals } from './replayMapVisualDiff';

const players = [
  { player_id: 'p1', color: '#e74c3c' },
  { player_id: 'p2', color: '#3498db' },
];

describe('diffReplayMapVisuals', () => {
  it('returns empty when prev is missing', () => {
    expect(diffReplayMapVisuals(null, { territories: {}, players })).toEqual([]);
  });

  it('detects capture when owner changes', () => {
    const prev = {
      territories: { t1: { owner_id: 'p2', unit_count: 3 } },
      players,
    };
    const next = {
      territories: { t1: { owner_id: 'p1', unit_count: 2 } },
      players,
    };
    const events = diffReplayMapVisuals(prev, next);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('capture');
    expect(events[0]?.territoryId).toBe('t1');
    expect(events[0]?.newOwnerColor).toBe('#e74c3c');
  });

  it('detects reinforce when units increase under same owner', () => {
    const prev = {
      territories: { t1: { owner_id: 'p1', unit_count: 3 } },
      players,
    };
    const next = {
      territories: { t1: { owner_id: 'p1', unit_count: 6 } },
      players,
    };
    const events = diffReplayMapVisuals(prev, next);
    expect(events[0]?.kind).toBe('reinforce');
    expect(events[0]?.units).toBe(3);
  });

  it('detects combat losses when units decrease without owner change', () => {
    const prev = {
      territories: { t1: { owner_id: 'p2', unit_count: 5 } },
      players,
    };
    const next = {
      territories: { t1: { owner_id: 'p2', unit_count: 3 } },
      players,
    };
    const events = diffReplayMapVisuals(prev, next);
    expect(events[0]?.kind).toBe('combat');
    expect(events[0]?.defenderLosses).toBe(2);
  });
});
