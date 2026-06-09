import { describe, expect, it } from 'vitest';
import { computeMapDensityMetrics } from './mapInteractionDensity';

describe('computeMapDensityMetrics', () => {
  it('marks sprawling maps as not dense', () => {
    const metrics = computeMapDensityMetrics({
      canvas_width: 1000,
      canvas_height: 700,
      territories: Array.from({ length: 12 }, (_, i) => ({
        territory_id: `t${i}`,
        region_id: 'main',
        center_point: [i * 80, i * 50] as [number, number],
        polygon: [[0, 0], [60, 0], [60, 60], [0, 60]],
      })),
      connections: [],
    });
    expect(metrics.isDense).toBe(false);
    expect(metrics.densityScore).toBeLessThan(0.4);
  });

  it('marks many tightly packed territories as dense', () => {
    const territories = Array.from({ length: 40 }, (_, i) => ({
      territory_id: `t${i}`,
      region_id: 'main',
      center_point: [(i % 8) * 18, Math.floor(i / 8) * 16] as [number, number],
      polygon: [[0, 0], [14, 0], [14, 12], [0, 12]],
    }));
    const connections = territories.flatMap((t, i) => {
      if (i >= territories.length - 1) return [];
      return [{ from: t.territory_id, to: territories[i + 1].territory_id }];
    });

    const metrics = computeMapDensityMetrics({
      canvas_width: 1000,
      canvas_height: 700,
      territories,
      connections,
    });

    expect(metrics.isDense).toBe(true);
    expect(metrics.densityScore).toBeGreaterThan(0.5);
  });
});
