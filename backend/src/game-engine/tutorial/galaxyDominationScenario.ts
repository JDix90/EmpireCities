import type { AuthoredScenario, AuthoredScenarioTerritory } from '../../types';

/**
 * Opening position for the Domination lesson, on the real galaxy board
 * (`database/maps/era_galaxy.json`), two seats: the human plays the Stellar
 * Mandate on Sol III, the AI the Helion Navigators on Verdan Reach, and the
 * Rust Belt and Nexus Station open as neutral colonies (state/galaxyModes.ts).
 *
 * What is the galaxy's own here is that Domination never fires. `checkVictory`
 * reads last standing before anything else, and an attacker who takes a
 * seat's last system eliminates it on the spot (`executeLandAttack`): with
 * two or more seats, holding every system means every rival is already gone,
 * so the result reads Last Commander Standing, never Total Domination — and
 * the 32 neutral colony garrisons never need taking. Last standing is also
 * the one win not held to round 2 (victory/openingRound.ts). The lesson has
 * the player do exactly that: the Navigators are down to Greenfire Vault,
 * the Verdan gateway facing Pacific Rim; the player holds the other fifteen
 * Verdan systems and takes the last one by ground from Glowmire Shelf, with
 * the full 3 dice, in round 1, and the game ends on the capture.
 *
 * `galaxyDominationScenario.test.ts` builds the game as the start route does,
 * runs the capture through the engine with fixed dice, and pins the
 * elimination, the condition and that it fires in round 1; and that a board
 * held entire still reads last standing.
 */

/** The attack the lesson's winning move makes, source to target, by ground. */
export const GALAXY_DOMINATION_WINNING_ATTACK = {
  from: 'verdan_glowmire_shelf',
  to: 'verdan_greenfire_vault',
} as const;

/** Every Verdan system but the Navigators' last. */
const VERDAN_HELD = [
  'verdan_spore_reach',
  'verdan_verdigris_span',
  'verdan_saffron_mire',
  'verdan_chlorophage_span',
  'verdan_lumen_bog',
  'verdan_photic_crown',
  'verdan_thundercrown_belt',
  'verdan_witchlight_fen',
  'verdan_mistveil_hollow',
  'verdan_cinder_bloom',
  'verdan_sulphur_drift',
  'verdan_mycel_deep',
  'verdan_emberleaf_basin',
  'verdan_pollen_sea',
  GALAXY_DOMINATION_WINNING_ATTACK.from,
] as const;

const held = (ids: readonly string[], unit_count: number): Record<string, AuthoredScenarioTerritory> =>
  Object.fromEntries(ids.map((id) => [id, { owner: 'human', unit_count }]));

export const GALAXY_DOMINATION_SCENARIO: AuthoredScenario = {
  starting_board: {
    ...held(VERDAN_HELD, 3),
    [GALAXY_DOMINATION_WINNING_ATTACK.from]: { owner: 'human', unit_count: 8 },
    [GALAXY_DOMINATION_WINNING_ATTACK.to]: { owner: 'ai', unit_count: 2 },
  },
};
