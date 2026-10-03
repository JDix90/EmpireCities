import { describe, it, expect, afterEach } from 'vitest';
import { galaxyTutorialGameSpec } from './galaxyTutorialGames';
import { GALAXY_TUTORIAL_LESSON_MODULES } from './tutorialModules';
import { normalizeGameSettings } from '../state/gameSettings';
import { resetAdminConfigCacheForTests, setAdminConfigCacheForTests } from '../../services/adminConfig';

describe('galaxy tutorial game specs', () => {
  afterEach(() => resetAdminConfigCacheForTests());

  it('has a spec for every galaxy lesson, seating the human first', () => {
    for (const lesson of GALAXY_TUTORIAL_LESSON_MODULES) {
      const spec = galaxyTutorialGameSpec(lesson);
      expect(spec.seats.length).toBeGreaterThanOrEqual(2);
      expect(spec.seats[0]?.is_ai).toBe(false);
      for (const seat of spec.seats.slice(1)) {
        expect(seat.is_ai).toBe(true);
        expect(seat.ai_difficulty).toBe('tutorial');
      }
      expect(spec.settings.max_players).toBe(spec.seats.length);
      expect(spec.settings.tutorial).toBe(true);
      expect(spec.settings.tutorial_lesson_module).toBe(lesson);
    }
  });

  it('survives the settings normalizer every room load runs', () => {
    // A key missing from normalizeGameSettings' whitelist is silently dropped
    // on the next load: the authored opening and the lesson id must both stay.
    for (const lesson of GALAXY_TUTORIAL_LESSON_MODULES) {
      const spec = galaxyTutorialGameSpec(lesson);
      const norm = normalizeGameSettings(spec.settings);
      expect(norm.tutorial_lesson_module).toBe(lesson);
      expect(norm.authored_scenario).toEqual(spec.settings.authored_scenario);
      expect(norm.factions_enabled).toBe(true);
      expect(norm.economy_enabled).toBe(true);
      expect(norm.tech_trees_enabled).toBe(true);
    }
  });

  it('bakes the galaxy rules from the live flags, as the create route does', () => {
    const live = galaxyTutorialGameSpec('galaxy_lane_sovereignty').settings;
    expect(live.galaxy_corridors_enabled).toBe(true);
    expect(live.world_rules_enabled).toBe(true);
    expect(live.world_rules_disabled).toEqual([]);
    expect(live.galaxy_transit_enabled).toBe(false);
    expect(live.galaxy_buildings_v2).toBe(false);

    setAdminConfigCacheForTests({ feature_flags: { galaxy_rule_storms_enabled: false, galaxy_transit_enabled: true, galaxy_buildings_v2_enabled: true } });
    const patched = galaxyTutorialGameSpec('galaxy_lane_sovereignty').settings;
    expect(patched.world_rules_disabled).toEqual(['storms']);
    expect(patched.galaxy_transit_enabled).toBe(true);
    expect(patched.galaxy_buildings_v2).toBe(true);
  });
});
