import type { EraId, GameState, PlayerState } from '../../types';

/** PoC advancement spine: Ancient → Medieval only. */
export const ERA_ADVANCEMENT_SEQUENCE: EraId[] = ['ancient', 'medieval'];

export function getEraIdForAdvancementIndex(index: number): EraId {
  return ERA_ADVANCEMENT_SEQUENCE[index] ?? ERA_ADVANCEMENT_SEQUENCE[ERA_ADVANCEMENT_SEQUENCE.length - 1];
}

export function resolvePlayerEraId(state: GameState, player: PlayerState): EraId {
  if (!state.settings.era_advancement_enabled) return state.era;
  const idx = player.current_era_index ?? 0;
  return getEraIdForAdvancementIndex(idx);
}

export function getPlayerEraIndex(state: GameState, playerId: string): number {
  if (!state.settings.era_advancement_enabled) return 0;
  const player = state.players.find((p) => p.player_id === playerId);
  return player?.current_era_index ?? 0;
}

export function getDefaultEraAdvancementSettings(): {
  era_advancement_enabled: false;
  era_advancement_conversion_ratio: number;
  era_advancement_strength_step: number;
  era_advancement_cost_step: number;
  era_advancement_cost_mult: number;
  era_advancement_cost_escalation: number;
  era_advancement_stability_gate: number;
  era_advancement_tech_gate_pct: number;
  era_advancement_vuln_defense_mult: number;
  era_advancement_vuln_turns: number;
  era_advancement_max_era_index: number;
  era_advancement_combat_gap_dice: number;
} {
  return {
    era_advancement_enabled: false,
    era_advancement_conversion_ratio: 0.7,
    era_advancement_strength_step: 1.4,
    era_advancement_cost_step: 1.25,
    era_advancement_cost_mult: 2.0,
    era_advancement_cost_escalation: 1.5,
    era_advancement_stability_gate: 60,
    era_advancement_tech_gate_pct: 0.25,
    era_advancement_vuln_defense_mult: 0.75,
    era_advancement_vuln_turns: 1,
    era_advancement_max_era_index: 1,
    era_advancement_combat_gap_dice: 1,
  };
}
