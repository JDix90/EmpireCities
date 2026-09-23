import type { Faction, TechNode, EraWonder } from './types';

// ── Factions ──────────────────────────────────────────────────────────────────
export const DISCOVERY_FACTIONS: Faction[] = [
  {
    faction_id: 'spain',
    lineage_id: 'imperial',
    name: 'Spanish Empire',
    description: 'Conquistadors press the advantage — +1 attack die on every attack.',
    lore: 'Silver fleets, crusading zeal, and hard-edged conquistadors make Spain a transoceanic empire hungry for rapid expansion.',
    flavor_quote: 'Across the ocean lies another crown to claim.',
    home_region_ids: ['europe_disc'],
    passive_attack_bonus: 1,
    color: '#f39c12',
  },
  {
    faction_id: 'portugal',
    lineage_id: 'maritime',
    name: 'Portuguese Empire',
    description: 'Masters of the sea — sea_lanes connections allow 3 attack dice (normally 2) and free sea-lane fortify moves.',
    lore: 'Portugal lives by charts, caravels, and coastal strongpoints, turning sea lanes into a private imperial network.',
    flavor_quote: 'Map the current, own the world beyond it.',
    home_region_ids: ['europe_disc'],
    // Naval Charts is a sea-only effect (see executeTechAbility / combatModifiers):
    // sea_lanes attacks roll the full 3-dice cap. No general passive attack bonus,
    // so land attacks are unaffected — matching the faction description.
    ability_id: 'naval_charts',
    ability_description: 'Naval Charts: your sea_lanes attacks use the full 3 dice cap instead of the era-limited 2.',
    color: '#27ae60',
  },
  {
    faction_id: 'ottoman',
    lineage_id: 'expansionist',
    name: 'Ottoman Empire',
    // The "from controlling the mediterranean sea_routes region" condition in
    // the old description does not exist: reinforce_bonus is flat and always
    // has been. Same defect class as the eight corrected in #397.
    description: 'Straddling east and west — +2 reinforcements per turn, and an extra attack die on every assault.',
    lore: 'From the Balkans to Arabia, Ottoman rule merges disciplined corps and strategic chokepoints into a continental hinge.',
    flavor_quote: 'Hold the straits, and empires must knock at your door.',
    home_region_ids: ['ottoman'],
    reinforce_bonus: 2,
    // The Ottomans held the best-shaped opening in the era — one contiguous
    // block, the second-lowest border pressure — and still won 9% against a
    // 17% fair share, because janissaries is a defender reaction and
    // reinforcements scale with territory a defensive faction never takes.
    // The same dead end the Byzantines were in, and the same way out.
    passive_attack_bonus: 1,
    ability_id: 'janissaries',
    ability_description: 'Janissaries: once per turn, defend with 3 dice regardless of garrison size.',
    color: '#d35400',
  },
  {
    faction_id: 'england_discovery',
    lineage_id: 'insurgent',
    name: 'English Crown',
    description: 'Privateers and merchant adventurers — +1 tech point per sea territory owned.',
    lore: 'A rising maritime kingdom, England weaponizes chartered companies, private raids, and coastal footholds into empire.',
    flavor_quote: 'Where merchants sail, the flag soon follows.',
    home_region_ids: ['europe_disc'],
    ability_id: 'privateer',
    ability_description: 'Privateer: once per turn, steal 1 production unit from an adjacent enemy coastal territory.',
    color: '#c0392b',
  },
  {
    faction_id: 'ming_china',
    lineage_id: 'bastion',
    name: 'Ming Dynasty',
    // No faction may carry an innate defence die (factionDefense.test.ts), and
    // there is no region-scoped defence mechanic behind "in Asian territories".
    // The Great Wall is real, but it is a GATED charge, which is the whole
    // difference: it fires once per turn, not on every roll.
    description: 'Vast population and the Great Wall — +1 reinforcement per turn, and one assault each turn breaks on the stonework.',
    lore: 'The Ming command enormous manpower and monumental defenses, preferring layered stability over reckless overreach.',
    flavor_quote: 'The empire endures because its walls are built in both stone and grain.',
    home_region_ids: ['ming_china'],
    reinforce_bonus: 1,
    ability_id: 'great_wall',
    // It does not prevent the attack: defenderReactions gives the defender +2
    // dice before the roll, the same charge the Abbasids' City of Peace uses.
    ability_description: 'Great Wall: once per turn, the first attack against you is met with +2 defence dice.',
    color: '#e74c3c',
    stability_recovery_bonus: 3,
  },
  {
    faction_id: 'mughal',
    lineage_id: 'mercantile',
    name: 'Mughal Empire',
    // The old description promised "+3 extra tech points per turn" and there is
    // no tech_point_income on this faction at all — it was advertising a field
    // that does not exist, on top of an ability nobody could pay for.
    description: 'Rich subcontinent — the spice caravans fund two extra reinforcements each turn, and gunpowder armies press with an extra attack die.',
    lore: 'Courtly wealth, gunpowder armies, and a mosaic of provinces make the Mughals formidable when prosperity is protected.',
    flavor_quote: 'Splendor is strongest when backed by cannon.',
    home_region_ids: ['mughal_india'],
    // This faction had no numeric bonus of any kind and one ability costing 5
    // tech points, which is unpayable with tech trees off. It won 3% of 900
    // games and was eliminated in 81% of them — the worst seat measured in any
    // era. Spice Trade is ungated now, so the economy lives in the button
    // rather than a hidden stat; the attack die is what the Byzantines needed
    // for the same reason, the means to retake what it loses. Income alone was
    // measured at 1-2% with elimination still over half.
    passive_attack_bonus: 1,
    ability_id: 'spice_trade',
    ability_description: 'Spice Trade: once per turn, the caravans deliver 2 extra reinforcements.',
    color: '#9b59b6',
  },
];

