import type { GameMap, GameState, PlayerState } from '../../types';
import { getEraTechTreeForPlayer } from '../state/techManager';
import { getPlayerEraModifiers } from '../state/eraModifiers';
import { getAdjacentTerritoryIds } from '../state/influenceManager';
import { getOrbitAccessResult, isLaneSealedForPlayer } from '../state/moonAccess';

/** Abilities consumed once per game (not per turn). */
export const GAME_SCOPED_ABILITIES = new Set([
  'atom_bomb',
  'launch_space_station',
  'march_to_sea',
  'mass_mobilization',
  'total_war',
  'peoples_war',
]);

/** Tech abilities that ignore defense-building bonus when the player attacks. */
/** Unlocked ability ids that permanently negate defender building dice (not once-per-turn actives). */
const PASSIVE_IGNORE_DEFENSE_BUILDING = new Set([
  'siege_attack',
  'heavy_bombardment',
  'artillery_barrage',
  'cannon_barrage',
  'artillery_support',
]);

export interface TerritoryAbilityDef {
  label: string;
  scope: 'turn' | 'game';
  phase: 'attack' | 'draft' | 'fortify';
  /** Minimum units left on target after a reduction strike. */
  minTargetUnits?: number;
  unitReduction?: number;
  requiresAdjacency?: boolean;
  maxHopRange?: number;
  /** Self-buff consumed on next land attack instead of targeting a territory. */
  selfBuff?: 'pre_attack_damage' | 'extra_attack_die' | 'negate_attacker_losses' | 'ignore_lane_seal';
  /**
   * Free-unit placement on an owned territory (faction draft abilities). Units
   * are placed directly, bypassing the stability draft cap (matching the
   * royal_decree / guerrilla_warfare convention for granted bonus units).
   */
  ownPlacement?: {
    units: number;
    /** Target must be an owned Moon territory (lunar_supply_drop). */
    requiresMoon?: boolean;
    /** Also restore the target territory's stability to full (terraform). */
    restoreStability?: boolean;
    /** Target must have a production building (mercenary_contract). */
    requiresProductionBuilding?: boolean;
    /** Target must border (any connection type) a territory owned by another player (satellite_uplink). */
    requiresEnemyAdjacent?: boolean;
    /** Production granted to the user on placement, if economy is on (solar_surge). */
    grantsProduction?: number;
  };
  /** Tech points consumed when the ability is used (Group B economy abilities). */
  techCost?: number;
  /** Adds N units to the draft pool with no territory target (spice_trade). */
  draftReinforcements?: number;
  /** Reduction strike target must be coastal (have a sea connection) — privateer. */
  requiresCoastalTarget?: boolean;
  /** Tech points granted to the user on a successful strike, if economy is on (privateer). */
  grantsTechPointOnUse?: number;
}

