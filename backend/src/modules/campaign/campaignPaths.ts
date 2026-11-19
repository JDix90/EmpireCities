// ============================================================
// Campaign Paths — static configuration for narrative campaigns
// ============================================================

import type { VictoryType, AiDifficulty, CampaignStageMission, CampaignStageDisplay } from '../../types';

export type PathId = 'blood_empire' | 'revolutionary_flame' | 'last_defenders';

export interface PathCarry {
  /** Universal carry: attack bonus for first 3 turns of next era. */
  prestige_bonus: number;
  /** Last Defenders: +defense dice in home regions (stacks to 8). */
  survivor_bonus: number;
  /** Revolutionary Flame: +stability recovery per turn (stacks to 10). */
  revolutionary_spirit: number;
}

/** A side a path lets the player take (CampaignPath `lines`). */
export type LineId = 'allies' | 'soviets';

export interface PathEraConfig {
  era: string;
  /** The stage's own name, for a stage that stages a named campaign. */
  title?: string;
  /**
   * The stage's stated objective. The player holds this mission instead of a
   * dealt one and the bots hold none (victory/missions.ts), so it needs
   * `secret_mission` among the victory conditions and nothing else beside it.
   */
  mission?: CampaignStageMission;
  /**
   * Territories the stage's story has no part for. They sit out of the deal
   * and open unowned, with a garrison; anyone may take them.
   */
  neutral_territories?: string[];
  /** Names the stage shows in place of the era's own (types `CampaignStageDisplay`). */
  display?: CampaignStageDisplay;
  /** Map override — set when a special map replaces the era default. */
  map_id: string;
  /** Player's faction is locked; faction picker is disabled in lobby. */
  locked_faction: string;
  /** Victory conditions for this era. */
  allowed_victory_conditions: VictoryType[];
  /** Territory threshold % when 'threshold' is in conditions. */
  victory_threshold?: number;
  /**
   * Turn cap for this stage, overriding the campaign default. A survival stage
   * is decided by outlasting the clock holding the most ground, so it wants a
   * shorter one than a conquest stage.
   */
  max_turns?: number;
  /** AI faction ids, one per AI seat, in seat order. */
  ai_factions: string[];
  ai_difficulty: AiDifficulty;
  ai_count: number;
  /** Starting unit modifier for human player. Negative = harder start. */
  starting_unit_modifier: number;
  /** Narrative text shown before the era begins. */
  intro_text: string;
  /** Narrative text shown after winning this era. */
  outro_win_text: string;
  /** Narrative text shown after losing this era. */
  outro_loss_text: string;
  /** Carry-forward deltas applied on win (merged into path_carry). */
  carry_on_win: Partial<PathCarry>;
  /** Carry-forward deltas applied on loss. */
  carry_on_loss: Partial<PathCarry>;
}

export interface CampaignPath {
  path_id: PathId;
  name: string;
  tagline: string;
  description: string;
  /** Which carry key is the signature stat shown prominently in the UI. */
  signature_carry_key: keyof PathCarry;
  /** Human-readable label for the signature carry stat. */
  signature_carry_label: string;
  /** Max value for the signature carry stat (for progress display). */
  signature_carry_max: number;
  /**
   * How hard the path is next to the others, for its card on the selection
   * screen: the screen gave a newcomer nothing to choose between three paths by.
   */
  difficulty: 'standard' | 'hard' | 'hardest';
  /** The path the selection screen marks as the one to start with. Exactly one. */
  recommended_start: boolean;
  /**
   * A guest can play the path while `guest_campaign_enabled` is on. Open a
   * path once every stage of it states its goal, runs on a clock and sits on
   * a measured difficulty curve: a guest's first campaign is this one.
   */
  guest_open: boolean;
  /**
   * Carry the path starts stage one holding. A path whose stages hand the
   * player a starting-unit deficit has to hand them the compensating stat with
   * it, or stage one is the only stage played without the thing the path is
   * about: measured on the engine, The Last Defenders' ww2 stage went from a
   * 0% to a 25% win rate on nothing but two points of Survivor Bonus.
   */
  initial_carry: Partial<PathCarry>;
  /**
   * The stages, by index. Where the path has `lines`, the stages from
   * `choose_at` on are the default line's, so a reader that knows nothing of
   * lines still gets a whole path.
   */
  eras: PathEraConfig[];
  /** The path lets the player take a side partway through, and keep it. */
  lines?: CampaignLines;
}

export interface CampaignLine {
  line_id: LineId;
  /** The side, as the choice names it. */
  name: string;
  /** One or two sentences on what choosing it means. */
  pitch: string;
  /** This line's stages by index: every stage from `choose_at` to the last. */
  eras: Record<number, PathEraConfig>;
}

export interface CampaignLines {
  /** Index of the stage that offers the choice. Every later stage follows it. */
  choose_at: number;
  /** The line a campaign with none stored plays: one older than the choice. */
  default_line: LineId;
  options: CampaignLine[];
}

// ── Blood & Empire, stages 4 to 6: two lines ───────────────────────────
//
// The twentieth century is played from one of two sides, chosen at stage 4 and
// kept to the end. Each stage stages a named campaign and states its objective
// (`mission`): the player wins by completing it, a bot by eliminating the
// player or by holding the most ground when the clock runs out.
//
// Win rates, simCampaignStages over two seeds of 40 games, Medium stand-in then
// Expert: Allies 39% / 44%, 44% / 55%, 39% / 53%; Soviets 51% / 70%, 39% / 68%,
// 33% / 51%. An objective the stand-in could not reach was changed, not left
// hard: Cuba sits six territories from the Soviet homeland and was taken in
// none of 40 games, and "eliminate the Rogue State" was completed in one.

