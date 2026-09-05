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

  {
    id: 'the_gates_of_vienna',
    kind: 'tactical',
    era_id: 'medieval',
    map_id: 'era_medieval',
    title: 'The Gates of Vienna',
    intro: 'The Magyar host is on the Danube. Vienna is the door to the Empire, and France will answer its call if you knock too slowly.',
    hint: 'One assault, all in. A second try gives France time to arrive.',
    anchor: 'hungary',
    target: 'holy_roman',
    support: 'byzantine',
    relief: 'france',
    hold: {
      title: 'Vienna Holds',
      intro: 'The Magyars are across the Danube. Vienna stands with its garrison and whatever France can send.',
      hint: 'Fortify France into the Empire before the first assault — the garrison you start with is not the one that has to hold.',
    },
  },
  {
    id: 'crecy',
    kind: 'tactical',
    era_id: 'medieval',
    map_id: 'era_medieval',
    title: 'Crécy',
    intro: 'The Channel is narrow and the crossing rolls fewer dice. Normandy is worth every one of them.',
    hint: 'A sea assault caps you at two dice — this is won by numbers, not by a charge.',
    anchor: 'england',
    target: 'france',
    support: 'scandinavia',
    relief: 'holy_roman',
    hold: {
      title: 'Calais',
      intro: 'The English are in the boats. France holds the coast, and the Empire can march to the Channel if you ask in time.',
    },
  },
  {
    id: 'the_road_to_jerusalem',
    kind: 'tactical',
    era_id: 'medieval',
    map_id: 'era_medieval',
    title: 'The Road to Jerusalem',
    intro: 'The host has crossed Anatolia. The Crusader coast is one march away, and Egypt is already moving north.',
    anchor: 'anatolia_med',
    target: 'levant_crusader',
    support: 'byzantine',
    relief: 'egypt_ayyubid',
    hold: {
      title: 'Outremer',
      intro: 'The Seljuks are through the passes. The Crusader States hold the coast; Egypt, for once, is on your side.',
    },
  },
  {
    id: 'the_armada',
    kind: 'tactical',
    era_id: 'discovery',
    map_id: 'era_discovery',
    title: 'The Armada',
    intro: 'The fleet is in the Channel ports. England is one crossing away, and her colonies will send ships if it drags.',
    hint: 'Two dice on the water. Mass the whole fleet — a half-armada is a wreck.',
    anchor: 'france_disc',
    target: 'britain_disc',
    support: 'spain_portugal',
    relief: 'north_america_east',
    hold: {
      title: 'Drake’s Watch',
      intro: 'The Armada is at sea. England has the Channel, the weather, and a colony that can send ships home.',
    },
  },
  {
    id: 'the_bulge',
    kind: 'tactical',
    era_id: 'ww2',
    map_id: 'era_ww2',
    title: 'The Bulge',
    intro: 'The Ardennes are thin. Paris is the prize, and the British will come across the water if it drags.',
    anchor: 'germany',
    target: 'france_ww2',
    support: 'scandinavia_ww2',
    relief: 'britain_ww2',
    hold: {
      title: 'The Line Holds',
      intro: 'The armour is in the Ardennes. France holds with what it has, and Britain can land what it can spare.',
      hint: 'The reserve is across the Channel — bring it over before the first assault, not after.',
    },
  },
  {
    id: 'barbarossa',
    kind: 'tactical',
    era_id: 'ww2',
    map_id: 'era_ww2',
    title: 'Barbarossa',
    intro: 'The whole front moves east at dawn. Kiev is the objective; Moscow is the reason it will be reinforced.',
    hint: 'The garrison is strong and the relief is stronger. Win the first fight with enough left to hold the second.',
    anchor: 'eastern_europe_ww2',
    target: 'ukraine',
    support: 'germany',
    relief: 'russia_west',
    ai_difficulty: 'hard',
    hold: {
      title: 'Kiev Holds',
      intro: 'The whole front is moving east. Kiev holds until Moscow can send what Moscow can send.',
    },
  },
  {
    id: 'the_desert_fox',
    kind: 'tactical',
    era_id: 'ww2',
    map_id: 'era_ww2',
    title: 'The Desert Fox',
    intro: 'Past Egypt, the road runs to the Levant and the oil beyond it. Turkey will not stay neutral if you sit still.',
    anchor: 'libya_egypt',
    target: 'levant_ww2',
    support: 'ethiopia_ww2',
    relief: 'turkey_ww2',
    hold: {
      title: 'The Canal Holds',
      intro: 'The Afrika Korps is past the wire. The Levant holds the road to the oil; Turkey can spare a division.',
    },
  },
  {
    id: 'the_fulda_gap',
    kind: 'tactical',
    era_id: 'coldwar',
    map_id: 'era_coldwar',
    title: 'The Fulda Gap',
    intro: 'The Pact’s armour is on the inner German border. Frankfurt is four days away if France does not arrive first.',
    anchor: 'east_germany',
    target: 'west_germany',
    support: 'czechoslovakia',
    relief: 'france_benelux',
    hold: {
      title: 'Fulda Holds',
      intro: 'The Pact is through the Gap. West Germany holds; France is a border away.',
      hint: 'Every unit fortified into Germany before the assault is a die the attacker has to beat.',
    },
  },
  {
    id: 'the_38th_parallel',
    kind: 'tactical',
    era_id: 'coldwar',
    map_id: 'era_coldwar',
    title: 'The 38th Parallel',
    intro: 'The volunteers are across the Yalu. Korea is the objective; Japan is where the counterattack will come from.',
    anchor: 'china_north_cw',
    target: 'korea_cw',
    support: 'mongolia_cw',
    relief: 'japan_cw',
    hold: {
      title: 'Pusan Holds',
      intro: 'The volunteers are across the Yalu. Korea holds the peninsula; Japan can land what it has.',
    },
  },
  {
    id: 'savannah',
    kind: 'tactical',
    era_id: 'acw',
    map_id: 'era_acw',
    title: 'Savannah',
    intro: 'Georgia is behind you. The Carolinas are ahead, and Virginia will send what it can down the coast.',
    anchor: 'acw_georgia_fl',
    target: 'acw_carolinas',
    support: 'acw_alabama',
    relief: 'acw_upper_south',
    hold: {
      title: 'Charleston Holds',
      intro: 'Sherman is in Georgia and he is not stopping. The Carolinas hold; Virginia is the only reserve.',
    },
  },
  {
    id: 'vicksburg',
    kind: 'tactical',
    era_id: 'acw',
    map_id: 'era_acw',
    title: 'Vicksburg',
    intro: 'The river is the war. Whoever holds the Mississippi cuts the Confederacy in two, and Alabama knows it.',
    hint: 'The garrison is dug in. Grind it down; the relief is a border away and it will come.',
    anchor: 'acw_arkansas',
    target: 'acw_mississippi',
    support: 'acw_missouri',
    relief: 'acw_alabama',
    ai_difficulty: 'hard',
    hold: {
      title: 'The River Holds',
      intro: 'Grant is across the river. Vicksburg holds the bluffs; Alabama can send what it has.',
    },
  },
  {
    id: 'the_thousand',
    kind: 'tactical',
    era_id: 'risorgimento',
    map_id: 'era_risorgimento',
    title: 'The Expedition of the Thousand',
    intro: 'Calabria has risen. Naples is the kingdom, and Rome will send soldiers to keep it a kingdom.',
    anchor: 'ris_sud',
    target: 'ris_campania',
    support: 'ris_sicilia',
    relief: 'ris_lazio',
    hold: {
      title: 'Naples Holds',
      intro: 'Garibaldi is in Calabria. Naples holds the crown; Rome can march if asked.',
    },
  },
  {
    id: 'solferino',
    kind: 'tactical',
    era_id: 'risorgimento',
    map_id: 'era_risorgimento',
    title: 'Solferino',
    intro: 'Piedmont marches on Milan. Venetia will send the Austrians west if the siege drags.',
    anchor: 'ris_piemonte_liguria',
    target: 'ris_lombardia',
    support: 'ris_toscana',
    relief: 'ris_veneto_friuli',
    hold: {
      title: 'Milan Holds',
      intro: 'Piedmont is across the Ticino. Milan holds; Venetia is the reserve.',
    },
  },
  {
    id: 'the_dacian_wars',
    kind: 'tactical',
    era_id: 'ancient',
    map_id: 'community_roman_empire_117',
    title: 'The Dacian Wars',
    intro: 'Trajan’s legions are on the Danube. Dacia’s gold is across it, and Pannonia will send help down the river.',
    hint: 'The relief is a border away. Take Dacia with enough left to keep it.',
    anchor: 'moesia',
    target: 'dacia',
    support: 'macedonia',
    relief: 'pannonia',
    ai_difficulty: 'hard',
    hold: {
      title: 'Sarmizegetusa',
      intro: 'The legions are at the Danube. Dacia holds the mountains; Pannonia, for once, is on your side.',
    },
  },
  {
    id: 'inabayama',
    kind: 'tactical',
    era_id: 'medieval',
    map_id: 'community_sengoku_japan',
    title: 'Inabayama',
    intro: 'Oda Nobunaga looks north from Owari. Mino is the castle on the mountain, and Echizen will not let it fall quietly.',
    anchor: 'owari',
    target: 'mino',
    support: 'mikawa',
    relief: 'echizen',
    hold: {
      title: 'Gifu Holds',
      intro: 'Nobunaga is at the border. Mino holds the mountain; Echizen can send what it has.',
    },
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

  {
    id: 'the_hanseatic_league',
    kind: 'economy',
    era_id: 'medieval',
    map_id: 'era_medieval',
    title: 'The Hanseatic League',
    intro: 'Salt, herring, timber, cloth. The Baltic pays for everything if someone builds the warehouses.',
    human: ['holy_roman', 'scandinavia', 'poland_bohemia'],
    ai: ['kievan_rus'],
    building_type: 'production_1',
  },
  {
    id: 'the_silver_fleet',
    kind: 'economy',
    era_id: 'discovery',
    map_id: 'era_discovery',
    title: 'The Silver Fleet',
    intro: 'The mines of the New World are yours. Turn the silver into something that stays when the fleet sails.',
    human: ['new_spain', 'new_granada', 'peru_chile'],
    ai: ['brazil'],
    building_type: 'production_1',
  },
  {
    id: 'arsenal_of_democracy',
    kind: 'economy',
    era_id: 'ww2',
    map_id: 'era_ww2',
    title: 'Arsenal of Democracy',
    intro: 'One factory is a start. Two, one on top of the other, is a war economy. Build them in order.',
    hint: 'Tier two needs tier one beneath it — the same territory, twice.',
    human: ['usa_east', 'usa_west', 'caribbean'],
    ai: ['japan_ww2'],
    building_type: 'production_2',
  },
  {
    id: 'the_marshall_plan',
    kind: 'economy',
    era_id: 'coldwar',
    map_id: 'era_coldwar',
    title: 'The Marshall Plan',
    intro: 'The money is arriving. Put it into a factory before the other side puts it into a rumour.',
    human: ['france_benelux', 'italy_cw', 'west_germany'],
    ai: ['east_germany'],
    building_type: 'production_1',
  },
  {
    id: 'the_five_year_plan',
    kind: 'economy',
    era_id: 'coldwar',
    map_id: 'era_coldwar',
    title: 'The Five-Year Plan',
    intro: 'The quota is a second factory on top of the first. The plan does not care how.',
    hint: 'Raise tier one, hold your ground for the gold, raise tier two on it.',
    human: ['russia_west_cw', 'russia_central_cw', 'ukraine_cw'],
    ai: ['czechoslovakia'],
    building_type: 'production_2',
  },
  {
    id: 'the_western_forts',
    kind: 'economy',
    era_id: 'acw',
    map_id: 'era_acw',
    title: 'The Western Forts',
    intro: 'The frontier is long and the garrison is thin. Dig in somewhere before someone tests it.',
    human: ['acw_plains', 'acw_great_lakes', 'acw_missouri'],
    ai: ['acw_arkansas'],
    building_type: 'defense_1',
  },

  // ── More tech ─────────────────────────────────────────────────────────────
  {
    id: 'the_feudal_compact',
    kind: 'tech',
    era_id: 'medieval',
    map_id: 'era_medieval',
    title: 'The Feudal Compact',
    intro: 'Land for service, service for land. Write it down before the barons write it for you.',
    human: ['france', 'holy_roman'],
    ai: ['hungary'],
    tech_id: 'medieval_feudalism',
  },
  {
    id: 'the_great_bombard',
    kind: 'tech',
    era_id: 'medieval',
    map_id: 'era_medieval',
    title: 'The Great Bombard',
    intro: 'The walls have stood for a thousand years. Metallurgy first, then the engines that will bring them down.',
    hint: 'Siege Warfare needs Advanced Metallurgy first — two discoveries, one clock.',
    human: ['anatolia_med', 'mesopotamia_med'],
    ai: ['byzantine'],
    tech_id: 'medieval_siege_warfare',
  },
  {
    id: 'trace_italienne',
    kind: 'tech',
    era_id: 'discovery',
    map_id: 'era_discovery',
    title: 'Trace Italienne',
    intro: 'Cannon made the old walls a liability. The new ones are low, thick and star-shaped. Learn to build them.',
    human: ['italy_disc', 'holy_roman_disc'],
    ai: ['ottoman_balkans'],
    tech_id: 'discovery_fortifications',
  },
  {
    id: 'bletchley',
    kind: 'tech',
    era_id: 'ww2',
    map_id: 'era_ww2',
    title: 'Bletchley',
    intro: 'The war is being fought on the air as much as the ground. Get the radios talking.',
    human: ['britain_ww2', 'scandinavia_ww2'],
    ai: ['germany'],
    tech_id: 'ww2_radio',
  },
  {
    id: 'sputnik',
    kind: 'tech',
    era_id: 'coldwar',
    map_id: 'era_coldwar',
    title: 'Sputnik',
    intro: 'Heavy industry first, then the rocket it pays for. The other side is counting the days.',
    hint: 'Space Race needs Heavy Industry beneath it — research in order and hold the ground for the points.',
    human: ['russia_west_cw', 'russia_central_cw', 'russia_east_cw'],
    ai: ['mongolia_cw'],
    tech_id: 'cw_space_race',
  },
  {
    id: 'the_iron_horse',
    kind: 'tech',
    era_id: 'acw',
    map_id: 'era_acw',
    title: 'The Iron Horse',
    intro: 'An army moves at the speed of its supply. Lay the rails and the front comes to you.',
    human: ['acw_ohio_indiana', 'acw_great_lakes'],
    ai: ['acw_kentucky'],
    tech_id: 'acw_railroads',
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

  {
    id: 'operation_sea_lion',
    kind: 'region',
    era_id: 'ww2',
    map_id: 'era_ww2',
    title: 'Operation Sea Lion',
    intro: 'The continent is yours from Norway to Sicily. Britain and Iberia are not, and the Western Front is not won without them.',
    hint: 'Two crossings, two capped-dice fights. Take the one you can hold, then the other.',
    region_id: 'western_front',
    human: ['germany', 'france_ww2', 'italy_ww2', 'scandinavia_ww2'],
    ai: ['britain_ww2', 'iberia_ww2'],
    support: 'eastern_europe_ww2',
  },
  {
    id: 'mare_nostrum',
    kind: 'region',
    era_id: 'ancient',
    map_id: 'community_roman_empire_117',
    title: 'Mare Nostrum',
    intro: 'The peninsula is Rome’s. The islands are not, and a sea that is not ours is not our sea.',
    region_id: 'italia',
    human: ['italia_north', 'italia_central', 'italia_south'],
    ai: ['sicilia', 'sardinia_corsica'],
    support: 'narbonensis',
  },
  {
    id: 'bleeding_missouri',
    kind: 'region',
    era_id: 'acw',
    map_id: 'era_acw',
    title: 'Bleeding Missouri',
    intro: 'Ohio and the Plains are secure. Missouri is not, and the Midwest is not the Union’s until it is.',
    region_id: 'union_midwest',
    human: ['acw_ohio_indiana', 'acw_plains'],
    ai: ['acw_missouri'],
    support: 'acw_great_lakes',
  },
  {
    id: 'the_kanto',
    kind: 'region',
    era_id: 'medieval',
    map_id: 'community_sengoku_japan',
    title: 'The Kantō',
    intro: 'The Hōjō hold the coast. Kōzuke and Hitachi hold out. The plain is yours when both are.',
    region_id: 'kanto',
    human: ['sagami', 'musashi', 'shimosa'],
    ai: ['kozuke', 'hitachi'],
    support: 'kai',
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

  {
    id: 'to_the_oxus',
    kind: 'chain',
    era_id: 'ancient',
    map_id: 'era_ancient',
    title: 'To the Oxus',
    intro: 'Persia first, then Bactria beyond it. The army that reaches the river has to still be an army.',
    hint: 'Do not bleed the stack at Persepolis — Bactria is the second fight, and the steppe is behind it.',
    anchor: 'mesopotamia',
    targets: ['persia', 'bactria'],
    support: 'levant',
    relief: 'central_steppe',
  },
  {
    id: 'atlanta_to_the_sea',
    kind: 'chain',
    era_id: 'acw',
    map_id: 'era_acw',
    title: 'Atlanta to the Sea',
    intro: 'Georgia first, the Carolinas after. Virginia will come south to stop the second half.',
    anchor: 'acw_tennessee',
    targets: ['acw_georgia_fl', 'acw_carolinas'],
    support: 'acw_kentucky',
    relief: 'acw_upper_south',
  },
  {
    id: 'case_yellow',
    kind: 'chain',
    era_id: 'ww2',
    map_id: 'era_ww2',
    title: 'Case Yellow',
    intro: 'France in the first week, the Pyrenees in the second. Morocco will land troops in Iberia if the second week is slow.',
    anchor: 'germany',
    targets: ['france_ww2', 'iberia_ww2'],
    support: 'scandinavia_ww2',
    relief: 'morocco_ww2',
  },
  {
    id: 'the_northern_expedition',
    kind: 'chain',
    era_id: 'ww2',
    map_id: 'community_fractured_china',
    title: 'The Northern Expedition',
    intro: 'Out of Guangdong, through Hunan, to Wuhan. Henan’s warlord will not watch it happen.',
    anchor: 'guangdong',
    targets: ['hunan', 'hubei'],
    support: 'fujian',
    relief: 'henan',
  },
  {
    id: 'the_reconquista',
    kind: 'chain',
    era_id: 'medieval',
    map_id: 'community_charlemagne_814',
    title: 'The Reconquista',
    intro: 'Toledo first, Córdoba after. Galicia will answer the emirate’s call if the march stalls.',
    anchor: 'marca_hispanica',
    targets: ['toledo', 'cordoba'],
    support: 'gothia',
    relief: 'galicia_asturias',
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
  {
    id: 'the_hundred_years',
    kind: 'domination',
    spec: {
      archetype: 'domination',
      title: 'The Hundred Years',
      intro: 'Two crowns, one continent, and a war that outlives everyone who started it. Finish it in forty turns.',
      goal: 'Eliminate the rival faction and control the entire map.',
      era_id: 'medieval',
      map_id: 'era_medieval',
      seed: 83_100_017,
      player_count: 2,
      max_turns: 40,
      ai_difficulty: 'medium',
      // Additive on the dealt board: the French core is reinforced; the Empire is yours to hold.
      starting_board: {
        france: { owner: 'ai', unit_count: 9 },
        italy_states: { owner: 'ai', unit_count: 7 },
        holy_roman: { owner: 'human', unit_count: 8 },
      },
    },
  },
  {
    id: 'treasure_fleets',
    kind: 'domination',
    spec: {
      archetype: 'domination',
      title: 'Treasure Fleets',
      intro: 'Silver flows from the New World to Madrid, and Madrid pays for armies with it. Cut the flow, or drown in what it buys.',
      goal: 'Eliminate the rival faction and control the entire map.',
      era_id: 'discovery',
      map_id: 'era_discovery',
      seed: 83_100_023,
      player_count: 2,
      max_turns: 38,
      ai_difficulty: 'medium',
      // Additive on the dealt board: Spain and its silver colony are reinforced; France is yours.
      starting_board: {
        spain_portugal: { owner: 'ai', unit_count: 9 },
        new_spain: { owner: 'ai', unit_count: 7 },
        france_disc: { owner: 'human', unit_count: 8 },
      },
    },
  },
  {
    id: 'the_iron_curtain',
    kind: 'domination',
    spec: {
      archetype: 'domination',
      title: 'The Iron Curtain',
      intro: 'A continent split by a line on a map, and both halves armed to the teeth. The line was never going to hold.',
      goal: 'Eliminate the rival faction and control the entire map.',
      era_id: 'coldwar',
      map_id: 'era_coldwar',
      seed: 83_100_029,
      player_count: 2,
      max_turns: 35,
      ai_difficulty: 'hard',
      // Additive on the dealt board: the Eastern Bloc is reinforced; West Germany is your salient.
      starting_board: {
        ukraine_cw: { owner: 'ai', unit_count: 9 },
        east_germany: { owner: 'ai', unit_count: 7 },
        west_germany: { owner: 'human', unit_count: 8 },
      },
    },
  },
  {
    id: 'pacific_century',
    kind: 'domination',
    spec: {
      archetype: 'domination',
      title: 'Pacific Century',
      intro: 'The century belongs to whoever holds the Pacific rim. Two powers are certain it is theirs.',
      goal: 'Eliminate the rival faction and control the entire map.',
      era_id: 'modern',
      map_id: 'era_modern',
      seed: 83_100_031,
      player_count: 2,
      max_turns: 40,
      ai_difficulty: 'hard',
      // Additive on the dealt board: both Chinas are reinforced; Japan is your island fortress.
      starting_board: {
        china_east_mod: { owner: 'ai', unit_count: 9 },
        china_west_mod: { owner: 'ai', unit_count: 7 },
        japan_mod: { owner: 'human', unit_count: 8 },
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
