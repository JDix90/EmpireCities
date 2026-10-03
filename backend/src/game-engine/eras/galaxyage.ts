import type { BuildingType } from '../../types';
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
//   corridors kill switch off; their live kit is gateway sight + Drift Jump,
//   plus `reinforce_bonus: 2` since Sol's Cradle started firing (see below).
// - Forge Syndicate carries `reinforce_bonus: 2`, the only purely economic kit in
//   the era and the one that kept losing anyway: 12-14% across Phases 5-6 with +1,
//   19.5% with +2 (400g x 3 seeds on the deterministic harness). A production kit
//   needs units, not more buildings — its cheap buildings and half-price gates
//   were already the most-built of the four and did not convert.
// - Stellar Mandate has NO research discount any more. The history is in the field
//   comment below; the short version is that the discount was worth ~10 points of
//   win rate on a seat already worth ~24%, and nothing else about Sol moved the
//   number.
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
// - The Shattered Shell (Nexus rebuilt as a hub around the Vault) needed both
//   halves back, smaller: the Vault's `home_unit_bonus: 1`, and a per-tile tech
//   modifier of 0.084 so the Custodians' twelve opening tiles earn 1 TP/turn
//   (0.0625 floored to 0 there). Those two were first chosen on a sim harness
//   whose games leaked into each other (GALAXY-BALANCE.md §1), and re-checked
//   on the fixed one with the Rust/Verdan retune in place, 1,000 games x 3
//   seeds: bonus 0 sends Forge to 51-53% and Nexus to 13-15%; tech 0.0625
//   puts Forge at 33.4% on seed B; bonus 1 + 0.084 keeps all four inside
//   18-32%. Both stay.
// ──────────────────────────────────────────────────────────────────────────

