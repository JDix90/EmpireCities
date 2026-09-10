/**
 * AI parity for the Moon-gated tier (Space Age Moon Race, Phase 2a).
 *
 * A power a bot never fires is a power three quarters of the table never sees,
 * and the phase gate in §4.5 is measured in *usage*. So the bot has to plan
 * around He-3 the way a player would: keep enough back to fire what it can
 * fire, and export only the surplus.
 *
 * This lives outside gameSocket so the target choices are testable without a
 * socket, a room, or Redis. The socket calls these and passes the answer
 * straight to `executeTechAbility`, which re-validates everything — these
 * functions choose, they never permit.
 *
 * Phase 1's finding is why the choices here are narrow. Scoring lunar yield
 * inside the AI's *attack* valuation was measured and rejected: it halved
 * decisive endings, because bots spent their turns on a sideshow instead of the
 * Earth conquest that ends games (see docs/space-age-moon/README.md §3.6). The
 * rules below spend He-3 on the Earth war rather than steering the bot toward
 * the Moon for its own sake.
 */

import type { GameMap, GameState } from '../../types';
import { countLunarTerritories, isHelium3Enabled, LUNAR_EXPORT_MAX } from '../state/helium3';
import { TERRITORY_ABILITY_DEFS, playerHasUnlockedAbility } from '../abilities/techAbilities';
import { areMoonPowersEnabled } from '../abilities/moonPowers';
import { SPACE_AGE_LANE_SEAL_HELIUM3_COST, canSealLane } from '../state/moonAccess';
import {
  DROP_ASSAULT_HELIUM3_COST,
  dropAssaultBlockReason,
  isDropAssaultTarget,
} from '../abilities/dropAssault';

/**
 * Enemy stack that makes the beam worth firing. Below this the bot is better
 * off banking: `dyson_beam` removes 4 units for 6 He-3, which is most of a
 * turn's lunar income for a three-tile holder.
 */
export const AI_DYSON_BEAM_THREAT_UNITS = 6;

function buildAdjacency(map: GameMap): Map<string, string[]> {
  const adjacency = new Map<string, string[]>();
  for (const conn of map.connections ?? []) {
    if (!adjacency.has(conn.from)) adjacency.set(conn.from, []);
    if (!adjacency.has(conn.to)) adjacency.set(conn.to, []);
    adjacency.get(conn.from)!.push(conn.to);
    adjacency.get(conn.to)!.push(conn.from);
  }
  return adjacency;
}

const abilityUsedThisTurn = (state: GameState, playerId: string, abilityId: string): boolean =>
  !!(state.players.find((p) => p.player_id === playerId)?.ability_uses ?? {})[abilityId];

const helium3Of = (state: GameState, playerId: string): number =>
  state.players.find((p) => p.player_id === playerId)?.helium3 ?? 0;

const gateCost = (abilityId: string): number =>
  TERRITORY_ABILITY_DEFS[abilityId]?.helium3Cost ?? 0;

const gateTiles = (abilityId: string): number =>
  TERRITORY_ABILITY_DEFS[abilityId]?.requiresMoonTiles ?? 0;

/**
 * The largest enemy stack of at least `AI_DYSON_BEAM_THREAT_UNITS` that borders
 * one of this player's territories, or null when nothing qualifies.
 *
 * `dyson_beam` itself has no adjacency requirement — it is a global strike —
 * but a bordering stack is the one the bot is about to have to fight, and
 * spending the fuel on a distant stack it will never reach is how a global
 * ability becomes a wasted one.
 */
export function selectAiDysonBeamTarget(
  state: GameState,
  map: GameMap,
  playerId: string,
): string | null {
  const adjacency = buildAdjacency(map);
  let best: { id: string; units: number } | null = null;
  for (const [tid, territory] of Object.entries(state.territories)) {
    if (territory.owner_id !== playerId) continue;
    for (const neighbourId of adjacency.get(tid) ?? []) {
      const neighbour = state.territories[neighbourId];
      if (!neighbour || neighbour.owner_id == null || neighbour.owner_id === playerId) continue;
      if (neighbour.unit_count < AI_DYSON_BEAM_THREAT_UNITS) continue;
      // Ties break on id so a replayed seed makes the same choice.
      if (!best || neighbour.unit_count > best.units
        || (neighbour.unit_count === best.units && neighbourId < best.id)) {
        best = { id: neighbourId, units: neighbour.unit_count };
      }
    }
  }
  return best?.id ?? null;
}