export const TERRITORY_ABILITY_DEFS: Record<string, TerritoryAbilityDef> = {
  atom_bomb: { label: 'Atom Bomb', scope: 'game', phase: 'attack' },
  nuclear_strike: { label: 'Nuclear Strike', scope: 'turn', phase: 'attack', unitReduction: 2, minTargetUnits: 1 },
  cyber_attack: { label: 'Cyber Attack', scope: 'turn', phase: 'attack', unitReduction: 1, minTargetUnits: 1, requiresAdjacency: true },
  data_breach: { label: 'Data Breach', scope: 'turn', phase: 'attack', unitReduction: 1, minTargetUnits: 1, requiresAdjacency: true },
  orbital_strike: { label: 'Orbital Strike', scope: 'turn', phase: 'attack', unitReduction: 3, minTargetUnits: 1 },
  swarm_strike: { label: 'Swarm Strike', scope: 'turn', phase: 'attack', unitReduction: 2, minTargetUnits: 1, requiresAdjacency: true },
  dyson_beam: { label: 'Dyson Beam', scope: 'turn', phase: 'attack', unitReduction: 4, minTargetUnits: 1 },
  hypersonic_strike: { label: 'Hypersonic Strike', scope: 'turn', phase: 'attack', unitReduction: 2, minTargetUnits: 1, maxHopRange: 2 },
  river_blockade: { label: 'River Blockade', scope: 'turn', phase: 'attack', unitReduction: 1, minTargetUnits: 1, requiresAdjacency: true },
  air_strike: { label: 'Air Strike', scope: 'turn', phase: 'attack', selfBuff: 'pre_attack_damage', unitReduction: 1 },
  knights_charge: { label: 'Knights Charge', scope: 'turn', phase: 'attack', selfBuff: 'extra_attack_die' },
  bersaglieri_charge: { label: 'Bersaglieri Charge', scope: 'turn', phase: 'attack', selfBuff: 'extra_attack_die' },
  siege_assault: { label: 'Siege Assault', scope: 'turn', phase: 'attack' },
  cannon_barrage: { label: 'Cannon Barrage', scope: 'turn', phase: 'attack', selfBuff: 'extra_attack_die' },
  spy_network: { label: 'Spy Network', scope: 'turn', phase: 'attack' },
  satellite_reconnaissance: { label: 'Satellite Recon', scope: 'turn', phase: 'attack' },
  launch_space_station: { label: 'Launch Space Station', scope: 'game', phase: 'draft' },
  royal_decree: { label: 'Royal Decree', scope: 'turn', phase: 'draft' },
  mass_mobilization: { label: 'Mass Mobilization', scope: 'game', phase: 'draft' },
  detente_protocol: { label: 'Détente Influence', scope: 'turn', phase: 'attack' },

  // ── Faction abilities: free-unit placement on owned territory (Group A) ──────
  marshall_plan: { label: 'Marshall Plan', scope: 'turn', phase: 'draft', ownPlacement: { units: 1 } },
  insurgency: { label: 'Insurgency', scope: 'turn', phase: 'draft', ownPlacement: { units: 1 } },
  guerrilla_resistance: { label: 'Guerrilla Resistance', scope: 'turn', phase: 'draft', ownPlacement: { units: 2 } },
  // Forge Syndicate's Supply Insert (and China's Guerrilla Warfare) ran through a
  // bespoke socket branch instead of a def, so the AI parity path — which reads
  // TERRITORY_ABILITY_DEFS — could never fire it, and no client button existed.
  // Label matches the client's FACTION_ABILITY_UI entry; Forge's faction copy
  // calls the same charge "Supply Insert" until the galaxy kits are rebuilt.
  guerrilla_warfare: { label: 'Guerrilla Warfare', scope: 'turn', phase: 'draft', ownPlacement: { units: 1 } },
  habsberg_garrison: { label: 'Habsburg Garrison', scope: 'turn', phase: 'draft', ownPlacement: { units: 1 } },
  lunar_supply_drop: { label: 'Lunar Supply Drop', scope: 'turn', phase: 'draft', ownPlacement: { units: 2, requiresMoon: true } },
  terraform: { label: 'Terraform', scope: 'turn', phase: 'draft', ownPlacement: { units: 1, restoreStability: true } },

  // ── Faction abilities: tech-point-gated placement (Group B) ─────────────────
  arsenal_of_democracy: { label: 'Arsenal of Democracy', scope: 'turn', phase: 'draft', techCost: 5, ownPlacement: { units: 3 } },
  ai_surge: { label: 'AI Surge', scope: 'turn', phase: 'draft', techCost: 5, ownPlacement: { units: 3 } },
  economic_boom: { label: 'Economic Boom', scope: 'turn', phase: 'draft', techCost: 3, ownPlacement: { units: 2 } },
  oil_wealth: { label: 'Oil Wealth', scope: 'turn', phase: 'draft', techCost: 6, ownPlacement: { units: 3 } },
  mercenary_contract: { label: 'Mercenary Contract', scope: 'turn', phase: 'draft', techCost: 6, ownPlacement: { units: 4, requiresProductionBuilding: true } },
  satellite_uplink: { label: 'Satellite Uplink', scope: 'turn', phase: 'draft', techCost: 4, ownPlacement: { units: 2, requiresEnemyAdjacent: true } },
  solar_surge: { label: 'Solar Surge', scope: 'turn', phase: 'draft', ownPlacement: { units: 1, grantsProduction: 2 } },
  spice_trade: { label: 'Spice Trade', scope: 'turn', phase: 'draft', techCost: 5, draftReinforcements: 2 },

  // ── Faction abilities: reinforcement / economy boosts (Group C, draft) ──────
  total_war: { label: 'Total War', scope: 'game', phase: 'draft' },
  peoples_war: { label: "People's War", scope: 'game', phase: 'draft' },
  imperial_diet: { label: 'Imperial Diet', scope: 'turn', phase: 'draft' },
  silk_road: { label: 'Silk Road', scope: 'turn', phase: 'draft' },
  house_of_wisdom: { label: 'House of Wisdom', scope: 'turn', phase: 'draft' },

  // ── Faction abilities: attack self-buffs (Group D, attack) ──────────────────
  war_elephants: { label: 'War Elephants', scope: 'turn', phase: 'attack', selfBuff: 'extra_attack_die' },
  banzai_charge: { label: 'Banzai Charge', scope: 'turn', phase: 'attack', selfBuff: 'extra_attack_die' },
  ambush: { label: 'Ambush', scope: 'turn', phase: 'attack', selfBuff: 'extra_attack_die' },
  testudo: { label: 'Testudo', scope: 'turn', phase: 'attack', selfBuff: 'negate_attacker_losses' },

  // ── Galactic Age (corridors) ─────────────────────────────────────────────────
  blockade_runner: { label: 'Blockade Runner', scope: 'turn', phase: 'attack', selfBuff: 'ignore_lane_seal' },

  // ── Faction abilities: unit-reduction strikes (Group E, attack) ─────────────
  precision_airstrike: { label: 'Precision Airstrike', scope: 'turn', phase: 'attack', unitReduction: 2, minTargetUnits: 1, requiresAdjacency: true },
  longbowmen: { label: 'Longbowmen', scope: 'turn', phase: 'attack', unitReduction: 1, minTargetUnits: 1, requiresAdjacency: true },
  chevauchee: { label: 'Chevauchée', scope: 'turn', phase: 'attack', unitReduction: 2, minTargetUnits: 1, requiresAdjacency: true },
  privateer: { label: 'Privateer', scope: 'turn', phase: 'attack', unitReduction: 1, minTargetUnits: 1, requiresAdjacency: true, requiresCoastalTarget: true, grantsTechPointOnUse: 1 },

  // ── Faction abilities: fortify boost (Group F, fortify) ─────────────────────
  armored_push: { label: 'Armored Push', scope: 'turn', phase: 'fortify' },

  // ── Faction abilities: other actives (Group G) ──────────────────────────────
  unification_drive: { label: 'Unification Drive', scope: 'turn', phase: 'attack' },
};

