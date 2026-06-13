import type { EraId, GameState, PlayerState } from '../../types';
import type { Faction } from './types';
import { getEraFactions, getFactionById } from './index';
import { resolvePlayerEraId } from '../eraAdvancement/constants';

/**
 * Faction resolution that respects era advancement.
 *
 * With era advancement + factions on, a player's `faction_id` is remapped on
 * each advance to the next era's faction sharing their lineage archetype
 * (imperial / expansionist / maritime / mercantile / bastion / insurgent). Every
 * classic-spine era defines exactly one faction per lineage, so the remap always
 * resolves. Because `faction_id` now tracks the player's CURRENT era, every
 * runtime faction lookup must resolve against that era — never the static
 * `state.era` — which is what `getPlayerFaction` does.
 *
 * When era advancement is off, `resolvePlayerEraId` returns `state.era`, so this
 * collapses to the original behaviour.
 */
export function getPlayerFaction(state: GameState, player: PlayerState): Faction | undefined {
  if (!player.faction_id) return undefined;
  return getFactionById(resolvePlayerEraId(state, player), player.faction_id);
}

/** The faction in `eraId` belonging to `lineageId`, if one exists. */
export function findFactionByLineage(eraId: EraId, lineageId: string | undefined): Faction | undefined {
  if (!lineageId) return undefined;
  return getEraFactions(eraId).find((f) => f.lineage_id === lineageId);
}

/**
 * Remap a player's faction along its lineage when advancing from one era to the
 * next. No-op unless factions are enabled and the player has a faction. The
 * lineage is captured from the departing-era faction (falling back to a stored
 * lineage), persisted, and used to pick the arriving era's faction.
 */
export function applyLineageOnAdvance(
  state: GameState,
  player: PlayerState,
  departingEraId: EraId,
  arrivingEraId: EraId,
): void {
  if (!state.settings.factions_enabled || !player.faction_id) return;
  const lineageId = getFactionById(departingEraId, player.faction_id)?.lineage_id ?? player.faction_lineage_id;
  if (!lineageId) return;
  player.faction_lineage_id = lineageId;
  const arriving = findFactionByLineage(arrivingEraId, lineageId);
  if (arriving) player.faction_id = arriving.faction_id;
}

/**
 * Back-compat for in-flight games that advanced before lineages shipped: a
 * player may sit in a later era while still holding a base-era `faction_id`.
 * Migrate such ids forward via their lineage so faction lookups (which now use
 * the current era) keep resolving. Idempotent; safe to run on every load.
 */
export function migrateAdvancedFactions(state: GameState): void {
  if (!state.settings.factions_enabled || !state.settings.era_advancement_enabled) return;
  for (const player of state.players) {
    if (!player.faction_id) continue;
    const currentEraId = resolvePlayerEraId(state, player);
    const current = getFactionById(currentEraId, player.faction_id);
    if (current) {
      // Valid in the current era — just backfill the lineage if missing.
      player.faction_lineage_id = player.faction_lineage_id ?? current.lineage_id;
      continue;
    }
    // Stale base-era id on an advanced player → remap via lineage.
    const lineageId = getFactionById(state.era, player.faction_id)?.lineage_id ?? player.faction_lineage_id;
    const migrated = findFactionByLineage(currentEraId, lineageId);
    if (migrated) {
      player.faction_id = migrated.faction_id;
      player.faction_lineage_id = lineageId;
    }
  }
}
