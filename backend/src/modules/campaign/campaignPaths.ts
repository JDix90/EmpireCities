// ============================================================
// Campaign Paths — static configuration for narrative campaigns
// ============================================================

import type { VictoryType, AiDifficulty, CampaignStageMission } from '../../types';

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
  starting_unit_modifier: 0,
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
  ai_difficulty: 'hard',
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
  description: 'You are always the revolutionary — reformer, rebel, the mob. Secret missions matter more than brute conquest. Your Revolutionary Spirit grows with every era you win and rallies extra reinforcements to your cause each turn.',
  signature_carry_key: 'revolutionary_spirit',
  signature_carry_label: 'Revolutionary Spirit',
  signature_carry_max: 10,
  difficulty: 'hard',
  recommended_start: false,
  guest_open: false,
  initial_carry: { revolutionary_spirit: 2 },
  eras: [
    {
      era: 'ancient',
      map_id: 'era_ancient',
      locked_faction: 'rome',
      allowed_victory_conditions: ['secret_mission'],
      // Two openers, not three. The ancient balance pass gave the Germanic
      // tribes a homeland they can hold, which is worth about nine points to
      // whoever plays them — here that is the opposition, and this stage fell
      // from 44% to 26% on it. Dropping the third seat put it back at 44%.
      // The stage's own text names no faction, so which three was never the
      // point; how many of them open on the player is.
      ai_factions: ['parthia', 'germanic_tribes'],
      ai_difficulty: 'easy',
      ai_count: 2,
      starting_unit_modifier: 0,
      intro_text: 'Rome is a republic, not yet an empire, and the Senate is a battlefield of factions. Foreign powers probe the borders. Your mission is not conquest — hold the regions that define Roman identity and demonstrate governance where tyrants only demand tribute.',
      outro_win_text: 'The Republic\'s institutions hold. Revolutionary Spirit ignites: the model of citizen governance will echo through history.',
      outro_loss_text: 'The Republic fractures under pressure. But the idea survives in fragments.',
      carry_on_win: { revolutionary_spirit: 2, prestige_bonus: 1 },
      carry_on_loss: {},
    },
    {
      era: 'medieval',
      map_id: 'era_medieval',
      locked_faction: 'byzantine',
      allowed_victory_conditions: ['secret_mission'],
      ai_factions: ['mongol_empire', 'hre', 'caliphate'],
      ai_difficulty: 'medium',
      ai_count: 3,
      starting_unit_modifier: 0,
      intro_text: 'Constantinople is the last ember of Rome, surrounded by Mongols from the east, Crusaders who looted your city once, and an Abbasid world that has outthought the West for centuries. Hold the capital regions. Survive through statecraft, not just swords.',
      outro_win_text: 'Byzantium endures another century. The flame passes. The libraries survive.',
      outro_loss_text: 'The walls fall eventually. But the books were copied.',
      carry_on_win: { revolutionary_spirit: 2, prestige_bonus: 1 },
      carry_on_loss: {},
    },
    {
      era: 'discovery',
      map_id: 'era_discovery',
      locked_faction: 'england_discovery',
      allowed_victory_conditions: ['secret_mission'],
      ai_factions: ['spain', 'ottoman', 'portugal'],
      ai_difficulty: 'medium',
      ai_count: 3,
      starting_unit_modifier: 0,
      intro_text: 'England\'s crown is not absolute. Parliament has teeth. Merchant adventurers and privateers build an empire without kings needing to ask permission. Form an unlikely alliance with one rival power — revolutionary ideas travel on trade ships.',
      outro_win_text: 'The Glorious Revolution is prefigured here. An alliance holds where dominance would have failed.',
      outro_loss_text: 'Coalitions are fragile. History files this failure under "useful precedent."',
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
      allowed_victory_conditions: ['threshold'],
      victory_threshold: 60,
      max_turns: 40,
      ai_factions: ['uk', 'germany'],
      ai_difficulty: 'hard',
      ai_count: 2,
      starting_unit_modifier: -3,
      intro_text: 'The colonists do not want to be a province. The Crown\'s armies are professional, better-supplied, and backed by the most powerful navy in the world. You hold interior lines, local knowledge, and the desperation of people with nowhere else to go. Survive — hold 60% of the map, or lead it after forty turns — until the empire decides the cost is not worth the prize.',
      outro_win_text: 'Yorktown. The empire leaves. Revolutionary Spirit carries the muscle memory of asymmetric persistence.',
      outro_loss_text: 'This revolution was ahead of its time. The next one will remember this failure.',
      carry_on_win: { revolutionary_spirit: 2, prestige_bonus: 1 },
      carry_on_loss: {},
    },
    {
      era: 'coldwar',
      map_id: 'era_coldwar',
      locked_faction: 'ussr',
      allowed_victory_conditions: ['domination'],
      // Four seats, four named factions. A seat with no faction named plays
      // with none: no passive, no ability, no home region, and nothing for the
      // board to call it. The Non-Aligned Movement in the fourth: 13% for the
      // stand-in against 20% with the seat empty (the United Kingdom there made it 35%).
      ai_factions: ['usa_cw', 'china_cw', 'nato_proxy', 'decolonization_movement'],
      // Same reason: the Alliance is one of this stage's opponents, and the
      // stage dropped from 25% to 11%, a dip below the finale that follows it.
      // Medium restores it to 19% and the path reads as a ramp again.
      ai_difficulty: 'medium',
      ai_count: 4,
      starting_unit_modifier: 0,
      intro_text: 'The revolution succeeded. Now defend it. Every proxy war, every satellite state is a symptom of revolutionary ideology hardening into a state apparatus. Dominate before the contradictions collapse from within.',
      outro_win_text: 'The Soviet project endures its peak. Revolutionary Spirit turns institutional.',
      outro_loss_text: 'The wall will come down regardless. The Flame was always bigger than one state.',
      carry_on_win: { revolutionary_spirit: 2, prestige_bonus: 1 },
      carry_on_loss: {},
    },
    {
      era: 'modern',
      map_id: 'era_modern',
      locked_faction: 'rogue_state',
      allowed_victory_conditions: ['secret_mission'],
      // Four seats, four named factions. A seat with no faction named plays
      // with none: no passive, no ability, no home region, and nothing for the
      // board to call it. The Emerging Economy in the fourth: 13% for the
      // stand-in against 8% with the seat empty.
      ai_factions: ['western_power', 'eastern_bloc', 'petro_state', 'emerging_power'],
      ai_difficulty: 'expert',
      ai_count: 4,
      starting_unit_modifier: -2,
      intro_text: 'You are small, sanctioned, and surrounded. But Revolutionary Spirit at this level makes every occupied territory a front. Eliminate one superpower\'s presence from your region and prove the Flame outlasts every empire.',
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
  description: 'You are always the underdog — civilizations at the moment of existential threat. Survival IS victory: you start each era outnumbered, and your Survivor Bonus adds defense dice on home ground. The hardest path. For those who believe in holding the line.',
  signature_carry_key: 'survivor_bonus',
  signature_carry_label: 'Survivor Bonus',
  signature_carry_max: 8,
  difficulty: 'hardest',
  recommended_start: false,
  guest_open: false,
  initial_carry: { survivor_bonus: 2 },
  eras: [
    {
      era: 'ancient',
      map_id: 'era_ancient',
      locked_faction: 'germanic_tribes',
      allowed_victory_conditions: ['threshold'],
      victory_threshold: 55,
      max_turns: 30,
      ai_factions: ['rome', 'carthage', 'parthia'],
      // Easy: the one setting that moves this stage, because the deal decides
      // it. When the map merge in #586 re-dealt Asia, the tribes lost Central
      // Steppe, their road into the Steppe region, to Parthia and drew Southern
      // India in its place. The stand-in's wins at the 55% line fell from 29%
      // of games to 8%, and the stage from 43% to 27%, level with this path's
      // ww2 stage, so the opener had stopped being the way in. No deficit
      // (-4 to 0), threshold (50 to 65) or clock (25 to 40 turns) lifted it by
      // as much as two points, and every other choice of seats made it harder.
      // Easy puts it at 36%: the easiest stage of this path, and still the
      // hardest of the three openers.
      ai_difficulty: 'easy',
      ai_count: 3,
      starting_unit_modifier: -4,
      intro_text: 'Rome does not ask permission. Three legions have crossed the Rhine and the Senate has already declared the forests a province. You have no roads, no siege engines, and no allies — only trees, ambushes, and the knowledge that every mile the legions march is a mile they must defend. Hold 55% of the map, or simply hold more of it than Rome does when the thirtieth turn ends.',
      outro_win_text: 'Varus and his three legions do not return. The Rhine becomes Rome\'s permanent frontier. Survivor Bonus grows from the knowledge that terrain is a weapon.',
      outro_loss_text: 'The forests fall to engineering. But the chieftains who survived learned how Rome thinks.',
      carry_on_win: { survivor_bonus: 2, prestige_bonus: 1 },
      carry_on_loss: {},
    },
    {
      era: 'medieval',
      map_id: 'era_medieval',
      locked_faction: 'byzantine',
      allowed_victory_conditions: ['capital'],
      // A clock, to bound a stage that otherwise ran to a 47-turn average with
      // a tail at the 100-turn cap.
      max_turns: 40,
      // Two besiegers, not three. A capital victory means taking every other
      // seat's capital, so a third seat was a third fortified city to storm
      // from six units down: 0 wins in 100 games against three, 38 against
      // two with nothing else changed.
      // The two are the Crusaders and the Caliphate. The Mongols were one of
      // them until every campaign seat was dealt its homeland: theirs borders
      // Byzantium's, and with the steppe's bonus behind them they took
      // Constantinople by turn 6 in all 40 games, whatever the difficulty,
      // deficit or clock. They stay in the stage's text as what is coming.
      ai_factions: ['hre', 'caliphate'],
      // Expert and six units down put the siege where the path wants its
      // catastrophe beat: 18% for the stand-in, 50% for the expert one, in
      // 20-25 turns, as it measured with the Mongols before the deal changed.
      ai_difficulty: 'expert',
      ai_count: 2,
      starting_unit_modifier: -6,
      intro_text: 'The Mongols have shattered every kingdom east of the Danube and will reach the walls soon enough. The Crusaders who came to help looted your city once already, and the Caliphate\'s armies are camped outside. Hold Constantinople, then break those two armies — or simply still be holding more of the map than they do after forty turns. Let history record the city stood.',
      outro_win_text: 'Constantinople survives the medieval catastrophe. The Church, the libraries, the Greek language — all preserved. Survivor Bonus carries the weight of what was saved.',
      outro_loss_text: 'The city falls in 1453 in every version of history. The libraries burned slowly.',
      carry_on_win: { survivor_bonus: 2, prestige_bonus: 1 },
      carry_on_loss: {},
    },
    {
      era: 'discovery',
      map_id: 'era_discovery',
      locked_faction: 'ming_china',
      allowed_victory_conditions: ['threshold'],
      victory_threshold: 60,
      max_turns: 35,
      // Three colonial seats. A fourth (the Mughals) was added when Ming, on
      // a contiguous bloc, won 88% against three. Dealt their homelands the
      // four held Ming to 0% (23% for the expert stand-in), and with the
      // Mughals out it is 50% and 60% in 25 turns, at any deficit from three
      // units to six.
      ai_factions: ['spain', 'portugal', 'england_discovery'],
      ai_difficulty: 'hard',
      ai_count: 3,
      starting_unit_modifier: -3,
      intro_text: 'Portuguese caravels probe the coast. Spanish silver buys political leverage. English merchants want trading posts that become footholds. The Yongle Emperor built a wall and burned the treasure fleet — it did not save the dynasty, but it bought time. Hold 60% of the map against three powers probing at once, or lead it when the thirty-fifth turn ends.',
      outro_win_text: 'The Middle Kingdom holds its borders through the Age of Discovery. The isolation costs — but survival is its own kind of victory.',
      outro_loss_text: 'The treaty ports open. History files this under "unequal treaties." The dynasty survives on paper.',
      carry_on_win: { survivor_bonus: 2, prestige_bonus: 1 },
      carry_on_loss: {},
    },
    {
      era: 'ww2',
      map_id: 'era_ww2',
      locked_faction: 'uk',
      allowed_victory_conditions: ['threshold'],
      victory_threshold: 55,
      max_turns: 30,
      // Two besiegers, not three, for the same reason as this path's medieval
      // stage: the two are the ones the stage's own text has doing something.
      // Britain alone in 1940 is not fighting Nationalist China. This stage was
      // winnable at 24% only because the UK's homeland used to span Britain AND
      // all of continental western Europe, which is what left Germany sharing
      // its own homeland and unplayable; with the UK moved to its island and
      // its real theatres, three expert seats took it to 4%. Two put it at 21%.
      ai_factions: ['germany', 'japan'],
      ai_difficulty: 'expert',
      ai_count: 2,
      // Two units down, not five: with every seat dealt its homeland the
      // stage fell from 23% to 8% (48% to 15% for the expert stand-in), and
      // the smaller deficit puts it at 15% and 45%.
      starting_unit_modifier: -2,
      intro_text: 'Dunkirk is over. France is gone. The Luftwaffe is assembling. You hold an island, a navy, and the stubborn conviction that this is not over. The USA has not yet entered the war. Hold 55% of the map — your island, North Africa, and whatever remains of the Commonwealth lifelines — or lead it when the thirtieth turn ends.',
      outro_win_text: 'Britain stands alone and standing is enough. The Allies will come. Survivor Bonus grows from the knowledge that holding is a form of winning.',
      outro_loss_text: 'Even the darkest hour eventually ends.',
      carry_on_win: { survivor_bonus: 2, prestige_bonus: 1 },
      carry_on_loss: {},
    },
    {
      era: 'coldwar',
      map_id: 'era_coldwar',
      locked_faction: 'decolonization_movement',
      allowed_victory_conditions: ['secret_mission'],
      // Four seats, four named factions. A seat with no faction named plays
      // with none: no passive, no ability, no home region, and nothing for the
      // board to call it. The United Kingdom in the fourth, the empire the
      // stage's text has retreating: 18% for the stand-in against 25% with the seat empty.
      ai_factions: ['usa_cw', 'ussr', 'nato_proxy', 'uk_cw'],
      ai_difficulty: 'hard',
      ai_count: 4,
      starting_unit_modifier: -3,
      intro_text: 'The empires retreated but left their borders. The USA and USSR both want your allegiance and will destabilize your government if you refuse to choose. Control your three home regions. Do not let the superpowers\' proxy war become your civil war.',
      outro_win_text: 'Non-alignment survives the Cold War. Survivor Bonus becomes sovereignty.',
      outro_loss_text: 'The Cold War carved new nations into old wounds. But the independence movements cannot be unmade.',
      carry_on_win: { survivor_bonus: 2, prestige_bonus: 1 },
      carry_on_loss: {},
    },
    {
      era: 'modern',
      map_id: 'era_modern',
      locked_faction: 'rogue_state',
      // A shared land race is the one thing a seat five units down cannot
      // win. Set as a territory threshold — alongside secret_mission, which
      // gave each of the four AI seats two lanes to the player's one board —
      // the stand-in took 2% of 100 games, and no knob moved it past 7%:
      // fewer seats made it worse, because a smaller table hands every AI a
      // bigger share of the deal. A secret mission is a private objective
      // rather than a race, which is what this stage's own text promised all
      // along, and it takes the finale to 10% with the difficulty left where
      // a finale wants it.
      allowed_victory_conditions: ['secret_mission'],
      // The 35-turn clock was cutting off the games the player was on track to
      // win. A secret-mission stage is a race to finish a private objective,
      // and the weakest seat on the board finishes last: at 35 turns the
      // stand-in completed its mission in 28 of 300 games, at 50 turns in 45.
      // Measured by mission kind, no objective was the culprit — capture,
      // eliminate and control all landed between 6% and 11% — the player was
      // simply slower at all of them.
      max_turns: 50,
      // Three superpowers, the ones the stage names. The fourth seat was added
      // in #390 only because ai_count was 4 with three factions listed, and it
      // is one more racer the player has to beat to the finish: an AI completed
      // its mission first in 56% of games.
      ai_factions: ['western_power', 'eastern_bloc', 'petro_state'],
      ai_difficulty: 'expert',
      ai_count: 3,
      starting_unit_modifier: -4,
      intro_text: 'Sanctioned, surrounded, and targeted. Precision airstrikes and economic isolation are the tools of an age that prefers clean wars. Complete the one objective that matters to you while the powers argue over who owns the map — prove that a small nation can survive a superpower\'s attention long enough to become inconvenient rather than conquerable.',
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