export function getUnlockedAbilityIds(state: GameState, player: PlayerState): Set<string> {
  if (!state.settings.tech_trees_enabled) return new Set();
  const unlocked = player.unlocked_techs ?? [];
  const tree = getEraTechTreeForPlayer(state, player.player_id);
  const ids = new Set<string>();
  for (const node of tree) {
    if (unlocked.includes(node.tech_id) && node.unlocks_ability) {
      ids.add(node.unlocks_ability);
    }
  }
  return ids;
}

export function playerHasUnlockedAbility(state: GameState, playerId: string, abilityId: string): boolean {
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player) return false;
  return getUnlockedAbilityIds(state, player).has(abilityId);
}

/**
 * The single strongest UNUSED tech-unlocked once-per-game ability the player
 * currently holds — the "trump card" carried into the next era on advancement
 * (e.g. an undetonated Atom Bomb). Ranked by the unlocking tech's tier then
 * cost. Returns null when there's nothing worth carrying. Faction abilities are
 * excluded (they remap on advance and weren't bought with tech points).
 */
export function getCarryableLegacyAbility(state: GameState, player: PlayerState): string | null {
  if (!state.settings.tech_trees_enabled) return null;
  const unlocked = new Set(player.unlocked_techs ?? []);
  const used = new Set(player.used_game_abilities ?? []);
  const tree = getEraTechTreeForPlayer(state, player.player_id);
  let best: { abilityId: string; tier: number; cost: number } | null = null;
  for (const node of tree) {
    const abilityId = node.unlocks_ability;
    if (!abilityId || !unlocked.has(node.tech_id)) continue;
    if (!GAME_SCOPED_ABILITIES.has(abilityId) || used.has(abilityId)) continue;
    if (!best || node.tier > best.tier || (node.tier === best.tier && node.cost > best.cost)) {
      best = { abilityId, tier: node.tier, cost: node.cost };
    }
  }
  return best?.abilityId ?? null;
}

