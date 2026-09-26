import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countOwnedLunarTerritories, orbitLockReason, type FrontendMapData } from './orbitAccess';
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

describe('why a player\'s lanes are locked', () => {
  // The galaxy overview, the action list and the territory panel all name the
  // lock with this. Space to Stars is a galaxy-kind board that starts in the
  // Space Age, so the answer there is the Moon ladder — the overview used to
  // say "need Lane Charts" to everyone.
  const load = (id: string) => JSON.parse(
    fs.readFileSync(path.resolve(__dirname, `../../../database/maps/${id}.json`), 'utf-8'),
  ) as FrontendMapData;
  const spaceToStars = load('era_ascension_galaxy');
  const galactic = load('era_galaxy');

  const stateOn = (
    map: FrontendMapData,
    era: string,
    settings: Record<string, unknown>,
    me: Record<string, unknown> = {},
  ): GameState => ({
    era,
    settings: { tech_trees_enabled: true, ...settings },
    era_spine: settings.era_advancement_enabled ? [{ era_id: 'space_age' }, { era_id: 'galaxy_age' }] : undefined,
    players: [
      { player_id: 'me', unlocked_techs: [], ...me },
      { player_id: 'rival', unlocked_techs: [] },
    ],
    territories: Object.fromEntries(
      map.territories.map((t) => [t.territory_id, { territory_id: t.territory_id, owner_id: null, unit_count: 2 }]),
    ),
  } as unknown as GameState);

  const spaceToStarsSettings = { galaxy_corridors_enabled: true, era_advancement_enabled: true };

  it('names the Moon ladder on Space to Stars while the player is still in the Space Age', () => {
    expect(spaceToStars.map_kind).toBe('galaxy');
    const reason = orbitLockReason(spaceToStars, stateOn(spaceToStars, 'space_age', spaceToStarsSettings), 'me', 'space_age');
    expect(reason).toBe('Moon access requires: Lunar Expansion tech + Launch Pad building + launched Space Station');
  });

  it('has nothing to name there once the player has climbed to the Galactic Age', () => {
    // Galactic Age corridors: access is positional, so no gate at all.
    const climbed = stateOn(spaceToStars, 'space_age', spaceToStarsSettings, { current_era_index: 1 });
    expect(orbitLockReason(spaceToStars, climbed, 'me', 'space_age')).toBeNull();
  });

  it('names Lane Charts on the Galactic board only with the corridors kill switch off', () => {
    const legacy = stateOn(galactic, 'galaxy_age', { galaxy_corridors_enabled: false });
    expect(orbitLockReason(galactic, legacy, 'me', 'galaxy_age')).toBe('Hyperspace travel requires: Lane Charts tech');
    const corridors = stateOn(galactic, 'galaxy_age', { galaxy_corridors_enabled: true });
    expect(orbitLockReason(galactic, corridors, 'me', 'galaxy_age')).toBeNull();
  });

  it('has nothing to say on a board with no gate, or before the map loads', () => {
    expect(orbitLockReason(null, stateOn(galactic, 'galaxy_age', {}), 'me', 'galaxy_age')).toBeNull();
    const ancient = { territories: [{ territory_id: 'rome', region_id: 'italia' }], connections: [] } as FrontendMapData;
    expect(orbitLockReason(ancient, stateOn(ancient, 'ancient', {}), 'me', 'ancient')).toBeNull();
  });
});
