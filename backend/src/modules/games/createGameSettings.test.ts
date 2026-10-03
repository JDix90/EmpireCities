import { describe, it, expect, afterEach } from 'vitest';
import { featureFlags } from '../../config/featureFlags';
import { resetAdminConfigCacheForTests, setAdminConfigCacheForTests } from '../../services/adminConfig';
import { GALAXY_FACTIONS_REQUIRED_ERROR } from '../../game-engine/lobby/lobbyEraMapCompatibility';
import {
  ASYNC_TURN_TIMER_ERROR,
  ORBIT_GATED_DEFAULT_MAX_TURNS,
  TERRITORY_DRAFT_FACTIONS_ERROR,
  applyLobbySettingVote,
  bakeCreateGameSettings,
  lobbySettingVoteRejection,
  lobbyVoteBringsAlong,
  rebakeSettingsForMapChange,
  resolveMoonRacePhases,
} from './createGameSettings';

/** What the Custom Game form sends with every advanced feature left off. */
const LOBBY_DEFAULTS = {
  fog_of_war: false,
  allowed_victory_conditions: ['domination' as const],
  turn_timer_seconds: 300,
  initial_unit_count: 3,
  card_set_escalating: true,
  diplomacy_enabled: false,
  combat_dice_cap_enabled: false,
};

const WW2 = { era_id: 'ww2', map_id: 'era_ww2' };
const SPACE = { era_id: 'space_age', map_id: 'era_space_age' };
const created = (theater: typeof WW2, settings: Record<string, unknown> = {}, hasMoon = theater === SPACE) =>
  bakeCreateGameSettings({ ...theater, settings: { ...LOBBY_DEFAULTS, ...settings }, hasMoon }) as unknown as Record<string, unknown>;

/** What the Space Age brings, with whichever Moon Race phases the operator ships. */
const moonRace = resolveMoonRacePhases({ isSpaceAge: true, shipped: featureFlags.moonRacePhases });
const moonRaceKeys = Object.keys(featureFlags.moonRacePhases);

describe('a Map & Era vote re-bakes the settings, as the create route would', () => {
  it('moving to the Space Age brings its systems, its Moon Race and its turn cap', () => {
    const next = rebakeSettingsForMapChange({ settings: created(WW2), from: WW2, to: SPACE, hasMoon: true }) as unknown as Record<string, unknown>;
    expect(next).toEqual(created(SPACE, { economy_enabled: true, tech_trees_enabled: true }));
    expect({ economy: next.economy_enabled, tech: next.tech_trees_enabled, cap: next.max_turns })
      .toEqual({ economy: true, tech: true, cap: ORBIT_GATED_DEFAULT_MAX_TURNS });
    for (const key of Object.keys(moonRace.phases)) expect({ key, on: next[key] }).toEqual({ key, on: true });
  });

  it('leaving the Space Age takes the Moon Race, the lunar victory and the turn cap with it', () => {
    const space = created(SPACE, { economy_enabled: true, tech_trees_enabled: true });
    const next = rebakeSettingsForMapChange({ settings: space, from: SPACE, to: WW2, hasMoon: false }) as unknown as Record<string, unknown>;
    // Economy and Technology Trees stay on: a WW2 lobby may choose them too.
    expect(next).toEqual(created(WW2, { economy_enabled: true, tech_trees_enabled: true }));
    for (const key of [...moonRaceKeys, 'space_age_moon_tribute_enabled', 'space_age_frontiers_enabled', 'lanes_contestable_enabled']) {
      expect({ key, value: next[key] }).toEqual({ key, value: undefined });
    }
    expect(next.allowed_victory_conditions).toEqual(['domination']);
    expect(next.max_turns ?? null).toBeNull();
  });

  it('keeps a turn cap and victory list the lobby chose itself', () => {
    const chosen = created(WW2, { max_turns: 60, allowed_victory_conditions: ['domination', 'capital'] });
    const there = rebakeSettingsForMapChange({ settings: chosen, from: WW2, to: SPACE, hasMoon: true }) as unknown as Record<string, unknown>;
    const back = rebakeSettingsForMapChange({ settings: there, from: SPACE, to: WW2, hasMoon: false }) as unknown as Record<string, unknown>;
    expect(back.max_turns).toBe(60);
    expect(back.allowed_victory_conditions).toEqual(['domination', 'capital']);
  });

  it('drops Era Advancement off an Ancient start, as the move always did', () => {
    const ancient = { era_id: 'ancient', map_id: 'era_ancient' };
    const ea = created(ancient, { era_advancement_enabled: true, economy_enabled: true }, false);
    const next = rebakeSettingsForMapChange({ settings: ea, from: ancient, to: WW2, hasMoon: false }) as unknown as Record<string, unknown>;
    expect(next.era_advancement_enabled ?? false).toBe(false);
  });
});