const ALLIES_WW2: PathEraConfig = {
  era: 'ww2',
  map_id: 'era_ww2',
  title: 'The Second Front, 1944',
  locked_faction: 'usa',
  allowed_victory_conditions: ['secret_mission'],
  mission: { kind: 'control_regions', region_ids: ['western_front'] },
  max_turns: 30,
  ai_factions: ['germany', 'japan', 'soviet_union'],
  ai_difficulty: 'medium',
  ai_count: 3,
  starting_unit_modifier: 0,
  intro_text: 'June 1944. Four years of occupation are about to end the way they began: from the sea. You command the Western Allies, with American industry behind you and an armada pointed at the coast of France. The Third Reich holds the continent and Imperial Japan holds the Pacific. In the east the Red Army is already driving on Berlin: an ally today, and a rival for the peace tomorrow. Objective: liberate the Western Front by holding every territory in it. If the thirtieth turn ends first, whoever holds the most ground dictates the terms.',
  outro_win_text: 'Paris, Rome, the Rhine, Berlin. The war in Europe ends with the Western Allies holding the continent they came to free. Prestige carries that victory into the long peace that follows, which will not be peaceful.',
  outro_loss_text: 'The second front stalls short of the Rhine, and the map of Europe is drawn by someone else. The landing craft are still there. So is the coast.',
  carry_on_win: { prestige_bonus: 2 },
  carry_on_loss: { prestige_bonus: 0 },
};

const SOVIETS_WW2: PathEraConfig = {
  era: 'ww2',
  map_id: 'era_ww2',
  title: 'Berlin and Manchuria, 1945',
  locked_faction: 'soviet_union',
  allowed_victory_conditions: ['secret_mission'],
  mission: { kind: 'capture_territories', territory_ids: ['germany', 'manchuria_ww2'] },
  max_turns: 30,
  ai_factions: ['germany', 'japan', 'usa'],
  ai_difficulty: 'expert',
  ai_count: 3,
  starting_unit_modifier: 0,
  intro_text: 'The invader reached the gates of Moscow and the banks of the Volga, and was thrown back from both. Now the Red Army goes west. You command the Soviet Union on the road from Stalingrad to Berlin, and once Germany falls, east against Japan\'s army in Manchuria. The Western Allies are ashore in France, and whoever reaches the heart of Germany first shapes what comes after. Objective: capture Germany and Manchuria, and hold both. If the thirtieth turn ends first, whoever holds the most ground dictates the terms.',
  outro_win_text: 'The red banner flies over the Reichstag, and three months later the Kwantung Army lays down its arms in Manchuria. Prestige carries the weight of that victory into the age of the bomb.',
  outro_loss_text: 'The offensive runs out of road before it runs out of enemies. The front holds where it stands, and the Stavka draws up the next plan.',
  carry_on_win: { prestige_bonus: 2 },
  carry_on_loss: { prestige_bonus: 0 },
};

const ALLIES_COLD_WAR: PathEraConfig = {
  era: 'coldwar',
  map_id: 'era_coldwar',
  title: 'Thirteen Days, 1962',
  locked_faction: 'usa_cw',
  allowed_victory_conditions: ['secret_mission'],
  mission: { kind: 'control_regions', region_ids: ['north_america_cw', 'latin_america'] },
  max_turns: 35,
  ai_factions: ['ussr', 'china_cw', 'decolonization_movement'],
  ai_difficulty: 'hard',
  ai_count: 3,
  starting_unit_modifier: 0,
  intro_text: 'The war is won and the alliance that won it is gone. Two powers with the bomb now face each other across every ocean, and the contest has come home: a revolution in Havana, missile sites ninety miles off Florida, and thirteen days in October 1962 when the world held its breath. You command the United States. Objective: hold all of North America and Latin America, the whole hemisphere. If the thirty-fifth turn ends first, whoever holds the most ground has won the argument.',
  outro_win_text: 'The ships turn back, the missiles come out, and the hemisphere is quiet. Prestige is the weight of a superpower that did not blink.',
  outro_loss_text: 'The quarantine line does not hold, and the hemisphere is no longer yours alone. The hotline is still open.',
  carry_on_win: { prestige_bonus: 2 },
  carry_on_loss: { prestige_bonus: 0 },
};

const SOVIETS_COLD_WAR: PathEraConfig = {
  era: 'coldwar',
  map_id: 'era_coldwar',
  title: 'Pyongyang and Hanoi, 1950',
  locked_faction: 'ussr',
  allowed_victory_conditions: ['secret_mission'],
  mission: { kind: 'capture_territories', territory_ids: ['korea_cw', 'vietnam_korea'] },
  max_turns: 35,
  ai_factions: ['usa_cw', 'nato_proxy', 'china_cw'],
  ai_difficulty: 'easy',
  ai_count: 3,
  starting_unit_modifier: 0,
  intro_text: 'You hold everything from the Elbe to the Pacific, and every mile of it is ringed with bases. Europe is frozen in place, so the contest has moved to Asia: a peninsula divided at the 38th parallel, and a colonial war in Indochina that is about to become something larger. You command the Soviet Union, and Beijing, an ally on paper, is no longer taking instructions. Objective: capture Korea and Vietnam & Indochina, and hold both. If the thirty-fifth turn ends first, whoever holds the most ground has won the argument.',
  outro_win_text: 'Friendly governments in Pyongyang and Hanoi, and a border that now runs to the South China Sea. Prestige is a superpower that can no longer be contained on a map.',
  outro_loss_text: 'The armistice line holds where it was drawn, and the advisers come home. The ring of bases is still there, and so is the next opening.',
  carry_on_win: { prestige_bonus: 2 },
  carry_on_loss: { prestige_bonus: 0 },
};

