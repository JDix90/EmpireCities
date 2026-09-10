import { describe, it, expect } from 'vitest';
import type { GameMap, GameState } from '../../types';
import { chooseEmergencySealLane } from './aiBot';

/**
 * Emergency Seal, AI side: close the Nexus lane whose far end holds the biggest
 * rival stack relative to the bot's own gateway — the landing most likely to
 * come — and keep the charge when nothing threatens.
 */
const map = {
  territories: [
    { territory_id: 'nexus_a', world_id: 'nexus_station', region_id: 'r' },
    { territory_id: 'nexus_b', world_id: 'nexus_station', region_id: 'r' },
    { territory_id: 'sol_a', world_id: 'sol', region_id: 'r' },
    { territory_id: 'rust_a', world_id: 'rust', region_id: 'r' },
  ],
  connections: [
    { from: 'nexus_a', to: 'sol_a', type: 'orbit' },
    { from: 'nexus_b', to: 'rust_a', type: 'orbit' },
    { from: 'nexus_a', to: 'nexus_b', type: 'land' },
  ],
} as unknown as GameMap;

function state(units: Record<string, [string | null, number]>): GameState {
  return {
    territories: Object.fromEntries(
      Object.entries(units).map(([id, [owner, n]]) => [id, { territory_id: id, owner_id: owner, unit_count: n }]),
    ),
  } as unknown as GameState;
}

describe('chooseEmergencySealLane', () => {
  it('picks the lane whose far end out-stacks the bot\'s gateway by the most', () => {
    const s = state({ nexus_a: ['p4', 3], sol_a: ['p1', 12], nexus_b: ['p4', 5], rust_a: ['p2', 7] });
    expect(chooseEmergencySealLane(s, map, 'p4')).toEqual({ from: 'nexus_a', to: 'sol_a' });
  });

  it('keeps the charge when no far end is a threat', () => {
    const s = state({ nexus_a: ['p4', 9], sol_a: ['p1', 4], nexus_b: ['p4', 9], rust_a: ['p2', 2] });
    expect(chooseEmergencySealLane(s, map, 'p4')).toBeNull();
  });

  it('ignores lanes whose near end the bot does not hold, and neutral far ends', () => {
    const s = state({ nexus_a: ['p1', 2], sol_a: ['p1', 12], nexus_b: ['p4', 2], rust_a: [null, 6] });
    expect(chooseEmergencySealLane(s, map, 'p4')).toBeNull();
  });
});