describe('a settings vote is held to the create-time rules', () => {
  const vote = (settings: Record<string, unknown>, setting: string, value: unknown, theater = WW2) =>
    lobbySettingVoteRejection({ ...theater, settings, setting, value });

  it('refuses Factions in a Territory Draft game', () => {
    expect(vote(created(WW2, { territory_selection: true }), 'factions_enabled', true)).toBe(TERRITORY_DRAFT_FACTIONS_ERROR);
    expect(vote(created(WW2), 'factions_enabled', true)).toBeNull();
  });

  it('refuses a turn timer in an async game, which runs on its own deadline', () => {
    expect(vote(created(WW2, { async_mode: true }), 'turn_timer_seconds', 120)).toBe(ASYNC_TURN_TIMER_ERROR);
    expect(vote(created(WW2), 'turn_timer_seconds', 120)).toBeNull();
  });

  it('refuses turning factions off in the Galactic Age, whose start is one faction per world', () => {
    const galaxy = { era_id: 'galaxy_age', map_id: 'era_galaxy' };
    const settings = { ...LOBBY_DEFAULTS, factions_enabled: true, economy_enabled: true, tech_trees_enabled: true };
    expect(vote(settings, 'factions_enabled', false, galaxy)).toBe(GALAXY_FACTIONS_REQUIRED_ERROR);
    expect(vote(settings, 'fog_of_war', true, galaxy)).toBeNull();
  });

  it('does not blame a vote for a block the lobby already had', () => {
    // Refused at create, but not by this vote: an unrelated change may pass.
    expect(vote({ ...created(WW2), tutorial: true }, 'fog_of_war', true)).toBeNull();
  });

  it('turns Economy on with Naval, as the lobby form does', () => {
    expect(applyLobbySettingVote(created(WW2), 'naval_enabled', true)).toMatchObject({ naval_enabled: true, economy_enabled: true });
    expect(applyLobbySettingVote(created(WW2), 'naval_enabled', false).economy_enabled).toBeUndefined();
  });

  it('says on the proposal what else it turns on', () => {
    expect(lobbyVoteBringsAlong(created(WW2), 'naval_enabled', true)).toBe('turns on Economy & Buildings');
    expect(lobbyVoteBringsAlong(created(WW2, { economy_enabled: true }), 'naval_enabled', true)).toBeNull();
    expect(lobbyVoteBringsAlong(created(WW2), 'map_change', SPACE)).toBe('turns on Economy & Buildings and Technology Trees');
    expect(lobbyVoteBringsAlong(created(WW2), 'fog_of_war', true)).toBeNull();
  });
});

