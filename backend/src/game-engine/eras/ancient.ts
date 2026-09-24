import type { Faction, TechNode, EraWonder } from './types';

// ── Factions ──────────────────────────────────────────────────────────────────
export const ANCIENT_FACTIONS: Faction[] = [
  {
    faction_id: 'rome',
    lineage_id: 'imperial',
    name: 'Roman Republic',
    // Copy fix, no balance change: Testudo negates the attacker's losses for
    // one assault, it is not a re-roll, and the reinforcement is flat rather
    // than conditional on Italic ground.
    description: 'Disciplined legions — +1 reinforcement per turn, and one assault each turn costs Rome nothing.',
    lore: 'A republic forged through citizen armies, road networks, and relentless campaigning, Rome expands by turning conquest into administration.',
    flavor_quote: 'The Senate debates. The legions decide.',
    home_region_ids: ['roman_west'],
    passive_attack_bonus: 0,   // legion_reroll is an era-wide modifier; rome gets reinforce bonus on top
    reinforce_bonus: 1,
    ability_id: 'testudo',
    ability_description: 'Testudo Formation: once per turn during attack phase, negate all attacker losses on one combat exchange.',
    color: '#c0392b',
    stability_recovery_bonus: 3,
  },
  {
    faction_id: 'parthia',
    lineage_id: 'bastion',
    name: 'Parthian Empire',
    // The Parthian Shot costs an attacker an extra unit when they take
    // Parthian ground. It has never removed an attack die, and it is not
    // scoped to Parthian territory, whatever this description claimed before.
    description: 'Caravan cities pay for the frontier: +3 reinforcements each turn, and anyone who takes Parthian ground loses an extra unit on the way in.',
    lore: 'Ruling the Iranian plateau from horseback and caravan city alike, Parthia bleeds invaders with mobility rather than static walls.',
    flavor_quote: 'Strike, vanish, and let the desert finish the rest.',
    home_region_ids: ['parthia'],
    // Parthia is the most boxed-in seat in the game: it opens with 0.3
    // uncontested neutral tiles against 3.0-4.5 for every other faction, and
    // four rival homelands on its border. Reinforcements scale with territory
    // count, so a faction that cannot expand cannot out-earn anyone — which is
    // why attack dice never lifted it off the floor and income did.
    //
    // 4 balanced the era better (spread 25 against 33) and is not shippable: an
    // AI does not need to play well to spend reinforcements, so an AI Parthia
    // at 4 went from opponent to executioner. It cut the player's win rate on
    // The Last Defenders' opening stage from 12% to 5% and eliminated them
    // outright in a fifth of the games it won. 3 costs three points of spread
    // and leaves that stage inside its own seed-to-seed variance.
    reinforce_bonus: 3,
    ability_id: 'parting_shot',
    ability_description: 'Parting Shot: after losing a territory, immediately deal 1 unit loss to the attacker.',
    color: '#8e44ad',
  },
  {
    faction_id: 'han',
    lineage_id: 'mercantile',
    name: 'Han Dynasty',
    // Silk Road granted tech points and nothing else, so in a normal game —
    // tech_trees_enabled defaults false — the era's strongest faction had no
    // ability at all. It won 38.8% of 1500 games on position and
    // reinforcements alone. The caravan levy is what makes it a kit; the tech
    // grant is kept for games with research switched on.
    description: 'Vast territory and organized bureaucracy — +2 reinforcements per turn, and the caravans bring a fresh levy.',
    lore: 'The Han state binds frontier armies, granaries, and court officials into one of the ancient world\'s most enduring imperial machines.',
    flavor_quote: 'Order the provinces, and the empire feeds itself.',
    home_region_ids: ['han_china'],
    reinforce_bonus: 2,
    ability_id: 'silk_road',
    ability_description: 'Silk Road: once per turn during draft, place 1 unit on a territory you hold — and +3 tech points where research is in play.',
    color: '#e67e22',
  },
  {
    faction_id: 'maurya',
    lineage_id: 'expansionist',
    name: 'Maurya Empire',
    // Copy fix, no balance change: the attack die is unconditional, and War
    // Elephants adds a second one once per turn. Whether it SHOULD be
    // conditional is a live question — see the era balance notes — but the
    // description has to match what the code does meanwhile.
    description: 'War elephants — +1 attack die on every assault, and a second die once per turn.',
    lore: 'From the Ganges heartland, Mauryan rulers project authority through elephant corps, tax officials, and a centralized imperial court.',
    flavor_quote: 'When the elephants move, kingdoms tremble.',
    home_region_ids: ['india'],
    passive_attack_bonus: 1,
    ability_id: 'war_elephants',
    ability_description: 'War Elephants: once per turn, one attack roll uses 4 dice (max).',
    color: '#27ae60',
  },
  {
    faction_id: 'carthage',
    lineage_id: 'maritime',
    name: 'Carthaginian Republic',
    // Carthage shipped with no ability and no numeric bonus of any kind, and
    // its description promised nothing either — the only faction in the game
    // whose entire kit was a sentence of scenery.
    //
    // It was not WEAK: 17% of 900 games against a 17% fair share, because
    // `africa` pays 5 for three territories, the densest region on the map. It
    // was just featureless, and it died for it — 47% eliminated while winning
    // its share, the profile of a seat that snowballs or collapses with nothing
    // in hand either way. A hired spear each turn puts it at 20.8% over five
    // seeds with elimination down to roughly 35%.
    //
    // Paying for that by trimming `africa` to 4 was measured across the same
    // five seeds and REJECTED: it does hold Carthage to 18.4%, but han rises
    // 38.8% -> 41.2% at every single seed and the era's spread goes 33.2 ->
    // 35.6. Making the region less worth fighting over helps the faction that
    // already runs the era, so the trim buys a tidier Carthage number by making
    // ancient's actual problem worse. The map is left alone; ancient's spread
    // is set by han at ~39% and germanic/parthia at ~6%, and Carthage is
    // neither.
    description: 'A maritime trading power anchored in North Africa — its gold hires a fresh spear every turn.',
    lore: 'Merchant princes and admirals make Carthage rich, turning harbors and trade routes into weapons that reach across the sea.',
    flavor_quote: 'Gold on the docks is power on the battlefield.',
    home_region_ids: ['africa'],
    ability_id: 'mercenary_levy',
    ability_description: 'Mercenary Levy: once per turn during draft, place 1 extra unit on a territory you hold.',
    color: '#2980b9',
  },
  {
    faction_id: 'germanic_tribes',
    lineage_id: 'insurgent',
    name: 'Germanic Tribes',
    // Copy fix, no balance change: this promised an innate defence die, which
    // no faction may have (factionDefense.test.ts). Ambush is an attack-phase
    // self-buff and always has been.
    description: 'Fierce forest fighters — one ambush each turn adds an attack die.',
    lore: 'Loose confederations of war bands and chieftains know every forest trail and river crossing, punishing empires that overextend.',
    flavor_quote: 'The woods are our walls.',
    // The steppe was never theirs — it belongs to horse nomads, and claiming it
    // smeared this faction from Gaul to Manchuria across a front it could not
    // hold. Scandinavia and the Volga are the Germanic and Gothic world, and
    // they join Germania into one northern block.
    home_region_ids: ['germanic', 'northern_frontier'],
    reinforce_bonus: 0,
    ability_id: 'ambush',
    ability_description: 'Ambush: once per turn, attack from a border territory using 1 extra die.',
    color: '#7f8c8d',
  },
];

