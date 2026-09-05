import type { BuildingType, EraId } from '../types';
import type { DailyPuzzleSpec } from '../game-engine/daily/dailyPuzzleTypes';

/**
 * The daily-challenge set-piece library.
 *
 * A set-piece is the part of a daily only a person can write: the place, the
 * title, the sentence that says why the fight matters, and the one tension
 * that makes it hard — a relief column, a prize that has to be held, an income
 * that has to be waited for. It carries NO numbers. Garrisons, stacks, clocks
 * and grants are the generator's job (dailyGenerator.ts), sized fresh from the
 * date every time the set-piece comes round, so a recurrence is a new fight on
 * a familiar front rather than a repeat.
 *
 * The schedule (dailySchedule.ts) walks each verb's bucket in id order, one
 * entry per cadence slot, and starts over when the bucket is exhausted. A
 * bigger library means a longer gap between recurrences; that is the only
 * effect of adding entries, so the library can grow a few at a time forever.
 *
 * Authoring rules, enforced by dailySetPieces.test.ts against the real maps:
 * - ids unique; every territory exists on the entry's map;
 * - tactical: the anchor borders the target; support borders the anchor;
 *   relief borders the target; none of the four coincide;
 * - economy/tech: human and AI holdings are non-empty and disjoint; the
 *   building is in the cost table; the tech is in the era's tree;
 * - region: human + AI holdings are exactly the region; every AI garrison
 *   borders a human territory; support borders a human region territory;
 * - chain: the first target borders the anchor and each next borders the
 *   previous; relief borders the last target;
 * - domination: the spec is complete and passes the persistence validator.
 *
 * Community maps carry no era; a daily takes its era from the spec, so a
 * set-piece may pair any map with any era whose rules suit the story.
 */

interface SetPieceBase {
  /** Stable, unique, snake_case. Seeds derive from it, so renaming one re-rolls its numbers. */
  id: string;
  era_id: EraId;
  map_id: string;
  title: string;
  intro: string;
  hint?: string;
  /** The AI seat's difficulty. Default medium. */
  ai_difficulty?: 'easy' | 'medium' | 'hard';
}

export interface TacticalSetPiece extends SetPieceBase {
  kind: 'tactical';
  /** The human's main force; must border the target. */
  anchor: string;
  /** The AI garrison to capture. */
  target: string;
  /** A human reserve behind the anchor (must border it). */
  support?: string;
  /** An AI relief garrison beside the target (must border it). */
  relief?: string;
  /** Other AI holdings that shape the front without joining the fight. */
  extra_ai?: readonly string[];
  /**
   * The same front, defended: the AI masses on the anchor and the human must
   * keep the target. Support and relief swap sides (the relief territory is
   * the human's reserve, the support territory an AI holding). Present only
   * where the story reads both ways; a set-piece without it is capture-only.
   */
  hold?: { title: string; intro: string; hint?: string };
}

export interface EconomySetPiece extends SetPieceBase {
  kind: 'economy';
  human: readonly string[];
  ai: readonly string[];
  building_type: BuildingType;
}

export interface TechSetPiece extends SetPieceBase {
  kind: 'tech';
  human: readonly string[];
  ai: readonly string[];
  tech_id: string;
}

/**
 * A domination day is the one shape that cannot be sized: its dealt board IS
 * the content, and the seed deals it. The spec is kept complete; only the dice
 * stream is re-derived from the date.
 */
export interface DominationSetPiece {
  id: string;
  kind: 'domination';
  spec: Omit<DailyPuzzleSpec, 'dice_queue_seed'>;
}

/**
 * Control a region: the human starts with most of it, the AI garrisons the
 * rest, and every garrison has to fall and stay fallen. The first AI territory
 * listed is the primary fight and is sized like a tactical day.
 */
export interface RegionSetPiece extends SetPieceBase {
  kind: 'region';
  region_id: string;
  /** Region territories the human starts with. */
  human: readonly string[];
  /** Region territories the AI garrisons, primary fight first. Together with `human`: the whole region. */
  ai: readonly string[];
  /** A human reserve outside the region (must border a human region territory). */
  support?: string;
  extra_ai?: readonly string[];
}

/**
 * A forced march: take the first target from the anchor, then the next from
 * the first, and hold them all. Each target borders the one before it.
 */
