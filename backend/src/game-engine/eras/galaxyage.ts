import type { Faction, TechNode, EraWonder } from './types';

// ──────────────────────────────────────────────────────────────────────────
// Galactic Age factions
//
// Design notes:
// - Each faction's `home_region_ids` matches one world in `era_galaxy.json`
//   so factions spawn on their lore home (orbit gating then forces hyperspace
//   tech before contact between worlds).
// - Helion Navigators get free hyperspace via `getOrbitAccessResult` special
//   case — that's their primary advantage. They no longer also stack a flat
//   attack passive; the open-lane perk alone is significant on this map.
// - Forge Syndicate now carries a passive `reinforce_bonus: 1` so it isn't
//   the only faction without a sustained passive (parity with the era's
//   other factions).
// - Ability IDs reuse legacy handlers so the abilities work end-to-end today;
//   the user-facing labels and lore have been refreshed for galaxy flavor.
// ──────────────────────────────────────────────────────────────────────────

export const GALAXY_AGE_FACTIONS: Faction[] = [
  {
    faction_id: 'stellar_mandate',
    name: 'Stellar Mandate',
    description: 'Central admiralty doctrine — +1 defense die on owned territories; cyber warfare unlocked.',
    lore: 'The Mandate believes stability flows from a single chain of command spanning every recognized star system.',
    flavor_quote: 'Order is not imposed — it is synchronized.',
    home_region_ids: ['stellar_core'],
    passive_defense_bonus: 1,
    ability_id: 'cyber_attack',
    ability_description: 'Cyber Strike: once per turn, remove 1 enemy unit from an adjacent territory.',
    color: '#5dade2',
  },
  {
    faction_id: 'forge_syndicate',
    name: 'Forge Syndicate',
    description: 'Industrial cartels — shipyard logistics deliver +1 reinforcement per turn; supply inserts on demand.',
    lore: 'Shipyards and foundries form the true border between civilization and the dark between stars.',
    flavor_quote: 'We sell the hulls that empires die in.',
    home_region_ids: ['industrial_rim'],
    reinforce_bonus: 1,
    ability_id: 'guerrilla_warfare',
    ability_description: 'Supply Insert: once per turn, place 1 free unit on an owned territory.',
    color: '#e67e22',
  },
  {
    faction_id: 'helion_navigators',
    name: 'Helion Navigators',
    description: 'Lane-mappers and drift pilots — hyperspace lanes open without researching Hyperspace Chart first.',
    lore: 'Their astrogators tape gravimetric shoals the way ancient sailors mapped reefs.',
    flavor_quote: 'The void has currents; we read them.',
    home_region_ids: ['verdant_expanse'],
    ability_id: 'orbital_recon',
    ability_description: 'Long-Range Sensors: once per turn, reveal units in one adjacent enemy territory.',
    color: '#2ecc71',
  },
  {
    faction_id: 'void_custodians',
    name: 'Void Custodians',
    description: 'Deep patrol fleets — +1 reinforcement per turn; stronger defense along station corridors.',
    lore: 'They guard the silent rings and tether cities where vacuum is the only neighbor.',
    flavor_quote: 'We keep the dark from leaning in.',
    home_region_ids: ['station_corridor'],
    passive_defense_bonus: 1,
    reinforce_bonus: 1,
    ability_id: 'terraform',
    ability_description: 'Emergency Seal: once per turn, restore stability on an owned territory and gain 1 free unit there.',
    color: '#9b59b6',
    stability_recovery_bonus: 2,
  },
];

// ──────────────────────────────────────────────────────────────────────────
// Galactic Age technology tree
//
// Two parallel tier-1 roots so opening builds branch:
//   Hyperspace Chart (cost 5) — central mechanic, unlocks orbit travel.
//   Lattice Logistics (cost 4) — economic root: +1 reinforcement / turn.
// Hyperdrive Doctrine and Lane Sovereignty extend Hyperspace Chart so the
// gate isn't just a binary unlock but a real progression: orbit attacks
// become more powerful as the player invests deeper.
// ──────────────────────────────────────────────────────────────────────────