const ALLIES_MODERN: PathEraConfig = {
  era: 'modern',
  map_id: 'era_modern',
  title: 'The Atlantic Order',
  locked_faction: 'western_power',
  allowed_victory_conditions: ['secret_mission'],
  mission: { kind: 'control_regions', region_ids: ['north_america', 'europe'] },
  max_turns: 40,
  ai_factions: ['eastern_bloc', 'rogue_state', 'emerging_power', 'petro_state'],
  ai_difficulty: 'expert',
  ai_count: 4,
  // The finale, and with what a winning run carries into it (two Prestige dice
  // for five rounds) the stand-in won 60% at even strength: the easiest stage
  // of the line. Eight units down it is 34% over two seeds of 80 games, 46%
  // for the expert stand-in.
  starting_unit_modifier: -8,
  intro_text: 'The wall came down and for a decade the order you built had no rival. That decade is over. Precision strikes, satellites and sanctions are every power\'s tools now, and four of them are testing how much of the alliance is still an alliance. Objective: hold all of North America and Europe, both shores of the Atlantic. If the fortieth turn ends first, whoever holds the most ground writes the next set of rules.',
  outro_win_text: 'Blood & Empire ends where it began: one power, one map, and a history written by the side that held together. From the Second Front to the present, the Atlantic held.',
  outro_loss_text: 'Every order ends. This one was built on a beach in Normandy, and it was a long way from there to here.',
  carry_on_win: { prestige_bonus: 2 },
  carry_on_loss: { prestige_bonus: 0 },
};

const SOVIETS_MODERN: PathEraConfig = {
  era: 'modern',
  map_id: 'era_modern',
  title: 'The Southern Flank',
  locked_faction: 'eastern_bloc',
  allowed_victory_conditions: ['secret_mission'],
  mission: { kind: 'capture_territories', territory_ids: ['iran_mod', 'turkey_mod'] },
  max_turns: 40,
  ai_factions: ['rogue_state', 'western_power', 'emerging_power', 'petro_state'],
  // Expert, for the same reason as the Allied finale: 50% on Hard with the
  // carry counted, 35% on Expert over two seeds of 80 games (65% for the
  // expert stand-in). A deficit on top took it to 33% by wiping the player
  // out in two games of five.
  ai_difficulty: 'expert',
  ai_count: 4,
  starting_unit_modifier: 0,
  intro_text: 'The bloc you led did not survive the century, but the power at its centre did. Now a rogue state on your southern flank has slipped every treaty it ever signed, and it is arming faster than anyone can sanction it. The straits and the plateau south of your border are the two doors it has to be shut behind. Objective: capture Turkey and Iran, and hold both. If the fortieth turn ends first, whoever holds the most ground writes the next set of rules.',
  outro_win_text: 'Blood & Empire ends where it began: one power, one map, and a history written by the side still standing. From Stalingrad to the present, the centre held.',
  outro_loss_text: 'Every order ends. This one began in the ruins of Stalingrad, and it was a long way from there to here.',
  carry_on_win: { prestige_bonus: 2 },
  carry_on_loss: { prestige_bonus: 0 },
};

// ── Path 1: Blood & Empire ──────────────────────────────────────────────

