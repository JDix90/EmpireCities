/**
 * Types for the generated faction codex data.
 *
 * The VALUES in factionCodex.generated.mjs are generated; this shape is not.
 * It mirrors `CodexFaction` / `CodexEra` in
 * backend/src/game-engine/eras/factionCodex.ts — change one and change both.
 * Every field here is optional exactly where the projection drops undefined.
 */

export interface CodexFaction {
  faction_id: string;
  name: string;
  description: string;
  lore?: string;
  flavor_quote?: string;
  color?: string;
  passive_attack_bonus?: number;
  passive_defense_bonus?: number;
  reinforce_bonus?: number;
  tech_cost_discount?: number;
  stability_recovery_bonus?: number;
  ability_description?: string;
}

export interface CodexEra {
  era_id: string;
  factions: CodexFaction[];
}

export const FACTION_CODEX: CodexEra[];
export const FACTION_COUNT: number;
