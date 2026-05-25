import type { GameMap, GameState, PlayerState } from '../../types';
import { syncTerritoryCounts } from '../state/gameStateManager';
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

  // ── March to the Sea: enable chain attacks for this turn (once per game) ──
  if (abilityId === 'march_to_sea') {
    if (state.phase !== 'attack') {
      return { success: false, error: 'March to the Sea can only be activated during the attack phase' };
    }
    currentPlayer.march_to_sea_active = true;
    currentPlayer.used_game_abilities = [...(currentPlayer.used_game_abilities ?? []), abilityId];
    return { success: true, effect: 'march_to_sea_active' };
  }

  // ── Siege assault variants: next attack ignores defense building ──────────
  if (abilityId === 'siege_assault' || abilityId === 'cannon_barrage') {
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

    const { previousOwner, previousUnits } = applyUnitReduction(
      state,
      territoryId,
      def.unitReduction,
      def.minTargetUnits ?? 1,
    );
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
} {
  const preAttackDamage = player.pending_pre_attack_damage ?? 0;
  const extraAttackDie = !!player.pending_extra_attack_die;
  const ignoreDefenseBuilding = !!player.pending_ignore_defense_building;

  player.pending_pre_attack_damage = undefined;
  player.pending_extra_attack_die = undefined;
  player.pending_ignore_defense_building = undefined;

  return { preAttackDamage, extraAttackDie, ignoreDefenseBuilding };
}

export function playerCanUseAbility(
  state: GameState,
  player: PlayerState,
  abilityId: string,
): boolean {
  if (!playerHasUnlockedAbility(state, player.player_id, abilityId)) return false;
  const def = TERRITORY_ABILITY_DEFS[abilityId];
  if (!def) return false;
  if (isGameScopedAbility(abilityId)) {
    return !(player.used_game_abilities ?? []).includes(abilityId);
  }
  return !(player.ability_uses ?? {})[abilityId];
}