// ── Tech Tree ─────────────────────────────────────────────────────────────────
export const ANCIENT_TECH_TREE: TechNode[] = [
  // Tier 1
  {
    tech_id: 'ancient_iron_weapons',
    name: 'Iron Weapons',
    description: 'Superior metallurgy grants +1 attack die on all attack rolls.',
    tier: 1,
    cost: 4,
    attack_bonus: 1,
  },
  {
    tech_id: 'ancient_stone_walls',
    name: 'Stone Walls',
    description: 'Permanent fortifications — unlocks the defense_1 building.',
    tier: 1,
    cost: 4,
    unlocks_building: 'defense_1',
  },
  {
    tech_id: 'ancient_granaries',
    name: 'Granaries',
    description: 'Improved food storage — unlocks the production_1 building.',
    tier: 1,
    cost: 3,
    unlocks_building: 'production_1',
  },
  {
    tech_id: 'ancient_roads',
    name: 'Roman Roads',
    description: 'Extended road network grants +1 extra reinforcement per turn.',
    tier: 1,
    cost: 4,
    reinforce_bonus: 1,
  },
  // Tier 2
  {
    tech_id: 'ancient_siege_engines',
    name: 'Siege Engines',
    description: 'Catapults and ballistae: when attacking a territory with a defense building, ignore its bonus.',
    tier: 2,
    prerequisite: 'ancient_iron_weapons',
    cost: 7,
    attack_bonus: 1,
    unlocks_ability: 'siege_attack',
  },
  {
    tech_id: 'ancient_fortified_camps',
    name: 'Fortified Camps',
    description: 'Permanent legion camps — unlocks the defense_2 building.',
    tier: 2,
    prerequisite: 'ancient_stone_walls',
    cost: 7,
    unlocks_building: 'defense_2',
  },
  {
    tech_id: 'ancient_trade_routes',
    name: 'Trade Routes',
    description: 'Organized trade generates +1 tech point per owned territory per turn (capped 10).',
    tier: 2,
    prerequisite: 'ancient_granaries',
    cost: 6,
    tech_point_income: 3,
    unlocks_building: 'tech_gen_1',
  },
  {
    tech_id: 'ancient_cavalry',
    name: 'Cavalry',
    description: 'Mounted units allow one free re-fortify move per turn (units > 3 territory).',
    tier: 2,
    prerequisite: 'ancient_roads',
    cost: 6,
    reinforce_bonus: 1,
    unlocks_ability: 'cavalry_march',
  },
  // Tier 3
  {
    tech_id: 'ancient_legion_tactics',
    name: 'Legion Tactics',
    description: 'Advanced formation tactics: attacker re-rolls lowest die on ALL exchanges (stacks with legion_reroll era modifier).',
    tier: 3,
    prerequisite: 'ancient_siege_engines',
    cost: 11,
    attack_bonus: 1,
  },
  {
    tech_id: 'ancient_fortresses',
    name: 'Fortresses',
    description: 'Continental fortresses — unlocks the defense_3 building.',
    tier: 3,
    prerequisite: 'ancient_fortified_camps',
    cost: 11,
    unlocks_building: 'defense_3',
  },
  {
    tech_id: 'ancient_great_library',
    name: 'Great Library',
    description: 'Centre of learning — unlocks the tech_gen_2 building and grants +2 tech points per turn.',
    tier: 3,
    prerequisite: 'ancient_trade_routes',
    cost: 10,
    tech_point_income: 2,
    unlocks_building: 'tech_gen_2',
  },
  // Tier 4
  {
    tech_id: 'ancient_pax_romana',
    name: 'Pax Romana',
    description: 'Era of peace and prosperity: gain +3 reinforcements per turn and +1 tech point per owned region.',
    tier: 4,
    prerequisite: 'ancient_legion_tactics',
    cost: 16,
    reinforce_bonus: 3,
    tech_point_income: 2,
    unlocks_ability: 'pax_romana',
  },
];

// ── Wonder ────────────────────────────────────────────────────────────────────
export const ANCIENT_WONDER: EraWonder = {
  wonder_id: 'wonder_colosseum',
  name: 'The Colosseum',
  description: 'Spectacles of power: +1 defense die in all territories you own.',
  cost: 18,
  passive_effect_type: 'defense_die_global',
  passive_effect_value: 1,
};
