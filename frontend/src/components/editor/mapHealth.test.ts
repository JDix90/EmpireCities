import { describe, it, expect } from 'vitest';
import { evaluateMapHealth, mapComponents, type MapHealthInput } from '@borderfall/shared';

function ring(n: number, regionId = 'r1'): MapHealthInput {
  const territories = Array.from({ length: n }, (_, i) => ({
    territory_id: `t_${i}`,
    name: `Province ${i + 1}`,
    region_id: regionId,
  }));
  const connections = territories.map((t, i) => ({
    from: t.territory_id,
    to: territories[(i + 1) % n].territory_id,
    type: 'land',
  }));
  return {
    name: 'Ring Map',
    description: 'Seven provinces in a circle',
    era_theme: 'medieval',
    territories,
    connections,
    regions: [{ region_id: regionId, name: 'The Ring', bonus: 3 }],
  };
}

const codes = (input: MapHealthInput) => evaluateMapHealth(input).issues.map((i) => i.code);

describe('evaluateMapHealth', () => {
  it('is ready for a connected ring with a described, tagged map', () => {
    const report = evaluateMapHealth(ring(7));
    expect(report.ready).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.components).toEqual([ring(7).territories.map((t) => t.territory_id)]);
  });

  it('counts what a small draft still needs', () => {
    const report = evaluateMapHealth(ring(3));
    expect(report.ready).toBe(false);
    expect(report.blockers.map((b) => b.message)).toEqual([
      'Add 3 more territories — a map needs at least 6 (has 3)',
      'Add 2 more connections — a map needs at least 5 (has 3)',
    ]);
  });

  it('points the disconnected blocker at the unreachable territories, by name', () => {
    const input = ring(7);
    const loose = input.territories[6].territory_id;
    input.connections = input.connections.filter((c) => c.from !== loose && c.to !== loose);
    const report = evaluateMapHealth(input);
    const issue = report.blockers.find((b) => b.code === 'disconnected');
    expect(issue?.territoryIds).toEqual([loose]);
    expect(issue?.message).toContain('"Province 1"');
    expect(issue?.message).toContain('Province 7');
    expect(report.components.map((c) => c.length)).toEqual([6, 1]);
    // The same territory also earns the more actionable warning.
    expect(report.warnings.find((w) => w.code === 'isolated_territory')?.territoryIds).toEqual([loose]);
  });

  it('flags duplicate and self-loop connections and unknown endpoints', () => {
    const input = ring(7);
    const [first] = input.connections;
    input.connections.push({ from: first.to, to: first.from, type: 'land' });
    input.connections.push({ from: 't_0', to: 't_0', type: 'land' });
    input.connections.push({ from: 't_0', to: 'ghost', type: 'sea' });
    expect(codes(input)).toEqual(
      expect.arrayContaining(['duplicate_connection', 'self_loop', 'unknown_endpoint']),
    );
  });

  it('flags an empty region once and a thin bonus region with its members', () => {
    const input = ring(7);
    input.regions.push({ region_id: 'r_ghost', name: 'Ghost', bonus: 5 });
    input.territories[0].region_id = 'r_lone';
    input.regions.push({ region_id: 'r_lone', name: 'Lone Isle', bonus: 2 });
    const report = evaluateMapHealth(input);
    expect(report.blockers.filter((b) => b.regionIds?.includes('r_ghost'))).toHaveLength(1);
    const thin = report.blockers.find((b) => b.code === 'thin_bonus_region');
    expect(thin?.regionIds).toEqual(['r_lone']);
    expect(thin?.territoryIds).toEqual(['t_0']);
    expect(thin?.message).toContain('"Lone Isle" has a +2 bonus but only 1 territory');
  });

  it('lets a region without a bonus hold a single territory', () => {
    const input = ring(7);
    input.territories[0].region_id = 'r_lone';
    input.regions.push({ region_id: 'r_lone', name: 'Landmark', bonus: 0 });
    expect(evaluateMapHealth(input).blockers).toEqual([]);
  });

  it('catches a shared geometry code drawn unclipped twice', () => {
    const input = ring(7);
    input.territories[0].iso_codes = ['FR'];
    input.territories[1].iso_codes = ['FR'];
    const issue = evaluateMapHealth(input).blockers.find((b) => b.code === 'shared_geo_code');
    expect(issue?.territoryIds).toEqual(['t_0', 't_1']);
    input.territories[0].clip_bbox = [0, 0, 1, 1];
    input.territories[1].clip_bbox = [1, 1, 2, 2];
    expect(codes(input)).not.toContain('shared_geo_code');
  });

  it('warns about duplicate names and tips about the hub card', () => {
    const input = ring(7);
    input.territories[1].name = 'province 1';
    input.description = '';
    input.era_theme = '';
    const report = evaluateMapHealth(input);
    expect(report.ready).toBe(true);
    expect(report.warnings.map((w) => w.code)).toEqual(['duplicate_territory_name']);
    expect(report.warnings[0].territoryIds).toEqual(['t_0', 't_1']);
    expect(report.tips.map((t) => t.code)).toEqual(['no_description', 'no_era_tag']);
  });

  it('asks for a name of three characters', () => {
    const input = ring(7);
    input.name = 'Hi';
    expect(codes(input)).toContain('name_short');
  });
});

describe('mapComponents', () => {
  it('groups by reachability, largest first, ignoring edges to unknown ids', () => {
    const components = mapComponents(['a', 'b', 'c', 'd'], [
      { from: 'a', to: 'b' },
      { from: 'c', to: 'zz' },
      { from: 'd', to: 'd' },
    ]);
    expect(components).toEqual([['a', 'b'], ['c'], ['d']]);
  });
});
