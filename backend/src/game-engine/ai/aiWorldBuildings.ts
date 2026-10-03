/**
 * AI parity for the Galactic Age world buildings (state/worldBuildings.ts,
 * docs/GALACTIC_AGE_BUILDINGS.md §7).
 *
 * The bot builds one building a turn and banks more PP than it can spend, so a
 * world building's real price is the build slot, not the PP. Each is offered
 * only where it plainly pays, most urgent first:
 *
 *   Storm Shelter  on a held storm-world tile already at the storm line (a stack
 *                  the weather is about to bleed), biggest stack first;
 *   Vault Conduit  on every Vault tile, while the bot holds the whole Vault;
 *   Toll Beacon    on a held gateway whose lane is already the bot's corridor;
 *   Habitat Dome   on a thin Cradle tile facing a rival, where the muster's
 *                  extra unit is a defender, at most AI_MAX_HABITAT_DOMES.
 *
 * These functions CHOOSE; `validateBuild` re-checks every placement, cost and
 * tech, so nothing here permits anything.
 */

import type { BuildingType, GameMap, GameState } from '../../types';
import { getWorldRules, tileMusterThreshold, vaultStatuses } from '../state/worldRules';
import { laneHasTollBeacon, tollBeaconPays, worldBuildingsEnabled } from '../state/worldBuildings';
import { isFriendlyOwner } from '../state/teams';

/** Domes a bot keeps at most: the muster's extra unit is small, the build slot is not. */
export const AI_MAX_HABITAT_DOMES = 3;

const has = (buildings: readonly string[] | undefined, b: string): boolean => (buildings ?? []).includes(b);

/** Neighbours an attack can come from: every edge but a Jump Gate's or a projected surge. */
function attackNeighbours(map: GameMap): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const c of map.connections ?? []) {
    if (c.source === 'jump_gate' || c.source === 'surge_projector') continue;
    (out.get(c.from) ?? out.set(c.from, []).get(c.from)!).push(c.to);
    (out.get(c.to) ?? out.set(c.to, []).get(c.to)!).push(c.from);
  }
  return out;
}

/**
 * The world buildings worth raising this turn, each with the tiles to try in
 * order. Empty in a game that does not play them.
 */
export function aiWorldBuildingCandidates(
  state: GameState,
  map: GameMap,
  playerId: string,
): Array<{ buildingType: BuildingType; candidates: string[] }> {
  if (!worldBuildingsEnabled(state)) return [];
  const owned = Object.entries(state.territories).filter(([, t]) => t.owner_id === playerId);
  const out: Array<{ buildingType: BuildingType; candidates: string[] }> = [];

  // Storm Shelter: a stack at the storm line loses a unit every round from here.
  const sheltered = owned
    .filter(([, t]) => {
      const storm = getWorldRules(state, t.world_id).storm_threshold;
      return storm != null && !has(t.buildings, 'storm_shelter') && t.unit_count >= storm;
    })
    .sort(([a, ta], [b, tb]) => tb.unit_count - ta.unit_count || a.localeCompare(b))
    .map(([id]) => id);
  if (sheltered.length > 0) out.push({ buildingType: 'storm_shelter', candidates: sheltered });

  // Vault Conduit: only while the bot holds the whole Vault, on every tile of it.
  const conduits: string[] = [];
  for (const v of vaultStatuses(state)) {
    if (v.holder_id !== playerId) continue;
    for (const [id, t] of owned) {
      if (t.world_id === v.world_id && t.region_id === v.region_id && !has(t.buildings, 'vault_conduit')) conduits.push(id);
    }
  }
  if (conduits.length > 0) out.push({ buildingType: 'vault_conduit', candidates: conduits.sort() });

  // Toll Beacon: on a gateway whose lane already pays, best-held first.
  const tolls = owned
    .filter(([, t]) => (t.lane_partners?.length ?? 0) > 0 && !has(t.buildings, 'toll_beacon')
      && tollBeaconPays(state, t) && !laneHasTollBeacon(state, t))
    .sort(([a, ta], [b, tb]) => tb.unit_count - ta.unit_count || a.localeCompare(b))
    .map(([id]) => id);
  if (tolls.length > 0) out.push({ buildingType: 'toll_beacon', candidates: tolls });

  // Habitat Dome: a thin Cradle tile facing a rival, where the muster tops it
  // up and the extra unit is a defender.
  const domes = owned.filter(([, t]) => has(t.buildings, 'habitat_dome')).length;
  if (domes < AI_MAX_HABITAT_DOMES) {
    const neighbours = attackNeighbours(map);
    const thin = owned
      .filter(([id, t]) => {
        const muster = getWorldRules(state, t.world_id).muster_threshold;
        if (muster == null || has(t.buildings, 'habitat_dome')) return false;
        // Below the threshold the Dome would give it, so the muster still reaches it.
        if (t.unit_count >= tileMusterThreshold(state, { buildings: [...(t.buildings ?? []), 'habitat_dome'] }, muster)) {
          return false;
        }
        return (neighbours.get(id) ?? []).some((n) => {
          const owner = state.territories[n]?.owner_id;
          return !!owner && !isFriendlyOwner(state, playerId, owner);
        });
      })
      .sort(([a, ta], [b, tb]) => ta.unit_count - tb.unit_count || a.localeCompare(b))
      .map(([id]) => id);
    if (thin.length > 0) out.push({ buildingType: 'habitat_dome', candidates: thin });
  }

  return out;
}