describe('Galactic Age buildings v2 is baked at create from its flag', () => {
  afterEach(() => resetAdminConfigCacheForTests());
  const GALAXY = { era_id: 'galaxy_age', map_id: 'era_galaxy' };
  const galaxyLobby = { factions_enabled: true, economy_enabled: true, tech_trees_enabled: true };

  it('is absent while the flag is off, and never baked outside the Galactic Age', () => {
    expect(created(GALAXY, galaxyLobby).galaxy_buildings_v2).toBeUndefined();
    setAdminConfigCacheForTests({ feature_flags: { galaxy_buildings_v2_enabled: true } });
    expect(created(GALAXY, galaxyLobby).galaxy_buildings_v2).toBe(true);
    expect(created(WW2).galaxy_buildings_v2).toBeUndefined();
    expect(created(SPACE, { economy_enabled: true, tech_trees_enabled: true }).galaxy_buildings_v2).toBeUndefined();
  });

  it('orbital infrastructure (Phase 2) is baked the same way, Space to Stars included', () => {
    expect(created(GALAXY, galaxyLobby).galaxy_orbital_buildings).toBeUndefined();
    setAdminConfigCacheForTests({ feature_flags: { galaxy_orbital_buildings_enabled: true } });
    expect(created(GALAXY, galaxyLobby).galaxy_orbital_buildings).toBe(true);
    const ascension = { era_id: 'space_age', map_id: 'era_ascension_galaxy' };
    expect(created(ascension, { ...galaxyLobby, era_advancement_enabled: true }).galaxy_orbital_buildings).toBe(true);
    expect(created(WW2).galaxy_orbital_buildings).toBeUndefined();
    expect(created(SPACE, { economy_enabled: true, tech_trees_enabled: true }).galaxy_orbital_buildings).toBeUndefined();
  });

  it('garrison doctrines (Phase 3) are baked the same way', () => {
    expect(created(GALAXY, galaxyLobby).galaxy_garrisons).toBeUndefined();
    setAdminConfigCacheForTests({ feature_flags: { galaxy_garrisons_enabled: true } });
    expect(created(GALAXY, galaxyLobby).galaxy_garrisons).toBe(true);
    expect(created(WW2).galaxy_garrisons).toBeUndefined();
    expect(created(SPACE, { economy_enabled: true, tech_trees_enabled: true }).galaxy_garrisons).toBeUndefined();
  });

  it('lane powers (Phase 4) are baked the same way', () => {
    expect(created(GALAXY, galaxyLobby).galaxy_powers).toBeUndefined();
    setAdminConfigCacheForTests({ feature_flags: { galaxy_powers_enabled: true } });
    expect(created(GALAXY, galaxyLobby).galaxy_powers).toBe(true);
    expect(created(WW2).galaxy_powers).toBeUndefined();
    expect(created(SPACE, { economy_enabled: true, tech_trees_enabled: true }).galaxy_powers).toBeUndefined();
  });

  it('the WW2 bots and the bomb are baked only into games that start in WW2', () => {
    expect(created(WW2).ww2_bomb_ai).toBeUndefined();
    setAdminConfigCacheForTests({ feature_flags: { ww2_bomb_ai_enabled: true } });
    expect(created(WW2).ww2_bomb_ai).toBe(true);
    // A WW2 start that climbs onward keeps it; a climb from an earlier era,
    // which reaches WW2 one seat at a time, does not (§5 of the design doc).
    expect(created(WW2, { era_advancement_enabled: true }).ww2_bomb_ai).toBe(true);
    expect(created({ era_id: 'ancient', map_id: 'era_ancient' }, { era_advancement_enabled: true }).ww2_bomb_ai).toBeUndefined();
    expect(created(GALAXY, galaxyLobby).ww2_bomb_ai).toBeUndefined();
    // A lobby cannot set it: the bake owns the key.
    setAdminConfigCacheForTests({ feature_flags: { ww2_bomb_ai_enabled: false } });
    expect(created(WW2, { ww2_bomb_ai: true }).ww2_bomb_ai).toBeUndefined();
  });

  it('the WW2 science line is baked the same way', () => {
    expect(created(WW2).ww2_manhattan_science).toBeUndefined();
    setAdminConfigCacheForTests({ feature_flags: { ww2_manhattan_science_enabled: true } });
    expect(created(WW2).ww2_manhattan_science).toBe(true);
    expect(created(WW2, { era_advancement_enabled: true }).ww2_manhattan_science).toBe(true);
    expect(created({ era_id: 'ancient', map_id: 'era_ancient' }, { era_advancement_enabled: true }).ww2_manhattan_science).toBeUndefined();
    expect(created(GALAXY, galaxyLobby).ww2_manhattan_science).toBeUndefined();
  });

  it('the WW2 atomic arsenal is baked the same way', () => {
    expect(created(WW2).ww2_atomic_arsenal).toBeUndefined();
    setAdminConfigCacheForTests({ feature_flags: { ww2_atomic_arsenal_enabled: true } });
    expect(created(WW2).ww2_atomic_arsenal).toBe(true);
    expect(created(WW2, { era_advancement_enabled: true }).ww2_atomic_arsenal).toBe(true);
    expect(created({ era_id: 'ancient', map_id: 'era_ancient' }, { era_advancement_enabled: true }).ww2_atomic_arsenal).toBeUndefined();
    expect(created(GALAXY, galaxyLobby).ww2_atomic_arsenal).toBeUndefined();
  });

  it('world buildings (Phase 5) are baked the same way', () => {
    expect(created(GALAXY, galaxyLobby).galaxy_world_buildings).toBeUndefined();
    setAdminConfigCacheForTests({ feature_flags: { galaxy_world_buildings_enabled: true } });
    expect(created(GALAXY, galaxyLobby).galaxy_world_buildings).toBe(true);
    expect(created(WW2).galaxy_world_buildings).toBeUndefined();
    expect(created(SPACE, { economy_enabled: true, tech_trees_enabled: true }).galaxy_world_buildings).toBeUndefined();
  });
});