/**
 * The owned territory most in need of the drop: the one whose strongest enemy
 * neighbour most outnumbers it. Null when nothing the player owns is
 * outnumbered — three units placed behind the lines are three units that will
 * not be in the fight, and the He-3 is better exported.
 */
export function selectAiOrbitalDropTarget(
  state: GameState,
  map: GameMap,
  playerId: string,
): string | null {
  const adjacency = buildAdjacency(map);
  let best: { id: string; deficit: number; units: number } | null = null;
  for (const [tid, territory] of Object.entries(state.territories)) {
    if (territory.owner_id !== playerId) continue;
    let strongestEnemy = 0;
    for (const neighbourId of adjacency.get(tid) ?? []) {
      const neighbour = state.territories[neighbourId];
      if (!neighbour || neighbour.owner_id == null || neighbour.owner_id === playerId) continue;
      strongestEnemy = Math.max(strongestEnemy, neighbour.unit_count);
    }
    const deficit = strongestEnemy - territory.unit_count;
    if (deficit <= 0) continue;
    if (!best || deficit > best.deficit
      || (deficit === best.deficit && territory.unit_count < best.units)
      || (deficit === best.deficit && territory.unit_count === best.units && tid < best.id)) {
      best = { id: tid, deficit, units: territory.unit_count };
    }
  }
  return best?.id ?? null;
}

/**
 * Lunar holding a bot wants before it commits to a Drop Assault.
 *
 * Higher than the rule's own threshold of three on purpose. The drop costs 10
 * He-3 and a three-turn reload, and it is cancelled outright if the foothold is
 * gone when it lands — so a bot clinging to exactly three tiles is the one most
 * likely to pay for a drop that never arrives. Five means it can lose two and
 * still land.
 */
export const AI_DROP_ASSAULT_MOON_TILES = 5;

/**
 * The enemy or neutral Earth tile that would COMPLETE a region for this bot —
 * the one target worth the fuel, since a region bonus pays every turn after.
 *
 * Ties break on the smaller garrison: three units fight a normal battle, so the
 * odds matter more than which region it is.
 */
export function selectAiDropAssaultTarget(
  state: GameState,
  playerId: string,
): string | null {
  const tally = new Map<string, { owned: number; total: number }>();
  for (const t of Object.values(state.territories)) {
    if (!t.region_id) continue;
    const entry = tally.get(t.region_id) ?? { owned: 0, total: 0 };
    entry.total += 1;
    if (t.owner_id === playerId) entry.owned += 1;
    tally.set(t.region_id, entry);
  }

  let best: { id: string; units: number } | null = null;
  for (const t of Object.values(state.territories)) {
    if (!t.region_id) continue;
    const entry = tally.get(t.region_id)!;
    // One tile short of the whole region, and this is that tile.
    if (entry.total - entry.owned !== 1 || t.owner_id === playerId) continue;
    if (!isDropAssaultTarget(state, playerId, t.territory_id)) continue;
    if (!best || t.unit_count < best.units
      || (t.unit_count === best.units && t.territory_id < best.id)) {
      best = { id: t.territory_id, units: t.unit_count };
    }
  }
  return best?.id ?? null;
}

/** Whether the bot could declare a drop this turn, target aside. */
export function canAiPlanDropAssault(state: GameState, playerId: string): boolean {
  return areMoonPowersEnabled(state)
    && countLunarTerritories(state, playerId) >= AI_DROP_ASSAULT_MOON_TILES;
}

/** Whether the bot can declare one right now — fuel, reload and all. */
export function canAiUseDropAssault(state: GameState, playerId: string): boolean {
  return canAiPlanDropAssault(state, playerId)
    && dropAssaultBlockReason(state, playerId) === null;
}

/**
 * Whether the bot holds the standing credentials for a power — everything
 * except the fuel.
 *
 * Affordability is deliberately NOT part of this. The reserve below is built on
 * these, and a reserve that required the bot to already afford the power could
 * never accumulate toward it: at 5 He-3 nothing is affordable, so nothing is
 * reserved, so the export converts the 5 and the stockpile never reaches 6.
 * Saving up is the whole behaviour the design asks for.
 */
