/**
 * Galactic Age lane powers — docs/GALACTIC_AGE_BUILDINGS.md §6 (Phase 4).
 *
 * The galaxy's tree was the only tree with no `unlocks_ability`, and the Moon
 * package measured what works and what does not: tech points injected as a
 * reward moved nothing, while position-gated, fuel-priced powers did. So these
 * are powers, priced in the fuel the galaxy already banks — production points —
 * and each is fired FROM a tile carrying the building it needs, checked at the
 * moment of use. A captured source takes the power with it (Phase 2 keeps a
 * gateway's buildings standing for the captor), which is what makes a power a
 * position rather than a credential.
 *
 *   Lance Battery   (Disruption Net)          a defence building on a gateway;
 *                    removes 2 units from the enemy gateway across that lane,
 *                    to a floor of 1, before you cross.            5 PP
 *   Orbital Muster  (Battle Fabricators)      an industry building on a gateway;
 *                    places 3 units there. The one place PP becomes units, gated
 *                    by a building on a lane so it is a position: fired from
 *                    any industry tile it was three free defenders a turn, and
 *                    four-seat decisiveness fell a point (doc §6). 6 PP
 *   Seal Breaker    (Gravity Brake Doctrine)  a defence building on a gateway;
 *                    your next crossing from it ignores a Nebula Closure or an
 *                    Emergency Seal — the Stellar Mandate's kit, at a price. 4 PP
 *
 * All are once per turn (`scope: 'turn'`). Each is a `TERRITORY_ABILITY_DEFS`
 * entry using two descriptor fields, `productionCost` and `requiresBuilding`,
 * validated here beside the Moon's gate in `executeTechAbility`: the
 * requirement before anything mutates, the PP only once the effect succeeds.
 * Lane Sovereignty, the Vault and lane weather are untouched by all of them.
 *
 * Gated by `settings.galaxy_powers`, baked at create from the
 * `galaxy_powers_enabled` flag. Off, no node unlocks them and this gate refuses
 * them on every path, so a game without the setting is today's game exactly.
 */

import type { GameMap, GameState, MapConnection, PlayerState, TerritoryState } from '../../types';
import { isLaneSealedForPlayer } from '../state/moonAccess';
import { areAllies } from '../state/teams';
import { TERRITORY_ABILITY_DEFS, type TerritoryAbilityDef } from './techAbilities';

/** Every lane power, in the order the panels list them. */
export const LANE_POWER_IDS = ['lance_battery', 'orbital_muster', 'seal_breaker'] as const;
export type LanePowerId = (typeof LANE_POWER_IDS)[number];

/**
 * Prices in PP. Mutable so the balance sim can measure a candidate
 * (`SIM_POWER_COSTS`) without editing the defs, as SCHISM_TUNING is.
 */
export const LANE_POWER_TUNING: Record<LanePowerId, number> = {
  lance_battery: TERRITORY_ABILITY_DEFS.lance_battery.productionCost ?? 0,
  orbital_muster: TERRITORY_ABILITY_DEFS.orbital_muster.productionCost ?? 0,
  seal_breaker: TERRITORY_ABILITY_DEFS.seal_breaker.productionCost ?? 0,
};

export function lanePowersEnabled(state: Pick<GameState, 'settings'>): boolean {
  return state.settings?.galaxy_powers === true;
}

export function isLanePower(abilityId: string): abilityId is LanePowerId {
  return (LANE_POWER_IDS as readonly string[]).includes(abilityId);
}

/** The PP a lane power costs right now (the tuning knob). */
export function lanePowerCost(abilityId: string): number {
  return isLanePower(abilityId) ? LANE_POWER_TUNING[abilityId] : 0;
}

/**
 * Lanes a power can reach across: every orbit edge except a Jump Gate's, which
 * carries no attack (state/jumpGates.ts).
 */
export function crossableLanes(map: GameMap): MapConnection[] {
  return (map.connections ?? []).filter((c) => c.type === 'orbit' && c.source !== 'jump_gate');
}

export function hasRequiredBuilding(
  territory: Pick<TerritoryState, 'buildings'> | undefined,
  requirement: TerritoryAbilityDef['requiresBuilding'],
): boolean {
  if (!requirement) return true;
  const buildings = territory?.buildings ?? [];
  if (requirement === 'defense') return buildings.some((b) => b.startsWith('defense_'));
  if (requirement === 'production') return buildings.some((b) => b.startsWith('production_'));
  return buildings.length > 0;
}

