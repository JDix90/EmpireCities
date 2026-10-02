import type { AuthoredScenario, AuthoredScenarioTerritory } from '../../types';

/**
 * Opening position for the Territory Threshold lesson, on the real galaxy
 * board (`database/maps/era_galaxy.json`), two seats: the human plays the
 * Stellar Mandate on Sol III, the AI the Helion Navigators on Verdan Reach,
 * and the Rust Belt and Nexus Station open as neutral colonies
 * (state/galaxyModes.ts).
 *
 * What is the galaxy's own here is the denominator. `checkVictory` measures
 * the threshold against EVERY territory in the game state, unowned ones
 * included, and needs `ceil(total × percent / 100)` of them: on this 64-system
 * board at the galaxy lobby's default of 60% that is 39, so the neutral
 * colonies count against the player as much as a rival's worlds do — and are
 * the cheapest systems to take, since nobody reinforces them. The lesson's
 * Map Control meter reads "38 of 39" as the game opens, and one capture wins.
 *
 * The scenario hands the Mandate the whole of Nexus Station (the colony
 * beyond Sol's two Nexus lanes) and a six-system beachhead on Verdan's
 * Dawnrim, across the two Sol–Verdan lanes: 16 Sol (the deal) + 16 Nexus +
 * 6 Verdan = 38. The 39th is Spore Reach, a Navigator system two units thin
 * beside the beachhead, taken by GROUND from Saffron Mire: a full 3-dice
 * attack, not a lane crossing, so the lesson's point is the count and not the
 * cap. Eight against two wins over a few rolls; the opening draft of a
 * 38-system empire, placed on Saffron Mire as the card says, makes it certain.
 * The tutorial AI never attacks (`aiBot.ts`), so nothing the player holds is
 * ever lost before the win is judged. The rest of Verdan stays the deal's.
 *
 * `galaxyThresholdScenario.test.ts` builds the game as the start route does
 * and pins the count, the need, the ground adjacency and the turn the win
 * fires on.
 */

/** The threshold the lesson is played at: the galaxy lobby's default (`ORBIT_GATED_DEFAULT_VICTORY_THRESHOLD`). */
export const GALAXY_THRESHOLD_LESSON_PERCENT = 60;

/** The attack the lesson's winning move makes, source to target, by ground. */
export const GALAXY_THRESHOLD_WINNING_ATTACK = {
  from: 'verdan_saffron_mire',
  to: 'verdan_spore_reach',
} as const;

const NEXUS_STATION_SYSTEMS = [
  'nexus_harmonic_rim',
  'nexus_gate_threshold',
  'nexus_echo_concourse',
  'nexus_basin_mandate',
  'nexus_cordon_march',
  'nexus_quietude_basin',
  'nexus_antenna_spire',
  'nexus_lodgeway',
  'nexus_halo_span',
  'nexus_toll_crater',
  'nexus_waystation_loni',
  'nexus_lattice_berth',
  'nexus_vault_approach',
  'nexus_beacon_hollow',
  'nexus_resonance_vault',
  'nexus_custodian_quarter',
] as const;

/** The Verdan beachhead: both gateways facing Sol and the four systems behind them. */
const VERDAN_BEACHHEAD = [
  'verdan_chlorophage_span',
  'verdan_greenfire_vault',
  'verdan_lumen_bog',
  'verdan_glowmire_shelf',
  'verdan_verdigris_span',
  GALAXY_THRESHOLD_WINNING_ATTACK.from,
] as const;

const held = (ids: readonly string[], unit_count: number): Record<string, AuthoredScenarioTerritory> =>
  Object.fromEntries(ids.map((id) => [id, { owner: 'human', unit_count }]));

export const GALAXY_THRESHOLD_SCENARIO: AuthoredScenario = {
  starting_board: {
    ...held(NEXUS_STATION_SYSTEMS, 3),
    ...held(VERDAN_BEACHHEAD, 3),
    [GALAXY_THRESHOLD_WINNING_ATTACK.from]: { owner: 'human', unit_count: 8 },
    [GALAXY_THRESHOLD_WINNING_ATTACK.to]: { owner: 'ai', unit_count: 2 },
  },
};
