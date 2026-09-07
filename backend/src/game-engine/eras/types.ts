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
    | 'influence_range'
    | 'orbit_access';
  passive_effect_value: number;
}

/** A playable faction for a given era with geographic home territories and passive ability. */
export interface Faction {
  faction_id: string;
  name: string;
  description: string;
  lore?: string;
  flavor_quote?: string;
  /**
   * region_id values that form the home region for initial placement.
   * `distributeTerritoriesGeographic` matches these against `territory.region_id`
   * only — a territory_id listed here is silently ignored.
   */
  home_region_ids: string[];
  /** Passive combat modifier applied to this faction's attacks (+dice / re-roll). */
  passive_attack_bonus?: number;
  /** Passive combat modifier applied when defending. */
  passive_defense_bonus?: number;
  /** Extra reinforcement units per turn. */
  reinforce_bonus?: number;
  /**
   * Flat tech-point discount on every research (floor: effective cost 1).
   * A deliberately gentle tempo lever: worth ~1 TP per research (~8-10/game),
   * unlike a per-turn income which compounds every turn.
   */
  tech_cost_discount?: number;
  /** ID of a unique ability available once per turn. */
  ability_id?: string;
  /** Human-readable description of the special ability. */
  ability_description?: string;
  /** UI color (CSS hex) — used in lobby display. */
  color: string;
  /** Extra stability recovery per turn for this faction's territories. */
  stability_recovery_bonus?: number;
  /**
   * Flat tech points added to the player's per-turn tech income. Unlike
   * `tech_cost_discount` this compounds every turn, so keep it small — it is the
   * whole identity of a research-first faction (Corporate Enclave), not a perk.
   */
  tech_point_income?: number;
  /**
   * Extra production per owned `tech_gen_*` building each turn, scaled by the
   * same stability/population multipliers as the building's own yield. Rewards
   * a faction for building the research economy it needs for its ability
   * (Sino-Pacific Hegemony's AI Surge) rather than handing it production flat.
   */
  production_per_tech_building?: number;
  /**
   * Multiplier on the per-tick population growth chance (default 1). Population
   * feeds production yield, so this is a slow-burn economic identity that only
   * pays out on territories held stably for many turns (Climate Alliance).
   */
  population_growth_multiplier?: number;
  /**
   * Defense dice added only when the defended territory sits off Earth
   * (`world_id` present and not 'earth'). Deliberately NOT `passive_defense_bonus`:
   * an always-on defensive die makes a faction impregnable from turn one, whereas
   * this only matters once the holder has raced to the Moon (Lunar Pioneers).
   */
  offworld_defense_bonus?: number;
  /**
   * Lineage archetype this faction belongs to. When era advancement + factions
   * are both on, advancing remaps the player to the next era's faction sharing
   * this lineage_id (e.g. imperial: rome → hre → spain → ...). Every classic-spine
   * era defines exactly one faction per lineage. Optional on non-classic eras.
   */
  lineage_id?: string;
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