export const GALAXY_AGE_TECH_TREE: TechNode[] = [
  {
    tech_id: 'ga_hyperspace_chart',
    name: 'Hyperspace Chart',
    description: 'Certified lane plots — unlocks travel and claims along orbit connections to foreign worlds.',
    tier: 1,
    cost: 5,
  },
  {
    tech_id: 'ga_lattice_logistics',
    name: 'Lattice Logistics',
    description: 'Orbital depots and routing algorithms — +1 reinforcement per turn.',
    tier: 1,
    cost: 4,
    reinforce_bonus: 1,
  },
  {
    tech_id: 'ga_hyperdrive_doctrine',
    name: 'Hyperdrive Doctrine',
    description: 'Aggressive lane-jump tactics — +1 attack die on all attacks.',
    tier: 2,
    cost: 9,
    prerequisite: 'ga_hyperspace_chart',
    attack_bonus: 1,
  },
  {
    tech_id: 'ga_disruption_net',
    name: 'Disruption Net',
    description: 'EM harassment fields — +1 defense die.',
    tier: 2,
    cost: 10,
    prerequisite: 'ga_lattice_logistics',
    defense_bonus: 1,
    unlocks_building: 'defense_1',
  },
  {
    tech_id: 'ga_battle_fabricators',
    name: 'Battle Fabricators',
    description: 'Front-line nano-forges — unlocks production_1 and +2 tech points per turn.',
    tier: 2,
    cost: 11,
    prerequisite: 'ga_hyperspace_chart',
    tech_point_income: 2,
    unlocks_building: 'production_1',
  },
  {
    tech_id: 'ga_lane_sovereignty',
    name: 'Lane Sovereignty',
    description: 'Doctrinal control of charted lanes — +1 defense die and +1 reinforcement per turn.',
    tier: 3,
    cost: 14,
    prerequisite: 'ga_hyperdrive_doctrine',
    defense_bonus: 1,
    reinforce_bonus: 1,
  },
  {
    tech_id: 'ga_solar_foundries',
    name: 'Solar Foundries',
    description: 'Skimming stellar flux — unlocks tech_gen_1 and +4 tech points per turn.',
    tier: 3,
    cost: 16,
    prerequisite: 'ga_battle_fabricators',
    tech_point_income: 4,
    unlocks_building: 'tech_gen_1',
  },
  {
    tech_id: 'ga_gravity_brake',
    name: 'Gravity Brake Doctrine',
    description: 'Tactical insertion drills — +2 attack dice.',
    tier: 3,
    cost: 15,
    prerequisite: 'ga_disruption_net',
    attack_bonus: 2,
  },
  {
    tech_id: 'ga_dyson_slice',
    name: 'Dyson Slice',
    description: 'Micro-swarm collectors — +7 tech points per turn.',
    tier: 4,
    cost: 24,
    prerequisite: 'ga_solar_foundries',
    tech_point_income: 7,
    unlocks_building: 'tech_gen_2',
  },
  {
    tech_id: 'ga_final_broadcast',
    name: 'Final Broadcast',
    description: 'Synchronized fleet consciousness — +2 attack, +1 defense, +2 reinforcements.',
    tier: 4,
    cost: 26,
    prerequisite: 'ga_gravity_brake',
    attack_bonus: 2,
    defense_bonus: 1,
    reinforce_bonus: 2,
  },
];

// `passive_effect_type: 'orbit_access'` is honest about what the wonder does.
// `getOrbitAccessResult` already special-cases ownership of `wonder_hyperlane_anchor`
// so no runtime change is needed — only the descriptor was misleading.
export const GALAXY_AGE_WONDER: EraWonder = {
  wonder_id: 'wonder_hyperlane_anchor',
  name: 'Hyperlane Anchor',
  description: 'Stabilized jump beacon — orbit travel no longer requires Hyperspace Chart for you.',
  cost: 22,
  passive_effect_type: 'orbit_access',
  passive_effect_value: 1,
};
