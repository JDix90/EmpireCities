import type { GameMap, GameState, PlayerState } from '../../types';
import { getEraTechTreeForPlayer } from '../state/techManager';
import type { TechNode } from '../eras/types';
import { isTerritoryReachableWithinHops, getAdjacentTerritoryIds } from '../state/influenceManager';

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
  selfBuff?: 'pre_attack_damage' | 'extra_attack_die' | 'negate_attacker_losses';
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
  habsberg_garrison: { label: 'Habsburg Garrison', scope: 'turn', phase: 'draft', ownPlacement: { units: 1 } },
  lunar_supply_drop: { label: 'Lunar Supply Drop', scope: 'turn', phase: 'draft', ownPlacement: { units: 2, requiresMoon: true } },
  terraform: { label: 'Terraform', scope: 'turn', phase: 'draft', ownPlacement: { units: 1, restoreStability: true } },

  // ── Faction abilities: tech-point-gated placement (Group B) ─────────────────
  arsenal_of_democracy: { label: 'Arsenal of Democracy', scope: 'turn', phase: 'draft', techCost: 5, ownPlacement: { units: 3 } },
  ai_surge: { label: 'AI Surge', scope: 'turn', phase: 'draft', techCost: 5, ownPlacement: { units: 3 } },
  economic_boom: { label: 'Economic Boom', scope: 'turn', phase: 'draft', techCost: 3, ownPlacement: { units: 2 } },
  oil_wealth: { label: 'Oil Wealth', scope: 'turn', phase: 'draft', techCost: 6, ownPlacement: { units: 3 } },
  mercenary_contract: { label: 'Mercenary Contract', scope: 'turn', phase: 'draft', techCost: 5, ownPlacement: { units: 4, requiresProductionBuilding: true } },
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

export function getInfluenceUnitCost(state: GameState, playerId: string): number {
  if (!state.settings.tech_trees_enabled) return 3;
  return playerHasUnlockedAbility(state, playerId, 'proxy_funding') ? 2 : 3;
}

export function getFortifyMoveLimit(state: GameState, playerId: string): number {
  const player = state.players.find((p) => p.player_id === playerId);
  // Armored Push (faction ability) grants +1 fortify move for the turn; applies
  // even when tech trees are off, so it is folded into every return path.
  const fortifyBonus = player?.bonus_fortify_moves ?? 0;
  let limit = state.era_modifiers?.wartime_logistics ? 2 : 1;
  if (!state.settings.tech_trees_enabled) return limit + fortifyBonus;

  const abilities = getUnlockedAbilityIds(state, player!);
  if (abilities.has('motorized_logistics') && state.era_modifiers?.wartime_logistics) {
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
  if (!state.era_modifiers?.precision_strike) return Infinity;
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

  if (def.maxHopRange != null) {
    return isTerritoryReachableWithinHops({
      map,
      ownedTerritoryIds: ownedIds,
      targetId,
      hopLimit: def.maxHopRange,
    });
  }

  if (def.requiresAdjacency) {
    return ownedIds.some((oid) => getAdjacentTerritoryIds(map, oid).includes(targetId));
  }

  return true;
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

export function findTechNodeForAbility(tree: TechNode[], abilityId: string): TechNode | undefined {
  return tree.find((n) => n.unlocks_ability === abilityId);
}
