import type { AuthoredScenario } from '../../types';

/**
 * Opening position for the Transcendence lesson, on the Space to Stars board
 * (`database/maps/era_ascension_galaxy.json`): the one spine whose last era is
 * the Galactic Age (`eraAdvancement/spines.ts`, `space_to_stars`), so the one
 * board on which Transcendence — the final era reached with a wonder in hand —
 * ends in the galaxy. The board opens as Earth and the Moon; the three far
 * worlds arrive as neutral frontiers the moment the player advances.
 *
 * Two seats: the human plays the Lunar Pioneers, the AI the Terran Federation.
 * The Pioneers are the point. Leaving the Space Age needs a working Space
 * Program (`gate_requires_moon_access`), which for every other faction is four
 * technologies and two buildings deep; the Pioneers have Moon access from turn
 * one (`getMoonAccessState`), so the lesson's gate is research and buildings
 * only, and stays short enough to teach.
 *
 * Every Earth system is named so the opening does not depend on the deal:
 *   - the human holds the six systems of their corner — the five of Oceania,
 *     whose region bonus is real from turn one, and Southern African Union
 *     next door, where `initializeGameState` places the Pioneers' starting
 *     Launch Pad. That tile's buildings are deliberately NOT named: the pad is
 *     the deal's, and so is the orbit lane init opened from it, which is only
 *     re-synced on a room load. `galaxyTranscendenceScenario.test.ts` pins that
 *     the pad is there and nowhere else;
 *   - the Terran Federation holds the rest of Earth, three units a system.
 *     The tutorial AI never attacks (`aiBot.ts`), so the human's thin border
 *     is never tested and the vulnerability window after the advance is a
 *     thing to read about, not to survive.
 * The Moon is left as dealt: neutral garrisons, as every Space Age game opens.
 *
 * The gate the Pioneers must clear (the spine step's `gate_overrides` plus the
 * lesson's settings): 2 tier-1, 2 tier-2 and 1 tier-3 technologies, and 3
 * buildings. The Launch Pad is one; two Workshops are the other two. The
 * grants in `tutorialGrants.ts` are sized to that path, the advance and the
 * Hyperlane Anchor that follows it.
 */
const HUMAN_SYSTEMS = [
  'oc_australia',
  'oc_new_zealand',
  'oc_micronesia',
  'oc_polynesia',
  'asia_malay_archipelago',
  'africa_south',
] as const;

const AI_SYSTEMS = [
  'na_arctic_dominion', 'na_western_states', 'na_central_plains', 'na_launch_base', 'na_eastern_corridor',
  'na_southern_belt', 'euro_british_isles', 'euro_iberia', 'euro_spaceport', 'euro_nordic', 'euro_balkan',
  'euro_east', 'asia_cosmodrome', 'asia_heartland', 'asia_coastal', 'asia_korea_archipelago',
  'asia_indochina', 'asia_japan_islands', 'asia_siberia_belt', 'africa_sahel', 'africa_west', 'africa_horn',
  'africa_congo_basin', 'africa_east', 'mena_levant', 'mena_arabia', 'mena_persia', 'mena_maghreb',
  'mena_nile', 'ca_steppe', 'ca_tien_shan', 'ca_indus', 'ca_ganges', 'ca_deccan', 'la_amazonia', 'la_andes',
  'la_pampas', 'la_patagonia', 'la_caribbean', 'megacity_pacific_rim', 'pacific_seasteads',
  'arctic_reclamation', 'antarctic_peninsula_2100', 'north_pacific_gyre', 'antarctic_interior_2100',
  'south_atlantic_platforms', 'arctic_siberian_shelf', 'equatorial_orbital_anchor',
] as const;

/** Where the deal puts the Pioneers' Launch Pad; the lesson names it and the test pins it. */
export const GALAXY_TRANSCENDENCE_LAUNCH_PAD_SYSTEM = 'africa_south';

export const GALAXY_TRANSCENDENCE_SCENARIO: AuthoredScenario = {
  starting_board: {
    ...Object.fromEntries(HUMAN_SYSTEMS.map((id) => [id, { owner: 'human', unit_count: 4 }])),
    ...Object.fromEntries(AI_SYSTEMS.map((id) => [id, { owner: 'ai', unit_count: 3 }])),
  },
};

/**
 * The cheapest research that clears the gate, in the order the cards suggest
 * it: the two tier-1 roots, the tier-2 on each, and a tier-3 on one of them.
 * `galaxyTranscendenceScenario.test.ts` recomputes the cost from the Space Age
 * tree and holds the research grant to it.
 */
export const GALAXY_TRANSCENDENCE_RESEARCH_PATH = [
  'sa_megacity',
  'sa_digital_warfare',
  'sa_fusion_power',
  'sa_ai_command',
  'sa_hypersonic_swarm',
] as const;
