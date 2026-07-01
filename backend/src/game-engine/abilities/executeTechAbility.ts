import type { GameMap, GameState, PlayerState } from '../../types';
import { syncTerritoryCounts } from '../state/gameStateManager';
import { getEraTechTreeForPlayer } from '../state/techManager';
import { getInfluenceHopLimit, isTerritoryReachableWithinHops } from '../state/influenceManager';
import { getWonderInfluenceRange } from '../state/wonderManager';
import {
  GAME_SCOPED_ABILITIES,
  TERRITORY_ABILITY_DEFS,
  isEnemyTerritoryReachableForAbility,
  playerHasUnlockedAbility,
} from './techAbilities';

export interface AbilityExecutionResult {
  success: boolean;
  error?: string;
  effect?: string;
  territoryId?: string;
  previousOwner?: string | null;
  previousUnits?: number;
}

function getCurrentPlayer(state: GameState, playerId: string): PlayerState | undefined {
  return state.players.find((p) => p.player_id === playerId);
}

function applyUnitReduction(
  state: GameState,
  targetId: string,
  reduction: number,
  minUnits: number,
): { previousOwner: string | null; previousUnits: number } {
  const target = state.territories[targetId]!;
  const previousOwner = target.owner_id;
  const previousUnits = target.unit_count;
  target.unit_count = Math.max(minUnits, target.unit_count - reduction);
  syncTerritoryCounts(state);
  return { previousOwner, previousUnits };
}

export function validateAbilityPhase(abilityId: string, phase: GameState['phase']): string | null {
  const def = TERRITORY_ABILITY_DEFS[abilityId];
  if (!def) return null;
  if (def.phase === 'attack' && phase !== 'attack') {
    return `${def.label} can only be used during the attack phase`;
  }
  if (def.phase === 'fortify' && phase !== 'fortify') {
    return `${def.label} can only be used during the fortify phase`;
  }
  if (def.phase === 'draft' && phase !== 'draft' && phase !== 'fortify') {
    return `${def.label} can only be used during the draft or fortify phase`;
  }
  return null;
}

