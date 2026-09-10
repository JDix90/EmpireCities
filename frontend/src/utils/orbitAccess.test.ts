import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countOwnedLunarTerritories, type FrontendMapData } from './orbitAccess';
import type { GameState } from '../store/gameStore';

/**
 * The Moon's own powers are offered on this count, so it runs against the
 * SHIPPED Space Age map rather than a fixture: what matters is that it reads
 * the fields the real board actually carries. The map records `globe_id: moon`
 * and `region_id: lunar_surface` and no `world_id` at all, which is exactly the
 * shape a hand-written fixture is most likely to get wrong.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const spaceAge = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../database/maps/era_space_age.json'), 'utf-8'),
) as FrontendMapData;

const stateWith = (owners: Record<string, string | null>): GameState => ({
  territories: Object.fromEntries(
    spaceAge.territories.map((t) => [
      t.territory_id,
      { territory_id: t.territory_id, owner_id: owners[t.territory_id] ?? null, unit_count: 2, unit_type: 'infantry' },
    ]),
  ),
} as unknown as GameState);

const lunarIds = spaceAge.territories
  .filter((t) => t.territory_id.startsWith('moon_'))
  .map((t) => t.territory_id);

describe('counting a player\'s Moon territories', () => {
  it('finds the shipped lunar surface at all', () => {
    // A guard on the fixture itself: if the map stops carrying nine lunar tiles
    // the assertions below would pass by counting nothing.
    expect(lunarIds.length).toBe(9);
  });

  it('counts only the lunar tiles this player holds', () => {
    const held = lunarIds.slice(0, 4);
    const state = stateWith({
      ...Object.fromEntries(held.map((id) => [id, 'me'])),
      ...Object.fromEntries(lunarIds.slice(4).map((id) => [id, 'rival'])),
    });
    expect(countOwnedLunarTerritories(spaceAge.territories, state, 'me')).toBe(4);
    expect(countOwnedLunarTerritories(spaceAge.territories, state, 'rival')).toBe(5);
  });

  it('does not count Earth, however much of it a player owns', () => {
    const earthIds = spaceAge.territories
      .filter((t) => !t.territory_id.startsWith('moon_'))
      .map((t) => t.territory_id);
    const state = stateWith(Object.fromEntries(earthIds.map((id) => [id, 'me'])));
    expect(earthIds.length).toBeGreaterThan(20);
    expect(countOwnedLunarTerritories(spaceAge.territories, state, 'me')).toBe(0);
  });

  it('counts nothing before the map or the state has loaded', () => {
    const state = stateWith({});
    expect(countOwnedLunarTerritories(undefined, state, 'me')).toBe(0);
    expect(countOwnedLunarTerritories(spaceAge.territories, null, 'me')).toBe(0);
    expect(countOwnedLunarTerritories(spaceAge.territories, state, null)).toBe(0);
  });
});