export function getInfluenceUnitCost(state: GameState, playerId: string): number {
  if (!state.settings.tech_trees_enabled) return 3;
  return playerHasUnlockedAbility(state, playerId, 'proxy_funding') ? 2 : 3;
}

export function getFortifyMoveLimit(state: GameState, playerId: string): number {
  const player = state.players.find((p) => p.player_id === playerId);
  // Armored Push (faction ability) grants +1 fortify move for the turn; applies
  // even when tech trees are off, so it is folded into every return path.
  const fortifyBonus = player?.bonus_fortify_moves ?? 0;
  const eraModifiers = getPlayerEraModifiers(state, playerId);
  let limit = eraModifiers.wartime_logistics ? 2 : 1;
  if (!state.settings.tech_trees_enabled) return limit + fortifyBonus;

  const abilities = getUnlockedAbilityIds(state, player!);
  if (abilities.has('motorized_logistics') && eraModifiers.wartime_logistics) {
    limit = 3;
  } else if (abilities.has('cavalry_march') || abilities.has('galleon_transport')) {
    limit = Math.max(limit, 2);
  }

  // ACW railroads description grants 2 fortify moves — keyed on the tech node, not an ability id.
  if (player?.unlocked_techs?.includes('acw_railroads')) {
    limit = Math.max(limit, 2);
  }
  return limit + fortifyBonus;
}

export function getPrecisionStrikeMinUnits(state: GameState, playerId: string): number {
  if (!getPlayerEraModifiers(state, playerId).precision_strike) return Infinity;
  if (state.settings.tech_trees_enabled && playerHasUnlockedAbility(state, playerId, 'special_ops')) {
    return 2;
  }
  return 4;
}

export function attackerIgnoresDefenseBuilding(state: GameState, attackerId: string): boolean {
  if (!state.settings.tech_trees_enabled) return false;
  const abilities = getUnlockedAbilityIds(state, state.players.find((p) => p.player_id === attackerId)!);
  for (const id of PASSIVE_IGNORE_DEFENSE_BUILDING) {
    if (abilities.has(id)) return true;
  }
  const player = state.players.find((p) => p.player_id === attackerId);
  if (player?.pending_ignore_defense_building) return true;
  return false;
}

/** Extra attack dice when assaulting an under-defended territory (rapid_fire). */
export function getUnderdefendedAttackDiceBonus(
  state: GameState,
  attackerId: string,
  defenderUnitCount: number,
): number {
  if (!state.settings.tech_trees_enabled) return 0;
  if (defenderUnitCount > 2) return 0;
  return playerHasUnlockedAbility(state, attackerId, 'rapid_fire') ? 1 : 0;
}