export function executeTechAbility(params: {
  state: GameState;
  map: GameMap;
  playerId: string;
  abilityId: string;
  territoryId?: string;
}): AbilityExecutionResult {
  const { state, map, playerId, abilityId, territoryId } = params;
  const currentPlayer = getCurrentPlayer(state, playerId);
  if (!currentPlayer) return { success: false, error: 'Player not found' };

  const phaseError = validateAbilityPhase(abilityId, state.phase);
  if (phaseError) return { success: false, error: phaseError };

  const def = TERRITORY_ABILITY_DEFS[abilityId];

  // ── Self-buff abilities (consumed on next attack) ─────────────────────────
  if (def?.selfBuff === 'pre_attack_damage') {
    currentPlayer.pending_pre_attack_damage = (currentPlayer.pending_pre_attack_damage ?? 0) + 1;
    return { success: true, effect: 'pre_attack_damage_ready' };
  }
  if (def?.selfBuff === 'extra_attack_die') {
    currentPlayer.pending_extra_attack_die = true;
    return { success: true, effect: 'extra_attack_die_ready' };
  }
  if (def?.selfBuff === 'negate_attacker_losses') {
    currentPlayer.pending_negate_attacker_losses = true;
    return { success: true, effect: 'negate_attacker_losses_ready' };
  }

  // ── Recon abilities (no territory target) ─────────────────────────────────
  if (abilityId === 'spy_network' || abilityId === 'satellite_reconnaissance') {
    return { success: true, effect: `${abilityId}_active` };
  }

  // ── Royal Decree: place 2 free units on an owned territory during draft ───
  if (abilityId === 'royal_decree') {
    if (!territoryId) return { success: false, error: 'Provide territoryId' };
    const t = state.territories[territoryId];
    if (!t || t.owner_id !== playerId) return { success: false, error: 'Invalid territory' };
    t.unit_count += 2;
    syncTerritoryCounts(state);
    return { success: true, effect: 'royal_decree_units', territoryId };
  }

  // ── Total War / People's War: one-time draft reinforcement surge (Group C) ──
  if (abilityId === 'total_war' || abilityId === 'peoples_war') {
    state.draft_units_remaining += 6;
    currentPlayer.used_game_abilities = [...(currentPlayer.used_game_abilities ?? []), abilityId];
    return { success: true, effect: 'faction_draft_reinforcements' };
  }

  // ── Imperial Diet: +1 draft unit per fully-owned region, capped at +4 ───────
  if (abilityId === 'imperial_diet') {
    const regionTally = new Map<string, { owned: number; total: number }>();
    for (const t of Object.values(state.territories)) {
      if (!t.region_id) continue;
      const entry = regionTally.get(t.region_id) ?? { owned: 0, total: 0 };
      entry.total += 1;
      if (t.owner_id === playerId) entry.owned += 1;
      regionTally.set(t.region_id, entry);
    }
    let fullyOwned = 0;
    for (const { owned, total } of regionTally.values()) {
      if (total > 0 && owned === total) fullyOwned += 1;
    }
    const bonus = Math.min(fullyOwned, 4);
    if (bonus === 0) return { success: false, error: 'Control at least one full region first' };
    state.draft_units_remaining += bonus;
    return { success: true, effect: 'faction_draft_reinforcements' };
  }

  // ── Unification Drive: free conversion of a neutral territory in range ──────
  if (abilityId === 'unification_drive') {
    if (!territoryId) return { success: false, error: 'Provide territoryId' };
    const target = state.territories[territoryId];
    if (!target) return { success: false, error: 'Invalid territory' };
    if (target.owner_id != null) return { success: false, error: 'Can only unify a neutral territory' };

    const ownedIds = Object.entries(state.territories)
      .filter(([, t]) => t.owner_id === playerId)
      .map(([id]) => id);
    const hopLimit = getInfluenceHopLimit({
      baseHopLimit: state.era_modifiers?.influence_range ?? 1,
      unlockedTechs: currentPlayer.unlocked_techs ?? [],
      techTree: state.settings.tech_trees_enabled ? getEraTechTreeForPlayer(state, playerId) : [],
      wonderRangeBonus: state.settings.economy_enabled ? getWonderInfluenceRange(state, playerId) : 0,
    });
    if (!isTerritoryReachableWithinHops({ map, ownedTerritoryIds: ownedIds, targetId: territoryId, hopLimit })) {
      return { success: false, error: 'Target is out of influence range' };
    }

    target.owner_id = playerId;
    target.unit_count = 1;
    syncTerritoryCounts(state);
    return { success: true, effect: 'unification_convert', territoryId };
  }

  // ── Armored Push: +1 fortify move this turn (Group F) ───────────────────────
  if (abilityId === 'armored_push') {
    currentPlayer.bonus_fortify_moves = (currentPlayer.bonus_fortify_moves ?? 0) + 1;
    return { success: true, effect: 'bonus_fortify_move' };
  }

  // ── Silk Road: +3 tech points (Group C) ─────────────────────────────────────
  if (abilityId === 'silk_road') {
    currentPlayer.tech_points = (currentPlayer.tech_points ?? 0) + 3;
    return { success: true, effect: 'faction_tech_points' };
  }

  // ── House of Wisdom: discount the next research by 3 tech points (min 1) ────
  if (abilityId === 'house_of_wisdom') {
    currentPlayer.pending_tech_discount = (currentPlayer.pending_tech_discount ?? 0) + 3;
    return { success: true, effect: 'faction_tech_discount' };
  }

  // ── Spice Trade: spend tech points to add reinforcements to the draft pool ──
  if (def?.draftReinforcements) {
    const cost = def.techCost ?? 0;
    if ((currentPlayer.tech_points ?? 0) < cost) {
      return { success: false, error: `Not enough tech points (need ${cost})` };
    }
    currentPlayer.tech_points = (currentPlayer.tech_points ?? 0) - cost;
    state.draft_units_remaining += def.draftReinforcements;
    return { success: true, effect: 'faction_draft_reinforcements' };
  }

  // ── Faction free / tech-gated unit placement on an owned territory (Groups A & B) ─
  if (def?.ownPlacement) {
    if (!territoryId) return { success: false, error: 'Provide territoryId' };
    const t = state.territories[territoryId];
    if (!t || t.owner_id !== playerId) return { success: false, error: 'Invalid territory' };
    if (def.ownPlacement.requiresMoon && t.world_id !== 'moon' && t.globe_id !== 'moon') {
      return { success: false, error: 'Must target an owned Moon territory' };
    }
    if (def.ownPlacement.requiresProductionBuilding
      && !(t.buildings ?? []).some((b) => b.startsWith('production'))) {
      return { success: false, error: 'Must target a territory with a production building' };
    }
    const cost = def.techCost ?? 0;
    if (cost > 0 && (currentPlayer.tech_points ?? 0) < cost) {
      return { success: false, error: `Not enough tech points (need ${cost})` };
    }
    if (cost > 0) currentPlayer.tech_points = (currentPlayer.tech_points ?? 0) - cost;
    t.unit_count += def.ownPlacement.units;
    if (def.ownPlacement.restoreStability && t.stability != null) {
      t.stability = 100;
    }
    syncTerritoryCounts(state);
    return { success: true, effect: 'faction_units_placed', territoryId };
  }

  // ── Mass Mobilization: place 5 free units on an owned territory (once/game) ─
  if (abilityId === 'mass_mobilization') {
    if (!territoryId) return { success: false, error: 'Provide territoryId' };
    const t = state.territories[territoryId];
    if (!t || t.owner_id !== playerId) return { success: false, error: 'Invalid territory' };
    t.unit_count += 5;
    syncTerritoryCounts(state);
    currentPlayer.used_game_abilities = [...(currentPlayer.used_game_abilities ?? []), abilityId];
    return { success: true, effect: 'mass_mobilization_units', territoryId };
  }

  // ── March to the Sea: enable chain attacks for this turn (once per game) ──
  if (abilityId === 'march_to_sea') {
    if (state.phase !== 'attack') {
      return { success: false, error: 'March to the Sea can only be activated during the attack phase' };
    }
    currentPlayer.march_to_sea_active = true;
    currentPlayer.march_to_sea_hops_used = 0;
    currentPlayer.march_to_sea_last_capture_id = null;
    currentPlayer.used_game_abilities = [...(currentPlayer.used_game_abilities ?? []), abilityId];
    return { success: true, effect: 'march_to_sea_active' };
  }

  // ── Siege Assault: next attack ignores defense building (once per turn) ───
  if (abilityId === 'siege_assault') {
    currentPlayer.pending_ignore_defense_building = true;
    return { success: true, effect: 'ignore_defense_building_ready' };
  }

  // ── Unit-reduction strikes ────────────────────────────────────────────────
  if (def?.unitReduction != null) {
    if (!territoryId) return { success: false, error: 'Provide territoryId' };
    const target = state.territories[territoryId];
    if (!target) return { success: false, error: 'Invalid territory' };
    if (target.owner_id === playerId) return { success: false, error: 'Cannot target your own territory' };
    if (target.owner_id == null) return { success: false, error: 'Cannot target a neutral territory' };

    if (!isEnemyTerritoryReachableForAbility(state, map, playerId, territoryId, def)) {
      return { success: false, error: 'Target territory is out of range' };
    }

    // Privateer: the raid can only strike coastal targets (territories with a sea connection).
    if (def.requiresCoastalTarget) {
      const isCoastal = (map.connections ?? []).some(
        (c) => c.type === 'sea' && (c.from === territoryId || c.to === territoryId),
      );
      if (!isCoastal) return { success: false, error: 'Can only strike a coastal territory' };
    }

    const { previousOwner, previousUnits } = applyUnitReduction(
      state,
      territoryId,
      def.unitReduction,
      def.minTargetUnits ?? 1,
    );

    // Privateer: looting a coastal target yields tech points when economy is enabled.
    if (def.grantsTechPointOnUse && state.settings.economy_enabled) {
      currentPlayer.tech_points = (currentPlayer.tech_points ?? 0) + def.grantsTechPointOnUse;
    }

    return {
      success: true,
      effect: 'unit_reduction',
      territoryId,
      previousOwner,
      previousUnits,
    };
  }

  // ── Atom bomb (territory devastation, once per game) ──────────────────────
  if (abilityId === 'atom_bomb') {
    if (!territoryId) return { success: false, error: 'Provide territoryId' };
    const target = state.territories[territoryId];
    if (!target) return { success: false, error: 'Invalid territory' };
    if (target.owner_id === playerId) return { success: false, error: 'Cannot bomb your own territory' };

    currentPlayer.used_game_abilities = [...(currentPlayer.used_game_abilities ?? []), abilityId];

    const previousOwner = target.owner_id;
    const previousUnits = target.unit_count;
    target.owner_id = null;
    target.unit_count = 1;
    target.buildings = [];
    target.naval_units = 0;
    if (target.stability != null) target.stability = 0;
    syncTerritoryCounts(state);

    return {
      success: true,
      effect: 'atom_bomb_detonated',
      territoryId,
      previousOwner,
      previousUnits,
    };
  }

  // ── Launch space station ──────────────────────────────────────────────────
  if (abilityId === 'launch_space_station') {
    if (state.phase === 'attack') {
      return { success: false, error: 'Launch must be scheduled during draft or fortify phase' };
    }
    if (currentPlayer.space_station_launched) {
      return { success: false, error: 'Your Space Station has already been launched' };
    }
    const launchPadTerritory = Object.values(state.territories).find(
      (t) => t.owner_id === playerId && (t.buildings?.includes('launch_pad') ?? false),
    );
    if (!launchPadTerritory) {
      return { success: false, error: 'You need a Launch Pad building to launch a Space Station' };
    }
    currentPlayer.used_game_abilities = [...(currentPlayer.used_game_abilities ?? []), abilityId];
    currentPlayer.space_station_launched = true;
    return {
      success: true,
      effect: 'space_station_launched',
      territoryId: launchPadTerritory.territory_id,
    };
  }

  // detente_protocol is handled via the influence socket path
  if (abilityId === 'detente_protocol') {
    return { success: false, error: 'Use the Influence action on a neutral territory' };
  }

  return { success: false, error: `Ability '${abilityId}' is not implemented` };
}

