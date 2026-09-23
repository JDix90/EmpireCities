import type { Faction, TechNode, EraWonder } from './types';

// ── Factions ──────────────────────────────────────────────────────────────────
export const MODERN_FACTIONS: Faction[] = [
  {
    faction_id: 'western_power',
    lineage_id: 'expansionist',
    name: 'Western Bloc',
    // Two claims, both false. `precision_strike` is an ERA_DEFAULTS modifier
    // that every faction in this era gets, not a Western perk; and no faction
    // may carry an innate defence die at all (factionDefense.test.ts). What was
    // actually here was an attack die — on the era's best-shaped opening, which
    // is how this seat reached 34% against a 17% fair share. One of the eight
    // descriptions #397 recorded as still outstanding.
    description: 'Precision warfare — an airstrike each turn kills without an exchange, and the front recovers faster than it breaks.',
    lore: 'Satellite eyes, expeditionary logistics, and precision doctrine define a bloc that wins by seeing and striking first.',
    flavor_quote: 'Information arrives before the soldiers do.',
    home_region_ids: ['north_america', 'europe'],
    // The attack die is gone. It compounds — captures buy territory, territory
    // buys reinforcements, those buy more captures — so on the widest home
    // claim in the era (twelve territories across two regions, with Europe
    // uncontested) it ran away with every measurement: removing it alone took
    // the era's spread from 28 points to 17.7 across three seeds. Same finding
    // as Japan in #399 and Spain in #400.
    ability_id: 'precision_airstrike',
    ability_description: 'Precision Airstrike: once per turn, deal 2 unit losses to any adjacent enemy territory without a full attack exchange.',
    color: '#3498db',
    stability_recovery_bonus: 3,
  },
  {
    faction_id: 'eastern_bloc',
    lineage_id: 'imperial',
    name: 'Eastern Coalition',
    // Armored Push grants an extra fortify MOVE, not "2 extra units".
    description: 'Armored mass — +2 reinforcements per turn, and the tanks make a second fortify move each turn.',
    lore: 'Centralized command and armored depth give the coalition raw staying power once the battlefield hardens into fronts.',
    flavor_quote: 'Pressure is a weapon when it never stops.',
    home_region_ids: ['russia_cis'],
    reinforce_bonus: 2,
    ability_id: 'armored_push',
    ability_description: 'Armored Push: once per turn, execute two fortify moves instead of one.',
    color: '#c0392b',
  },
  {
    faction_id: 'rogue_state',
    lineage_id: 'bastion',
    name: 'Rogue State',
    // Another innate defence die that cannot exist (factionDefense.test.ts),
    // and an immunity to `precision_strike` with no implementation behind it.
    // This faction carries no numeric bonus at all; Insurgency is the kit. The
    // second of #397's outstanding eight.
    description: 'Asymmetric tactics — every territory they attack answers back, spawning a free defender where the blow landed.',
    lore: 'Sanctioned, isolated, and unpredictable, the Rogue State survives by turning every invasion into a trap of attrition and ambiguity.',
    flavor_quote: 'If they cannot predict us, they cannot dominate us.',
    home_region_ids: ['middle_east'],
    ability_id: 'insurgency',
    ability_description: 'Insurgency: once per turn, spawn 1 free unit in a border territory that was attacked this turn.',
    color: '#e74c3c',
  },
  {
    faction_id: 'emerging_power',
    lineage_id: 'mercantile',
    name: 'Emerging Economy',
    // There is no per-building production mechanic on this faction — it has a
    // flat reinforcement and an ability, and the ability cost more than a game
    // without tech trees can ever pay.
    description: 'Rapid industrialization — +1 reinforcement per turn, and an economic boom places two more wherever they are needed.',
    lore: 'Factories, ports, and swelling cities let the Emerging Power convert growth itself into strategic momentum.',
    flavor_quote: 'Development is the quietest path to dominance.',
    home_region_ids: ['asia'],
    reinforce_bonus: 1,
    ability_id: 'economic_boom',
    // "4 tech points" did not even match the 3 the definition charged.
    ability_description: 'Economic Boom: once per turn, immediately place 2 units on any owned territory.',
    color: '#f39c12',
  },
  {
    faction_id: 'petro_state',
    lineage_id: 'maritime',
    name: 'Petrostate',
    // No tech_point_income on this faction, and no resource-territory
    // mechanic anywhere in the engine: both halves advertised nothing.
    description: 'Oil wealth — the wells fund an extra unit every turn, placed wherever the pressure is greatest.',
    lore: 'Energy rents and patronage networks give the Petrostate immense bursts of leverage so long as the wells stay secure.',
    flavor_quote: 'Guard the fields and the world will bargain on your terms.',
    // Sub-Saharan Africa is no longer claimed as a homeland. Twelve
    // territories across two regions made this the widest claim in the era
    // alongside the Western Bloc's, and with Oil Wealth finally payable the
    // Petrostate ran away at 29-33%. Trimmed to the Gulf — the region the
    // archetype is actually named for — it lands at 21% and the era's spread
    // falls from 24 points to 13. Africa becomes neutral ground everyone can
    // contest rather than one faction's back garden.
    home_region_ids: ['middle_east'],
    ability_id: 'oil_wealth',
    ability_description: 'Oil Wealth: once per turn, place 1 extra unit on any owned territory.',
    color: '#e67e22',
  },
  {
    faction_id: 'cyber_power',
    lineage_id: 'insurgent',
    name: 'Cyber State',
    description: 'Digital warfare — once per turn, sabotage an adjacent enemy territory (remove 1 unit before combat).',
    lore: 'A state built on code, surveillance, and disruption, it weakens enemies by corrupting the systems that coordinate them.',
    flavor_quote: 'Why storm the gate when you can turn off the locks?',
    home_region_ids: ['asia', 'north_america'],
    ability_id: 'cyber_attack',
    ability_description: 'Cyber Attack: once per turn, remove 1 unit from an adjacent enemy territory without combat.',
    color: '#9b59b6',
  },
];