export function canAiPlanOrbitalDrop(state: GameState, playerId: string): boolean {
  return areMoonPowersEnabled(state)
    && !abilityUsedThisTurn(state, playerId, 'orbital_drop')
    && countLunarTerritories(state, playerId) >= gateTiles('orbital_drop');
}

export function canAiPlanDysonBeam(state: GameState, playerId: string): boolean {
  return areMoonPowersEnabled(state)
    && !abilityUsedThisTurn(state, playerId, 'dyson_beam')
    && playerHasUnlockedAbility(state, playerId, 'dyson_beam')
    && countLunarTerritories(state, playerId) >= gateTiles('dyson_beam');
}

/** Whether the bot can fire Orbital Drop right now, target aside. */
export function canAiUseOrbitalDrop(state: GameState, playerId: string): boolean {
  return canAiPlanOrbitalDrop(state, playerId)
    && helium3Of(state, playerId) >= gateCost('orbital_drop');
}

/** Whether the bot can fire the beam this turn, target aside. */
export function canAiUseDysonBeam(state: GameState, playerId: string): boolean {
  return canAiPlanDysonBeam(state, playerId)
    && helium3Of(state, playerId) >= gateCost('dyson_beam');
}

/**
 * He-3 the bot should keep back rather than export, because it has a power it
 * can actually fire this turn and a target worth firing it at.
 *
 * Requiring a target is what keeps the reserve from starving the export: a bot
 * with the beam tech and no bordering stack banks nothing and exports as it did
 * in Phase 1. Additive, because both powers can fire in the same turn — the
 * drop in draft, the beam in the attack phase that follows.
 */
export function aiHelium3Reserve(state: GameState, map: GameMap, playerId: string): number {
  if (!areMoonPowersEnabled(state)) return 0;
  let reserve = 0;
  if (canAiPlanOrbitalDrop(state, playerId) && selectAiOrbitalDropTarget(state, map, playerId)) {
    reserve += gateCost('orbital_drop');
  }
  if (canAiPlanDysonBeam(state, playerId) && selectAiDysonBeamTarget(state, map, playerId)) {
    reserve += gateCost('dyson_beam');
  }
  if (canAiPlanDropAssault(state, playerId) && selectAiDropAssaultTarget(state, playerId)) {
    reserve += DROP_ASSAULT_HELIUM3_COST;
  }
  return reserve;
}

/**
 * The authored anchor lane this bot should blockade, as an [earth, moon] pair,
 * or null when there is nothing worth sealing (Moon Race, Phase 4).
 *
 * Only a player with something to defend seals: the bot must hold lunar ground
 * AND a rival must be able to reach it, which is exactly when a lane is worth
 * denying. Launch Pad lanes are excluded by `canSealLane` itself — the anchors
 * are the convenient route and may be denied, the pad is the contest route and
 * stays open.
 */
export function selectAiLaneSeal(
  state: GameState,
  map: GameMap,
  playerId: string,
): [string, string] | null {
  if (!state.settings.space_age_moon_blockade_enabled) return null;
  if (countLunarTerritories(state, playerId) === 0) return null;
  // Seal from surplus only. A seal that costs the bot its beam is a bad trade:
  // the beam answers the army coming for the Moon, the seal only delays it.
  const surplus = helium3Of(state, playerId) - aiHelium3Reserve(state, map, playerId);
  if (surplus < SPACE_AGE_LANE_SEAL_HELIUM3_COST) return null;

  for (const conn of map.connections ?? []) {
    if (conn.type !== 'orbit') continue;
    const check = canSealLane(state, map, conn.from, conn.to, playerId);
    if (check.ok) return [conn.from, conn.to];
  }
  return null;
}

/**
 * Whether the bot should convert He-3 to tech points this turn.
 *
 * Phase 1 exported on any full `LUNAR_EXPORT_MAX`; Phase 2 exports only the
 * surplus over what its powers need. Without this the export drains the
 * stockpile below 6 every turn and neither power ever fires — the sink that was
 * measured as neutral would quietly eat the tier that is supposed to matter.
 */
export function shouldAiExportHelium3(state: GameState, map: GameMap, playerId: string): boolean {
  if (!isHelium3Enabled(state)) return false;
  if (countLunarTerritories(state, playerId) === 0) return false;
  const surplus = helium3Of(state, playerId) - aiHelium3Reserve(state, map, playerId);
  return surplus >= LUNAR_EXPORT_MAX;
}
