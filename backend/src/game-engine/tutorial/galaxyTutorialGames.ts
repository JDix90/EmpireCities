/**
 * How each Galactic Age lesson is set up: its board, its seats and the
 * settings the game is created with. `POST /games/tutorial/start` reads one
 * of these for a galaxy module instead of the WW2/Ancient defaults the other
 * lessons share.
 *
 * The galaxy settings are baked from the live feature flags exactly as the
 * create route bakes them (modules/games/createGameSettings.ts): the lesson
 * teaches the rules production plays, so if an operator has switched the
 * corridors or a world rule off, the lesson plays without them too.
 */
import type { AiDifficulty, GameSettings, VictoryType } from '../../types';
import { featureFlags } from '../../config/featureFlags';
import { GALAXY_LANE_SOVEREIGNTY_SCENARIO } from './galaxyLaneSovereigntyScenario';
import { GALAXY_TRANSCENDENCE_SCENARIO } from './galaxyTranscendenceScenario';
import { GALAXY_SECRET_MISSIONS_SCENARIO } from './galaxySecretMissionsScenario';
import { GALAXY_CAPITAL_SCENARIO } from './galaxyCapitalScenario';
import { GALAXY_THRESHOLD_LESSON_PERCENT, GALAXY_THRESHOLD_SCENARIO } from './galaxyThresholdScenario';
import { GALAXY_DOMINATION_SCENARIO } from './galaxyDominationScenario';
import {
  GALAXY_LANE_SOVEREIGNTY_GRANT_TECH_POINTS,
  GALAXY_TRANSCENDENCE_GRANT_GOLD,
  GALAXY_TRANSCENDENCE_GRANT_TECH_POINTS,
} from './tutorialGrants';
import type { GalaxyTutorialLessonModule } from './tutorialModules';

export interface TutorialSeat {
  faction_id: string | null;
  is_ai: boolean;
  ai_difficulty?: AiDifficulty;
}

export interface GalaxyTutorialGameSpec {
  mapId: string;
  eraId: 'galaxy_age' | 'space_age';
  /** Seat 0 is the human; the rest are inserted in this order. */
  seats: TutorialSeat[];
  settings: Partial<GameSettings> & Record<string, unknown>;
}

const TUTORIAL_AI: TutorialSeat['ai_difficulty'] = 'tutorial';

/** The settings every galaxy lesson shares; a lesson's own settings go on top. */
function galaxySettingsBase(lessonModule: GalaxyTutorialLessonModule, seats: number, victory: VictoryType[]) {
  return {
    fog_of_war: false,
    allowed_victory_conditions: victory,
    victory_type: victory[0] ?? 'domination',
    turn_timer_seconds: 0,
    initial_unit_count: 3,
    card_set_escalating: false,
    diplomacy_enabled: false,
    tutorial: true,
    tutorial_lesson_module: lessonModule,
    max_players: seats,
    // The era's own systems (frontend/src/utils/eraSystemDefaults.ts locks
    // all three on for a Galactic Age lobby). Factions are what deal the home
    // worlds; the economy and tech trees are what Lane Charts and the Vault
    // need to mean anything.
    factions_enabled: true,
    economy_enabled: true,
    tech_trees_enabled: true,
    stability_enabled: false,
    combat_dice_cap_enabled: true,
    // Baked from the live flags, as the create route does.
    galaxy_corridors_enabled: featureFlags.galaxyCorridorsEnabled,
    world_rules_enabled: featureFlags.galaxyWorldRulesEnabled,
    world_rules_disabled: featureFlags.galaxyDisabledWorldRules,
    galaxy_transit_enabled: featureFlags.galaxyTransitEnabled,
    galaxy_buildings_v2: featureFlags.galaxyBuildingsV2Enabled,
    galaxy_orbital_buildings: featureFlags.galaxyOrbitalBuildingsEnabled,
  };
}

