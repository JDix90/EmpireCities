import type { Faction, TechNode, EraWonder } from './types';

// ── Factions ──────────────────────────────────────────────────────────────────
export const WW2_FACTIONS: Faction[] = [
  {
    faction_id: 'germany',
    lineage_id: 'imperial',
    name: 'Third Reich',
    description: 'Blitzkrieg doctrine — after a successful capture, may make one immediate bonus attack per turn.',
    lore: 'A mechanized war machine built on shock and tempo, Germany seeks to collapse fronts before attrition can catch up.',
    flavor_quote: 'Break the line before the enemy remembers how wide it is.',
    home_region_ids: ['western_front'],
    passive_attack_bonus: 1,
    ability_id: 'blitzkrieg',
    ability_description: 'Blitzkrieg: once per turn, after capturing a territory immediately execute a free additional attack from that territory.',
    color: '#7f8c8d',
  },
  {
    faction_id: 'soviet_union',
    lineage_id: 'insurgent',
    name: 'Soviet Union',
    // Copy fix, no balance change: wartime_logistics is a tech node, not this
    // faction's ability. Mass Mobilization is, and it is once per game.
    description: 'Vast reserves — +2 reinforcements per turn, and once per game a mass mobilisation places five extra units.',
    lore: 'Factories beyond the Urals and endless manpower let the Soviet state trade land for time and return with crushing mass.',
    flavor_quote: 'If the first line falls, build a second behind it.',
    home_region_ids: ['eastern_front'],
    reinforce_bonus: 2,
    ability_id: 'mass_mobilization',
    ability_description: 'Mass Mobilization: once per game, place 5 extra units on any owned territory.',
    color: '#c0392b',
  },
  {
    faction_id: 'usa',
    lineage_id: 'mercantile',
    name: 'United States',
    // Copy fix, no balance change: there is no per-territory production here.
    // The passive is a flat reinforcement, and the Arsenal is tech-costed, so
    // it does nothing at all in a game with tech trees off — which is the
    // default, and every campaign stage.
    description: 'Industrial supremacy — +1 reinforcement per turn; where research is in play, the Arsenal of Democracy turns it into materiel.',
    lore: 'Protected by oceans and powered by industry, the United States converts economic depth into global military reach.',
    flavor_quote: 'Assembly lines win wars long before the landing craft arrive.',
    home_region_ids: ['atlantic_th'],
    reinforce_bonus: 1,
    ability_id: 'arsenal_of_democracy',
    ability_description: 'Arsenal of Democracy: once per turn during draft, spend 5 production points to place 3 extra units.',
    color: '#3498db',
  },
  {
    faction_id: 'uk',
    lineage_id: 'maritime',
    name: 'United Kingdom',
    description: 'Island fortress and global empire — recovers stability quickly in contested ground.',
    lore: 'Britain survives through naval control, imperial links, and the stubborn advantage of making every approach expensive.',
    flavor_quote: 'Rule the routes, and the island cannot be isolated.',
    home_region_ids: ['western_front', 'north_africa_th'],
    color: '#e74c3c',
    stability_recovery_bonus: 3,
  },
  {
    faction_id: 'japan',
    lineage_id: 'expansionist',
    name: 'Imperial Japan',
    // Copy fix, no balance change, and the most misleading of the set: the
    // attack die is UNCONDITIONAL, not regional, and no faction but Portugal
    // raises the sea-lane dice cap (see Naval Charts in combatModifiers).
    // Japan measures as the strongest seat in the era, and this description
    // was hiding why. Whether the bonus should become regional as written is
    // a balance question, not a copy one.
    description: 'Pacific supremacy — +1 attack die on every assault, and a banzai charge adds another once per turn.',
    lore: 'Fast carrier warfare and aggressive expansion define Japan at its peak, where initiative matters more than margin for error.',
    flavor_quote: 'In the first storm of war, strike farther than they thought possible.',
    home_region_ids: ['pacific_theatre'],
    passive_attack_bonus: 1,
    ability_id: 'banzai_charge',
    ability_description: 'Banzai Charge: once per turn, one attack exchange uses 4 attack dice (maximum).',
    color: '#e67e22',
  },
  {
    faction_id: 'china_ww2',
    lineage_id: 'bastion',
    name: 'Chinese Nationalists',
    // Copy fix, no balance change: another innate defence die that cannot
    // exist, and the reserve costs nothing — Guerrilla Warfare places one
    // free unit on ground you already hold.
    description: 'Guerrilla resistance — once per turn, a hidden reserve places a free unit on ground you hold.',
    lore: 'Fighting across fractured provinces, Chinese resistance depends on endurance, local knowledge, and refusing decisive collapse.',
    flavor_quote: 'Hold long enough, and the invader begins fighting the land itself.',
    home_region_ids: ['china_theatre'],
    ability_id: 'guerrilla_warfare',
    ability_description: 'Guerrilla Warfare: once per turn, place 1 unit on any owned territory for free.',
    color: '#27ae60',
  },
];

