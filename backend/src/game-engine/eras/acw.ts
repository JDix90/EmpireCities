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
  },
  {
    faction_id: 'confederacy',
    name: 'Confederate Army',
    description: 'Defensive masters — +2 defense dice in home (Southern) territory; rifle_doctrine grants extra re-roll.',
    lore: 'Fighting on familiar ground, the Confederacy leans on interior lines, local commitment, and punishing defensive battles.',
    flavor_quote: 'Make every mile northward cost them twice.',
    home_region_ids: ['confederate_east', 'confederate_central', 'confederate_west'],
    passive_defense_bonus: 2,
    ability_id: 'southern_defense',
    ability_description: 'Southern Defense: once per turn, fortify any number of units within the South region regardless of adjacency.',
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
