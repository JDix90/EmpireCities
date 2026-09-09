import { describe, it, expect } from 'vitest';
import type { GameState, PlayerState } from '../../types';
import {
  HELIUM3_STOCKPILE_CAP,
  LUNAR_EXPORT_MAX,
  applyHelium3Income,
  applyLunarExport,
  countLunarTerritories,
  getHelium3Income,
  helium3YieldOf,
  isLunarTerritory,
} from './helium3';

/**
 * The Space Age lunar economy. The point of it is that three Moon tiles is a
 * real position rather than a down payment on nine, so most of what these
 * tests pin is the partial case.
 */

type TerritorySeed = {
  id: string;
  owner?: string | null;
  region?: string;
  globe?: 'earth' | 'moon';
  world?: string;
};

function mkState(seeds: TerritorySeed[], over: Partial<GameState> = {}): GameState {
  const territories = Object.fromEntries(
    seeds.map((s) => [
      s.id,
      {
        territory_id: s.id,
        owner_id: s.owner ?? null,
        unit_count: 3,
        buildings: [],
        region_id: s.region,
        globe_id: s.globe,
        world_id: s.world,
      },
    ]),
  );
  return {
    era: 'space_age',
    settings: { space_age_moon_helium3_enabled: true },
    territories,
    players: [
      { player_id: 'p1', helium3: 0, tech_points: 0 },
      { player_id: 'p2', helium3: 0, tech_points: 0 },
    ] as unknown as PlayerState[],
    ...over,
  } as unknown as GameState;
}

/** The authored Space Age Moon: two polar basins plus seven ordinary tiles. */
const FULL_MOON: TerritorySeed[] = [
  { id: 'moon_polar_north', region: 'lunar_surface', globe: 'moon' },
  { id: 'moon_polar_south', region: 'lunar_surface', globe: 'moon' },
  { id: 'moon_mare_imbrium', region: 'lunar_surface', globe: 'moon' },
  { id: 'moon_mare_tranquillitatis', region: 'lunar_surface', globe: 'moon' },
  { id: 'moon_oceanus_procellarum', region: 'lunar_surface', globe: 'moon' },
  { id: 'moon_near_side_north', region: 'lunar_surface', globe: 'moon' },
  { id: 'moon_near_side_south', region: 'lunar_surface', globe: 'moon' },
  { id: 'moon_far_side_north', region: 'lunar_surface', globe: 'moon' },
  { id: 'moon_far_side_south', region: 'lunar_surface', globe: 'moon' },
];

const ownedBy = (owner: string, seeds: TerritorySeed[]) => seeds.map((s) => ({ ...s, owner }));

describe('identifying lunar ground', () => {
  it('reads the Moon off any of the shapes a territory can carry it in', () => {
    // State snapshotted before region_id was denormalized still has to resolve,
    // which is why this goes through the shared inferWorldId rather than
    // checking region_id alone.
    expect(isLunarTerritory({ territory_id: 'moon_polar_north', region_id: 'lunar_surface' } as never)).toBe(true);
    expect(isLunarTerritory({ territory_id: 'x', globe_id: 'moon' } as never)).toBe(true);
    expect(isLunarTerritory({ territory_id: 'x', world_id: 'moon' } as never)).toBe(true);
    expect(isLunarTerritory({ territory_id: 'moon_mare_imbrium' } as never)).toBe(true);
  });

  it('does not mistake Earth for the Moon', () => {
    expect(isLunarTerritory({ territory_id: 'mena_arabia', region_id: 'middle_east_2100' } as never)).toBe(false);
    expect(isLunarTerritory({ territory_id: 'euro_spaceport', region_id: 'europe_2100' } as never)).toBe(false);
  });
});

describe('Helium-3 yield', () => {
  it('pays double at the polar basins', () => {
    // The poles are the Moon's hubs; making them the richest ground is what
    // creates a fight inside the Moon instead of a sweep across it.
    const state = mkState(FULL_MOON);
    expect(helium3YieldOf(state.territories.moon_polar_north)).toBe(2);
    expect(helium3YieldOf(state.territories.moon_polar_south)).toBe(2);
    expect(helium3YieldOf(state.territories.moon_mare_imbrium)).toBe(1);
  });

  it('pays nothing for Earth', () => {
    const state = mkState([{ id: 'mena_arabia', owner: 'p1', region: 'middle_east_2100' }]);
    expect(helium3YieldOf(state.territories.mena_arabia)).toBe(0);
  });

  it('pays a partial holding, which is the whole point', () => {
    // Three ordinary tiles is 3/turn — roughly a sa_fusion_power of tech income
    // once exported, for a player who never takes the other six.
    const state = mkState([
      ...ownedBy('p1', FULL_MOON.slice(2, 5)),
      ...FULL_MOON.slice(5),
    ]);
    expect(getHelium3Income(state, 'p1')).toBe(3);
  });

  it('pays 11 for the whole Moon', () => {
    expect(getHelium3Income(mkState(ownedBy('p1', FULL_MOON)), 'p1')).toBe(11);
  });

  it('splits between two holders rather than going to whoever has more', () => {
    const state = mkState([
      ...ownedBy('p1', [FULL_MOON[0], FULL_MOON[2]]),   // a pole + a mare
      ...ownedBy('p2', [FULL_MOON[1], FULL_MOON[3], FULL_MOON[4]]), // a pole + two mares
    ]);
    expect(getHelium3Income(state, 'p1')).toBe(3);
    expect(getHelium3Income(state, 'p2')).toBe(4);
  });

  it('pays nothing while the phase flag is off', () => {
    const state = mkState(ownedBy('p1', FULL_MOON), {
      settings: { space_age_moon_helium3_enabled: false },
    } as Partial<GameState>);
    expect(getHelium3Income(state, 'p1')).toBe(0);
  });
});