// ── Tech Tree ─────────────────────────────────────────────────────────────────
export const WW2_TECH_TREE: TechNode[] = [
  // Tier 1
  {
    tech_id: 'ww2_motorization',
    name: 'Motorization',
    description: 'Logistical vehicles — wartime_logistics grants 3 fortify moves (up from 2).',
    tier: 1,
    cost: 5,
    reinforce_bonus: 1,
    unlocks_ability: 'motorized_logistics',
  },
  {
    tech_id: 'ww2_bunkers',
    name: 'Bunker Network',
    description: 'Reinforced defensive positions — unlocks defense_1 building.',
    tier: 1,
    cost: 4,
    unlocks_building: 'defense_1',
  },
  {
    tech_id: 'ww2_war_industry',
    name: 'War Industry',
    description: 'Convert civilian industry to military production — unlocks production_1 building.',
    tier: 1,
    cost: 4,
    unlocks_building: 'production_1',
  },
  {
    tech_id: 'ww2_radio',
    name: 'Radio Communications',
    description: 'Coordinated troop movements — +1 reinforcement per turn.',
    tier: 1,
    cost: 3,
    reinforce_bonus: 1,
  },
  // Tier 2
  {
    tech_id: 'ww2_tanks',
    name: 'Tank Divisions',
    description: 'Armored spearheads — +1 attack die on all ground attacks.',
    tier: 2,
    prerequisite: 'ww2_motorization',
    cost: 9,
    attack_bonus: 1,
  },
  {
    tech_id: 'ww2_fortifications',
    name: 'Maginot-Line Fortifications',
    description: 'Deep defensive works — unlocks defense_2 building.',
    tier: 2,
    prerequisite: 'ww2_bunkers',
    cost: 8,
    unlocks_building: 'defense_2',
  },
  {
    tech_id: 'ww2_munitions',
    name: 'Mass Munitions',
    description: 'Industrial-scale weapons production — unlocks tech_gen_1 building and +2 tech per turn.',
    tier: 2,
    prerequisite: 'ww2_war_industry',
    cost: 7,
    tech_point_income: 2,
    unlocks_building: 'tech_gen_1',
  },
  {
    tech_id: 'ww2_air_support',
    name: 'Tactical Air Support',
    description: 'Coordinated artillery and airstrikes — one attack per turn deals 1 bonus damage before dice roll.',
    tier: 2,
    prerequisite: 'ww2_radio',
    cost: 8,
    unlocks_ability: 'air_strike',
  },
  // Tier 3
  {
    tech_id: 'ww2_panzer_tactics',
    name: 'Panzer Tactics',
    description: 'Armored penetration doctrine — blitzkrieg ability fires twice per turn.',
    tier: 3,
    prerequisite: 'ww2_tanks',
    cost: 13,
    attack_bonus: 1,
    unlocks_ability: 'double_blitz',
  },
  {
    tech_id: 'ww2_fortress_europe',
    name: 'Fortress Europe',
    description: 'Atlantic Wall-style defenses — unlocks defense_3 building.',
    tier: 3,
    prerequisite: 'ww2_fortifications',
    cost: 13,
    unlocks_building: 'defense_3',
  },
  {
    tech_id: 'ww2_radar',
    name: 'Radar Network',
    description: 'Early warning systems — unlocks tech_gen_2 building and +3 tech per turn.',
    tier: 3,
    prerequisite: 'ww2_munitions',
    cost: 11,
    tech_point_income: 3,
    unlocks_building: 'tech_gen_2',
  },
  // Tier 4
  {
    tech_id: 'ww2_atom_bomb',
    name: 'Manhattan Project',
    description: 'Ultimate weapon — once per game, instantly eliminate all units in one territory (leaves it neutral with 1 unit).',
    tier: 4,
    prerequisite: 'ww2_panzer_tactics',
    cost: 20,
    unlocks_ability: 'atom_bomb',
  },
];

// ── Wonder ────────────────────────────────────────────────────────────────────
export const WW2_WONDER: EraWonder = {
  wonder_id: 'wonder_manhattan',
  name: 'Manhattan Project',
  description: 'Industrial supremacy: +2 flat reinforcement units per turn for the owner.',
  cost: 25,
  passive_effect_type: 'flat_reinforce',
  passive_effect_value: 2,
};