const BUILDING_WORDS: Record<NonNullable<TerritoryAbilityDef['requiresBuilding']>, string> = {
  defense: 'a defence building',
  production: 'an industry building',
  any: 'a building',
};

/** Does `territoryId` anchor a crossable lane? */
export function isLaneGateway(map: GameMap, territoryId: string): boolean {
  return crossableLanes(map).some((c) => c.from === territoryId || c.to === territoryId);
}

/**
 * Tiles `playerId` could fire `abilityId` from at `territoryId`, given the
 * board right now. `self`: the tile itself, if it qualifies. `across_lane`: the
 * player's gateways at the other end of an open lane from the target.
 */
export function lanePowerSources(
  state: GameState,
  map: GameMap,
  playerId: string,
  abilityId: string,
  territoryId: string,
): string[] {
  const def = TERRITORY_ABILITY_DEFS[abilityId];
  if (!def || !isLanePower(abilityId)) return [];
  const qualifies = (tid: string): boolean => {
    const t = state.territories[tid];
    if (!t || t.owner_id !== playerId) return false;
    if (!hasRequiredBuilding(t, def.requiresBuilding)) return false;
    return !def.requiresGateway || isLaneGateway(map, tid);
  };
  if (def.laneSource === 'across_lane') {
    const out: string[] = [];
    for (const c of crossableLanes(map)) {
      const near = c.from === territoryId ? c.to : c.to === territoryId ? c.from : null;
      if (!near || !qualifies(near)) continue;
      // The battery fires across the lane, so the lane must be open to it.
      if (isLaneSealedForPlayer(state, near, territoryId, playerId)) continue;
      out.push(near);
    }
    return out;
  }
  return qualifies(territoryId) ? [territoryId] : [];
}

/**
 * Validate a lane-power use. Returns an error, or null when the use may proceed
 * — and null for every ability that is not a lane power. Charges nothing.
 */
export function checkLanePowerRequirement(
  state: GameState,
  map: GameMap,
  playerId: string,
  abilityId: string,
  territoryId: string | undefined,
): string | null {
  if (!isLanePower(abilityId)) return null;
  const def = TERRITORY_ABILITY_DEFS[abilityId];
  // A power that exists only under the setting must not resolve without it, on
  // any path — the unlock table already withholds it, this is the engine's guard.
  if (!lanePowersEnabled(state)) return `${def.label} is not enabled in this game`;
  if (!territoryId || !state.territories[territoryId]) return 'Provide territoryId';
  const target = state.territories[territoryId];
  const what = BUILDING_WORDS[def.requiresBuilding ?? 'any'];

  if (def.laneSource === 'across_lane') {
    if (!target.owner_id || target.owner_id === playerId) {
      return `${def.label} fires on a rival's gateway`;
    }
    if (areAllies(state, playerId, target.owner_id)) return `${def.label} cannot fire on an ally`;
    if (lanePowerSources(state, map, playerId, abilityId, territoryId).length === 0) {
      return `${def.label} needs ${what} on your gateway at the other end of an open lane`;
    }
  } else {
    if (target.owner_id !== playerId) return `${def.label} fires from a system you hold`;
    if (def.requiresGateway && !isLaneGateway(map, territoryId)) {
      return `${def.label} fires from a gateway`;
    }
    if (!hasRequiredBuilding(target, def.requiresBuilding)) return `${def.label} needs ${what} on this system`;
  }

  const cost = lanePowerCost(abilityId);
  const purse = state.players.find((p) => p.player_id === playerId)?.special_resource ?? 0;
  if (purse < cost) return `${def.label} costs ${cost} PP (you have ${purse})`;
  return null;
}

/** Charge a lane power's PP after its effect succeeded. Returns the PP spent. */
export function spendLanePowerCost(state: GameState, playerId: string, abilityId: string): number {
  if (!isLanePower(abilityId) || !lanePowersEnabled(state)) return 0;
  const player = state.players.find((p) => p.player_id === playerId);
  const cost = lanePowerCost(abilityId);
  if (!player || cost <= 0) return 0;
  player.special_resource = (player.special_resource ?? 0) - cost;
  return cost;
}

/**
 * Seal Breaker: spend the charge if this crossing leaves the tile it was fired
 * from. Returns true when the crossing may proceed despite a closure or seal.
 */
export function consumeSealBreaker(player: PlayerState, fromId: string): boolean {
  if (player.pending_seal_breaker_from !== fromId) return false;
  player.pending_seal_breaker_from = undefined;
  return true;
}
