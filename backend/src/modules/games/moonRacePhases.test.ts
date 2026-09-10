import { describe, it, expect } from 'vitest';
import {
  CreateGameSchema,
  resolveMoonRacePhases,
  lanesContestableRejection,
} from './games.routes';
import { featureFlags, type MoonRacePhaseFlags } from '../../config/featureFlags';
import { normalizeGameSettings } from '../../game-engine/state/gameSettings';

/**
 * How the Moon Race reaches a game (docs/space-age-moon/README.md §10.2).
 *
 * The package is not optional and is not a game mode: the lunar economy, the
 * gated tier and the Hegemony victory ARE the Space Age, so every Space Age game
 * gets every phase the operator has shipped. What these tests guard is that the
 * only surviving switch is the operator's, that it cannot be reached from a
 * create request, and that the phases actually survive the trip into a game —
 * both of those fail silently.
 */

const NONE: MoonRacePhaseFlags = {
  space_age_moon_helium3_enabled: false,
  space_age_moon_gated_tier_enabled: false,
  space_age_moon_hegemony_enabled: false,
  space_age_moon_missions_enabled: false,
  space_age_moon_blockade_enabled: false,
};
const ALL: MoonRacePhaseFlags = {
  space_age_moon_helium3_enabled: true,
  space_age_moon_gated_tier_enabled: true,
  space_age_moon_hegemony_enabled: true,
  space_age_moon_missions_enabled: true,
  space_age_moon_blockade_enabled: true,
};

describe('every Space Age game gets every shipped phase', () => {
  it('turns on all of them, with nothing to opt out of', () => {
    const res = resolveMoonRacePhases({ isSpaceAge: true, shipped: ALL });
    expect(res.enabled).toBe(true);
    expect(res.phases).toEqual(ALL);
  });

  it('turns on ONLY the phases named in the shipped record', () => {
    // The resolver stays per-phase even though the flag no longer is: it writes
    // the SETTINGS a game is baked with, and those are read one at a time by the
    // code implementing each phase. A partial record cannot come from
    // featureFlags today (see below), but the contract is what keeps the bake
    // honest if that ever changes.
    const res = resolveMoonRacePhases({
      isSpaceAge: true,
      shipped: { ...NONE, space_age_moon_helium3_enabled: true, space_age_moon_hegemony_enabled: true },
    });
    expect(res.phases).toEqual({
      space_age_moon_helium3_enabled: true,
      space_age_moon_hegemony_enabled: true,
    });
  });

  it('leaves a Space Age game untouched while every phase is dark', () => {
    // No longer the shipping state — this is what the KILL SWITCH buys. With
    // the flag off, a Space Age create is byte-identical to one made before the
    // package existed, and games already running keep their baked settings.
    expect(resolveMoonRacePhases({ isSpaceAge: true, shipped: NONE })).toEqual({
      enabled: false,
      phases: {},
    });
  });

  it('writes phases as true-or-absent, never an explicit false', () => {
    // normalizeGameSettings persists a phase key only when it is on, so a
    // written `false` round-trips to undefined and makes any settings
    // comparison in between disagree with what the game will actually run.
    const res = resolveMoonRacePhases({
      isSpaceAge: true,
      shipped: { ...NONE, space_age_moon_helium3_enabled: true },
    });
    expect(Object.values(res.phases)).toEqual([true]);
  });
});

describe('the Moon Race is a Space Age package', () => {
  it('resolves to nothing in every other era, however much is shipped', () => {
    const res = resolveMoonRacePhases({ isSpaceAge: false, shipped: ALL });
    expect(res.enabled).toBe(false);
    expect(res.phases).toEqual({});
  });
});

