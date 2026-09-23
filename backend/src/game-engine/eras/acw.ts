import type { Faction, TechNode, EraWonder } from './types';

// ── Factions ──────────────────────────────────────────────────────────────────
export const ACW_FACTIONS: Faction[] = [
  {
    faction_id: 'union',
    name: 'Union Army',
    description: 'Industrial north — +1 production unit per owned territory; rifle_doctrine applies universally.',
    lore: 'Railroads, factories, and a widening war aim let the Union grind toward victory through capacity as much as battlefield brilliance.',
    flavor_quote: 'Win the rails, and the armies will follow.',
    home_region_ids: ['union_northeast', 'union_midwest'],
    reinforce_bonus: 1,
    ability_id: 'total_war',
    ability_description: 'Total War: once per game, in one turn place double your normal reinforcements.',
    color: '#3498db',
    stability_recovery_bonus: 3,
  },
  {
    faction_id: 'confederacy',
    name: 'Confederate Army',
    // The Confederacy shipped with no ability and no numeric bonus of any kind,
    // and its one advertised trait was false: `stability_recovery_bonus` sits on
    // the Union above, not here, and is inert anyway with stability_enabled
    // defaulting false. It won 1% of 900 games against a 50% fair share and was
    // eliminated in 99%.
    //
    // Two things were wrong and both are fixed here. The Union drafts 4 a turn
    // to the Confederacy's 3, which compounds brutally head-to-head; matching it
    // is worth 99/1 -> 87/13 on its own. The rest is shape: the Confederacy
    // holds THREE home regions spanning nine territories to the Union's two over
    // six, so it mans a longer line for its bonus and loses a whole region bonus
    // more easily. Swapping the two homelands with both kits stripped flips the
    // era to 53/48, which is what says the gap is position and income rather
    // than the map being drawn wrong — so neither is redrawn.
    description: 'Fighting on interior lines — +1 reinforcement per turn, and the first attack against them each turn costs the attacker a unit.',
    lore: 'Fighting on familiar ground, the Confederacy leans on interior lines, local commitment, and punishing defensive battles.',
    flavor_quote: 'Make every mile northward cost them twice.',
    home_region_ids: ['confederate_east', 'confederate_central', 'confederate_west'],
    reinforce_bonus: 1,
    ability_id: 'interior_lines',
    ability_description: 'Interior Lines: the first attack against you each turn costs the attacker 1 extra unit.',
    color: '#c0392b',
  },
];

// ── Tech Tree ─────────────────────────────────────────────────────────────────
export const ACW_TECH_TREE: TechNode[] = [
  // Tier 1
  {
    tech_id: 'acw_rifled_muskets',
    name: 'Rifled Muskets',
    description: 'Improved accuracy — rifle_doctrine re-roll applies to 2 tied dice instead of 1.',
    tier: 1,
    cost: 4,
    attack_bonus: 1,
  },
  {
    tech_id: 'acw_earthworks',
    name: 'Field Earthworks',
    description: 'Hasty fortifications — unlocks defense_1 building.',
    tier: 1,
    cost: 3,
    unlocks_building: 'defense_1',
  },
  {
    tech_id: 'acw_railroads',
    name: 'Railroad Network',
    description: 'Rapid troop movement — unlocks production_1 building and allows 2 fortify moves per turn.',
    tier: 1,
    cost: 4,
    unlocks_building: 'production_1',
    reinforce_bonus: 1,
  },
  {
    tech_id: 'acw_telegraph',
    name: 'Military Telegraph',
    description: 'Coordinated command — +1 reinforcement per turn.',
    tier: 1,
    cost: 3,
    reinforce_bonus: 1,
  },
  // Tier 2
  {
    tech_id: 'acw_repeating_rifles',
    name: 'Repeating Rifles',
    description: 'Rapid-fire weapons — attacker uses 4 dice when assaulting under-defended territories (≤2 units).',
    tier: 2,
    prerequisite: 'acw_rifled_muskets',
    cost: 7,
    attack_bonus: 1,
    unlocks_ability: 'rapid_fire',
  },
  {
    tech_id: 'acw_redoubts',
    name: 'Redoubts and Redans',
    description: 'Angled earthworks — unlocks defense_2 building.',
    tier: 2,
    prerequisite: 'acw_earthworks',
    cost: 7,
    unlocks_building: 'defense_2',
  },
  {
    tech_id: 'acw_supply_lines',
    name: 'Supply Lines',
    description: 'Organized logistics — unlocks tech_gen_1 building and +2 tech per turn.',
    tier: 2,
    prerequisite: 'acw_railroads',
    cost: 6,
    tech_point_income: 2,
    unlocks_building: 'tech_gen_1',
  },
  {
    tech_id: 'acw_ironclads',
    name: 'Ironclad Warships',
    description: 'River and coastal control — +1 defense die in river-adjacent territories.',
    tier: 2,
    prerequisite: 'acw_telegraph',
    cost: 7,
    defense_bonus: 1,
    unlocks_ability: 'river_blockade',
  },
  // Tier 3
  {
    tech_id: 'acw_artillery',
    name: 'Heavy Artillery',
    description: 'Siege batteries — negates any defense building bonus when attacking.',
    tier: 3,
    prerequisite: 'acw_repeating_rifles',
    cost: 11,
    attack_bonus: 1,
    unlocks_ability: 'heavy_bombardment',
  },
  {
    tech_id: 'acw_fortified_lines',
    name: 'Permanent Lines',
    description: 'Trench warfare network — unlocks defense_3 building.',
    tier: 3,
    prerequisite: 'acw_redoubts',
    cost: 11,
    unlocks_building: 'defense_3',
  },
  {
    tech_id: 'acw_industry',
    name: 'Industrial Arsenal',
    description: 'Total war industry — unlocks tech_gen_2 building and +3 tech per turn.',
    tier: 3,
    prerequisite: 'acw_supply_lines',
    cost: 10,
    tech_point_income: 3,
    unlocks_building: 'tech_gen_2',
  },
  // Tier 4
  {
    tech_id: 'acw_total_war',
    name: 'Total War',
    description: 'March to the sea — once per game, execute a chain attack through up to 3 connected enemy territories in one turn.',
    tier: 4,
    prerequisite: 'acw_artillery',
    cost: 16,
    reinforce_bonus: 2,
    unlocks_ability: 'march_to_sea',
  },
];

// ── Wonder ────────────────────────────────────────────────────────────────────
export const ACW_WONDER: EraWonder = {
  wonder_id: 'wonder_arsenal',
  name: 'The Great Arsenal',
  description: 'Industrial might of the North: +3 units per turn flat bonus.',
  cost: 18,
  passive_effect_type: 'flat_reinforce',
  passive_effect_value: 3,
};