export function galaxyTutorialGameSpec(lessonModule: GalaxyTutorialLessonModule): GalaxyTutorialGameSpec {
  switch (lessonModule) {
    case 'galaxy_primer': {
      // The classic four-seat board, as dealt: every faction on its home
      // world, nothing authored, played under the galaxy lobby's own default
      // victory list (createGameSettings.ts applyOrbitGatedVictoryDefaults)
      // so the Objectives panel shows the Map Control meter and the Lane
      // Sovereignty count the primer's cards point at. The primer is read,
      // not won: its last card marks it complete.
      const seats: TutorialSeat[] = [
        { faction_id: 'stellar_mandate', is_ai: false },
        { faction_id: 'helion_navigators', is_ai: true, ai_difficulty: TUTORIAL_AI },
        { faction_id: 'forge_syndicate', is_ai: true, ai_difficulty: TUTORIAL_AI },
        { faction_id: 'void_custodians', is_ai: true, ai_difficulty: TUTORIAL_AI },
      ];
      return {
        mapId: 'era_galaxy',
        eraId: 'galaxy_age',
        seats,
        settings: {
          ...galaxySettingsBase(lessonModule, seats.length, ['domination', 'threshold', 'lane_sovereignty']),
          victory_threshold: GALAXY_THRESHOLD_LESSON_PERCENT,
        },
      };
    }
    case 'galaxy_lane_sovereignty': {
      // Three seats: see galaxyLaneSovereigntyScenario.ts for why, and for
      // which AI seat is which.
      const seats: TutorialSeat[] = [
        { faction_id: 'helion_navigators', is_ai: false },
        { faction_id: 'void_custodians', is_ai: true, ai_difficulty: TUTORIAL_AI },
        { faction_id: 'forge_syndicate', is_ai: true, ai_difficulty: TUTORIAL_AI },
      ];
      return {
        mapId: 'era_galaxy',
        eraId: 'galaxy_age',
        seats,
        settings: {
          ...galaxySettingsBase(lessonModule, seats.length, ['domination', 'lane_sovereignty']),
          // Exactly Lane Charts: the third die across a lane, and nothing else.
          tutorial_grant_tech_points: GALAXY_LANE_SOVEREIGNTY_GRANT_TECH_POINTS,
          authored_scenario: GALAXY_LANE_SOVEREIGNTY_SCENARIO,
        },
      };
    }
    case 'galaxy_transcendence': {
      // The Space to Stars board: a Space Age start whose spine ends in the
      // Galactic Age. See galaxyTranscendenceScenario.ts for the seats.
      const seats: TutorialSeat[] = [
        { faction_id: 'lunar_pioneers', is_ai: false },
        { faction_id: 'terran_federation', is_ai: true, ai_difficulty: TUTORIAL_AI },
      ];
      return {
        mapId: 'era_ascension_galaxy',
        eraId: 'space_age',
        seats,
        settings: {
          ...galaxySettingsBase(lessonModule, seats.length, ['domination', 'transcendence']),
          era_advancement_enabled: true,
          era_advancement_spine_id: 'space_to_stars',
          // The core lesson's Skirmish pace for the one advance the lesson
          // makes: the cost is the income floor times this.
          era_advancement_cost_mult: 1.6,
          // The step's own overrides set the tier-2, tier-3 and building bar;
          // two tier-1 roots are what those tier-2s need anyway.
          era_advancement_min_tier1_techs: 2,
          tutorial_grant_tech_points: GALAXY_TRANSCENDENCE_GRANT_TECH_POINTS,
          tutorial_grant_gold: GALAXY_TRANSCENDENCE_GRANT_GOLD,
          authored_scenario: GALAXY_TRANSCENDENCE_SCENARIO,
        },
      };
    }
    case 'galaxy_secret_missions': {
      // Navigators against the Mandate across the two Sol–Verdan lanes; see
      // galaxySecretMissionsScenario.ts. Played for missions only, so the
      // Objectives panel shows the mission and nothing beside it.
      const seats: TutorialSeat[] = [
        { faction_id: 'helion_navigators', is_ai: false },
        { faction_id: 'stellar_mandate', is_ai: true, ai_difficulty: TUTORIAL_AI },
      ];
      return {
        mapId: 'era_galaxy',
        eraId: 'galaxy_age',
        seats,
        settings: {
          ...galaxySettingsBase(lessonModule, seats.length, ['domination', 'secret_mission']),
          authored_scenario: GALAXY_SECRET_MISSIONS_SCENARIO,
        },
      };
    }
    case 'galaxy_capital': {
      // The Mandate against the Navigators across the Guinea Coast lane; see
      // galaxyCapitalScenario.ts for why these two seats and this lane.
      const seats: TutorialSeat[] = [
        { faction_id: 'stellar_mandate', is_ai: false },
        { faction_id: 'helion_navigators', is_ai: true, ai_difficulty: TUTORIAL_AI },
      ];
      return {
        mapId: 'era_galaxy',
        eraId: 'galaxy_age',
        seats,
        settings: {
          ...galaxySettingsBase(lessonModule, seats.length, ['domination', 'capital']),
          authored_scenario: GALAXY_CAPITAL_SCENARIO,
        },
      };
    }
    case 'galaxy_threshold': {
      // The Mandate holding Sol, Nexus Station and a Verdan beachhead, one
      // system short of the galaxy default's 60%; see galaxyThresholdScenario.ts.
      const seats: TutorialSeat[] = [
        { faction_id: 'stellar_mandate', is_ai: false },
        { faction_id: 'helion_navigators', is_ai: true, ai_difficulty: TUTORIAL_AI },
      ];
      return {
        mapId: 'era_galaxy',
        eraId: 'galaxy_age',
        seats,
        settings: {
          ...galaxySettingsBase(lessonModule, seats.length, ['domination', 'threshold']),
          victory_threshold: GALAXY_THRESHOLD_LESSON_PERCENT,
          authored_scenario: GALAXY_THRESHOLD_SCENARIO,
        },
      };
    }
    case 'galaxy_domination': {
      // The Navigators down to one Verdan gateway, the Mandate holding the
      // rest of the world around it; see galaxyDominationScenario.ts. Played
      // for Domination alone, so the result shows what the galaxy makes of it.
      const seats: TutorialSeat[] = [
        { faction_id: 'stellar_mandate', is_ai: false },
        { faction_id: 'helion_navigators', is_ai: true, ai_difficulty: TUTORIAL_AI },
      ];
      return {
        mapId: 'era_galaxy',
        eraId: 'galaxy_age',
        seats,
        settings: {
          ...galaxySettingsBase(lessonModule, seats.length, ['domination']),
          authored_scenario: GALAXY_DOMINATION_SCENARIO,
        },
      };
    }
  }
}