// ── Tech Tree ─────────────────────────────────────────────────────────────────
export const MODERN_TECH_TREE: TechNode[] = [
  // Tier 1
  {
    tech_id: 'mod_drones',
    name: 'Drone Program',
    description: 'UAV reconnaissance — reveal all adjacent enemy territories each turn (ignores fog of war).',
    tier: 1,
    cost: 5,
    attack_bonus: 1,
    unlocks_ability: 'drone_recon',
  },
  {
    tech_id: 'mod_fortification',
    name: 'Military Bases',
    description: 'Permanent installations — unlocks defense_1 building.',
    tier: 1,
    cost: 4,
    unlocks_building: 'defense_1',
  },
  {
    tech_id: 'mod_economy',
    name: 'Digital Economy',
    description: 'Tech-driven growth — unlocks production_1 building.',
    tier: 1,
    cost: 4,
    unlocks_building: 'production_1',
  },
  {
    tech_id: 'mod_special_forces',
    name: 'Special Forces',
    description: 'Elite operators — precision_strike applies with 2 units (normally needs 4).',
    tier: 1,
    cost: 5,
    attack_bonus: 1,
    unlocks_ability: 'special_ops',
  },
  // Tier 2
  {
    tech_id: 'mod_stealth',
    name: 'Stealth Technology',
    description: 'Stealth aircraft — precision attacks cannot be countered; +1 attack die.',
    tier: 2,
    prerequisite: 'mod_drones',
    cost: 10,
    attack_bonus: 1,
  },
  {
    tech_id: 'mod_cyber_defense',
    name: 'Cyber Defense',
    description: 'Hardened networks — unlocks defense_2 building.',
    tier: 2,
    prerequisite: 'mod_fortification',
    cost: 8,
    unlocks_building: 'defense_2',
  },
  {
    tech_id: 'mod_ai_industry',
    name: 'AI-Driven Industry',
    description: 'Automated production — unlocks tech_gen_1 building and +2 tech per turn.',
    tier: 2,
    prerequisite: 'mod_economy',
    cost: 8,
    tech_point_income: 2,
    unlocks_building: 'tech_gen_1',
  },
  {
    tech_id: 'mod_hypersonic',
    name: 'Hypersonic Missiles',
    description: 'Long-range precision — once per turn, attack any adjacent territory that you could reach within 2 hops.',
    tier: 2,
    prerequisite: 'mod_special_forces',
    cost: 9,
    attack_bonus: 1,
    unlocks_ability: 'hypersonic_strike',
  },
  // Tier 3
  {
    tech_id: 'mod_space_weapons',
    name: 'Space-Based Weapons',
    description: 'Orbital strike platforms — once per turn, deal 3 unit losses to any enemy territory.',
    tier: 3,
    prerequisite: 'mod_stealth',
    cost: 15,
    unlocks_ability: 'orbital_strike',
  },
  {
    tech_id: 'mod_fortress',
    name: 'Fortress State',
    description: 'Comprehensive defense network — unlocks defense_3 building.',
    tier: 3,
    prerequisite: 'mod_cyber_defense',
    cost: 13,
    defense_bonus: 1,
    unlocks_building: 'defense_3',
  },
  {
    tech_id: 'mod_quantum',
    name: 'Quantum Computing',
    description: 'Quantum advantage — unlocks tech_gen_2 building and +4 tech per turn.',
    tier: 3,
    prerequisite: 'mod_ai_industry',
    cost: 13,
    tech_point_income: 4,
    unlocks_building: 'tech_gen_2',
  },
  // Tier 4
  {
    tech_id: 'mod_singularity',
    name: 'Technological Singularity',
    description: 'AI-controlled military — all attacks and defenses use maximum dice; +4 reinforcements per turn.',
    tier: 4,
    prerequisite: 'mod_space_weapons',
    cost: 22,
    attack_bonus: 2,
    defense_bonus: 1,
    reinforce_bonus: 4,
  },
];

// ── Wonder ────────────────────────────────────────────────────────────────────
export const MODERN_WONDER: EraWonder = {
  wonder_id: 'wonder_cern',
  name: 'CERN',
  description: 'Particle accelerator breakthroughs: research all T1/T2 tech nodes at half cost.',
  cost: 22,
  passive_effect_type: 'tech_cost_half',
  passive_effect_value: 1,
};
