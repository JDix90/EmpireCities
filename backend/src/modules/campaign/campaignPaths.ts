// ============================================================
// Campaign Paths — static configuration for narrative campaigns
// ============================================================

import type { VictoryType, AiDifficulty } from '../../types';

export type PathId = 'blood_empire' | 'revolutionary_flame' | 'last_defenders';

export interface PathCarry {
  /** Universal carry: attack bonus for first 3 turns of next era. */
  prestige_bonus: number;
  /** Last Defenders: +defense dice in home regions (stacks to 8). */
  survivor_bonus: number;
  /** Revolutionary Flame: +stability recovery per turn (stacks to 10). */
  revolutionary_spirit: number;
}

export interface PathEraConfig {
  era: string;
  /** Map override — set when a special map replaces the era default. */
  map_id: string;
  /** Player's faction is locked; faction picker is disabled in lobby. */
  locked_faction: string;
  /** Victory conditions for this era. */
  allowed_victory_conditions: VictoryType[];
  /** Territory threshold % when 'threshold' is in conditions. */
  victory_threshold?: number;
  /** AI faction ids to assign in order (fills with random if fewer than ai_count). */
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
  eras: PathEraConfig[];
}

// ── Path 1: Blood & Empire ──────────────────────────────────────────────

const BLOOD_EMPIRE: CampaignPath = {
  path_id: 'blood_empire',
  name: 'Blood & Empire',
  tagline: 'Conquer the world — era after era.',
  description: 'You are history\'s great empire-builders. Each era you command the apex offensive civilization of that period. Pure domination, maximum prestige — every victory doubles your carry-forward combat bonus.',
  signature_carry_key: 'prestige_bonus',
  signature_carry_label: 'Prestige',
  signature_carry_max: 12,
  eras: [
    {
      era: 'ancient',
      map_id: 'era_ancient',
      locked_faction: 'rome',
      allowed_victory_conditions: ['domination'],
      ai_factions: ['parthia', 'germanic_tribes', 'han'],
      ai_difficulty: 'medium',
      ai_count: 3,
      starting_unit_modifier: 0,
      intro_text: 'From seven hills, Rome eyes the known world. Carthage spreads its fleets, Parthia bleeds invaders dry, and Germanic war bands wait in the dark forests. The Republic survives by making everyone else understand the cost of resistance.',
      outro_win_text: 'The eagle flies from the Rhine to the Euphrates. Prestige carries the memory of Rome\'s iron discipline into every age that follows.',
      outro_loss_text: 'Even Rome falls, eventually. The legions who fought leave their bones in foreign earth, and the next emperor will know what not to repeat.',
      carry_on_win: { prestige_bonus: 2 },
      carry_on_loss: { prestige_bonus: 0 },
    },
    {
      era: 'medieval',
      map_id: 'era_medieval',
      locked_faction: 'mongol_empire',
      allowed_victory_conditions: ['domination'],
      ai_factions: ['byzantine', 'hre', 'abbasid_caliphate'],
      ai_difficulty: 'medium',
      ai_count: 3,
      starting_unit_modifier: 0,
      intro_text: 'The steppes are your launching ground. Silk Road cities, Byzantine walls, and Crusader kingdoms all underestimate what coordinated cavalry can do to a feudal line. Ride through them before they coordinate a defense.',
      outro_win_text: 'The Pax Mongolica spans half the world. Every trade route runs through your yam network. Prestige swells with the terror of your name.',
      outro_loss_text: 'The steppes reclaim their armies. History will remember the reach, if not the permanence.',
      carry_on_win: { prestige_bonus: 2 },
      carry_on_loss: { prestige_bonus: 0 },
    },
    {
      era: 'discovery',
      map_id: 'era_discovery',
      locked_faction: 'spain',
      allowed_victory_conditions: ['domination'],
      ai_factions: ['ottoman', 'portugal', 'england_discovery'],
      ai_difficulty: 'medium',
      ai_count: 3,
      starting_unit_modifier: 0,
      intro_text: 'Gold and God justify the crossing. The Ottomans hold the eastern routes, the Portuguese shadow your ships, and Ming China watches from behind its walls. Your advantage is ruthlessness and the element of surprise.',
      outro_win_text: 'Silver pours from Potosi. The Spanish Empire straddles the globe, and prestige rides on the back of the treasure fleet.',
      outro_loss_text: 'Another power will claim the New World. The routes remain; the ships will sail again.',
      carry_on_win: { prestige_bonus: 2 },
      carry_on_loss: { prestige_bonus: 0 },
    },
    {
      era: 'ww2',
      map_id: 'era_ww2',
      locked_faction: 'germany',
      allowed_victory_conditions: ['threshold'],
      victory_threshold: 70,
      ai_factions: ['soviet_union', 'usa', 'uk'],
      ai_difficulty: 'hard',
      ai_count: 3,
      starting_unit_modifier: 0,
      intro_text: 'Mechanized war has no sentiment. Blitzkrieg tears through static defenses. Total domination is not the goal — hold 70% of the map when the clock runs down and history calls it empire.',
      outro_win_text: 'The war map is yours. Prestige carries the cold logic of industrial warfare into the nuclear age.',
      outro_loss_text: 'Overreach was always the gamble. The Eastern Front does not forgive. Carry forward what you learned about supply lines.',
      carry_on_win: { prestige_bonus: 2 },
      carry_on_loss: { prestige_bonus: 0 },
    },
    {
      era: 'coldwar',
      map_id: 'era_coldwar',
      locked_faction: 'usa_cw',
      allowed_victory_conditions: ['domination'],
      ai_factions: ['ussr', 'china_cw', 'decolonization'],
      ai_difficulty: 'hard',
      ai_count: 4,
      starting_unit_modifier: 0,
      intro_text: 'The bombs ended one war and started another — of influence, proxy, and ideology. You don\'t need to occupy the world. You need to make it depend on you. Dominate the map before the Soviet bloc can harden.',
      outro_win_text: 'The Iron Curtain is rust. Prestige is now the weight of a unipolar world.',
      outro_loss_text: 'Multipolar reality asserts itself. History offers a second draft.',
      carry_on_win: { prestige_bonus: 2 },
      carry_on_loss: { prestige_bonus: 0 },
    },
    {
      era: 'modern',
      map_id: 'era_modern',
      locked_faction: 'western_power',
      allowed_victory_conditions: ['domination'],
      ai_factions: ['eastern_bloc', 'rogue_state', 'emerging_power'],
      ai_difficulty: 'expert',
      ai_count: 4,
      starting_unit_modifier: 0,
      intro_text: 'Precision strikes, satellite surveillance, and dollar-denominated debt. The battlefield is everywhere and nowhere. Dominate before asymmetric threats prove that empires dissolve without a single pitched battle.',
      outro_win_text: 'Blood and Empire ends where it began: one power, one map, one history written by the winner.',
      outro_loss_text: 'Every empire ends. The path was glorious.',
      carry_on_win: { prestige_bonus: 2 },
      carry_on_loss: { prestige_bonus: 0 },
    },
  ],
};

