import { describe, it, expect } from 'vitest';
import type { GameMap, GameState, PlayerState } from '../../types';
import {
  AI_DYSON_BEAM_THREAT_UNITS,
  aiHelium3Reserve,
  canAiUseDysonBeam,
  canAiUseOrbitalDrop,
  selectAiDysonBeamTarget,
  selectAiOrbitalDropTarget,
  shouldAiExportHelium3,
} from './aiMoonPowers';

/**
 * The bot's side of the gated tier. The rule that matters most here is the
 * reserve: Phase 1's export fires on any full 5 He-3, so without holding fuel
 * back the stockpile never reaches 6 and neither power is ever used — the
 * measured-neutral sink would silently eat the tier that is supposed to matter.
 */

type Seed = { id: string; owner?: string | null; units?: number; moon?: boolean };

function mkState(seeds: Seed[], over: { helium3?: number; techs?: string[]; settings?: Partial<GameState['settings']> } = {}): GameState {
  const territories = Object.fromEntries(
    seeds.map((s) => [
      s.id,
      {
        territory_id: s.id,
        owner_id: s.owner ?? null,
        unit_count: s.units ?? 3,
        buildings: [],
        region_id: s.moon ? 'lunar_surface' : 'north_america_2100',
        globe_id: s.moon ? 'moon' : 'earth',
      },
    ]),
  );
  return {
    era: 'space_age',
    phase: 'draft',
    settings: {
      space_age_moon_helium3_enabled: true,
      space_age_moon_gated_tier_enabled: true,
      tech_trees_enabled: true,
      ...over.settings,
    },
    territories,
    players: [
      {
        player_id: 'bot',
        helium3: over.helium3 ?? 20,
        tech_points: 0,
        ability_uses: {},
        unlocked_techs: over.techs ?? ['sa_dyson_array'],
      },
      { player_id: 'rival', helium3: 0, ability_uses: {}, unlocked_techs: [] },
    ] as unknown as PlayerState[],
  } as unknown as GameState;
}

const mkMap = (pairs: Array<[string, string]>): GameMap =>
  ({ territories: [], connections: pairs.map(([from, to]) => ({ from, to, type: 'land' })) } as unknown as GameMap);

const MOON: Seed[] = [
  { id: 'moon_polar_north', owner: 'bot', moon: true },
  { id: 'moon_mare_imbrium', owner: 'bot', moon: true },
  { id: 'moon_near_side_north', owner: 'bot', moon: true },
];

describe('choosing a beam target', () => {
  const map = mkMap([
    ['home', 'front'],
    ['home', 'quiet'],
    ['far', 'nowhere'],
  ]);

  it('takes the biggest enemy stack on its own border', () => {
    const state = mkState([
      { id: 'home', owner: 'bot', units: 3 },
      { id: 'front', owner: 'rival', units: 9 },
      { id: 'quiet', owner: 'rival', units: 7 },
    ]);
    expect(selectAiDysonBeamTarget(state, map, 'bot')).toBe('front');
  });

  it('ignores a stack it does not border, however large', () => {
    // The beam is global, but fuel spent on a stack the bot will never reach
    // is fuel wasted.
    const state = mkState([
      { id: 'home', owner: 'bot', units: 3 },
      { id: 'front', owner: 'rival', units: 6 },
      { id: 'nowhere', owner: 'rival', units: 20 },
      { id: 'far', owner: 'rival', units: 2 },
    ]);
    expect(selectAiDysonBeamTarget(state, map, 'bot')).toBe('front');
  });

  it('holds fire below the threat threshold', () => {
    const state = mkState([
      { id: 'home', owner: 'bot', units: 3 },
      { id: 'front', owner: 'rival', units: AI_DYSON_BEAM_THREAT_UNITS - 1 },
    ]);
    expect(selectAiDysonBeamTarget(state, map, 'bot')).toBeNull();
  });

  it('does not target neutral ground', () => {
    const state = mkState([
      { id: 'home', owner: 'bot', units: 3 },
      { id: 'front', owner: null, units: 12 },
    ]);
    expect(selectAiDysonBeamTarget(state, map, 'bot')).toBeNull();
  });
});

describe('choosing a drop target', () => {
  const map = mkMap([['weak', 'siege'], ['strong', 'skirmish'], ['rear', 'weak']]);

  it('reinforces the tile that is most outnumbered', () => {
    const state = mkState([
      { id: 'weak', owner: 'bot', units: 2 },
      { id: 'siege', owner: 'rival', units: 10 },
      { id: 'strong', owner: 'bot', units: 8 },
      { id: 'skirmish', owner: 'rival', units: 9 },
      { id: 'rear', owner: 'bot', units: 1 },
    ]);
    // weak is outnumbered by 8, strong only by 1, and rear borders no enemy at
    // all despite being the smallest stack on the board.
    expect(selectAiOrbitalDropTarget(state, map, 'bot')).toBe('weak');
  });

  it('skips a back-line tile: three units behind the lines are three wasted', () => {
    const state = mkState([
      { id: 'weak', owner: 'bot', units: 9 },
      { id: 'siege', owner: 'rival', units: 2 },
      { id: 'rear', owner: 'bot', units: 1 },
    ]);
    expect(selectAiOrbitalDropTarget(state, map, 'bot')).toBeNull();
  });
});

