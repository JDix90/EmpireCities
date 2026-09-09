// ============================================================
// Per-world RULES (galaxy maps) — worlds as characters
// ============================================================
//
// Where `WorldModifiers` change a total (a few decimals of income), a world's
// `rules` change a decision: Sol drafts deeper and breeds faster, Verdan's
// storms punish stacks, Rust is fortified by building, and Nexus carries the
// Vault — a prize region that starts neutral and pays its holder. Authored on
// `map.worlds[].rules`, snapshotted into `settings.world_rules` at init (like
// the modifiers) so the per-turn sites that only have `state` can read them by
// `world_id`, and gated by `settings.world_rules_enabled` (default on; baked at
// create from the `galaxy_world_rules_enabled` flag). Maps without rules — and
// standard maps — are untouched.

import { inferWorldId, type WorldRules } from '@borderfall/shared';
import type { GameMap, GameState } from '../../types';

const EMPTY: WorldRules = {};

interface WorldsLike {
  worlds?: Array<{ world_id: string; rules?: WorldRules }>;
}

/**
 * Build the `world_id -> rules` snapshot from a map's worlds[], or undefined
 * when disabled or no world defines any rule.
 */
export function buildWorldRuleSnapshot(
  map: WorldsLike,
  enabled: boolean,
): Record<string, WorldRules> | undefined {
  if (!enabled || !map.worlds) return undefined;
  const snap: Record<string, WorldRules> = {};
  for (const w of map.worlds) {
    if (w.rules && Object.keys(w.rules).length > 0) snap[w.world_id] = w.rules;
  }
  return Object.keys(snap).length > 0 ? snap : undefined;
}

/** Active rules for a world (empty object when none / feature off). */
export function getWorldRules(state: GameState, worldId: string | undefined | null): WorldRules {
  if (!worldId) return EMPTY;
  return state.settings.world_rules?.[worldId] ?? EMPTY;
}

// ── Sol III · the Cradle ──────────────────────────────────────────────────

/** Extra units the draft may place on one tile here per turn, over the stability cap. */
export function worldDeployCapBonus(state: GameState, worldId: string | undefined | null): number {
  return getWorldRules(state, worldId).deploy_cap_bonus ?? 0;
}

/** Multiplier on the per-tick population growth chance for tiles here (1 = unchanged). */
export function worldPopulationGrowthMult(state: GameState, worldId: string | undefined | null): number {
  const m = getWorldRules(state, worldId).population_growth_mult;
  return m != null && m > 0 ? m : 1;
}

// ── Verdan Reach · the Storms ─────────────────────────────────────────────

export interface StormLoss {
  territory_id: string;
  lost: number;
}

/**
 * Round start: every tile on a storm world holding MORE than the threshold
 * sheds `storm_attrition` units (default 1), never below the threshold. Owned
 * or neutral alike — the weather does not check flags. Returns what was lost
 * so callers can narrate it.
 */
export function applyStormAttrition(state: GameState): StormLoss[] {
  const rules = state.settings.world_rules;
  if (!rules) return [];
  const losses: StormLoss[] = [];
  for (const [tid, t] of Object.entries(state.territories)) {
    const r = t.world_id ? rules[t.world_id] : undefined;
    if (!r || r.storm_threshold == null) continue;
    if (t.unit_count <= r.storm_threshold) continue;
    const lost = Math.min(r.storm_attrition ?? 1, t.unit_count - r.storm_threshold);
    if (lost <= 0) continue;
    t.unit_count -= lost;
    losses.push({ territory_id: tid, lost });
  }
  return losses;
}

// ── Rust Belt · the Forge ─────────────────────────────────────────────────

/** Extra defender dice on a tile here that has at least one defence building. */
export function worldDefenseBuildingBonusDice(state: GameState, worldId: string | undefined | null): number {
  return getWorldRules(state, worldId).defense_building_bonus_dice ?? 0;
}

// ── Nexus Station · the Vault ─────────────────────────────────────────────

/**
 * Every vault tile on the authored map → its neutral starting garrison. Used
 * once, at init, to hold the prize region out of distribution.
 */
export function vaultRegionGarrisons(map: GameMap): Map<string, number> {
  const out = new Map<string, number>();
  for (const w of map.worlds ?? []) {
    const v = w.rules?.vault;
    if (!v) continue;
    for (const t of map.territories) {
      if (t.region_id === v.region_id && inferWorldId(t) === w.world_id) out.set(t.territory_id, v.neutral_garrison);
    }
  }
  return out;
}

export interface VaultStatus {
  world_id: string;
  region_id: string;
  /** Player holding EVERY tile of the region, else null. */
  holder_id: string | null;
  tech_income: number;
  emergency_seal: boolean;
  tiles: number;
}

/** Every vault the game carries and who holds it — from state alone (tiles mirror `region_id`). */
export function vaultStatuses(state: GameState): VaultStatus[] {
  const rules = state.settings.world_rules;
  if (!rules) return [];
  const out: VaultStatus[] = [];
  for (const [worldId, r] of Object.entries(rules)) {
    const v = r.vault;
    if (!v) continue;
    const owners = new Set<string | null>();
    let tiles = 0;
    for (const t of Object.values(state.territories)) {
      if (t.world_id !== worldId || t.region_id !== v.region_id) continue;
      tiles += 1;
      owners.add(t.owner_id ?? null);
    }
    const holder = tiles > 0 && owners.size === 1 ? [...owners][0] ?? null : null;
    out.push({
      world_id: worldId,
      region_id: v.region_id,
      holder_id: holder,
      tech_income: v.tech_income,
      emergency_seal: v.emergency_seal === true,
      tiles,
    });
  }
  return out;
}

/** Tech points per turn the player earns from vaults they hold. */
export function vaultTechIncome(state: GameState, playerId: string): number {
  let sum = 0;
  for (const v of vaultStatuses(state)) if (v.holder_id === playerId) sum += v.tech_income;
  return sum;
}

/** True when the player holds a vault that grants an Emergency Seal on any lane. */
export function playerHoldsVaultSeal(state: GameState, playerId: string): boolean {
  return vaultStatuses(state).some((v) => v.emergency_seal && v.holder_id === playerId);
}

/** Region ids of every vault (for the AI's objective weighting). */
export function vaultRegionIds(state: GameState): Set<string> {
  const out = new Set<string>();
  for (const r of Object.values(state.settings.world_rules ?? {})) if (r.vault) out.add(r.vault.region_id);
  return out;
}