// ── Path 2: The Revolutionary Flame ────────────────────────────────────

const REVOLUTIONARY_FLAME: CampaignPath = {
  path_id: 'revolutionary_flame',
  name: 'The Revolutionary Flame',
  tagline: 'History from below. The Flame never dies.',
  description: 'You are always the revolutionary — reformer, rebel, the mob. Stability and secret missions matter more than brute conquest. Your Revolutionary Spirit grows even when you lose — some flames cannot be extinguished.',
  signature_carry_key: 'revolutionary_spirit',
  signature_carry_label: 'Revolutionary Spirit',
  signature_carry_max: 10,
  eras: [
    {
      era: 'ancient',
      map_id: 'era_ancient',
      locked_faction: 'rome',
      allowed_victory_conditions: ['secret_mission'],
      ai_factions: ['parthia', 'germanic_tribes', 'carthage'],
      ai_difficulty: 'easy',
      ai_count: 3,
      starting_unit_modifier: 0,
      intro_text: 'Rome is a republic, not yet an empire, and the Senate is a battlefield of factions. Foreign powers probe the borders. Your mission is not conquest — hold the regions that define Roman identity and demonstrate governance where tyrants only demand tribute.',
      outro_win_text: 'The Republic\'s institutions hold. Revolutionary Spirit ignites: the model of citizen governance will echo through history.',
      outro_loss_text: 'The Republic fractures under pressure. But the idea survives in fragments.',
      carry_on_win: { revolutionary_spirit: 2, prestige_bonus: 1 },
      carry_on_loss: { revolutionary_spirit: 1 },
    },
    {
      era: 'medieval',
      map_id: 'era_medieval',
      locked_faction: 'byzantine',
      allowed_victory_conditions: ['secret_mission'],
      ai_factions: ['mongol_empire', 'hre', 'abbasid_caliphate'],
      ai_difficulty: 'medium',
      ai_count: 3,
      starting_unit_modifier: 0,
      intro_text: 'Constantinople is the last ember of Rome, surrounded by Mongols from the east, Crusaders who looted your city once, and an Abbasid world that has outthought the West for centuries. Hold the capital regions. Survive through statecraft, not just swords.',
      outro_win_text: 'Byzantium endures another century. The flame passes. The libraries survive.',
      outro_loss_text: 'The walls fall eventually. But the books were copied.',
      carry_on_win: { revolutionary_spirit: 2, prestige_bonus: 1 },
      carry_on_loss: { revolutionary_spirit: 1 },
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
      carry_on_loss: { revolutionary_spirit: 1 },
    },
    {
      // The American Revolution — uses ACW map, Confederacy faction as colonial militia
      era: 'ww2',
      map_id: 'era_acw',
      locked_faction: 'confederacy',
      allowed_victory_conditions: ['threshold'],
      victory_threshold: 40,
      ai_factions: ['union'],
      ai_difficulty: 'hard',
      ai_count: 2,
      starting_unit_modifier: -3,
      intro_text: 'The colonists do not want to be a province. The Crown\'s armies are professional, better-supplied, and backed by the most powerful navy in the world. You hold interior lines, local knowledge, and the desperation of people with nowhere else to go. Survive — hold 40% — until the empire decides the cost is not worth the prize.',
      outro_win_text: 'Yorktown. The empire leaves. Revolutionary Spirit carries the muscle memory of asymmetric persistence.',
      outro_loss_text: 'This revolution was ahead of its time. The next one will remember this failure.',
      carry_on_win: { revolutionary_spirit: 2, prestige_bonus: 1 },
      carry_on_loss: { revolutionary_spirit: 1 },
    },
    {
      era: 'coldwar',
      map_id: 'era_coldwar',
      locked_faction: 'ussr',
      allowed_victory_conditions: ['domination'],
      ai_factions: ['usa_cw', 'china_cw', 'nato_proxy'],
      ai_difficulty: 'hard',
      ai_count: 4,
      starting_unit_modifier: 0,
      intro_text: 'The revolution succeeded. Now defend it. Every proxy war, every satellite state is a symptom of revolutionary ideology hardening into a state apparatus. Dominate before the contradictions collapse from within.',
      outro_win_text: 'The Soviet project endures its peak. Revolutionary Spirit turns institutional.',
      outro_loss_text: 'The wall will come down regardless. The Flame was always bigger than one state.',
      carry_on_win: { revolutionary_spirit: 2, prestige_bonus: 1 },
      carry_on_loss: { revolutionary_spirit: 1 },
    },
    {
      era: 'modern',
      map_id: 'era_modern',
      locked_faction: 'rogue_state',
      allowed_victory_conditions: ['secret_mission'],
      ai_factions: ['western_power', 'eastern_bloc', 'petro_state'],
      ai_difficulty: 'expert',
      ai_count: 4,
      starting_unit_modifier: -2,
      intro_text: 'You are small, sanctioned, and surrounded. But Revolutionary Spirit at this level makes every occupied territory a front. Eliminate one superpower\'s presence from your region and prove the Flame outlasts every empire.',
      outro_win_text: 'The Revolutionary Flame burned through every era and refused to be extinguished. History does not belong only to the powerful.',
      outro_loss_text: 'The last ember goes out. But it lit fires history will not forget.',
      carry_on_win: { revolutionary_spirit: 2, prestige_bonus: 1 },
      carry_on_loss: { revolutionary_spirit: 1 },
    },
  ],
};

