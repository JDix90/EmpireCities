import type { DailyPuzzleSpec } from '../game-engine/daily/dailyPuzzleTypes';

/**
 * The authored daily-challenge calendar.
 *
 * A date listed here replaces the procedural generator for that day
 * (dailyPuzzleService consults this first). Dates not listed fall back to the
 * generator, so the calendar can be grown a batch at a time and an empty one
 * changes nothing.
 *
 * Authoring rules, enforced by dailyCalendar.test.ts:
 * - every territory id in a starting_board exists on the entry's map;
 * - a military day's human force is adjacent to its target, and the capture
 *   probability of the primary assault sits in a winnable-but-not-free band;
 * - economy/tech days grant enough to actually afford their goal;
 * - tech ids exist in the era's tree, building types in the economy set.
 *
 * The spec is stored as JSONB the first time the date is served. Editing a day
 * here still reaches players: dailyPuzzleService reconciles a stored row against
 * this calendar on read and rewrites a stale one. The exception is a day already
 * in play — swapping the board under recorded scores would corrupt that date's
 * leaderboard, so the service keeps the stored spec and logs the mismatch. Force
 * it with `pnpm -C backend exec tsx scripts/refreshTodayDailyChallenge.ts`.
 */
export const DAILY_CALENDAR: Record<string, DailyPuzzleSpec> = {
  // ── Week 1 ────────────────────────────────────────────────────────────────
  '2026-08-31': {
    archetype: 'military_capture',
    title: 'Crossing the Rubicon',
    intro:
      'Your legions mass in Gaul. Rome lies open — but Greece will reinforce it if you hesitate.',
    goal: 'Capture Italia before time runs out.',
    era_id: 'ancient',
    map_id: 'era_ancient',
    seed: 83_100_001,
    player_count: 2,
    max_turns: 8,
    dice_queue_seed: 0x5eed0831,
    target_territory_id: 'italia',
    anchor_territory_id: 'gaul',
    ai_difficulty: 'medium',
    clear_board: true,
    starting_phase: 'attack',
    starting_board: {
      gaul: { owner: 'human', unit_count: 10 },
      hispania: { owner: 'human', unit_count: 4 },
      italia: { owner: 'ai', unit_count: 6 },
      greece: { owner: 'ai', unit_count: 4 },
    },
    hint: 'Commit the Gaul stack — a split assault gives Rome two cheap defensive rounds.',
  },
  '2026-09-01': {
    archetype: 'economy_build',
    title: 'The Wool Trade',
    intro:
      'Peace for a season. Turn the treasury into something that outlasts it before the Empire stirs.',
    goal: 'Construct a Production (tier 1) building in any territory you control.',
    era_id: 'medieval',
    map_id: 'era_medieval',
    seed: 83_100_002,
    player_count: 2,
    max_turns: 6,
    dice_queue_seed: 0x5eed0901,
    building_type: 'production_1',
    ai_difficulty: 'medium',
    clear_board: true,
    starting_board: {
      france: { owner: 'human', unit_count: 6 },
      england: { owner: 'human', unit_count: 5 },
      iberia: { owner: 'human', unit_count: 4 },
      holy_roman: { owner: 'ai', unit_count: 8 },
    },
    // production_1 costs 3; the grant covers one, so two turns of income
    // (1/turn at three territories) have to be held for before you can build.
    grants: { gold: 1 },
  },
  '2026-09-02': {
    archetype: 'military_capture',
    title: 'The Border States',
    intro:
      'Whoever holds Kentucky holds the river war. The garrison is dug in and Tennessee stands behind it.',
    goal: 'Capture Kentucky before time runs out.',
    era_id: 'acw',
    map_id: 'era_acw',
    seed: 83_100_003,
    player_count: 2,
    max_turns: 8,
    dice_queue_seed: 0x5eed0902,
    target_territory_id: 'acw_kentucky',
    anchor_territory_id: 'acw_ohio_indiana',
    ai_difficulty: 'medium',
    clear_board: true,
    starting_phase: 'attack',
    starting_board: {
      acw_ohio_indiana: { owner: 'human', unit_count: 9 },
      acw_great_lakes: { owner: 'human', unit_count: 4 },
      acw_kentucky: { owner: 'ai', unit_count: 5 },
      acw_tennessee: { owner: 'ai', unit_count: 6 },
      acw_appalachia: { owner: 'ai', unit_count: 3 },
    },
    hint: 'Tennessee can retake a thinly-held Kentucky — win the fight with enough left to hold it.',
  },
  '2026-09-03': {
    archetype: 'tech_research',
    title: 'Arsenal of Ideas',
    intro:
      'The war will be won in the factories. Your researchers wait on a signature.',
    goal: 'Research “War Industry”.',
    era_id: 'ww2',
    map_id: 'era_ww2',
    seed: 83_100_004,
    player_count: 2,
    max_turns: 5,
    dice_queue_seed: 0x5eed0903,
    tech_id: 'ww2_war_industry',
    ai_difficulty: 'medium',
    clear_board: true,
    starting_board: {
      britain_ww2: { owner: 'human', unit_count: 6 },
      france_ww2: { owner: 'human', unit_count: 4 },
      germany: { owner: 'ai', unit_count: 7 },
    },
    // War Industry costs 4. The grant is two short, and the bootstrap is
    // pinned off so the grant really is the opening budget: the rest comes
    // from holding ground for two turns at 1 point per turn.
    grants: { tech_points: 2 },
    settings_overrides: { economy_tech_starting_tech_points: 0 },
  },
  '2026-09-04': {
    archetype: 'domination',
    title: 'Against the Tide',
    intro:
      'The map was dealt against you: the enemy front runs deep and reinforced. Outlast it anyway.',
    goal: 'Eliminate the rival faction and control the entire map.',
    era_id: 'ancient',
    map_id: 'era_ancient',
    seed: 83_100_005,
    player_count: 2,
    max_turns: 40,
    dice_queue_seed: 0x5eed0904,
    ai_difficulty: 'medium',
    // Additive: the dealt 1v1 board stands; these fronts are reinforced on top.
    starting_board: {
      italia: { owner: 'ai', unit_count: 9 },
      greece: { owner: 'ai', unit_count: 7 },
      gaul: { owner: 'human', unit_count: 8 },
    },
  },
  '2026-09-05': {
    archetype: 'military_capture',
    title: 'Checkpoint',
    intro:
      'The wall has a gate and the gate has a garrison. Prague will counterattack whatever you leave behind.',
    goal: 'Capture East Germany before time runs out.',
    era_id: 'coldwar',
    map_id: 'era_coldwar',
    seed: 83_100_006,
    player_count: 2,
    max_turns: 8,
    dice_queue_seed: 0x5eed0905,
    target_territory_id: 'east_germany',
    anchor_territory_id: 'west_germany',
    ai_difficulty: 'medium',
    clear_board: true,
    starting_phase: 'attack',
    starting_board: {
      west_germany: { owner: 'human', unit_count: 12 },
      france_benelux: { owner: 'human', unit_count: 5 },
      east_germany: { owner: 'ai', unit_count: 8 },
      czechoslovakia: { owner: 'ai', unit_count: 4 },
    },
  },
  '2026-09-06': {
    archetype: 'economy_build',
    title: 'Plantations',
    intro:
      'The colonies pay for the wars to come. Put the season’s silver into the ground.',
    goal: 'Construct a Production (tier 1) building in any territory you control.',
    era_id: 'discovery',
    map_id: 'era_discovery',
    seed: 83_100_007,
    player_count: 2,
    max_turns: 5,
    dice_queue_seed: 0x5eed0906,
    building_type: 'production_1',
    ai_difficulty: 'medium',
    clear_board: true,
    starting_board: {
      spain_portugal: { owner: 'human', unit_count: 5 },
      france_disc: { owner: 'human', unit_count: 4 },
      holy_roman_disc: { owner: 'ai', unit_count: 6 },
    },
    grants: { gold: 1 },
  },
  // ── Week 2 ────────────────────────────────────────────────────────────────
  '2026-09-07': {
    archetype: 'military_capture',
    title: 'The Crown’s Reach',
    intro:
      'England is an island only until someone builds enough boats. Sea assaults roll fewer dice — mass accordingly.',
    goal: 'Capture England before time runs out.',
    era_id: 'medieval',
    map_id: 'era_medieval',
    seed: 83_100_008,
    player_count: 2,
    max_turns: 10,
    dice_queue_seed: 0x5eed0907,
    target_territory_id: 'england',
    anchor_territory_id: 'france',
    ai_difficulty: 'medium',
    clear_board: true,
    starting_phase: 'attack',
    starting_board: {
      france: { owner: 'human', unit_count: 12 },
      iberia: { owner: 'human', unit_count: 5 },
      england: { owner: 'ai', unit_count: 5 },
      holy_roman: { owner: 'ai', unit_count: 6 },
    },
    hint: 'The Channel caps you at two attack dice — this crossing is won by attrition, not one charge.',
  },
  '2026-09-08': {
    archetype: 'tech_research',
    title: 'All Roads',
    intro:
      'An empire is only as large as the distance a legion can march in a season.',
    goal: 'Research “Roads”.',
    era_id: 'ancient',
    map_id: 'era_ancient',
    seed: 83_100_009,
    player_count: 2,
    max_turns: 5,
    dice_queue_seed: 0x5eed0908,
    tech_id: 'ancient_roads',
    ai_difficulty: 'medium',
    clear_board: true,
    starting_board: {
      italia: { owner: 'human', unit_count: 6 },
      greece: { owner: 'human', unit_count: 4 },
      anatolia: { owner: 'ai', unit_count: 6 },
    },
    grants: { tech_points: 2 },
    settings_overrides: { economy_tech_starting_tech_points: 0 },
  },
  '2026-09-09': {
    archetype: 'military_capture',
    title: 'Andean Campaign',
    intro:
      'Bogotá anchors the northern front, with reinforcements one border away in either direction.',
    goal: 'Capture Colombia before time runs out.',
    era_id: 'modern',
    map_id: 'era_modern',
    seed: 83_100_010,
    player_count: 2,
    max_turns: 8,
    dice_queue_seed: 0x5eed0909,
    target_territory_id: 'colombia_mod',
    anchor_territory_id: 'brazil_mod',
    ai_difficulty: 'medium',
    clear_board: true,
    starting_phase: 'attack',
    starting_board: {
      brazil_mod: { owner: 'human', unit_count: 11 },
      peru_mod: { owner: 'human', unit_count: 4 },
      colombia_mod: { owner: 'ai', unit_count: 6 },
      central_america_mod: { owner: 'ai', unit_count: 5 },
    },
  },
  '2026-09-10': {
    archetype: 'domination',
    title: 'Fortress Europe',
    intro:
      'The continent is dug in behind reinforced lines. Break it before the clock breaks you.',
    goal: 'Eliminate the rival faction and control the entire map.',
    era_id: 'ww2',
    map_id: 'era_ww2',
    seed: 83_100_011,
    player_count: 2,
    max_turns: 35,
    dice_queue_seed: 0x5eed0910,
    ai_difficulty: 'hard',
    // Additive on the dealt board: the Axis core is reinforced, so is London.
    starting_board: {
      germany: { owner: 'ai', unit_count: 10 },
      eastern_europe_ww2: { owner: 'ai', unit_count: 8 },
      britain_ww2: { owner: 'human', unit_count: 8 },
    },
  },
  '2026-09-11': {
    archetype: 'military_capture',
    title: 'The Ottoman Gates',
    intro:
      'The Balkans garrison is the strongest you have faced this week, and Anatolia stands behind it.',
    goal: 'Capture the Ottoman Balkans before time runs out.',
    era_id: 'discovery',
    map_id: 'era_discovery',
    seed: 83_100_012,
    player_count: 2,
    max_turns: 9,
    dice_queue_seed: 0x5eed0911,
    target_territory_id: 'ottoman_balkans',
    anchor_territory_id: 'holy_roman_disc',
    ai_difficulty: 'hard',
    clear_board: true,
    starting_phase: 'attack',
    starting_board: {
      holy_roman_disc: { owner: 'human', unit_count: 11 },
      italy_disc: { owner: 'human', unit_count: 4 },
      ottoman_balkans: { owner: 'ai', unit_count: 7 },
      anatolia_disc: { owner: 'ai', unit_count: 4 },
    },
    hint: 'Near-even fights favour the defender — grind the garrison down before the killing blow.',
  },
  '2026-09-12': {
    archetype: 'economy_build',
    title: 'The Listening Post',
    intro:
      'Not every building makes rifles. Raise a research station — the quiet kind of power.',
    goal: 'Construct a Tech Generator (tier 1) building in any territory you control.',
    era_id: 'coldwar',
    map_id: 'era_coldwar',
    seed: 83_100_013,
    player_count: 2,
    max_turns: 5,
    dice_queue_seed: 0x5eed0912,
    building_type: 'tech_gen_1',
    ai_difficulty: 'medium',
    clear_board: true,
    starting_board: {
      uk_ireland: { owner: 'human', unit_count: 5 },
      france_benelux: { owner: 'human', unit_count: 4 },
      east_germany: { owner: 'ai', unit_count: 6 },
    },
    grants: { gold: 2 },
  },
  '2026-09-13': {
    archetype: 'military_capture',
    title: 'Alexander’s Prize',
    intro:
      'Persepolis, at the end of the week and the end of the road. The hardest board of the fortnight.',
    goal: 'Capture Persia before time runs out.',
    era_id: 'ancient',
    map_id: 'era_ancient',
    seed: 83_100_014,
    player_count: 2,
    max_turns: 8,
    dice_queue_seed: 0x5eed0913,
    target_territory_id: 'persia',
    anchor_territory_id: 'mesopotamia',
    ai_difficulty: 'hard',
    clear_board: true,
    starting_phase: 'attack',
    starting_board: {
      mesopotamia: { owner: 'human', unit_count: 11 },
      levant: { owner: 'human', unit_count: 6 },
      persia: { owner: 'ai', unit_count: 8 },
      bactria: { owner: 'ai', unit_count: 4 },
    },
    hint: 'Bactria will feed the garrison if the siege drags — the clock is the second enemy.',
  },
};

/** The authored spec for a date (YYYY-MM-DD, UTC), or undefined to use the generator. */
export function getAuthoredDailySpec(date: string): DailyPuzzleSpec | undefined {
  return DAILY_CALENDAR[date];
}