const BLOOD_EMPIRE: CampaignPath = {
  path_id: 'blood_empire',
  name: 'Blood & Empire',
  tagline: 'Conquer the world — era after era.',
  description: 'You are history\'s great empire-builders. Each era you command a power at the height of its reach, and in the twentieth century you choose which side to fight on. Take the greater share of the map, or the objective you are given, before the clock runs out — every era you win earns Prestige, extra attack dice for your opening turns in the next.',
  signature_carry_key: 'prestige_bonus',
  signature_carry_label: 'Prestige',
  signature_carry_max: 12,
  difficulty: 'standard',
  recommended_start: true,
  guest_open: true,
  // Rome starts the path at full strength and takes no deficit anywhere in it,
  // so prestige is purely earned.
  initial_carry: {},
  eras: [
    {
      era: 'ancient',
      map_id: 'era_ancient',
      locked_faction: 'rome',
      // The path's opener, and the first campaign stage most players meet: a
      // share of the map against a clock, on Easy. As a domination stage it
      // ran to the 100-turn cap (an average of 95 turns for the stand-in, 79
      // for an expert one) and the stand-in won 35% of them. Half the map in
      // 25 turns ended on turn 19 on average with the stand-in winning 67%
      // (simCampaignStages, two seeds); dealt its homeland, as every campaign
      // seat now is, Rome wins 83% in 19 turns and 100% in 9 for the expert.
      allowed_victory_conditions: ['threshold'],
      victory_threshold: 50,
      max_turns: 25,
      ai_factions: ['parthia', 'germanic_tribes', 'han'],
      ai_difficulty: 'easy',
      ai_count: 3,
      starting_unit_modifier: 0,
      intro_text: 'From seven hills, Rome eyes the known world. Parthia bleeds invaders dry, Germanic war bands wait in the dark forests, and at the far end of the Silk Road the Han court answers to no one. The Republic survives by making everyone else understand the cost of resistance. Hold half the map, or simply hold more of it than any rival when the twenty-fifth turn ends.',
      outro_win_text: 'The eagle flies from the Rhine to the Euphrates. Prestige carries the memory of Rome\'s iron discipline into every age that follows.',
      outro_loss_text: 'Even Rome falls, eventually. The legions who fought leave their bones in foreign earth, and the next emperor will know what not to repeat.',
      carry_on_win: { prestige_bonus: 2 },
      carry_on_loss: { prestige_bonus: 0 },
    },
    {
      era: 'medieval',
      map_id: 'era_medieval',
      locked_faction: 'mongol_empire',
      // A share of the map against a clock, like the opener (86 turns and 18%
      // for the stand-in as a domination stage). Two seats, not three: on a
      // 30-turn clock the Caliphate out-holds everyone, and with it seated the
      // stage is 28% whatever else is set. The two left are the two the
      // stage's own text rides through. Dealt their homeland the Mongols start
      // on the steppe with its bonus, and two Easy seats at 55% were a
      // walkover (100% in 12 turns), so the seats are Medium and the line 60%:
      // 83% for the stand-in in 17 turns, 98% for the expert one in 9.
      allowed_victory_conditions: ['threshold'],
      victory_threshold: 60,
      max_turns: 30,
      ai_factions: ['byzantine', 'hre'],
      ai_difficulty: 'medium',
      ai_count: 2,
      starting_unit_modifier: 0,
      intro_text: 'The steppes are your launching ground. Silk Road cities, Byzantine walls, and Crusader kingdoms all underestimate what coordinated cavalry can do to a feudal line. Ride through them before they coordinate a defense. Hold 60% of the map, or lead it when the thirtieth turn ends.',
      outro_win_text: 'The Pax Mongolica spans half the world. Every trade route runs through your yam network. Prestige swells with the terror of your name.',
      outro_loss_text: 'The steppes reclaim their armies. History will remember the reach, if not the permanence.',
      carry_on_win: { prestige_bonus: 2 },
      carry_on_loss: { prestige_bonus: 0 },
    },
    {
      era: 'discovery',
      map_id: 'era_discovery',
      locked_faction: 'spain',
      // The same shape again, and the hardest of the three openers. The seats
      // are the powers Spain met abroad, not its neighbours: Portugal and
      // England share Spain's European homeland, and dealt it three ways
      // Spain won 15% (with either one alone, 5-10%). Against the Ottomans,
      // the Mughals and the Ming, each on its own ground: 53% for the
      // stand-in in 28 turns, 68% for the expert one in 26.
      allowed_victory_conditions: ['threshold'],
      victory_threshold: 55,
      max_turns: 30,
      ai_factions: ['ottoman', 'ming_china', 'mughal'],
      ai_difficulty: 'easy',
      ai_count: 3,
      starting_unit_modifier: 0,
      intro_text: 'Gold and God justify the crossing. The Ottomans hold the eastern routes, the Mughal court commands the wealth of India, and Ming China watches from behind its walls. Your advantage is ruthlessness and the element of surprise. Hold 55% of the map, or lead it when the thirtieth turn ends.',
      outro_win_text: 'Silver pours from Potosi. The Spanish Empire straddles the globe, and prestige rides on the back of the treasure fleet.',
      outro_loss_text: 'Another power will claim the New World. The routes remain; the ships will sail again.',
      carry_on_win: { prestige_bonus: 2 },
      carry_on_loss: { prestige_bonus: 0 },
    },
    ALLIES_WW2,
    ALLIES_COLD_WAR,
    ALLIES_MODERN,
  ],
  lines: {
    choose_at: 3,
    default_line: 'allies',
    options: [
      {
        line_id: 'allies',
        name: 'The Western Allies',
        pitch: 'Land in France and fight to the heart of Germany. Then hold the Atlantic alliance together through the Cold War and after it.',
        eras: { 3: ALLIES_WW2, 4: ALLIES_COLD_WAR, 5: ALLIES_MODERN },
      },
      {
        line_id: 'soviets',
        name: 'The Soviet Union',
        pitch: 'Drive the invader back from the Volga to Berlin, then turn on Japan\'s army in Manchuria. Then lead the Eastern bloc through the Cold War and after it.',
        eras: { 3: SOVIETS_WW2, 4: SOVIETS_COLD_WAR, 5: SOVIETS_MODERN },
      },
    ],
  },
};

// ── Path 2: The Revolutionary Flame ────────────────────────────────────