// ── Path 3: The Last Defenders ──────────────────────────────────────────

const LAST_DEFENDERS: CampaignPath = {
  path_id: 'last_defenders',
  name: 'The Last Defenders',
  tagline: 'Outnumbered. Outgunned. Still standing.',
  description: 'You are always the underdog — civilizations at the moment of existential threat. Survival IS victory. Threshold conditions shrink each era while your Survivor Bonus stacks defensive dice. The hardest path. For those who believe in holding the line.',
  signature_carry_key: 'survivor_bonus',
  signature_carry_label: 'Survivor Bonus',
  signature_carry_max: 8,
  eras: [
    {
      era: 'ancient',
      map_id: 'era_ancient',
      locked_faction: 'germanic_tribes',
      allowed_victory_conditions: ['threshold'],
      victory_threshold: 35,
      ai_factions: ['rome', 'rome', 'carthage'],
      ai_difficulty: 'hard',
      ai_count: 3,
      starting_unit_modifier: -4,
      intro_text: 'Rome does not ask permission. Three legions have crossed the Rhine and the Senate has already declared the forests a province. You have no roads, no siege engines, and no allies — only trees, ambushes, and the knowledge that every mile the legions march is a mile they must defend. Hold 35%.',
      outro_win_text: 'Varus and his three legions do not return. The Rhine becomes Rome\'s permanent frontier. Survivor Bonus grows from the knowledge that terrain is a weapon.',
      outro_loss_text: 'The forests fall to engineering. But the chieftains who survived learned how Rome thinks.',
      carry_on_win: { survivor_bonus: 2, prestige_bonus: 1 },
      carry_on_loss: { survivor_bonus: 1 },
    },
    {
      era: 'medieval',
      map_id: 'era_medieval',
      locked_faction: 'byzantine',
      allowed_victory_conditions: ['capital'],
      ai_factions: ['mongol_empire', 'hre', 'abbasid_caliphate'],
      ai_difficulty: 'hard',
      ai_count: 3,
      starting_unit_modifier: -4,
      intro_text: 'The Mongols have shattered every kingdom east of the Danube. The Crusaders who came to help looted your city once already. The Caliphate watches the walls from outside. Hold Constantinople. Not expand — hold. Let history record the city stood.',
      outro_win_text: 'Constantinople survives the medieval catastrophe. The Church, the libraries, the Greek language — all preserved. Survivor Bonus carries the weight of what was saved.',
      outro_loss_text: 'The city falls in 1453 in every version of history. The libraries burned slowly.',
      carry_on_win: { survivor_bonus: 2, prestige_bonus: 1 },
      carry_on_loss: { survivor_bonus: 1 },
    },
    {
      era: 'discovery',
      map_id: 'era_discovery',
      locked_faction: 'ming_china',
      allowed_victory_conditions: ['threshold'],
      victory_threshold: 50,
      ai_factions: ['spain', 'portugal', 'england_discovery'],
      ai_difficulty: 'hard',
      ai_count: 3,
      starting_unit_modifier: -3,
      intro_text: 'Portuguese caravels probe the coast. Spanish silver buys political leverage. English merchants want trading posts that become footholds. The Yongle Emperor built a wall and burned the treasure fleet — it did not save the dynasty, but it bought time. Hold 50% against three colonial powers probing simultaneously.',
      outro_win_text: 'The Middle Kingdom holds its borders through the Age of Discovery. The isolation costs — but survival is its own kind of victory.',
      outro_loss_text: 'The treaty ports open. History files this under "unequal treaties." The dynasty survives on paper.',
      carry_on_win: { survivor_bonus: 2, prestige_bonus: 1 },
      carry_on_loss: { survivor_bonus: 1 },
    },
    {
      era: 'ww2',
      map_id: 'era_ww2',
      locked_faction: 'uk',
      allowed_victory_conditions: ['threshold'],
      victory_threshold: 30,
      ai_factions: ['germany', 'japan', 'italy'],
      ai_difficulty: 'expert',
      ai_count: 3,
      starting_unit_modifier: -5,
      intro_text: 'Dunkirk is over. France is gone. The Luftwaffe is assembling. You hold an island, a navy, and the stubborn conviction that this is not over. The USA has not yet entered the war. Hold 30% — your island, North Africa, and whatever remains of the Commonwealth lifelines.',
      outro_win_text: 'Britain stands alone and standing is enough. The Allies will come. Survivor Bonus grows from the knowledge that holding is a form of winning.',
      outro_loss_text: 'Even the darkest hour eventually ends.',
      carry_on_win: { survivor_bonus: 2, prestige_bonus: 1 },
      carry_on_loss: { survivor_bonus: 1 },
    },
    {
      era: 'coldwar',
      map_id: 'era_coldwar',
      locked_faction: 'decolonization',
      allowed_victory_conditions: ['secret_mission'],
      ai_factions: ['usa_cw', 'ussr', 'nato_proxy'],
      ai_difficulty: 'hard',
      ai_count: 4,
      starting_unit_modifier: -3,
      intro_text: 'The empires retreated but left their borders. The USA and USSR both want your allegiance and will destabilize your government if you refuse to choose. Control your three home regions. Do not let the superpowers\' proxy war become your civil war.',
      outro_win_text: 'Non-alignment survives the Cold War. Survivor Bonus becomes sovereignty.',
      outro_loss_text: 'The Cold War carved new nations into old wounds. But the independence movements cannot be unmade.',
      carry_on_win: { survivor_bonus: 2, prestige_bonus: 1 },
      carry_on_loss: { survivor_bonus: 1 },
    },
    {
      era: 'modern',
      map_id: 'era_modern',
      locked_faction: 'rogue_state',
      allowed_victory_conditions: ['threshold', 'secret_mission'],
      victory_threshold: 25,
      ai_factions: ['western_power', 'eastern_bloc', 'petro_state'],
      ai_difficulty: 'expert',
      ai_count: 4,
      starting_unit_modifier: -5,
      intro_text: 'Sanctioned, surrounded, and targeted. Precision airstrikes and economic isolation are the tools of an age that prefers clean wars. Hold 25% of the map and complete your secret mission — prove that a small nation can survive a superpower\'s attention long enough to become inconvenient rather than conquerable.',
      outro_win_text: 'The Last Defenders held. Through six eras of overwhelming force, the underdog found a way. History belongs to survivors too.',
      outro_loss_text: 'Every empire needs an enemy to justify itself. The Last Defenders gave them a worthy one.',
      carry_on_win: { survivor_bonus: 2, prestige_bonus: 1 },
      carry_on_loss: { survivor_bonus: 1 },
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

export function getPathEraConfig(pathId: PathId, eraIndex: number): PathEraConfig | null {
  return CAMPAIGN_PATHS[pathId]?.eras[eraIndex] ?? null;
}
