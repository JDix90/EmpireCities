/**
 * The balance report plays the real engine. A small ring map, two bots, one
 * short game: enough to know the loop runs, ends, and reports in shape.
 */
import { describe, it, expect } from 'vitest';
import type { GameMap } from '../../types';
import { simulateMapBalance } from './mapBalanceSim';

function ringMap(n: number): GameMap {
  const territories = Array.from({ length: n }, (_, i) => ({
    territory_id: `t${i}`,
    name: `Province ${i + 1}`,
    polygon: [[i * 10, 0], [i * 10 + 8, 0], [i * 10 + 8, 8], [i * 10, 8]],
    center_point: [i * 10 + 4, 4] as [number, number],
    region_id: i < n / 2 ? 'west' : 'east',
  }));
  const connections = territories.map((t, i) => ({
    from: t.territory_id,
    to: territories[(i + 1) % n]!.territory_id,
    type: 'land' as const,
  }));
  return {
    map_id: 'balance_ring',
    name: 'Ring',
    description: '',
    era_theme: 'custom',
    canvas_width: 1200,
    canvas_height: 700,
    territories,
    connections,
    regions: [
      { region_id: 'west', name: 'West', bonus: 2 },
      { region_id: 'east', name: 'East', bonus: 2 },
    ],
    is_public: false,
    moderation_status: 'draft',
    creator_id: 'test',
    play_count: 0,
    rating_sum: 0,
    rating_count: 0,
    created_at: new Date(),
  } as unknown as GameMap;
}

describe('simulateMapBalance', () => {
  it('plays bot games on a map and reports seats, rounds, regions and dead zones', async () => {
    const report = await simulateMapBalance(ringMap(8), {
      games: 2,
      seats: 2,
      maxRounds: 6,
      difficulty: 'easy',
      era: 'modern',
      seed: 'test',
    });
    expect(report.gamesPlayed).toBe(2);
    expect(report.seatWins).toHaveLength(2);
    expect(report.seatWins.reduce((s, w) => s + w, 0) + report.unfinished).toBe(2);
    expect(report.rounds.max).toBeGreaterThanOrEqual(1);
    // The cap is a backstop the settings normaliser may raise; the loop guard bounds it either way.
    expect(report.rounds.max).toBeLessThanOrEqual(report.maxRounds + 60);
    expect(report.regions.map((r) => r.region_id).sort()).toEqual(['east', 'west']);
    for (const r of report.regions) {
      expect(r.heldShare).toBeGreaterThanOrEqual(0);
      expect(r.heldShare).toBeLessThanOrEqual(1);
    }
    expect(Object.values(report.endings).reduce((s, n) => s + n, 0)).toBe(2);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it('stops starting games once the deadline has passed, but always plays one', async () => {
    const report = await simulateMapBalance(ringMap(8), {
      games: 5,
      seats: 2,
      maxRounds: 4,
      difficulty: 'easy',
      era: 'modern',
      seed: 'deadline',
      deadlineMs: 0,
    });
    expect(report.gamesPlayed).toBe(1);
    expect(report.gamesRequested).toBe(5);
  }, 60_000);
});