const REVOLUTIONARY_FLAME: CampaignPath = {
  path_id: 'revolutionary_flame',
  name: 'The Revolutionary Flame',
  tagline: 'History from below. The Flame never dies.',
  description: 'You are always the revolutionary — reformer, rebel, the mob. Each era sets you one objective, and it is never to conquer the map. Your Revolutionary Spirit grows with every era you win and rallies extra reinforcements to your cause each turn.',
  signature_carry_key: 'revolutionary_spirit',
  signature_carry_label: 'Revolutionary Spirit',
  signature_carry_max: 10,
  difficulty: 'hardest',
  recommended_start: false,
  guest_open: true,
  initial_carry: { revolutionary_spirit: 2 },
  eras: [
    {
      era: 'ancient',
      map_id: 'era_ancient',
      locked_faction: 'rome',
      title: 'The Republic\'s Sea',
      allowed_victory_conditions: ['secret_mission'],
      mission: { kind: 'control_regions', region_ids: ['roman_west', 'roman_east'] },
      max_turns: 30,
      // The lands around the inner sea, against a clock. With a mission dealt
      // at random this stage ran 60 turns for a 68% stand-in. Against the two
      // seats it had, the stated objective was done by turn 7 nine games in
      // ten; Carthage in a third seat makes it 78% in 23 turns (73% expert).
      ai_factions: ['parthia', 'germanic_tribes', 'carthage'],
      ai_difficulty: 'easy',
      ai_count: 3,
      starting_unit_modifier: 0,
      intro_text: 'Rome is a republic, not yet an empire, and the Senate is a battlefield of factions. Carthage watches the sea lanes, Parthia the eastern roads and the Germanic tribes the forests. Your mission is not conquest for its own sake: bring the lands around the inner sea under one law, and show governance where tyrants only demand tribute. Objective: hold every territory in the Roman West and the Roman East. If the thirtieth turn ends first, whoever holds the most ground has made the better case.',
      outro_win_text: 'The Republic\'s institutions hold. Revolutionary Spirit ignites: the model of citizen governance will echo through history.',
      outro_loss_text: 'The Republic fractures under pressure. But the idea survives in fragments.',
      carry_on_win: { revolutionary_spirit: 2, prestige_bonus: 1 },
      carry_on_loss: {},
    },
    {
      era: 'medieval',
      map_id: 'era_medieval',
      locked_faction: 'byzantine',
      title: 'The Komnenian Restoration',
      allowed_victory_conditions: ['secret_mission'],
      mission: { kind: 'capture_territories', territory_ids: ['anatolia_med', 'levant_crusader'] },
      max_turns: 30,
      // Two seats, the two the objective is taken from and defended against.
      // Who sits decides this stage more than how well they play: with the
      // Holy Roman Empire in a seat the stand-in won 13-23% at any level, and
      // against the Mongols and the Caliphate on Medium it won 93%. Expert,
      // those two give 48% in 20 turns (90% for the expert stand-in).
      ai_factions: ['mongol_empire', 'caliphate'],
      ai_difficulty: 'expert',
      ai_count: 2,
      starting_unit_modifier: 0,
      intro_text: 'Constantinople is the last ember of Rome. Anatolia was lost at Manzikert, the Caliphate holds the roads to the Holy Land, and the Mongols are riding in from the east. Under the Komnenoi the empire took back what it had lost, by statecraft as much as by the sword. Objective: capture Anatolia and the Crusader States, and hold both. If the thirtieth turn ends first, whoever holds the most ground keeps the purple.',
      outro_win_text: 'Anatolia and the coast road are Roman again. Byzantium endures another century, the flame passes, and the libraries survive.',
      outro_loss_text: 'The walls fall eventually. But the books were copied.',
      carry_on_win: { revolutionary_spirit: 2, prestige_bonus: 1 },
      carry_on_loss: {},
    },
    {
      era: 'discovery',
      map_id: 'era_discovery',
      locked_faction: 'england_discovery',
      title: 'Virginia and the Spanish Main',
      allowed_victory_conditions: ['secret_mission'],
      mission: { kind: 'capture_territories', territory_ids: ['north_america_east', 'new_spain'] },
      max_turns: 30,
      // A colony and a raid: 35% in 23 turns for the stand-in, 50% for the
      // expert one. The Atlantic route in place of New Spain was done by
      // turn 8 in four games of five, and all of North America in none of 40.
      ai_factions: ['spain', 'ottoman', 'portugal'],
      ai_difficulty: 'medium',
      ai_count: 3,
      starting_unit_modifier: 0,
      intro_text: 'England\'s crown is not absolute. Parliament has teeth, and merchant adventurers and privateers are building an empire without waiting for a king\'s permission: a colony on the James River, and raids on the treasure ports of New Spain. Spain and Portugal have divided the world between them, and nobody asked England. Objective: capture Eastern North America and New Spain, and hold both. If the thirtieth turn ends first, whoever holds the most ground has the better claim.',
      outro_win_text: 'A colony that governs itself, and a Spanish treasure fleet that never reached Seville. The Glorious Revolution is prefigured here.',
      outro_loss_text: 'The colony starves and the privateers come home empty. History files this failure under "useful precedent."',
      carry_on_win: { revolutionary_spirit: 2, prestige_bonus: 1 },
      carry_on_loss: {},
    },
    {
      // The American Revolution on the ACW map. The factions must come from
      // the era this stage actually runs under (ww2, per CAMPAIGN_ERAS), or
      // getFactionById returns undefined and both sides play factionless:
      // usa are the colonists, uk the Crown, germany the Hessians alongside it.
      era: 'ww2',
      map_id: 'era_acw',
      locked_faction: 'usa',
      title: 'From Boston to Yorktown',
      allowed_victory_conditions: ['secret_mission'],
      // The seaboard, from New England to Georgia. As a 60% threshold on this
      // 18-territory board the stage was over on turn 6 and won 8% of the
      // time: a share any seat could cross before the player had moved. Two
      // named territories were taken by turn 7 in four games of five.
      // With the west neutral and six units down: 42% for the stand-in in 21
      // turns, 74% for the expert one (two seeds).
      mission: { kind: 'control_regions', region_ids: ['union_northeast', 'confederate_east'] },
      // The board is the Civil War's, eighty years on. The war of 1775-83 was
      // fought on the seaboard, over the mountains behind it and along the
      // Gulf, where Spain took British West Florida. The lands west of the
      // Mississippi had no part in it and belong to neither side here. With
      // Alabama and the river neutral as well the board is ten territories,
      // and the stand-in won 70% of a stage that was over by turn 12.
      neutral_territories: ['acw_louisiana', 'acw_arkansas', 'acw_missouri', 'acw_plains', 'acw_texas', 'acw_far_west'],
      // The stage runs on the WW2 era's rules and factions. What it is called
      // on screen is 1776's.
      display: {
        era_label: 'The American Revolution',
        factions: { usa: 'Continental Congress', uk: 'The Crown', germany: 'Hessian Regiments' },
        objective: 'Hold the Atlantic seaboard: every territory of the Northeast & Lakes and Atlantic regions',
      },
      max_turns: 30,
      ai_factions: ['uk', 'germany'],
      ai_difficulty: 'hard',
      ai_count: 2,
      starting_unit_modifier: -6,
      intro_text: 'The colonists do not want to be a province. The Crown\'s armies are professional, better supplied and backed by the most powerful navy in the world, with Hessian regiments hired to fight beside them. You hold interior lines, local knowledge and the desperation of people with nowhere else to go. The lands west of the Mississippi belong to neither side. Objective: hold the Atlantic seaboard, every territory of the Northeast & Lakes and of the Atlantic region, from New England to Georgia. If the thirtieth turn ends first, whoever holds the most ground decides whether this was a revolution or a rebellion.',
      outro_win_text: 'Yorktown. The empire leaves. Revolutionary Spirit carries the muscle memory of asymmetric persistence.',
      outro_loss_text: 'This revolution was ahead of its time. The next one will remember this failure.',
      carry_on_win: { revolutionary_spirit: 2, prestige_bonus: 1 },
      carry_on_loss: {},
    },
    {
      era: 'coldwar',
      map_id: 'era_coldwar',
      title: 'Winds of Change',
      locked_faction: 'decolonization_movement',
      allowed_victory_conditions: ['secret_mission'],
      mission: { kind: 'control_regions', region_ids: ['africa_cw', 'middle_east_cw'] },
      max_turns: 35,
      // The flame, in the Cold War, is the movement neither bloc owns. As the
      // Soviet Union on a domination stage this ran 88 turns for a 13%
      // stand-in. Africa and the Middle East against the two blocs and the
      // old colonial powers: 40% in 32 turns on Easy (65% expert); 23% on Medium.
      ai_factions: ['usa_cw', 'ussr', 'nato_proxy'],
      ai_difficulty: 'easy',
      ai_count: 3,
      starting_unit_modifier: 0,
      intro_text: 'Two blocs have divided the world, and neither asked the people who live in it. From Accra to Cairo to Bandung a third answer is taking shape: independence, and alignment with no one. You lead the movement. Washington, Moscow and the old colonial capitals of Europe each have plans for your continent. Objective: hold every territory in Africa and the Middle East. If the thirty-fifth turn ends first, whoever holds the most ground speaks for the rest.',
      outro_win_text: 'The flags come down in one capital after another, and nobody replaces them with a superpower\'s. Revolutionary Spirit is now the vote of half the world.',
      outro_loss_text: 'The blocs carve up the map as they meant to. The winds have not stopped blowing.',
      carry_on_win: { revolutionary_spirit: 2, prestige_bonus: 1 },
      carry_on_loss: {},
    },
    {
      era: 'modern',
      map_id: 'era_modern',
      locked_faction: 'rogue_state',
      title: 'The Last Ember',
      allowed_victory_conditions: ['secret_mission'],
      // Taken, and still held when round 15 comes. Three reinforcements a turn,
      // what Revolutionary Spirit is worth by now, took the region in 18 turns
      // more often than not (56%) and no deficit, fifth seat or shorter clock
      // changed that. Having to hold it does: the other powers come for it
      // (aiBot STAND_SIEGE_BONUS). 30% over two seeds, 40% for the expert
      // stand-in; with Africa added to the objective it was 17%.
      mission: { kind: 'control_regions', region_ids: ['middle_east'], from_round: 15 },
      max_turns: 40,
      // The whole of the player's own region, which the Petrostate shares:
      // 33% in 28 turns for the stand-in (50% expert), where a mission dealt
      // at random gave 8% (25%).
      ai_factions: ['western_power', 'eastern_bloc', 'petro_state', 'emerging_power'],
      ai_difficulty: 'expert',
      ai_count: 4,
      starting_unit_modifier: 0,
      intro_text: 'You are small, sanctioned and surrounded. But Revolutionary Spirit at this level makes every occupied territory a front. A petrostate shares your region and four powers have interests in it. Objective: hold every territory in the Middle East & North Africa when round 15 comes, with no other power\'s flag anywhere in it. Take it sooner and they will come to take it back; lose it and you can retake it. If the fortieth turn ends first, whoever holds the most ground has outlasted the rest.',
      outro_win_text: 'The Revolutionary Flame burned through every era and refused to be extinguished. History does not belong only to the powerful.',
      outro_loss_text: 'The last ember goes out. But it lit fires history will not forget.',
      carry_on_win: { revolutionary_spirit: 2, prestige_bonus: 1 },
      carry_on_loss: {},
    },
  ],
};

