import type { Faction, TechNode, EraWonder } from './types';

// ──────────────────────────────────────────────────────────────────────────
// Galactic Age factions
//
// Design notes:
// - Each faction's `home_region_ids` matches one world in `era_galaxy.json`
//   so factions spawn on their lore home; under corridors contact between
//   worlds is positional (hold a gateway, attack across its lane), so the
//   opening turns are about reaching and holding gateways, not research.
// - Helion Navigators' old free-hyperspace special case only matters with the
//   corridors kill switch off; their live kit is gateway sight + Drift Jump.
// - Forge Syndicate now carries a passive `reinforce_bonus: 1` so it isn't
//   the only faction without a sustained passive (parity with the era's
//   other factions).
// - Stellar Mandate's passive is a research discount (`tech_cost_discount: 2`)
//   — its old copy claimed a +1 defense die that was never wired (always-on
//   defensive dice were removed game-wide; see defenderReactions.ts), which
//   left Sol the only passive-less faction (~13% win rate in 400-game sims).
//   The lever is deliberately a DISCOUNT, not per-turn tech income: +1
//   TP/turn compounds all game and sim-tested at ~39% (and crushed Helion's
//   hyperspace head start). Discount ladder sim-tested at 400g×2 seeds
//   (expert, threshold-60 meta): 1 → Sol 18.6%, 2 → all four factions in
//   20-35% (Sol 33.8 / Rust 22.2 / Verdan 22.3 / Nexus 21.9 avg).
// - Kits are built around lanes (corridors): the Mandate runs blockades, Forge
//   supplies, Helion sees gateways and jumps between its own, the Custodians
//   seal and hold. Forge's Supply Insert still rides the shared
//   guerrilla_warfare def; everything else here is galaxy-native.
// - Void Custodians traded their flat `reinforce_bonus: 1` for Nexus Station's
//   tech identity. That was first a per-tile world modifier (16 x 0.0625 = 1
//   TP/turn; measured 400g x 2 seeds it alone put the Custodians at 56%, and
//   even 1 TP/turn left them at 38-40% until the spare reinforcement went).
//   Under worlds-as-characters the yield is the Vault instead: the Gate Ring
//   starts neutral and whoever holds all four tiles earns +2 TP/turn and an
//   Emergency Seal on any lane — a prize the Custodians start nearest to but
//   must take (see state/worldRules.ts and GALAXY-BALANCE.md).
// ──────────────────────────────────────────────────────────────────────────

