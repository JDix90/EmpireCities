import { describe, it, expect } from 'vitest';
import { analyzeMapStructure, articulationPoints, suggestRegionBonus } from '@borderfall/shared';

const t = (id: string, region = 'r1') => ({ territory_id: id, name: id.toUpperCase(), region_id: region });
const c = (from: string, to: string) => ({ from, to, type: 'land' });

describe('articulationPoints', () => {
  it('finds the middle of a path and nothing on a ring', () => {
    const adj = (edges: Array<[string, string]>) => {
      const m = new Map<string, Set<string>>();
      for (const [a, b] of edges) {
        (m.get(a) ?? m.set(a, new Set()).get(a)!).add(b);
        (m.get(b) ?? m.set(b, new Set()).get(b)!).add(a);
      }
      return m;
    };
    expect([...articulationPoints(['a', 'b', 'c'], adj([['a', 'b'], ['b', 'c']]))]).toEqual(['b']);
    expect(articulationPoints(['a', 'b', 'c'], adj([['a', 'b'], ['b', 'c'], ['c', 'a']])).size).toBe(0);
  });
});

describe('analyzeMapStructure', () => {
  // Two triangles joined by a single bridge territory: a classic two-region map.
  const input = {
    territories: [t('a', 'west'), t('b', 'west'), t('c', 'west'), t('d', 'east'), t('e', 'east'), t('f', 'east'), t('g', 'east')],
    connections: [
      c('a', 'b'), c('b', 'c'), c('c', 'a'),
      c('c', 'd'),
      c('d', 'e'), c('e', 'f'), c('f', 'd'), c('f', 'g'),
    ],
    regions: [
      { region_id: 'west', name: 'West', bonus: 5 },
      { region_id: 'east', name: 'East', bonus: 2 },
    ],
  };

  it('measures regions: size, borders, entrances, suggested bonus, defensibility', () => {
    const report = analyzeMapStructure(input);
    const west = report.regions.find((r) => r.region_id === 'west')!;
    expect(west).toMatchObject({ size: 3, borderTerritories: 1, entrances: 1, suggestedBonus: 2, defensibility: 3 });
    expect(west.payoutPerTerritory).toBeCloseTo(5 / 3);
    const east = report.regions.find((r) => r.region_id === 'east')!;
    expect(east).toMatchObject({ size: 4, borderTerritories: 1, entrances: 1 });
  });

  it('names the chokepoints and dead ends, and measures the distances', () => {
    const report = analyzeMapStructure(input);
    expect(report.chokepoints.sort()).toEqual(['c', 'd', 'f']);
    expect(report.deadEnds).toEqual(['g']);
    expect(report.diameter).toBe(4); // a → c → d → f → g
    expect(report.meanDistance).toBeGreaterThan(1);
    expect(report.degree.max).toBe(3);
  });

  it('writes notes a map maker can act on', () => {
    const codes = analyzeMapStructure(input).notes.map((n) => n.code);
    expect(codes).toContain('rich_region'); // West pays +5 for 3
    expect(codes).toContain('chokepoints');
    expect(codes).not.toContain('dead_ends'); // one dead end is not a pattern
  });

  it('leaves the distances null on a split map', () => {
    const report = analyzeMapStructure({
      territories: [t('a'), t('b'), t('c')],
      connections: [c('a', 'b')],
      regions: [{ region_id: 'r1', name: 'R', bonus: 1 }],
    });
    expect(report.diameter).toBeNull();
    expect(report.meanDistance).toBeNull();
  });

  it('flags an exposed region and a fortress', () => {
    // Hub-and-spoke: region X is one territory with four ways in; region Y a tight block.
    const report = analyzeMapStructure({
      territories: [t('hub', 'x'), t('h2', 'x'), t('y1', 'y'), t('y2', 'y'), t('y3', 'y'), t('y4', 'y'), t('z1', 'z'), t('z2', 'z')],
      connections: [
        c('hub', 'h2'),
        c('hub', 'y1'), c('hub', 'z1'), c('h2', 'z2'), c('hub', 'z2'),
        c('y1', 'y2'), c('y2', 'y3'), c('y3', 'y4'), c('y4', 'y1'),
        c('z1', 'z2'),
      ],
      regions: [
        { region_id: 'x', name: 'X', bonus: 1 },
        { region_id: 'y', name: 'Y', bonus: 2 },
        { region_id: 'z', name: 'Z', bonus: 1 },
      ],
    });
    const codes = report.notes.map((n) => n.code);
    expect(codes).toContain('exposed_region');
    expect(codes).toContain('fortress_region');
    expect(report.notes.find((n) => n.code === 'fortress_region')?.regionIds).toEqual(['y']);
  });
});

describe('suggestRegionBonus', () => {
  it('lands on the classic board within one, and never pays a lone territory', () => {
    expect(suggestRegionBonus(9, 3)).toBe(5);
    expect(suggestRegionBonus(12, 5)).toBe(7);
    expect(suggestRegionBonus(1, 1)).toBe(0);
  });
});