// ── Path 3: The Last Defenders ──────────────────────────────────────────

const LAST_DEFENDERS: CampaignPath = {
  path_id: 'last_defenders',
  name: 'The Last Defenders',
  tagline: 'Outnumbered. Outgunned. Still standing.',
  description: 'You are always the underdog — civilizations at the moment of existential threat. Survival IS victory: each era you start on your homeland, outnumbered, and win by still holding it when the round you are given comes. Your Survivor Bonus adds defense dice on home ground. For those who believe in holding the line.',
  signature_carry_key: 'survivor_bonus',
  signature_carry_label: 'Survivor Bonus',
  signature_carry_max: 8,
  difficulty: 'hard',
  recommended_start: false,
  guest_open: true,
  initial_carry: { survivor_bonus: 2 },
  eras: [
    {
      // A stand: the tribes start on their forests and win by still holding
      // them when round 12 comes. As a 55% share of the map this stage asked
      // the defenders to out-conquer Rome. Medium seats: 63% for the stand-in
      // in 17 turns, 75% for the expert one (88% and 95% against Easy).
      era: 'ancient',
      map_id: 'era_ancient',
      title: 'The Teutoburg Forest',
      locked_faction: 'germanic_tribes',
      allowed_victory_conditions: ['secret_mission'],
      mission: { kind: 'control_regions', region_ids: ['germanic', 'northern_frontier'], from_round: 12 },
      max_turns: 25,
      ai_factions: ['rome', 'carthage', 'parthia'],
      ai_difficulty: 'medium',
      ai_count: 3,
      starting_unit_modifier: -4,
      intro_text: 'Rome does not ask permission. Three legions have crossed the Rhine and the Senate has already declared the forests a province. You have no roads, no siege engines and no allies: only trees, ambushes, and the knowledge that every mile the legions march is a mile they must defend. Objective: still hold every territory of the Germanic Lands and the Northern Frontier when round 12 comes. Lose one and you can take it back; if the twenty-fifth turn ends first, whoever holds the most ground owns the forest.',
      outro_win_text: 'Varus and his three legions do not return. The Rhine becomes Rome\'s permanent frontier. Survivor Bonus grows from the knowledge that terrain is a weapon.',
      outro_loss_text: 'The forests fall to engineering. But the chieftains who survived learned how Rome thinks.',
      carry_on_win: { survivor_bonus: 2, prestige_bonus: 1 },
      carry_on_loss: {},
    },
    {
      // Three besiegers, and the Mongols are one of them again. As a capital
      // stage they took Constantinople by turn 6 in every game; a stand lets
      // the city fall and be retaken. Expert, three units down: 43% for the
      // stand-in in 23 turns, 55% for the expert one (30% and 50% six down;
      // 68% and 90% against two seats).
      era: 'medieval',
      map_id: 'era_medieval',
      title: 'The Walls of Constantinople',
      locked_faction: 'byzantine',
      allowed_victory_conditions: ['secret_mission'],
      mission: { kind: 'control_regions', region_ids: ['eastern_europe'], from_round: 15 },
      max_turns: 30,
      ai_factions: ['hre', 'caliphate', 'mongol_empire'],
      ai_difficulty: 'expert',
      ai_count: 3,
      starting_unit_modifier: -3,
      intro_text: 'The Mongols have shattered every kingdom east of the Danube and will reach the walls soon enough. The Crusaders who came to help looted your city once already, and the Caliphate\'s armies are camped outside. Objective: still hold every territory of Eastern Europe, Constantinople and the lands that feed it, when round 15 comes. What falls can be retaken; if the thirtieth turn ends first, whoever holds the most ground holds the city. Let history record that it stood.',
      outro_win_text: 'Constantinople survives the medieval catastrophe. The Church, the libraries, the Greek language — all preserved. Survivor Bonus carries the weight of what was saved.',
      outro_loss_text: 'The city falls in 1453 in every version of history. The libraries burned slowly.',
      carry_on_win: { survivor_bonus: 2, prestige_bonus: 1 },
      carry_on_loss: {},
    },
    {
      // The seats decide a stand: against Spain, Portugal and England, whose
      // homelands are a continent away, nobody came and the stand-in won 90%.
      // The Mughals share a border. With them, Expert: 50% in 23 turns, 53%
      // for the expert stand-in.
      era: 'discovery',
      map_id: 'era_discovery',
      title: 'The Sea Ban',
      locked_faction: 'ming_china',
      allowed_victory_conditions: ['secret_mission'],
      mission: { kind: 'control_regions', region_ids: ['ming_china'], from_round: 15 },
      max_turns: 30,
      ai_factions: ['portugal', 'spain', 'mughal'],
      ai_difficulty: 'expert',
      ai_count: 3,
      starting_unit_modifier: -3,
      intro_text: 'Portuguese caravels probe the coast. Spanish silver buys political leverage. On the land frontier the Mughal court is counting your garrisons. The Yongle Emperor built a wall and burned the treasure fleet: it did not save the dynasty, but it bought time. Objective: still hold every territory of Ming China when round 15 comes. What is lost can be retaken; if the thirtieth turn ends first, whoever holds the most ground writes the treaty.',
      outro_win_text: 'The Middle Kingdom holds its borders through the Age of Discovery. The isolation costs — but survival is its own kind of victory.',
      outro_loss_text: 'The treaty ports open. History files this under "unequal treaties." The dynasty survives on paper.',
      carry_on_win: { survivor_bonus: 2, prestige_bonus: 1 },
      carry_on_loss: {},
    },
    {
      // The island and the desert, the two places Britain could not lose in
      // 1940. Two Expert seats, five units down: 45% for the stand-in in 24
      // turns, 68% for the expert one (57% and 68% two down). As a 55% share
      // of the map it was 15% and 45%.
      era: 'ww2',
      map_id: 'era_ww2',
      title: 'Their Finest Hour, 1940',
      locked_faction: 'uk',
      allowed_victory_conditions: ['secret_mission'],
      mission: { kind: 'control_regions', region_ids: ['british_isles', 'north_africa_th'], from_round: 15 },
      max_turns: 30,
      ai_factions: ['germany', 'japan'],
      ai_difficulty: 'expert',
      ai_count: 2,
      starting_unit_modifier: -5,
      intro_text: 'Dunkirk is over. France is gone. The Luftwaffe is assembling. You hold an island, a navy, and the stubborn conviction that this is not over. The USA has not yet entered the war. Objective: still hold the British Isles and every territory of North Africa when round 15 comes: the island, and the desert road to the oil. What is lost can be retaken; if the thirtieth turn ends first, whoever holds the most ground dictates the peace.',
      outro_win_text: 'Britain stands alone and standing is enough. The Allies will come. Survivor Bonus grows from the knowledge that holding is a form of winning.',
      outro_loss_text: 'Even the darkest hour eventually ends.',
      carry_on_win: { survivor_bonus: 2, prestige_bonus: 1 },
      carry_on_loss: {},
    },
    {
      // Four Expert seats, and a long stand: round 26 of 35. Africa has no
      // seat's homeland on its border, so the round is the lever here: 63%
      // for the stand-in in 30 turns and 57% for the expert one, against 80%
      // and 73% at round 18. Dealt missions gave 20%, half of them lost to an
      // objective the player could not see.
      era: 'coldwar',
      map_id: 'era_coldwar',
      title: 'The Year of Africa, 1960',
      locked_faction: 'decolonization_movement',
      allowed_victory_conditions: ['secret_mission'],
      mission: { kind: 'control_regions', region_ids: ['africa_cw'], from_round: 26 },
      max_turns: 35,
      ai_factions: ['usa_cw', 'ussr', 'nato_proxy', 'uk_cw'],
      ai_difficulty: 'expert',
      ai_count: 4,
      starting_unit_modifier: -3,
      intro_text: 'The empires retreated but left their borders. Washington and Moscow both want your allegiance, and each will destabilize your government if you refuse to choose. Seventeen nations raise their own flags this year. Objective: still hold every territory of Africa when round 26 comes. What is lost can be retaken; if the thirty-fifth turn ends first, whoever holds the most ground drew the borders. Do not let the superpowers\' proxy war become your civil war.',
      outro_win_text: 'Non-alignment survives the Cold War. Survivor Bonus becomes sovereignty.',
      outro_loss_text: 'The Cold War carved new nations into old wounds. But the independence movements cannot be unmade.',
      carry_on_win: { survivor_bonus: 2, prestige_bonus: 1 },
      carry_on_loss: {},
    },
    {
      // The finale is the longest stand: round 36 of 40, against five Expert
      // seats, sixteen units down. With three Survivor dice at home, what a
      // winning run carries here, a stand to round 30 against three seats was
      // won 57% of the time: easier than the path's second stage. This is 35%
      // over two seeds of 80 games. No one lever did it: two more seats 48%,
      // the later round 45%, ten units down with both 42%. The player is
      // wiped out in about a quarter of games, as in the path's other sieges.
      era: 'modern',
      map_id: 'era_modern',
      title: 'Under Sanction',
      locked_faction: 'rogue_state',
      allowed_victory_conditions: ['secret_mission'],
      mission: { kind: 'control_regions', region_ids: ['middle_east'], from_round: 36 },
      max_turns: 40,
      ai_factions: ['western_power', 'eastern_bloc', 'emerging_power', 'petro_state', 'cyber_power'],
      ai_difficulty: 'expert',
      ai_count: 5,
      starting_unit_modifier: -16,
      intro_text: 'Sanctioned, surrounded and targeted. Precision airstrikes and economic isolation are the tools of an age that prefers clean wars. Five powers are arguing over who owns the map, and your region is on every one of their tables. Objective: still hold every territory of the Middle East & North Africa when round 36 comes. What is lost can be retaken; if the fortieth turn ends first, whoever holds the most ground has won the argument. Prove that a small nation can survive a superpower\'s attention long enough to become inconvenient rather than conquerable.',
      outro_win_text: 'The Last Defenders held. Through six eras of overwhelming force, the underdog found a way. History belongs to survivors too.',
      outro_loss_text: 'Every empire needs an enemy to justify itself. The Last Defenders gave them a worthy one.',
      carry_on_win: { survivor_bonus: 2, prestige_bonus: 1 },
      carry_on_loss: {},
    },
  ],
};

