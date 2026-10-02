import type { AuthoredScenario, SecretMission } from '../../types';

/**
 * Opening position for the Secret Missions lesson, on the real galaxy board
 * (`database/maps/era_galaxy.json`), two seats: the human plays the Helion
 * Navigators on Verdan Reach, the AI the Stellar Mandate on Sol III, and the
 * Rust Belt and Nexus Station open as neutral colonies (state/galaxyModes.ts).
 *
 * What the lesson is about is what the galaxy does to missions. The dealer
 * (`victory/missions.ts`) never names ground behind a hyperspace gate, and on
 * this map every world but Sol III is orbit-gated: a capture or control
 * mission here names Sol III ground, and nothing else, which puts every such
 * mission across a lane. A seat already holding all of Sol can draw only an
 * eliminate mission, and `galaxySecretMissionsScenario.test.ts` pins that the
 * Mandate is dealt exactly that.
 *
 * The deal is seeded from a per-game salt, so the human's mission is set here
 * instead (`human_secret_mission`): own Guinea Coast and Pacific Rim, the two
 * Sol gateways at the far end of the two Sol–Verdan lanes. Each is one
 * crossing from a gateway the Navigators hold: Chlorophage Span faces Guinea
 * Coast, Greenfire Vault faces Pacific Rim. Only those four tiles differ from
 * the deal; the rest of the board is as `initializeGameState` dealt it.
 *
 *   - A lane attack rolls at most 2 dice without Lane Charts, which the
 *     lesson does not grant: the point is the mission, not the tech. Eight
 *     against two, twice, wins through the cap over a few rolls, with
 *     "Attack until captured" doing the pressing.
 *   - The tutorial AI never attacks (`aiBot.ts`), so the two taken gateways
 *     are never contested, and the win lands as round 2 opens.
 */
export const GALAXY_SECRET_MISSIONS_TARGETS = ['sol_guinea', 'sol_pacific_rim'] as const;

/** The two crossings the lesson's captures make, source to target. */
export const GALAXY_SECRET_MISSIONS_LANES = [
  { from: 'verdan_chlorophage_span', to: 'sol_guinea' },
  { from: 'verdan_greenfire_vault', to: 'sol_pacific_rim' },
] as const;

export const GALAXY_SECRET_MISSIONS_HUMAN_MISSION: SecretMission = {
  kind: 'capture_territories',
  territory_ids: [GALAXY_SECRET_MISSIONS_TARGETS[0], GALAXY_SECRET_MISSIONS_TARGETS[1]],
};

export const GALAXY_SECRET_MISSIONS_SCENARIO: AuthoredScenario = {
  starting_board: {
    // Verdan Reach: the two gateways the crossings start from.
    verdan_chlorophage_span: { owner: 'human', unit_count: 8 },
    verdan_greenfire_vault: { owner: 'human', unit_count: 8 },
    // Sol III: the mission's two systems, the Mandate's gateways facing Verdan.
    sol_guinea: { owner: 'ai', unit_count: 2 },
    sol_pacific_rim: { owner: 'ai', unit_count: 2 },
  },
  human_secret_mission: GALAXY_SECRET_MISSIONS_HUMAN_MISSION,
};