export function isGameScopedAbility(abilityId: string): boolean {
  return GAME_SCOPED_ABILITIES.has(abilityId);
}

export function consumeAttackBuffs(player: PlayerState): {
  preAttackDamage: number;
  extraAttackDie: boolean;
  ignoreDefenseBuilding: boolean;
  negateAttackerLosses: boolean;
} {
  const preAttackDamage = player.pending_pre_attack_damage ?? 0;
  const extraAttackDie = !!player.pending_extra_attack_die;
  const ignoreDefenseBuilding = !!player.pending_ignore_defense_building;
  const negateAttackerLosses = !!player.pending_negate_attacker_losses;

  player.pending_pre_attack_damage = undefined;
  player.pending_extra_attack_die = undefined;
  player.pending_ignore_defense_building = undefined;
  player.pending_negate_attacker_losses = undefined;

  return { preAttackDamage, extraAttackDie, ignoreDefenseBuilding, negateAttackerLosses };
}

export function playerCanUseAbility(
  state: GameState,
  player: PlayerState,
  abilityId: string,
): boolean {
  // A carried legacy charge makes the ability usable even though its unlocking
  // tech is gone (era advancement wiped unlocked_techs).
  const hasLegacy = (player.legacy_ability_charges?.[abilityId] ?? 0) > 0;
  if (!hasLegacy && !playerHasUnlockedAbility(state, player.player_id, abilityId)) return false;
  const def = TERRITORY_ABILITY_DEFS[abilityId];
  if (!def) return false;
  if (isGameScopedAbility(abilityId)) {
    return !(player.used_game_abilities ?? []).includes(abilityId);
  }
  return !(player.ability_uses ?? {})[abilityId];
}