// ── Registry ────────────────────────────────────────────────────────────

export const CAMPAIGN_PATHS: Record<PathId, CampaignPath> = {
  blood_empire: BLOOD_EMPIRE,
  revolutionary_flame: REVOLUTIONARY_FLAME,
  last_defenders: LAST_DEFENDERS,
};

export const CAMPAIGN_PATH_LIST: CampaignPath[] = [
  BLOOD_EMPIRE,
  REVOLUTIONARY_FLAME,
  LAST_DEFENDERS,
];

/** Whether a guest may play this path. The classic campaign, with no path, is never open. */
export function pathOpenToGuests(pathId: string | null | undefined): boolean {
  return !!pathId && CAMPAIGN_PATHS[pathId as PathId]?.guest_open === true;
}

/**
 * The line a campaign plays: the one it stored if the path still offers it,
 * the path's default otherwise, and none on a path with no lines.
 */
export function resolveLineId(pathId: PathId | null | undefined, stored: unknown): LineId | null {
  const lines = pathId ? CAMPAIGN_PATHS[pathId]?.lines : undefined;
  if (!lines) return null;
  return lines.options.find((o) => o.line_id === stored)?.line_id ?? lines.default_line;
}

/** A stage's config, on the given line where the path has them. */
export function getPathEraConfig(
  pathId: PathId,
  eraIndex: number,
  lineId?: LineId | string | null,
): PathEraConfig | null {
  const path = CAMPAIGN_PATHS[pathId];
  if (!path) return null;
  const lines = path.lines;
  if (lines && eraIndex >= lines.choose_at) {
    const line = lines.options.find((o) => o.line_id === resolveLineId(pathId, lineId));
    const onLine = line?.eras[eraIndex];
    if (onLine) return onLine;
  }
  return path.eras[eraIndex] ?? null;
}