/** Passive recon: adjacent enemy territories stay fully visible under fog. */
export function hasPassiveAdjacentRecon(state: GameState, playerId: string): boolean {
  if (!state.settings.tech_trees_enabled) return false;
  const abilities = getUnlockedAbilityIds(state, state.players.find((p) => p.player_id === playerId)!);
  return abilities.has('drone_recon') || abilities.has('orbital_recon');
}

/**
 * Whether an owned territory borders (over any connection type) a territory
 * held by another player. Neutral neighbours don't count — the point of a
 * frontline-only placement (satellite_uplink) is that it can't fortify the rear.
 */
export function isOwnedTerritoryAdjacentToEnemy(
  state: GameState,
  map: GameMap,
  playerId: string,
  territoryId: string,
): boolean {
  return (map.connections ?? []).some((c) => {
    const otherId = c.from === territoryId ? c.to : c.to === territoryId ? c.from : null;
    if (!otherId) return false;
    const owner = state.territories[otherId]?.owner_id;
    return owner != null && owner !== playerId;
  });
}

/**
 * Orbit lanes a strike may travel along, for this player, right now.
 *
 * A reduction strike reaches across the map the way an attack does, so it must
 * respect the same orbit gate: measured on era_galaxy, Stellar Mandate's Cyber
 * Strike removed a unit from a Verdan tile across a hyperspace lane with no
 * Hyperspace Chart researched, because the reachability test only looked at
 * adjacency. Non-orbit edges are never filtered, so Earth maps are unaffected.
 */
function abilityTraversalFilter(
  state: GameState,
  map: GameMap,
  playerId: string,
): (from: string, to: string) => boolean {
  const player = state.players.find((p) => p.player_id === playerId);
  const orbitPairs = new Set<string>();
  for (const c of map.connections) {
    if (c.type === 'orbit') {
      orbitPairs.add(`${c.from}>${c.to}`);
      orbitPairs.add(`${c.to}>${c.from}`);
    }
  }
  if (orbitPairs.size === 0 || !player) return () => true;
  const access = getOrbitAccessResult(state, player, map, state.era);
  return (from, to) => {
    if (!orbitPairs.has(`${from}>${to}`)) return true;
    if (!access.allowed) return false;
    return !isLaneSealedForPlayer(state, from, to, playerId);
  };
}