describe('the phases survive the trip into a game', () => {
  it('persists every shipped phase through normalizeGameSettings', () => {
    // The whitelist trap: normalizeGameSettings names its fields one by one and
    // silently drops anything else, then re-runs on every room load. A phase key
    // missing from it makes the whole phase inert with nothing failing.
    const settings = normalizeGameSettings({
      fog_of_war: false,
      turn_timer_seconds: 300,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: true,
      allowed_victory_conditions: ['domination' as const],
      ...resolveMoonRacePhases({ isSpaceAge: true, shipped: ALL }).phases,
    });
    for (const key of Object.keys(ALL) as (keyof MoonRacePhaseFlags)[]) {
      expect(settings[key]).toBe(true);
    }
  });

  it('arms the Orbital Blockade’s create-boundary permission with the phase', () => {
    // Phase 4 IS lane sealing, so shipping it has to lift the create-boundary
    // rejection that otherwise keeps a galaxy mechanic out of a Space Age game.
    const live = resolveMoonRacePhases({ isSpaceAge: true, shipped: ALL });
    expect(
      lanesContestableRejection({
        lanesContestableEnabled: true,
        isGalacticAge: false,
        spaceAgeBlockade: live.phases.space_age_moon_blockade_enabled === true,
      }),
    ).toBeNull();

    const dark = resolveMoonRacePhases({ isSpaceAge: true, shipped: NONE });
    expect(
      lanesContestableRejection({
        lanesContestableEnabled: true,
        isGalacticAge: false,
        spaceAgeBlockade: dark.phases.space_age_moon_blockade_enabled === true,
      }),
    ).not.toBeNull();
  });
});

describe('a create request cannot reach the Moon Race', () => {
  const payload = (extra: Record<string, unknown>) => ({
    era_id: 'space_age',
    map_id: 'era_space_age',
    max_players: 4,
    settings: {
      turn_timer_seconds: 300,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: true,
      allowed_victory_conditions: ['domination'],
      ...extra,
    },
  });

  it('strips a per-phase key a client tries to set', () => {
    const parsed = CreateGameSchema.safeParse(payload({ space_age_moon_hegemony_enabled: true }));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect('space_age_moon_hegemony_enabled' in parsed.data.settings).toBe(false);
    }
  });

  it('strips the retired moon_race_enabled toggle', () => {
    // An older client may still send it. Zod drops it, and the resolver never
    // looks at a client value, so it cannot decline the era's own mechanic.
    const parsed = CreateGameSchema.safeParse(payload({ moon_race_enabled: false }));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect('moon_race_enabled' in parsed.data.settings).toBe(false);
    }
  });
});

describe('the operator flag as it ships today', () => {
  it('ships the package ON', () => {
    // Promoted once all five phase gates cleared (§§3.8, 4.5, 5.6, 6.5, 7.4).
    // This is the assertion that keeps the repo honest about what players
    // actually see: leaving the code default OFF while production runs on an
    // admin override is how the tree starts lying about the shipped game.
    expect(featureFlags.spaceAgeMoonRaceEnabled).toBe(true);
    expect(featureFlags.moonRacePhases).toEqual(ALL);
  });

  it('still has a kill switch', () => {
    // envOptOut: anything other than the literal string 'false' leaves it on,
    // so the switch is deliberate rather than trippable by an empty or
    // mistyped value.
    const prev = process.env.SPACE_AGE_MOON_RACE_ENABLED;
    try {
      process.env.SPACE_AGE_MOON_RACE_ENABLED = 'false';
      expect(featureFlags.spaceAgeMoonRaceEnabled).toBe(false);
      process.env.SPACE_AGE_MOON_RACE_ENABLED = '';
      expect(featureFlags.spaceAgeMoonRaceEnabled).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.SPACE_AGE_MOON_RACE_ENABLED;
      else process.env.SPACE_AGE_MOON_RACE_ENABLED = prev;
    }
  });

  it('is all-or-nothing: one switch, never a partial package', () => {
    // The five per-phase flags are gone. They offered the illusion of five
    // choices when only one combination was ever right — the gated tier is
    // inert without the economy that prices it, the blockade exists to counter
    // the Hegemony. Whatever the flag reads, every phase agrees with it.
    const values = new Set(Object.values(featureFlags.moonRacePhases));
    expect(values.size).toBe(1);
    expect([...values][0]).toBe(featureFlags.spaceAgeMoonRaceEnabled);
  });
});
