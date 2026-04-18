// ============================================================
// Shared types for era faction and technology definitions
// ============================================================

import type { BuildingType } from '../../types';

/** Era-unique wonder building definition. One per era, globally unique per game. */
export interface EraWonder {
  wonder_id: BuildingType;
  name: string;
  description: string;
  cost: number;
  /** What the passive does — used for display and applyWonderBonus dispatch. */
  passive_effect_type:
    | 'defense_die_global'
    | 'reinforce_bonus'
    | 'sea_attack_dice'
    | 'tech_point_per_territory'
    | 'tech_cost_half'
    | 'flat_reinforce'
    | 'influence_range';
  passive_effect_value: number;
}

/** A playable faction for a given era with geographic home territories and passive ability. */
export interface Faction {
  faction_id: string;
  name: string;
  description: string;
  lore?: string;
  flavor_quote?: string;
  /** region_id or territory_id values that form the home region for initial placement. */
  home_region_ids: string[];
  /** Passive combat modifier applied to this faction's attacks (+dice / re-roll). */
  passive_attack_bonus?: number;
  /** Passive combat modifier applied when defending. */
  passive_defense_bonus?: number;
  /** Extra reinforcement units per turn. */
  reinforce_bonus?: number;
  /** ID of a unique ability available once per turn. */
  ability_id?: string;
  /** Human-readable description of the special ability. */
  ability_description?: string;
  /** UI color (CSS hex) — used in lobby display. */
  color: string;
  /** Extra stability recovery per turn for this faction's territories. */
  stability_recovery_bonus?: number;
}

/** A node in an era-specific technology tree. */
export interface TechNode {
  tech_id: string;
  name: string;
  description: string;
  tier: 1 | 2 | 3 | 4;
  /** tech_id of the required prerequisite (null = no requirement). */
  prerequisite?: string;
  /** Gold / production point cost to research. */
  cost: number;
  /** Passive attack dice bonus (+N). */
  attack_bonus?: number;
  /** Passive defense dice bonus (+N). */
  defense_bonus?: number;
  /** Extra reinforcement units per turn. */
  reinforce_bonus?: number;
  /** Extra tech points generated per turn. */
  tech_point_income?: number;
  /** Building type that becomes available after researching this node. */
  unlocks_building?: BuildingType;
  /** Ability ID unlocked by this tech node. */
  unlocks_ability?: string;
}
