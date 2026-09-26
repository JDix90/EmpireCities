import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  countOwnedLunarTerritories,
  formatOrbitAccessError,
  getOrbitAccessResult,
  getSpaceProgramProgress,
  moonContestOpen,
  orbitLockReason,
  type FrontendMapData,
} from './orbitAccess';
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

describe('the contest rule, mirrored from the server', () => {
  // Once a rival holds lunar ground in a game the Hegemony can win, everyone
  // else can fly on Spaceport Infrastructure and a Launch Pad. The server has
  // enforced this all along; without the mirror the client kept telling players
  // to finish a ladder the game no longer asked them to finish.
  const HEGEMONY = {
    space_age_moon_hegemony_enabled: true,
    allowed_victory_conditions: ['domination', 'lunar_hegemony'],
  };

  const contest = (opts: {
    moonOwner?: string | null;
    myTechs?: string[];
    myPad?: boolean;
    settings?: Record<string, unknown>;
    myFaction?: string;
    launched?: boolean;
  } = {}): GameState => {
    const base = stateWith({
      [lunarIds[0]]: opts.moonOwner === undefined ? 'rival' : opts.moonOwner,
      na_launch_base: 'me',
    });
    if (opts.myPad ?? true) {
      base.territories.na_launch_base = { ...base.territories.na_launch_base, buildings: ['launch_pad'] };
    }
    return {
      ...base,
      era: 'space_age',
      settings: opts.settings ?? HEGEMONY,
      players: [
        {
          player_id: 'me',
          unlocked_techs: opts.myTechs ?? ['sa_launch_pad_tech'],
          faction_id: opts.myFaction,
          space_station_launched: opts.launched,
        },
        { player_id: 'rival', unlocked_techs: [] },
      ],
    } as unknown as GameState;
  };

  describe('when the Moon counts as contested', () => {
    it('opens once a rival holds a single lunar tile', () => {
      expect(moonContestOpen(spaceAge.territories, contest(), 'me')).toBe(true);
    });

    it('stays shut while the Moon is empty', () => {
      expect(moonContestOpen(spaceAge.territories, contest({ moonOwner: null }), 'me')).toBe(false);
    });

    it('is not opened by your own holding', () => {
      expect(moonContestOpen(spaceAge.territories, contest({ moonOwner: 'me' }), 'me')).toBe(false);
    });

    it('stays shut in a game the Hegemony cannot win', () => {
      // The server gates the rule on the victory list as well as the phase.
      const settings = { ...HEGEMONY, allowed_victory_conditions: ['domination'] };
      expect(moonContestOpen(spaceAge.territories, contest({ settings }), 'me')).toBe(false);
      expect(moonContestOpen(spaceAge.territories, contest({ settings: {} }), 'me')).toBe(false);
    });
  });

  describe('what access then costs', () => {
    it('lets a rival fly on Spaceport Infrastructure and a pad alone', () => {
      const res = getOrbitAccessResult(spaceAge, contest(), 'me', 'space_age');
      expect(res).toEqual({ allowed: true, missing: [], contested: true });
    });

    it('still asks for the pad and the tech, named as the server names them', () => {
      const res = getOrbitAccessResult(spaceAge, contest({ myTechs: [], myPad: false }), 'me', 'space_age');
      expect(res.allowed).toBe(false);
      expect(res.missing).toEqual(['Spaceport Infrastructure tech', 'Launch Pad building']);
      expect(formatOrbitAccessError(res, 'space_age_moon')).toBe(
        'The Moon is contested — joining the fight requires: Spaceport Infrastructure tech + Launch Pad building',
      );
    });

    it('leaves the full ladder in place while the Moon is unclaimed', () => {
      const res = getOrbitAccessResult(spaceAge, contest({ moonOwner: null }), 'me', 'space_age');
      expect(res.allowed).toBe(false);
      expect(res.contested).toBeUndefined();
      expect(res.missing).toContain('Lunar Expansion tech');
      expect(formatOrbitAccessError(res, 'space_age_moon')).toMatch(/^Moon access requires:/);
    });
  });

  describe('the Space Program tracker', () => {
    it('cuts the ladder to the two steps the contest asks for', () => {
      const progress = getSpaceProgramProgress(spaceAge, contest({ myPad: false }), 'me', 'space_age');
      expect(progress.contested).toBe(true);
      expect(progress.rungs.map((r) => r.key)).toEqual(['sa_launch_pad_tech', 'launch_pad']);
      expect(progress.allowed).toBe(false);
    });

    it('unlocks with them', () => {
      const progress = getSpaceProgramProgress(spaceAge, contest(), 'me', 'space_age');
      expect(progress.contested).toBe(true);
      expect(progress.allowed).toBe(true);
    });

    it('keeps all five rungs while the Moon is unclaimed', () => {
      const progress = getSpaceProgramProgress(spaceAge, contest({ moonOwner: null }), 'me', 'space_age');
      expect(progress.contested).toBe(false);
      expect(progress.rungs).toHaveLength(5);
    });

    it('changes nothing for someone the shortcut does not help', () => {
      const pioneer = getSpaceProgramProgress(spaceAge, contest({ myFaction: 'lunar_pioneers' }), 'me', 'space_age');
      expect(pioneer.contested).toBe(false);
      const finished = getSpaceProgramProgress(
        spaceAge,
        contest({ myTechs: ['sa_launch_pad_tech', 'sa_space_station', 'sa_lunar_expansion'], launched: true }),
        'me',
        'space_age',
      );
      expect(finished.contested).toBe(false);
      expect(finished.allowed).toBe(true);
      expect(finished.rungs).toHaveLength(5);
    });
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