// ── Tech Tree ─────────────────────────────────────────────────────────────────
export const DISCOVERY_TECH_TREE: TechNode[] = [
  // Tier 1
  {
    tech_id: 'discovery_cartography',
    name: 'Cartography',
    description: 'Better maps: sea_lanes attack uses full 3 dice (removes the 2-die cap from era modifier).',
    tier: 1,
    cost: 5,
    attack_bonus: 1,
  },
  {
    tech_id: 'discovery_fortifications',
    name: 'Star Forts',
    description: 'Bastion-trace fortification — unlocks defense_1 building.',
    tier: 1,
    cost: 4,
    unlocks_building: 'defense_1',
  },
  {
    tech_id: 'discovery_plantations',
    name: 'Colonial Plantations',
    description: 'Lucrative colonial agriculture — unlocks production_1 building.',
    tier: 1,
    cost: 3,
    unlocks_building: 'production_1',
  },
  {
    tech_id: 'discovery_muskets',
    name: 'Muskets',
    description: 'Matchlock firearms grant +1 attack die.',
    tier: 1,
    cost: 5,
    attack_bonus: 1,
  },
  // Tier 2
  {
    tech_id: 'discovery_galleons',
    name: 'Galleons',
    description: 'Warships allow 2 fortify moves along sea connections per turn.',
    tier: 2,
    prerequisite: 'discovery_cartography',
    cost: 8,
    reinforce_bonus: 1,
    unlocks_ability: 'galleon_transport',
  },
  {
    tech_id: 'discovery_citadel',
    name: 'Colonial Citadel',
    description: 'Reinforced fortifications — unlocks defense_2 building.',
    tier: 2,
    prerequisite: 'discovery_fortifications',
    cost: 7,
    unlocks_building: 'defense_2',
  },
  {
    tech_id: 'discovery_mercantilism',
    name: 'Mercantilism',
    description: 'State-directed commerce — unlocks tech_gen_1 building and +2 tech per turn.',
    tier: 2,
    prerequisite: 'discovery_plantations',
    cost: 6,
    tech_point_income: 2,
    unlocks_building: 'tech_gen_1',
  },
  {
    tech_id: 'discovery_artillery',
    name: 'Field Artillery',
    description: 'Cannon batteries add +1 attack die and negate defense building bonus.',
    tier: 2,
    prerequisite: 'discovery_muskets',
    cost: 8,
    attack_bonus: 1,
    unlocks_ability: 'artillery_barrage',
  },
  // Tier 3
  {
    tech_id: 'discovery_ironclads',
    name: 'Armored Galleons',
    description: 'Iron-plated warships — sea-lane attacks use full 3 dice and defender gets no sea bonus.',
    tier: 3,
    prerequisite: 'discovery_galleons',
    cost: 12,
    attack_bonus: 1,
  },
  {
    tech_id: 'discovery_fortress_network',
    name: 'Fortress Network',
    description: 'Coordinated fortresses — unlocks defense_3 building.',
    tier: 3,
    prerequisite: 'discovery_citadel',
    cost: 12,
    unlocks_building: 'defense_3',
  },
  {
    tech_id: 'discovery_stock_exchange',
    name: 'Stock Exchange',
    description: 'Amsterdam-style finance — unlocks tech_gen_2 and +3 tech points per turn.',
    tier: 3,
    prerequisite: 'discovery_mercantilism',
    cost: 11,
    tech_point_income: 3,
    unlocks_building: 'tech_gen_2',
  },
  // Tier 4
  {
    tech_id: 'discovery_empire',
    name: 'Global Empire',
    description: 'Colonies on every continent grant +3 reinforcements and +2 production per owned sea-adjacent territory.',
    tier: 4,
    prerequisite: 'discovery_ironclads',
    cost: 18,
    reinforce_bonus: 3,
    unlocks_ability: 'colonial_dominion',
  },
];

// ── Wonder ────────────────────────────────────────────────────────────────────
export const DISCOVERY_WONDER: EraWonder = {
  wonder_id: 'wonder_lighthouse',
  name: 'Lighthouse of Alexandria',
  description: 'Guiding beacon of navigation: sea-lane attacks use 3 dice instead of 2.',
  cost: 18,
  passive_effect_type: 'sea_attack_dice',
  passive_effect_value: 3,
};