describe('income and the stockpile cap', () => {
  it('credits income at the start of a turn', () => {
    const state = mkState(ownedBy('p1', FULL_MOON));
    expect(applyHelium3Income(state, 'p1')).toBe(11);
    expect(state.players[0].helium3).toBe(11);
  });

  it('clamps at the cap and reports only what it actually credited', () => {
    // The HUD shows the returned figure, so over-reporting here would promise
    // income the player never received.
    const state = mkState(ownedBy('p1', FULL_MOON));
    state.players[0].helium3 = HELIUM3_STOCKPILE_CAP - 4;
    expect(applyHelium3Income(state, 'p1')).toBe(4);
    expect(state.players[0].helium3).toBe(HELIUM3_STOCKPILE_CAP);
  });

  it('credits nothing once already at the cap', () => {
    const state = mkState(ownedBy('p1', FULL_MOON));
    state.players[0].helium3 = HELIUM3_STOCKPILE_CAP;
    expect(applyHelium3Income(state, 'p1')).toBe(0);
    expect(state.players[0].helium3).toBe(HELIUM3_STOCKPILE_CAP);
  });

  it('leaves an Earth-only player alone', () => {
    const state = mkState([{ id: 'mena_arabia', owner: 'p1', region: 'middle_east_2100' }]);
    expect(applyHelium3Income(state, 'p1')).toBe(0);
    expect(state.players[0].helium3).toBe(0);
  });
});

describe('Lunar Export', () => {
  it('converts up to the per-turn maximum, one for one', () => {
    const state = mkState(ownedBy('p1', FULL_MOON));
    state.players[0].helium3 = 12;
    const res = applyLunarExport(state, 'p1');
    expect(res.ok).toBe(true);
    expect(res.converted).toBe(LUNAR_EXPORT_MAX);
    expect(state.players[0].helium3).toBe(12 - LUNAR_EXPORT_MAX);
    expect(state.players[0].tech_points).toBe(LUNAR_EXPORT_MAX);
  });

  it('converts what is there when that is less than the maximum', () => {
    const state = mkState(ownedBy('p1', FULL_MOON));
    state.players[0].helium3 = 2;
    const res = applyLunarExport(state, 'p1');
    expect(res.converted).toBe(2);
    expect(state.players[0].helium3).toBe(0);
    expect(state.players[0].tech_points).toBe(2);
  });

  it('refuses a player who holds no lunar ground', () => {
    // Holding the Moon is the credential. A player who banked He-3 and then
    // lost every tile cannot keep exporting: the Moon is a position, not a
    // permit.
    const state = mkState([
      { id: 'mena_arabia', owner: 'p1', region: 'middle_east_2100' },
      ...ownedBy('p2', FULL_MOON),
    ]);
    state.players[0].helium3 = 20;
    const res = applyLunarExport(state, 'p1');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Moon territory/);
    expect(state.players[0].helium3).toBe(20);
  });

  it('refuses an empty stockpile without spending the turn silently', () => {
    const state = mkState(ownedBy('p1', FULL_MOON));
    const res = applyLunarExport(state, 'p1');
    expect(res.ok).toBe(false);
    expect(state.players[0].tech_points).toBe(0);
  });

  it('refuses while the phase flag is off', () => {
    const state = mkState(ownedBy('p1', FULL_MOON), {
      settings: { space_age_moon_helium3_enabled: false },
    } as Partial<GameState>);
    state.players[0].helium3 = 10;
    expect(applyLunarExport(state, 'p1').ok).toBe(false);
  });

  it('does not touch era-advancement gold', () => {
    // He-3 is its own field precisely so a Moon holder cannot buy era advances
    // with lunar income; special_resource must come out unchanged.
    const state = mkState(ownedBy('p1', FULL_MOON));
    state.players[0].helium3 = 8;
    (state.players[0] as PlayerState).special_resource = 7;
    applyLunarExport(state, 'p1');
    expect((state.players[0] as PlayerState).special_resource).toBe(7);
  });
});

describe('counting lunar ground', () => {
  it('counts only what this player holds', () => {
    const state = mkState([
      ...ownedBy('p1', FULL_MOON.slice(0, 4)),
      ...ownedBy('p2', FULL_MOON.slice(4)),
      { id: 'mena_arabia', owner: 'p1', region: 'middle_east_2100' },
    ]);
    expect(countLunarTerritories(state, 'p1')).toBe(4);
    expect(countLunarTerritories(state, 'p2')).toBe(5);
  });

  it('counts neutral Moon tiles for nobody', () => {
    expect(countLunarTerritories(mkState(FULL_MOON), 'p1')).toBe(0);
  });
});