/**
 * Every stage a player can be dealt, each line's included: what a test or the
 * stage simulator has to cover. `path.eras` alone misses every line but the
 * default.
 */
export function allCampaignStages(): Array<{
  path: CampaignPath;
  index: number;
  line_id: LineId | null;
  stage: PathEraConfig;
}> {
  const out: ReturnType<typeof allCampaignStages> = [];
  for (const path of CAMPAIGN_PATH_LIST) {
    path.eras.forEach((stage, index) => {
      const lines = path.lines;
      if (!lines || index < lines.choose_at) {
        out.push({ path, index, line_id: null, stage });
        return;
      }
      for (const option of lines.options) {
        const onLine = option.eras[index];
        if (onLine) out.push({ path, index, line_id: option.line_id, stage: onLine });
      }
    });
  }
  return out;
}

/** What a line's choice shows: the side, and the stage it opens on. */
export function describeLineChoice(pathId: PathId | null | undefined, stored: unknown): {
  choose_at: number;
  /** The line this campaign has taken, or null while it has taken none. */
  chosen: LineId | null;
  options: Array<{
    line_id: LineId;
    name: string;
    pitch: string;
    title: string | null;
    faction_id: string | null;
  }>;
} | null {
  const lines = pathId ? CAMPAIGN_PATHS[pathId]?.lines : undefined;
  if (!lines) return null;
  return {
    choose_at: lines.choose_at,
    chosen: lines.options.find((o) => o.line_id === stored)?.line_id ?? null,
    options: lines.options.map((o) => ({
      line_id: o.line_id,
      name: o.name,
      pitch: o.pitch,
      title: o.eras[lines.choose_at]?.title ?? null,
      faction_id: o.eras[lines.choose_at]?.locked_faction ?? null,
    })),
  };
}