// Lineage ids matter only on a spine that climbs INTO this era — Space to Stars.
// A player's faction is remapped along its lineage on arrival, and every runtime
// faction lookup resolves against the player's current era, so a galaxy faction
// with no lineage would leave an arriving player holding an id this era cannot
// resolve, i.e. no kit at all. The Space Age has six lineages and this era has
// four kits; the two with no partner here are handled by the fallback in
// `applyLineageOnAdvance`.
export const GALAXY_AGE_FACTIONS: Faction[] = [
  {
    faction_id: 'stellar_mandate',
    name: 'Stellar Mandate',
    description: 'Central admiralty doctrine — Sol III is the cradle: deeper reinforcement on its systems and a population that replaces what it loses. Blockade runners ignore lane seals.',
    lore: 'The Mandate believes stability flows from a single chain of command spanning every recognized star system.',
    flavor_quote: 'Order is not imposed — it is synchronized.',
    home_region_ids: ['sol_americas', 'sol_atlantic_arc', 'sol_crescent', 'sol_asian_rim'],
    lineage_id: 'imperial',
    // The research discount is GONE, not reduced. Its history: -2 compounded into
    // a 47% win rate once gateway fights were decided by dice, so Phase 3 cut it to
    // -1. Measured again on the deterministic harness (400g x 3 seeds, expert,
    // threshold 60) after Lane Sovereignty and the Jump Gates, -1 was still worth
    // ~10 points of win rate: Sol 34.6% with it, 24.3% without, while the seat
    // itself — four lanes, centre of the ring — is worth about 24%. No other Sol
    // lever moved the number at all (the Cradle world rule was inert then), so the
    // discount was the whole gap. Sol's identity is now Blockade Runner and the
    // Cradle muster, which does fire (GALAXY-BALANCE.md §4).
    ability_id: 'blockade_runner',
    ability_description: 'Blockade Runner: once per turn, your next attack across a hyperspace lane ignores an Emergency Seal.',
    color: '#5dade2',
  },
  {
    faction_id: 'forge_syndicate',
    name: 'Forge Syndicate',
    description: 'Industrial cartels — shipyard logistics deliver +2 reinforcements per turn and Jump Gates at half price; supply inserts on demand.',
    lore: 'Shipyards and foundries form the true border between civilization and the dark between stars.',
    flavor_quote: 'We sell the hulls that empires die in.',
    home_region_ids: ['rust_slag_wastes', 'rust_foundry_core', 'rust_ironstorm', 'rust_anchor_works', 'rust_hellas_deeps', 'rust_hesperia'],
    lineage_id: 'mercantile',
    reinforce_bonus: 2,
    // The Syndicate sells the hulls, so it builds the gate network at cost: half
    // price on Jump Gates. It is the one faction whose kit is production rather
    // than position, and mobility is what production could not previously buy.
    jump_gate_cost_mult: 0.5,
    ability_id: 'guerrilla_warfare',
    ability_description: 'Supply Insert: once per turn, place 1 free unit on an owned territory.',
    color: '#e67e22',
  },
  {
    faction_id: 'helion_navigators',
    name: 'Helion Navigators',
    description: 'Lane-mappers and drift pilots — +2 reinforcements per turn; every gateway in the galaxy stays visible to them, and their fleets jump between their own gateways.',
    lore: 'Their astrogators tape gravimetric shoals the way ancient sailors mapped reefs.',
    flavor_quote: 'The void has currents; we read them.',
    home_region_ids: ['verdan_sporefields', 'verdan_mirelands', 'verdan_lumen_crown', 'verdan_stormbelts', 'verdan_brilliance'],
    lineage_id: 'maritime',
    // Paid for the Cradle muster (GALAXY-BALANCE.md §4). Verdan is the seat Sol
    // feeds on, so any Sol rule that fires comes out of Verdan's share: the
    // muster alone left Verdan at 16-17%. +1 recovered seed A but not B or C;
    // +2 holds all three.
    reinforce_bonus: 2,
    // ...and in a two-player Colonies duel it is one too many (GALAXY-BALANCE.md
    // §7). Region bonuses shrink to a third at two seats and a flat bonus does
    // not, so the Navigators won 65-66% of their duels and 79-83% against the
    // Custodians. +1 there: 57.7-59.5%, and 64-74% against the Custodians,
    // with every faction at 41-60%. Halving the Forge's +2 as well broke the
    // Forge (34.5-37%): theirs is the kit, where this second point is the
    // Cradle's.
    colony_reinforce_bonus: { 2: 1 },
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
    lineage_id: 'bastion',
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
    description: 'Front-line nano-forges — unlocks the Workshop and +2 tech points per turn.',
    tier: 2,
    cost: 11,
    prerequisite: 'ga_hyperspace_chart',
    tech_point_income: 2,
    unlocks_building: 'production_1',
  },
  {
    // Gate Engineering is the economic root's second branch: Disruption Net
    // fortifies, this one MOVES. A pair of gates is a private lane between two
    // of your worlds, which is the only mobility the era sells.
    tech_id: 'ga_gate_engineering',
    name: 'Gate Engineering',
    description: 'Portable Pathfinder scaffolds — unlocks the Jump Gate building, a private lane between two worlds you hold.',
    tier: 2,
    cost: 10,
    prerequisite: 'ga_lattice_logistics',
    unlocks_building: 'jump_gate',
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
    description: 'Skimming stellar flux — unlocks the Laboratory and +4 tech points per turn.',
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

// ──────────────────────────────────────────────────────────────────────────
// Buildings v2 gating (docs/GALACTIC_AGE_BUILDINGS.md, Phase 1)
//
// The tree above names only the tier-I buildings, and names them at tier 2 or
// deeper; `isBuildingTechUnlocked` treats a building no node names as free, so
// the first tier of a family cost a mid-tree tech and every tier above it cost
// nothing. The v2 table gates every tier like the other eras do: tier I at the
// tier-1 roots, each later tier behind the matching tier of the tree. Node
// costs do not change. Selected per game by `settings.galaxy_buildings_v2`
// (baked at create from the `galaxy_buildings_v2_enabled` flag), through
// `getEraTechTree(era, { galaxyBuildingsV2 })`.
// ──────────────────────────────────────────────────────────────────────────

/** v2: which buildings each node opens. Nodes absent here open none. */
export const GALAXY_BUILDING_UNLOCKS_V2: Readonly<Record<string, readonly BuildingType[]>> = {
  ga_lattice_logistics: ['production_1', 'tech_gen_1'],
  ga_hyperspace_chart: ['defense_1'],
  ga_disruption_net: ['defense_2'],
  ga_battle_fabricators: ['production_2'],
  ga_gate_engineering: ['jump_gate'],
  ga_solar_foundries: ['production_3', 'tech_gen_2'],
  ga_gravity_brake: ['defense_3'],
  ga_dyson_slice: ['production_4'],
};

/** The same nodes, with their building unlocks replaced by the v2 table. */
// ──────────────────────────────────────────────────────────────────────────
// Lane powers (docs/GALACTIC_AGE_BUILDINGS.md §6, Phase 4)
//
// Every other era's tree unlocks abilities; the galaxy's unlocked none. Under
// `settings.galaxy_powers` four existing nodes each open a lane power
// (abilities/lanePowers.ts). The nodes, costs and prerequisites are unchanged;
// only `unlocks_ability` is added, and only in a game that plays the powers.
// ──────────────────────────────────────────────────────────────────────────

/** Lane powers: which ability each node opens under `galaxy_powers`. */
export const GALAXY_POWER_UNLOCKS: Readonly<Record<string, string>> = {
  ga_disruption_net: 'lance_battery',
  ga_battle_fabricators: 'orbital_muster',
  ga_gravity_brake: 'seal_breaker',
};

export interface GalaxyTreeOptions {
  /** Buildings v2 (`galaxy_buildings_v2`): the v2 building unlocks. */
  buildingsV2?: boolean;
  /** Lane powers (`galaxy_powers`): the four ability unlocks. */
  powers?: boolean;
}

const galaxyTreeMemo = new Map<string, TechNode[]>();

/**
 * The galaxy tree a game plays on, for its per-game options. Each combination
 * is built once and shared, so a reader can compare trees by identity.
 */
export function galaxyAgeTechTree(opts: GalaxyTreeOptions = {}): TechNode[] {
  if (!opts.buildingsV2 && !opts.powers) return GALAXY_AGE_TECH_TREE;
  const key = `${opts.buildingsV2 ? 'v2' : 'v1'}:${opts.powers ? 'powers' : ''}`;
  const hit = galaxyTreeMemo.get(key);
  if (hit) return hit;
  const tree = GALAXY_AGE_TECH_TREE.map((node) => {
    let next: TechNode = node;
    if (opts.buildingsV2) {
      const { unlocks_building: _v1, ...rest } = next;
      const opens = GALAXY_BUILDING_UNLOCKS_V2[node.tech_id];
      next = opens ? { ...rest, unlocks_buildings: [...opens] } : rest;
    }
    if (opts.powers) {
      const ability = GALAXY_POWER_UNLOCKS[node.tech_id];
      if (ability) next = { ...next, unlocks_ability: ability };
    }
    return next;
  });
  galaxyTreeMemo.set(key, tree);
  return tree;
}

/** The same nodes, with their building unlocks replaced by the v2 table. */
export const GALAXY_AGE_TECH_TREE_V2: TechNode[] = galaxyAgeTechTree({ buildingsV2: true });

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