export interface ChainSetPiece extends SetPieceBase {
  kind: 'chain';
  anchor: string;
  targets: readonly [string, string, ...string[]];
  /** A human reserve behind the anchor (must border it). */
  support?: string;
  /** An AI relief garrison beside the last target (must border it). */
  relief?: string;
  extra_ai?: readonly string[];
}

export type DailySetPiece =
  | TacticalSetPiece
  | EconomySetPiece
  | TechSetPiece
  | RegionSetPiece
  | ChainSetPiece
  | DominationSetPiece;

export const DAILY_SET_PIECES: readonly DailySetPiece[] = [
  // ── Tactical ──────────────────────────────────────────────────────────────
  {
    id: 'crossing_the_rubicon',
    kind: 'tactical',
    era_id: 'ancient',
    map_id: 'era_ancient',
    title: 'Crossing the Rubicon',
    intro: 'Your legions mass in Gaul. Rome lies open — but Greece will reinforce it if you hesitate.',
    hint: 'Commit the Gaul stack — a split assault gives Rome two cheap defensive rounds.',
    anchor: 'gaul',
    target: 'italia',
    support: 'hispania',
    relief: 'greece',
    hold: {
      title: 'Hold the Tiber',
      intro: 'The Gauls have crossed. Rome holds with what it has, and Greece can send what it can spare.',
      hint: 'Fortify Greece into Italia before the Gauls arrive — a garrison that grows each turn is a garrison that lasts.',
    },
  },
  {
    id: 'the_border_states',
    kind: 'tactical',
    era_id: 'acw',
    map_id: 'era_acw',
    title: 'The Border States',
    intro: 'Whoever holds Kentucky holds the river war. The garrison is dug in and Tennessee stands behind it.',
    hint: 'Tennessee can retake a thinly-held Kentucky — win the fight with enough left to hold it.',
    anchor: 'acw_ohio_indiana',
    target: 'acw_kentucky',
    support: 'acw_great_lakes',
    relief: 'acw_tennessee',
    extra_ai: ['acw_appalachia'],
    hold: {
      title: 'Kentucky Stands',
      intro: 'The Union masses in Ohio. Lose Kentucky and the river is theirs; Tennessee is your only reserve.',
      hint: 'The attacker rolls more dice than you — win on numbers, not on luck.',
    },
  },
  {
    id: 'checkpoint',
    kind: 'tactical',
    era_id: 'coldwar',
    map_id: 'era_coldwar',
    title: 'Checkpoint',
    intro: 'The wall has a gate and the gate has a garrison. Prague will counterattack whatever you leave behind.',
    anchor: 'west_germany',
    target: 'east_germany',
    support: 'france_benelux',
    relief: 'czechoslovakia',
    hold: {
      title: 'The Wall Holds',
      intro: 'NATO armour is massing at the border. East Germany must not fall; Prague can reinforce.',
    },
  },
  {
    id: 'the_crowns_reach',
    kind: 'tactical',
    era_id: 'medieval',
    map_id: 'era_medieval',
    title: 'The Crown’s Reach',
    intro: 'England is an island only until someone builds enough boats. Sea assaults roll fewer dice — mass accordingly.',
    hint: 'The Channel caps you at two attack dice — this crossing is won by attrition, not one charge.',
    anchor: 'france',
    target: 'england',
    support: 'iberia',
    extra_ai: ['holy_roman'],
    // Capture-only: England's neighbours are all sea lanes, so a defended
    // England would have no land reserve to fortify from.
  },
  {
    id: 'andean_campaign',
    kind: 'tactical',
    era_id: 'modern',
    map_id: 'era_modern',
    title: 'Andean Campaign',
    intro: 'Bogotá anchors the northern front, with reinforcements one border away in either direction.',
    anchor: 'brazil_mod',
    target: 'colombia_mod',
    support: 'peru_mod',
    relief: 'central_america_mod',
    hold: {
      title: 'Bogotá Holds',
      intro: 'Brazil comes north with everything. Colombia must hold until the rains; Central America is a border away.',
    },
  },
  {
    id: 'the_ottoman_gates',
    kind: 'tactical',
    era_id: 'discovery',
    map_id: 'era_discovery',
    title: 'The Ottoman Gates',
    intro: 'The Balkans garrison is the strongest you have faced this week, and Anatolia stands behind it.',
    hint: 'Near-even fights favour the defender — grind the garrison down before the killing blow.',
    anchor: 'holy_roman_disc',
    target: 'ottoman_balkans',
    support: 'italy_disc',
    relief: 'anatolia_disc',
    ai_difficulty: 'hard',
    hold: {
      title: 'The Gates Hold',
      intro: 'The Empire is at the Balkans with its main army. Anatolia can feed the garrison if you move first.',
      hint: 'Reinforce before the first assault; every unit in the garrison is a die the attacker has to beat.',
    },
  },
  {
    id: 'alexanders_prize',
    kind: 'tactical',
    era_id: 'ancient',
    map_id: 'era_ancient',
    title: 'Alexander’s Prize',
    intro: 'Persepolis, at the end of the road. The hardest board of the rotation.',
    hint: 'Bactria will feed the garrison if the siege drags — the clock is the second enemy.',
    anchor: 'mesopotamia',
    target: 'persia',
    support: 'levant',
    relief: 'bactria',
    ai_difficulty: 'hard',
    hold: {
      title: 'Persepolis',
      intro: 'Alexander is in Mesopotamia and he is not going home. Persia holds or the empire ends.',
      hint: 'Bactria’s reserve is the whole plan — fortify it into Persia on turn one.',
    },
  },

  // ── Economy ───────────────────────────────────────────────────────────────
  {
    id: 'the_wool_trade',
    kind: 'economy',
    era_id: 'medieval',
    map_id: 'era_medieval',
    title: 'The Wool Trade',
    intro: 'Peace for a season. Turn the treasury into something that outlasts it before the Empire stirs.',
    human: ['france', 'england', 'iberia'],
    ai: ['holy_roman'],
    building_type: 'production_1',
  },
  {
    id: 'plantations',
    kind: 'economy',
    era_id: 'discovery',
    map_id: 'era_discovery',
    title: 'Plantations',
    intro: 'The colonies pay for the wars to come. Put the season’s silver into the ground.',
    human: ['spain_portugal', 'france_disc'],
    ai: ['holy_roman_disc'],
    building_type: 'production_1',
  },
  {
    id: 'the_listening_post',
    kind: 'economy',
    era_id: 'coldwar',
    map_id: 'era_coldwar',
    title: 'The Listening Post',
    intro: 'Not every building makes rifles. Raise a research station — the quiet kind of power.',
    human: ['uk_ireland', 'france_benelux'],
    ai: ['east_germany'],
    building_type: 'tech_gen_1',
  },

  // ── Tech ──────────────────────────────────────────────────────────────────
  {
    id: 'arsenal_of_ideas',
    kind: 'tech',
    era_id: 'ww2',
    map_id: 'era_ww2',
    title: 'Arsenal of Ideas',
    intro: 'The war will be won in the factories. Your researchers wait on a signature.',
    human: ['britain_ww2', 'france_ww2'],
    ai: ['germany'],
    tech_id: 'ww2_war_industry',
  },
  {
    id: 'all_roads',
    kind: 'tech',
    era_id: 'ancient',
    map_id: 'era_ancient',
    title: 'All Roads',
    intro: 'An empire is only as large as the distance a legion can march in a season.',
    human: ['italia', 'greece'],
    ai: ['anatolia'],
    tech_id: 'ancient_roads',
  },

  // ── Tier two: a two-step plan on the same clock ───────────────────────────
  {
    id: 'the_ruhr',
    kind: 'economy',
    era_id: 'ww2',
    map_id: 'era_ww2',
    title: 'The Ruhr',
    intro: 'A factory is a promise. A second one on top of it is a war economy. Build the first to build the second.',
    hint: 'Tier two needs tier one beneath it — raise both in the same territory.',
    human: ['britain_ww2', 'france_ww2', 'iberia_ww2'],
    ai: ['germany'],
    building_type: 'production_2',
  },
  {
    id: 'engines_of_siege',
    kind: 'tech',
    era_id: 'ancient',
    map_id: 'era_ancient',
    title: 'Engines of Siege',
    intro: 'Iron first, then the machines that use it. Two discoveries, one season.',
    hint: 'Siege Engines needs Iron Weapons first — research in order and hold your ground for the points.',
    human: ['italia', 'greece'],
    ai: ['anatolia'],
    tech_id: 'ancient_siege_engines',
  },

  // ── Region ────────────────────────────────────────────────────────────────
  {
    id: 'the_eastern_marches',
    kind: 'region',
    era_id: 'medieval',
    map_id: 'era_medieval',
    title: 'The Eastern Marches',
    intro: 'Poland and Hungary are yours. Kiev and Constantinople are not. The whole march, or none of it.',
    hint: 'Two garrisons, one clock: take the nearer one with enough left to hold it, then the other.',
    region_id: 'eastern_europe',
    human: ['poland_bohemia', 'hungary'],
    ai: ['kievan_rus', 'byzantine'],
    support: 'holy_roman',
  },
  {
    id: 'the_parthian_shot',
    kind: 'region',
    era_id: 'ancient',
    map_id: 'era_ancient',
    title: 'The Parthian Shot',
    intro: 'Mesopotamia and Persia are held. Bactria and Arabia are not, and Parthia is not Parthia without them.',
    region_id: 'parthia',
    human: ['mesopotamia', 'persia'],
    ai: ['bactria', 'arabia'],
    support: 'levant',
  },

  // ── Chain ─────────────────────────────────────────────────────────────────
  {
    id: 'down_the_river',
    kind: 'chain',
    era_id: 'acw',
    map_id: 'era_acw',
    title: 'Down the River',
    intro: 'Kentucky first, Tennessee after. The river war is won in two steps or not at all.',
    hint: 'What you take Kentucky with is what you march on Tennessee with — do not bleed the stack on the first hop.',
    anchor: 'acw_ohio_indiana',
    targets: ['acw_kentucky', 'acw_tennessee'],
    support: 'acw_great_lakes',
    extra_ai: ['acw_appalachia'],
  },
  {
    id: 'the_road_to_greece',
    kind: 'chain',
    era_id: 'ancient',
    map_id: 'era_ancient',
    title: 'The Road to Greece',
    intro: 'Rome is the first prize and Greece the second. The legion that takes both has to survive both.',
    anchor: 'gaul',
    targets: ['italia', 'greece'],
    support: 'hispania',
    relief: 'anatolia',
  },

  // ── Domination ────────────────────────────────────────────────────────────
  {
    id: 'against_the_tide',
    kind: 'domination',
    spec: {
      archetype: 'domination',
      title: 'Against the Tide',
      intro: 'The map was dealt against you: the enemy front runs deep and reinforced. Outlast it anyway.',
      goal: 'Eliminate the rival faction and control the entire map.',
      era_id: 'ancient',
      map_id: 'era_ancient',
      seed: 83_100_005,
      player_count: 2,
      max_turns: 40,
      ai_difficulty: 'medium',
      // Additive: the dealt 1v1 board stands; these fronts are reinforced on top.
      starting_board: {
        italia: { owner: 'ai', unit_count: 9 },
        greece: { owner: 'ai', unit_count: 7 },
        gaul: { owner: 'human', unit_count: 8 },
      },
    },
  },
  {
    id: 'fortress_europe',
    kind: 'domination',
    spec: {
      archetype: 'domination',
      title: 'Fortress Europe',
      intro: 'The continent is dug in behind reinforced lines. Break it before the clock breaks you.',
      goal: 'Eliminate the rival faction and control the entire map.',
      era_id: 'ww2',
      map_id: 'era_ww2',
      seed: 83_100_011,
      player_count: 2,
      max_turns: 35,
      ai_difficulty: 'hard',
      // Additive on the dealt board: the Axis core is reinforced, so is London.
      starting_board: {
        germany: { owner: 'ai', unit_count: 10 },
        eastern_europe_ww2: { owner: 'ai', unit_count: 8 },
        britain_ww2: { owner: 'human', unit_count: 8 },
      },
    },
  },
];

/** The tactical set-pieces that read both ways, and so can be served as hold days. */
export function holdCapableSetPieces(): readonly TacticalSetPiece[] {
  return DAILY_SET_PIECES.filter((sp): sp is TacticalSetPiece => sp.kind === 'tactical' && !!sp.hold);
}

export function setPiecesOfKind<K extends DailySetPiece['kind']>(
  kind: K,
): ReadonlyArray<Extract<DailySetPiece, { kind: K }>> {
  return DAILY_SET_PIECES.filter((sp): sp is Extract<DailySetPiece, { kind: K }> => sp.kind === kind);
}
