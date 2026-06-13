import type { EraId, GameState, PlayerState } from '../../types';
import { DEFAULT_ERA_SPINE_ID, getSpineEraIdAtIndex } from './spines';

/** Era id at `index` along the game's spine snapshot, clamped to the final step. */
export function getEraIdForAdvancementIndex(state: GameState, index: number): EraId {
  return getSpineEraIdAtIndex(state, index);
}

export function resolvePlayerEraId(state: GameState, player: PlayerState): EraId {
  if (!state.settings.era_advancement_enabled) return state.era;
  const idx = player.current_era_index ?? 0;
  return getEraIdForAdvancementIndex(state, idx);
}

export function getPlayerEraIndex(state: GameState, playerId: string): number {
  if (!state.settings.era_advancement_enabled) return 0;
  const player = state.players.find((p) => p.player_id === playerId);
  return player?.current_era_index ?? 0;
}

export const DEFAULT_ECONOMY_TECH_STARTING_TECH_POINTS = 3;
export const DEFAULT_ECONOMY_TECH_STARTING_GOLD = 4;

export function getDefaultEraAdvancementSettings(): {
  era_advancement_enabled: false;
  era_advancement_spine_id: string;
  era_advancement_conversion_ratio: number;
  era_advancement_strength_step: number;
  era_advancement_cost_step: number;
  era_advancement_cost_mult: number;
  era_advancement_cost_escalation: number;
  era_advancement_cost_escalation_cap: number;
  era_advancement_cost_income_floor: number;
  era_advancement_stability_gate: number;
  era_advancement_tech_gate_pct: number;
  era_advancement_tech_gate_mode: 'milestone';
  era_advancement_min_tier1_techs: number;
  era_advancement_min_tier2_techs: number;
  era_advancement_min_tier3_techs: number;
  era_advancement_min_buildings: number;
  era_advancement_vuln_defense_mult: number;
  era_advancement_vuln_turns: number;
  era_advancement_max_era_index: number;
  era_advancement_combat_gap_dice: number;
  era_advancement_catchup_discount: number;
  era_advancement_catchup_discount_floor: number;
  era_advancement_echo_decay: number;
  era_advancement_echo_cap_attack: number;
  era_advancement_echo_cap_defense: number;
  era_advancement_echo_cap_reinforce: number;
  era_advancement_echo_cap_tech: number;
} {
  return {
    era_advancement_enabled: false,
    era_advancement_spine_id: DEFAULT_ERA_SPINE_ID,
    era_advancement_conversion_ratio: 0.7,
    era_advancement_strength_step: 1.4,
    era_advancement_cost_step: 1.25,
    era_advancement_cost_mult: 2.0,
    era_advancement_cost_escalation: 1.5,
    era_advancement_cost_escalation_cap: 4.0,
    era_advancement_cost_income_floor: 8,
    era_advancement_stability_gate: 60,
    era_advancement_tech_gate_pct: 0.33,
    era_advancement_tech_gate_mode: 'milestone',
    era_advancement_min_tier1_techs: 3,
    era_advancement_min_tier2_techs: 1,
    era_advancement_min_tier3_techs: 0,
    era_advancement_min_buildings: 1,
    era_advancement_vuln_defense_mult: 0.75,
    era_advancement_vuln_turns: 1,
    era_advancement_max_era_index: 1,
    era_advancement_combat_gap_dice: 1,
    era_advancement_catchup_discount: 0.85,
    era_advancement_catchup_discount_floor: 0.6,
    era_advancement_echo_decay: 0.5,
    era_advancement_echo_cap_attack: 2,
    era_advancement_echo_cap_defense: 2,
    era_advancement_echo_cap_reinforce: 2,
    era_advancement_echo_cap_tech: 3,
  };
}
