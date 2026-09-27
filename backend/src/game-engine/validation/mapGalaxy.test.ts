import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateMapGalaxy, type GalaxyMapDocument } from './mapGalaxy';
import { GALAXY_AGE_FACTIONS } from '../eras';

const MAPS = join(__dirname, '../../../../database/maps');
const load = (name: string): GalaxyMapDocument => JSON.parse(readFileSync(join(MAPS, name), 'utf8'));
const galaxy = load('era_galaxy.json');
const clone = (): GalaxyMapDocument => JSON.parse(JSON.stringify(galaxy));

/** A four-tile, two-world map small enough to reason about. */
function tiny(): GalaxyMapDocument {
  const sq: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 0]];
  return {
    map_kind: 'galaxy',
    worlds: [{ world_id: 'a' }, { world_id: 'b', rules: { vault: { region_id: 'b1' } } }],
    regions: [{ region_id: 'a1' }, { region_id: 'b1' }],
    territories: [
      { territory_id: 'a_x', world_id: 'a', region_id: 'a1', geo_polygon: sq },
      { territory_id: 'a_y', world_id: 'a', region_id: 'a1' },
      { territory_id: 'b_x', world_id: 'b', region_id: 'b1' },
      { territory_id: 'b_y', world_id: 'b', region_id: 'b1' },
    ],
    connections: [
      { from: 'a_x', to: 'a_y', type: 'land' },
      { from: 'b_x', to: 'b_y', type: 'land' },
      { from: 'a_y', to: 'b_x', type: 'orbit' },
    ],
  };
}

describe('validateMapGalaxy', () => {
  it('passes the shipped galaxy boards', () => {
    expect(validateMapGalaxy(galaxy, GALAXY_AGE_FACTIONS)).toEqual([]);
    expect(validateMapGalaxy(load('era_ascension_galaxy.json'))).toEqual([]);
    expect(validateMapGalaxy(tiny(), [
      { faction_id: 'fa', home_region_ids: ['a1'] },
      { faction_id: 'fb', home_region_ids: ['b1'] },
    ])).toEqual([]);
  });

  it('ignores maps that are not galaxies', () => {
    expect(validateMapGalaxy({ ...tiny(), map_kind: undefined, worlds: [] })).toEqual([]);
  });

  it('flags a missing or undeclared world_id', () => {
    const m = tiny();
    delete m.territories[0].world_id;
    m.territories[1].world_id = 'c';
    const errs = validateMapGalaxy(m).join('\n');
    expect(errs).toMatch(/a_x has no world_id/);
    expect(errs).toMatch(/a_y is on undeclared world "c"/);
  });

  it('flags a world its lanes alone hold together', () => {
    const m = tiny();
    m.connections = m.connections.filter((c) => !(c.from === 'b_x' && c.to === 'b_y'));
    m.connections.push({ from: 'a_x', to: 'b_y', type: 'orbit' });
    expect(validateMapGalaxy(m).join('\n')).toMatch(/world "b" is split without its lanes: b_y/);
  });

  it('flags an orbit lane inside a world and a land edge between worlds', () => {
    const m = tiny();
    m.connections.push({ from: 'b_x', to: 'b_y', type: 'orbit' });
    m.connections.push({ from: 'a_x', to: 'b_y', type: 'land' });
    const errs = validateMapGalaxy(m).join('\n');
    expect(errs).toMatch(/orbit lane b_x–b_y does not leave world "b"/);
    expect(errs).toMatch(/land edge a_x–b_y crosses worlds/);
  });

  it('flags undeclared, empty and world-spanning regions', () => {
    const m = tiny();
    m.regions!.push({ region_id: 'empty' });
    m.territories[0].region_id = 'ghost';
    m.territories[1].region_id = 'b1';
    const errs = validateMapGalaxy(m).join('\n');
    expect(errs).toMatch(/a_x is in undeclared region "ghost"/);
    expect(errs).toMatch(/region "empty" has no territories/);
    expect(errs).toMatch(/region "b1" spans worlds/);
  });

  it('flags a vault region that is not on its world', () => {
    const m = tiny();
    m.worlds![1].rules = { vault: { region_id: 'a1' } };
    expect(validateMapGalaxy(m).join('\n')).toMatch(/vault region "a1" is not a populated region on that world/);
  });

  it('flags the silent homeworld fallback: split, missing and shared homes', () => {
    const m = tiny();
    const errs = validateMapGalaxy(m, [
      { faction_id: 'split', home_region_ids: ['a1', 'b1'] },
      { faction_id: 'lost', home_region_ids: ['nowhere'] },
      { faction_id: 'first', home_region_ids: ['a1'] },
      { faction_id: 'second', home_region_ids: ['a1'] },
    ]).join('\n');
    expect(errs).toMatch(/split home regions do not resolve to one world \(a, b\)/);
    expect(errs).toMatch(/lost home regions do not resolve to one world \(missing or empty: nowhere\)/);
    expect(errs).toMatch(/factions first and second share homeworld "a"/);
  });

  it('catches the Nexus Vault emptying that the stale generator caused', () => {
    const m = clone();
    for (const t of m.territories) if (t.region_id === 'nexus_gate_ring') t.region_id = 'nexus_vault_ward';
    const errs = validateMapGalaxy(m, GALAXY_AGE_FACTIONS).join('\n');
    expect(errs).toMatch(/region "nexus_gate_ring" has no territories/);
    expect(errs).toMatch(/vault region "nexus_gate_ring"/);
    expect(errs).toMatch(/home regions do not resolve to one world \(missing or empty: nexus_gate_ring\)/);
  });

  it('flags open and out-of-range geo polygons', () => {
    const m = tiny();
    m.territories[0].geo_polygon = [[0, 0], [1, 0], [1, 1], [0, 1]];
    m.territories[1].geo_polygon = [[0, 0], [200, 0], [1, 1], [0, 0]];
    const errs = validateMapGalaxy(m).join('\n');
    expect(errs).toMatch(/a_x geo_polygon is not closed/);
    expect(errs).toMatch(/a_y geo_polygon has a coordinate outside/);
  });

  it('flags a world that unlocks piecemeal', () => {
    const m = tiny();
    m.territories[2].unlock_era_index = 1;
    expect(validateMapGalaxy(m).join('\n')).toMatch(/world "b" mixes unlock_era_index values: 1, undefined/);
  });
});