export const GALAXY_AGE_FACTIONS: Faction[] = [
  {
    faction_id: 'stellar_mandate',
    name: 'Stellar Mandate',
    description: 'Central admiralty doctrine — every technology costs 1 less to research; blockade runners ignore lane seals.',
    lore: 'The Mandate believes stability flows from a single chain of command spanning every recognized star system.',
    flavor_quote: 'Order is not imposed — it is synchronized.',
    home_region_ids: ['sol_americas', 'sol_atlantic_arc', 'sol_crescent', 'sol_asian_rim'],
    // 2 → 1: measured under corridors (200g × 2 seeds, expert, threshold 60) the
    // -2 discount compounds across a dice-heavy tree into a 47% win rate once
    // gateway fights are decided by dice. Cyber Strike went with it: it was the
    // only galaxy active the AI fired, and it belonged to the era that already led.
    tech_cost_discount: 1,
    ability_id: 'blockade_runner',
    ability_description: 'Blockade Runner: once per turn, your next attack across a hyperspace lane ignores an Emergency Seal.',
    color: '#5dade2',
  },
  {
    faction_id: 'forge_syndicate',
    name: 'Forge Syndicate',
    description: 'Industrial cartels — shipyard logistics deliver +1 reinforcement per turn; supply inserts on demand.',
    lore: 'Shipyards and foundries form the true border between civilization and the dark between stars.',
    flavor_quote: 'We sell the hulls that empires die in.',
    home_region_ids: ['rust_slag_wastes', 'rust_foundry_core', 'rust_ironstorm', 'rust_anchor_works'],
    reinforce_bonus: 1,
    ability_id: 'guerrilla_warfare',
    ability_description: 'Supply Insert: once per turn, place 1 free unit on an owned territory.',
    color: '#e67e22',
  },
  {
    faction_id: 'helion_navigators',
    name: 'Helion Navigators',
    description: 'Lane-mappers and drift pilots — every gateway in the galaxy stays visible to them, and their fleets jump between their own gateways.',
    lore: 'Their astrogators tape gravimetric shoals the way ancient sailors mapped reefs.',
    flavor_quote: 'The void has currents; we read them.',
    home_region_ids: ['verdan_sporefields', 'verdan_mirelands', 'verdan_lumen_crown', 'verdan_stormbelts'],
    // Long-Range Sensors is the passive (expandFogVisibilityFromFactionPassive).
    // Drift Jump is applied implicitly by the fortify handler: a fortify between
    // two owned gateway tiles on different worlds that has no connected path.
    ability_id: 'drift_jump',
    ability_description: 'Drift Jump: once per turn, fortify between two gateways you hold on different worlds with no connecting route.',
    color: '#2ecc71',
  },
  {
    faction_id: 'void_custodians',
    name: 'Void Custodians',
    description: 'Station enginseers — +1 defence die against any attack across a lane; faster stability recovery. Nexus Station\'s Gate Ring is the Vault: hold all four tiles for +2 tech per turn and an Emergency Seal on any lane.',
    lore: 'They guard the silent rings and tether cities where vacuum is the only neighbor.',
    flavor_quote: 'We keep the dark from leaning in.',
    home_region_ids: ['nexus_gate_ring', 'nexus_vault_ward', 'nexus_spire_walk', 'nexus_berth_ring'],
    ability_id: 'emergency_seal',
    ability_description: 'Emergency Seal: once per turn, close any hyperspace lane touching Nexus Station to everyone else for one round.',
    color: '#9b59b6',
    stability_recovery_bonus: 2,
    lane_defense_bonus: 1,
  },
];

// ──────────────────────────────────────────────────────────────────────────
// Galactic Age technology tree
//
// Two parallel tier-1 roots so opening builds branch:
//   Lane Charts (cost 5) — the third attack die across a lane (crossings roll
//   2 without it, under corridors); the access gate it used to be was bought
//   on turn 1 by every seat in every simulated game.
//   Lattice Logistics (cost 4) — economic root: +1 reinforcement / turn.
// Hyperdrive Doctrine and Lane Sovereignty extend Lane Charts so lane
// crossings keep getting stronger as the player invests deeper.
// ──────────────────────────────────────────────────────────────────────────

export const GALAXY_AGE_TECH_TREE: TechNode[] = [
  {
    // Kept the id so nothing that reads unlocked_techs churns. Under corridors
    // this is no longer the access gate (every seat bought it on turn 1, so it
    // gated nothing) — it buys back the third attack die across a lane.
    tech_id: 'ga_hyperspace_chart',
    name: 'Lane Charts',
    description: 'Certified lane plots — attacks across a hyperspace lane roll 3 dice instead of 2.',
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

// Under corridors there is no access gate for the Anchor to skip, so it lifts
// the lane dice cap for its owner instead (`galaxyLaneAttackDiceCap`); with the
// kill switch off it still grants orbit access (`getOrbitAccessResult`).
export const GALAXY_AGE_WONDER: EraWonder = {
  wonder_id: 'wonder_hyperlane_anchor',
  name: 'Hyperlane Anchor',
  description: 'Stabilized jump beacon — your attacks across hyperspace lanes roll full dice (no lane cap).',
  cost: 22,
  passive_effect_type: 'orbit_access',
  passive_effect_value: 1,
};
