import { describe, it, expect } from 'vitest';
import { reachesSpaceAge } from './spines';
import { resolveMoonRacePhases } from '../../modules/games/games.routes';
import type { MoonRacePhaseFlags } from '../../config/featureFlags';

/**
 * The Moon Race and era advancement (docs/space-age-moon/README.md §10.2).
 *
 * A game that climbs into the Space Age has to arrive with the package, or it
 * reaches the era without the thing that makes it the era. The phases are baked
 * at CREATE rather than at the board transform — the engine never reads a
 * feature flag, and a match's rules cannot shift under it depending on when it
 * transformed — which only works because `reachesSpaceAge` can see the whole
 * climb from the create payload.
 */

const ALL: MoonRacePhaseFlags = {
  space_age_moon_helium3_enabled: true,
  space_age_moon_gated_tier_enabled: true,
  space_age_moon_hegemony_enabled: true,
  space_age_moon_missions_enabled: true,
  space_age_moon_blockade_enabled: true,
};

describe('which games will see the Space Age', () => {
  it('a game that starts there', () => {
    expect(reachesSpaceAge('space_age', {})).toBe(true);
  });

  it('the epic preset, whose spine id is still implied by the preset', () => {
    // The create boundary runs BEFORE normalizeGameSettings resolves the
    // preset, so reading `era_advancement_spine_id` alone would see undefined
    // here and silently answer no.
    expect(reachesSpaceAge('ancient', {
      era_advancement_enabled: true,
      era_advancement_preset: 'epic',
    })).toBe(true);
  });

  it('an explicit full_ascension spine', () => {
    expect(reachesSpaceAge('ancient', {
      era_advancement_enabled: true,
      era_advancement_spine_id: 'full_ascension',
    })).toBe(true);
  });

  it('a board-transform game starting mid-line', () => {
    // Board transform anchors an ascension spine at the start era, so a ww2
    // start climbs ww2 → coldwar → modern → space_age.
    expect(reachesSpaceAge('ww2', {
      era_advancement_enabled: true,
      era_advancement_board_transform: true,
    })).toBe(true);
  });

  it('NOT a spine that stops short of it', () => {
    for (const preset of ['skirmish', 'standard']) {
      expect(reachesSpaceAge('ancient', { era_advancement_enabled: true, era_advancement_preset: preset })).toBe(false);
    }
    expect(reachesSpaceAge('ancient', {
      era_advancement_enabled: true, era_advancement_spine_id: 'classic',
    })).toBe(false);
  });

  it('NOT a game with era advancement off, whatever spine is configured', () => {
    // The spine is inert without advancement, so the game stays where it began.
    expect(reachesSpaceAge('ancient', { era_advancement_spine_id: 'full_ascension' })).toBe(false);
    expect(reachesSpaceAge('ancient', { era_advancement_preset: 'epic' })).toBe(false);
  });

  it('NOT a board-transform game off the ascension line', () => {
    // era_acw / risorgimento / galaxy anchor no ascension spine, so the game
    // falls back to its configured spine rather than climbing to 2100.
    expect(reachesSpaceAge('acw', {
      era_advancement_enabled: true, era_advancement_board_transform: true,
    })).toBe(false);
  });
});

describe('what an ascending game is created with', () => {
  it('arrives in the Space Age with every shipped phase', () => {
    const res = resolveMoonRacePhases({
      isSpaceAge: reachesSpaceAge('ancient', {
        era_advancement_enabled: true, era_advancement_preset: 'epic',
      }),
      shipped: ALL,
    });
    expect(res.phases).toEqual(ALL);
  });

  it('leaves a climb that stops at Modern with none of it', () => {
    const res = resolveMoonRacePhases({
      isSpaceAge: reachesSpaceAge('ancient', {
        era_advancement_enabled: true, era_advancement_preset: 'standard',
      }),
      shipped: ALL,
    });
    expect(res.phases).toEqual({});
  });
});