export function isEnemyTerritoryReachableForAbility(
  state: GameState,
  map: GameMap,
  playerId: string,
  targetId: string,
  def: TerritoryAbilityDef,
): boolean {
  const target = state.territories[targetId];
  if (!target || target.owner_id === playerId || target.owner_id == null) return false;

  const ownedIds = Object.entries(state.territories)
    .filter(([, t]) => t.owner_id === playerId)
    .map(([id]) => id);

  const canTraverse = abilityTraversalFilter(state, map, playerId);

  if (def.maxHopRange != null) {
    // Walk the hop budget over the permitted edges only. The unfiltered helper
    // stays the influence path's; a strike may not route through a closed lane.
    if (ownedIds.length === 0 || def.maxHopRange <= 0) return false;
    const visited = new Set<string>(ownedIds);
    let frontier = [...ownedIds];
    for (let hop = 0; hop < def.maxHopRange; hop++) {
      const next: string[] = [];
      for (const tid of frontier) {
        for (const nid of getAdjacentTerritoryIds(map, tid)) {
          if (visited.has(nid) || !canTraverse(tid, nid)) continue;
          visited.add(nid);
          if (nid === targetId) return true;
          next.push(nid);
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }
    return false;
  }

  if (def.requiresAdjacency) {
    return ownedIds.some(
      (oid) => getAdjacentTerritoryIds(map, oid).includes(targetId) && canTraverse(oid, targetId),
    );
  }

  // Unbounded strikes (orbital_strike, dyson_beam) are authored as "anywhere on
  // the map" and stay that way: gating them on lanes would silently redesign
  // them, which is a call for the corridor work, not this repair.
  return true;
}

/**
 * Faction passives that reveal territory under fog.
 *
 * Helion Navigators' Long-Range Sensors was authored as a once-per-turn active
 * (`orbital_recon`) that no handler implements: over the wire the ability
 * returned "Ability 'orbital_recon' is not implemented", and no client button
 * existed either, so the faction's only advertised active did nothing at all.
 * The lore says they map the lanes, so the repair makes it a passive: every
 * gateway tile in the galaxy — both ends of every inter-world lane — stays
 * visible to them, garrison included.
 *
 * Gateways are derived from the adjacency graph rather than the map document
 * (which this layer doesn't receive): on a galaxy map the only edges joining two
 * different worlds are the orbit lanes, so a tile with a neighbour on another
 * world is exactly a lane endpoint. No-ops on single-world maps.
 */
/**
 * Blockade Runner: spend the held charge if a sealed lane is about to be
 * crossed. Returns true when the crossing may proceed despite the seal.
 */
export function consumeBlockadeRunner(player: PlayerState): boolean {
  if (!player.pending_ignore_lane_seal) return false;
  player.pending_ignore_lane_seal = undefined;
  return true;
}

export function expandFogVisibilityFromFactionPassive(
  state: GameState,
  playerId: string,
  visibleIds: Set<string>,
  adjacency: Map<string, string[]>,
): void {
  if (!state.settings.factions_enabled) return;
  const player = state.players.find((p) => p.player_id === playerId);
  if (player?.faction_id !== 'helion_navigators') return;

  for (const [tid, territory] of Object.entries(state.territories)) {
    const world = territory.world_id;
    if (!world) continue;
    for (const neighbourId of adjacency.get(tid) ?? []) {
      const neighbour = state.territories[neighbourId];
      if (!neighbour?.world_id || neighbour.world_id === world) continue;
      visibleIds.add(tid);
      visibleIds.add(neighbourId);
      break;
    }
  }
}

export function expandFogVisibilityFromRecon(
  state: GameState,
  playerId: string,
  visibleIds: Set<string>,
  adjacency: Map<string, string[]>,
): void {
  const player = state.players.find((p) => p.player_id === playerId);
  if (!player || !state.settings.tech_trees_enabled) return;

  if (player.ability_uses?.satellite_reconnaissance) {
    for (const tid of Object.keys(state.territories)) visibleIds.add(tid);
    return;
  }

  if (player.ability_uses?.spy_network) {
    const ownedIds = Object.entries(state.territories)
      .filter(([, t]) => t.owner_id === playerId)
      .map(([id]) => id);
    let frontier = [...ownedIds];
    const visited = new Set<string>(ownedIds);
    for (let hop = 0; hop < 2; hop++) {
      const next: string[] = [];
      for (const tid of frontier) {
        for (const nid of adjacency.get(tid) ?? []) {
          if (visited.has(nid)) continue;
          visited.add(nid);
          visibleIds.add(nid);
          next.push(nid);
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }
  }

  // Passive recon (drone_recon / orbital_recon): persistently reveal territories
  // within 2 hops of owned territory — one ring beyond the default border
  // scouting reveal — so the tech delivers real standing intel each turn.
  if (hasPassiveAdjacentRecon(state, playerId)) {
    const ownedIds = Object.entries(state.territories)
      .filter(([, t]) => t.owner_id === playerId)
      .map(([id]) => id);
    let frontier = [...ownedIds];
    const visited = new Set<string>(ownedIds);
    for (let hop = 0; hop < 2; hop++) {
      const next: string[] = [];
      for (const tid of frontier) {
        for (const nid of adjacency.get(tid) ?? []) {
          if (visited.has(nid)) continue;
          visited.add(nid);
          visibleIds.add(nid);
          next.push(nid);
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }
  }
}