describe('banking He-3 instead of exporting it', () => {
  const map = mkMap([['home', 'front']]);
  const contested: Seed[] = [
    { id: 'home', owner: 'bot', units: 3 },
    { id: 'front', owner: 'rival', units: 9 },
  ];

  it('saves toward a power it cannot yet afford', () => {
    // The failure this pins: a reserve conditioned on already affording the
    // power reserves nothing at 5 He-3, so the export converts the 5 and the
    // stockpile never climbs to 6.
    const state = mkState([...contested, ...MOON], { helium3: 5 });
    expect(aiHelium3Reserve(state, map, 'bot')).toBe(14);
    expect(shouldAiExportHelium3(state, map, 'bot')).toBe(false);
  });

  it('exports the surplus over what the powers need', () => {
    const state = mkState([...contested, ...MOON], { helium3: 19 });
    expect(shouldAiExportHelium3(state, map, 'bot')).toBe(true);
  });

  it('reserves nothing when there is no target worth firing at', () => {
    // A bot with the tech, the tiles and a quiet border banks nothing and
    // exports exactly as it did in Phase 1.
    const quiet = mkState([
      { id: 'home', owner: 'bot', units: 9 },
      { id: 'front', owner: 'rival', units: 2 },
      ...MOON,
    ], { helium3: 6 });
    expect(aiHelium3Reserve(quiet, map, 'bot')).toBe(0);
    expect(shouldAiExportHelium3(quiet, map, 'bot')).toBe(true);
  });

  it('reserves only the beam when the Moon holding is too small to drop', () => {
    const state = mkState([...contested, MOON[0]], { helium3: 5 });
    expect(aiHelium3Reserve(state, map, 'bot')).toBe(6);
  });

  it('reserves only the drop when the beam tech is unresearched', () => {
    const state = mkState([...contested, ...MOON], { helium3: 5, techs: [] });
    expect(aiHelium3Reserve(state, map, 'bot')).toBe(8);
  });

  it('reserves nothing once both powers are spent this turn', () => {
    const state = mkState([...contested, ...MOON], { helium3: 12 });
    state.players[0].ability_uses = { dyson_beam: 1, orbital_drop: 1 };
    expect(aiHelium3Reserve(state, map, 'bot')).toBe(0);
    expect(shouldAiExportHelium3(state, map, 'bot')).toBe(true);
  });

  it('behaves exactly like Phase 1 while Phase 2 is off', () => {
    const state = mkState([...contested, ...MOON], {
      helium3: 5,
      settings: { space_age_moon_gated_tier_enabled: false },
    });
    expect(aiHelium3Reserve(state, map, 'bot')).toBe(0);
    expect(shouldAiExportHelium3(state, map, 'bot')).toBe(true);
  });

  it('does not export for a player who holds no lunar ground', () => {
    const state = mkState([...contested], { helium3: 30 });
    expect(shouldAiExportHelium3(state, map, 'bot')).toBe(false);
  });
});

describe('what the bot may fire', () => {
  const board: Seed[] = [
    { id: 'home', owner: 'bot', units: 3 },
    { id: 'front', owner: 'rival', units: 9 },
    ...MOON,
  ];

  it('needs the tech for the beam and only the ground for the drop', () => {
    const noTech = mkState(board, { techs: [] });
    expect(canAiUseDysonBeam(noTech, 'bot')).toBe(false);
    expect(canAiUseOrbitalDrop(noTech, 'bot')).toBe(true);
  });

  it('needs the fuel for both', () => {
    const broke = mkState(board, { helium3: 5 });
    expect(canAiUseDysonBeam(broke, 'bot')).toBe(false);
    expect(canAiUseOrbitalDrop(broke, 'bot')).toBe(false);
    const beamOnly = mkState(board, { helium3: 6 });
    expect(canAiUseDysonBeam(beamOnly, 'bot')).toBe(true);
    expect(canAiUseOrbitalDrop(beamOnly, 'bot')).toBe(false);
  });

  it('fires neither with the phase off', () => {
    const off = mkState(board, { settings: { space_age_moon_gated_tier_enabled: false } });
    expect(canAiUseDysonBeam(off, 'bot')).toBe(false);
    expect(canAiUseOrbitalDrop(off, 'bot')).toBe(false);
  });
});
