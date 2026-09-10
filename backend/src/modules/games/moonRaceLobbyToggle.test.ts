import { describe, it, expect } from 'vitest';
import {
  CreateGameSchema,
  resolveMoonRacePhases,
  lanesContestableRejection,
} from './games.routes';
import { featureFlags, type MoonRacePhaseFlags } from '../../config/featureFlags';
import { normalizeGameSettings } from '../../game-engine/state/gameSettings';

/**
 * The Moon Race lobby toggle (docs/space-age-moon/README.md §10.2).
 *
 * One toggle stands for a five-phase package, which puts two promises on it:
 * unticking it gives today's game EXACTLY, and ticking it can never turn on a
 * phase the operator has not shipped. Both are asserted here rather than left
 * to the reader, because the failure modes are silent — a game that quietly
 * runs a dark phase, or a lobby toggle that turns nothing on.
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

describe('the toggle can never outrun the operator', () => {
  it('turns on nothing a dark operator has not shipped', () => {
    const res = resolveMoonRacePhases({ isSpaceAge: true, requested: true, shipped: NONE });
    expect(res.phases).toEqual({});
    // "Wants it" is still true — there is simply nothing behind the toggle.
    expect(res.enabled).toBe(true);
  });

  it('turns on ONLY the phases that are shipped', () => {
    const res = resolveMoonRacePhases({
      isSpaceAge: true,
      requested: true,
      shipped: { ...NONE, space_age_moon_helium3_enabled: true, space_age_moon_hegemony_enabled: true },
    });
    expect(res.phases).toEqual({
      space_age_moon_helium3_enabled: true,
      space_age_moon_hegemony_enabled: true,
    });
  });

  it('writes phases as true-or-absent, never an explicit false', () => {
    // normalizeGameSettings persists a phase key only when it is on, so a
    // written `false` round-trips to undefined and makes any settings
    // comparison in between disagree with what the game will actually run.
    const res = resolveMoonRacePhases({
      isSpaceAge: true,
      requested: true,
      shipped: { ...NONE, space_age_moon_helium3_enabled: true },
    });
    expect(Object.values(res.phases)).toEqual([true]);
  });
});

describe('unticking gives today’s game exactly', () => {
  it('turns off every phase however much the operator ships', () => {
    const res = resolveMoonRacePhases({ isSpaceAge: true, requested: false, shipped: ALL });
    expect(res.enabled).toBe(false);
    expect(res.phases).toEqual({});
  });

  it('leaves a normalized Space Age game byte-identical to one created before the package', () => {
    const base = {
      fog_of_war: false,
      turn_timer_seconds: 300,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: true,
      allowed_victory_conditions: ['domination' as const],
    };
    const declined = normalizeGameSettings({
      ...base,
      ...resolveMoonRacePhases({ isSpaceAge: true, requested: false, shipped: ALL }).phases,
    });
    expect(declined).toEqual(normalizeGameSettings(base));
  });
});

describe('the phases survive the trip into a game', () => {
  it('persists every accepted phase through normalizeGameSettings', () => {
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
      ...resolveMoonRacePhases({ isSpaceAge: true, requested: true, shipped: ALL }).phases,
    });
    for (const key of Object.keys(ALL) as (keyof MoonRacePhaseFlags)[]) {
      expect(settings[key]).toBe(true);
    }
  });
});

describe('what an absent toggle means', () => {
  it('follows the operator, so promoting a flag to ON reaches players', () => {
    // A caller predating the toggle — Quick Match, an older client, a scripted
    // create. Before this existed those games got whatever the flags said, and
    // they still do.
    const res = resolveMoonRacePhases({ isSpaceAge: true, requested: undefined, shipped: ALL });
    expect(res.enabled).toBe(true);
    expect(res.phases).toEqual(ALL);
  });

  it('stays off while every phase is dark', () => {
    expect(resolveMoonRacePhases({ isSpaceAge: true, shipped: NONE })).toEqual({
      enabled: false,
      phases: {},
    });
  });
});

describe('the Moon Race is a Space Age package', () => {
  it('resolves to nothing off the era, even asked for outright', () => {
    const res = resolveMoonRacePhases({ isSpaceAge: false, requested: true, shipped: ALL });
    expect(res.enabled).toBe(false);
    expect(res.phases).toEqual({});
  });
});

describe('what the toggle drags along with it', () => {
  it('closes the Orbital Blockade’s create-boundary hole when declined', () => {
    // Phase 4 is what lets a Space Age create arm lane sealing at all. Decline
    // the race and that permission goes with it, so a client cannot use the
    // toggle to smuggle a galaxy mechanic into a classic Space Age game.
    const declined = resolveMoonRacePhases({ isSpaceAge: true, requested: false, shipped: ALL });
    expect(
      lanesContestableRejection({
        lanesContestableEnabled: true,
        isGalacticAge: false,
        spaceAgeBlockade: declined.phases.space_age_moon_blockade_enabled === true,
      }),
    ).not.toBeNull();

    const accepted = resolveMoonRacePhases({ isSpaceAge: true, requested: true, shipped: ALL });
    expect(
      lanesContestableRejection({
        lanesContestableEnabled: true,
        isGalacticAge: false,
        spaceAgeBlockade: accepted.phases.space_age_moon_blockade_enabled === true,
      }),
    ).toBeNull();
  });
});

describe('the create schema carries the toggle', () => {
  const payload = (moonRace?: boolean) => ({
    era_id: 'space_age',
    map_id: 'era_space_age',
    max_players: 4,
    settings: {
      turn_timer_seconds: 300,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: true,
      allowed_victory_conditions: ['domination'],
      ...(moonRace === undefined ? {} : { moon_race_enabled: moonRace }),
    },
  });

  it('keeps the field instead of silently stripping it', () => {
    // A field missing from this whitelist is dropped by zod, which would make
    // the toggle inert with nothing failing.
    for (const value of [true, false]) {
      const parsed = CreateGameSchema.safeParse(payload(value));
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.settings.moon_race_enabled).toBe(value);
    }
  });

  it('leaves it undefined when the client never sent it', () => {
    const parsed = CreateGameSchema.safeParse(payload(undefined));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.settings.moon_race_enabled).toBeUndefined();
  });

  it('refuses per-phase keys from a client — the operator owns those', () => {
    const parsed = CreateGameSchema.safeParse({
      ...payload(true),
      settings: { ...payload(true).settings, space_age_moon_hegemony_enabled: true },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect('space_age_moon_hegemony_enabled' in parsed.data.settings).toBe(false);
    }
  });
});

describe('the operator flags as they ship today', () => {
  it('offers no toggle while every phase is dark', () => {
    // The package is dark-launched in full. When this fails a phase has been
    // promoted, and §10.2 asks that the lobby toggle appear at the same moment.
    expect(featureFlags.moonRacePhases).toEqual(NONE);
    expect(featureFlags.moonRaceAvailable).toBe(false);
  });

  it('derives availability from the phase record, so the two cannot drift', () => {
    expect(featureFlags.moonRaceAvailable).toBe(
      Object.values(featureFlags.moonRacePhases).some(Boolean),
    );
  });
});
