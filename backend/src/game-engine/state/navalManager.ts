// ============================================================
// Naval Manager — fleets, ports, sea-lane combat
// ============================================================

import { randomInt } from 'crypto';
import type { GameState, GameMap, TerritoryState } from '../../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Return the set of territory IDs that participate in at least one sea connection.
 */
export function getCoastalTerritoryIds(map: GameMap): Set<string> {
  const ids = new Set<string>();
  for (const c of map.connections) {
    if (c.type === 'sea') {
      ids.add(c.from);
      ids.add(c.to);
    }
  }
  return ids;
}

// ── Initialization ────────────────────────────────────────────────────────────

/**
 * Set `naval_units: 0` on every coastal territory so the field is present.
 */
export function initializeNavalUnits(state: GameState, map: GameMap): void {
  const coastal = getCoastalTerritoryIds(map);
  for (const tid of coastal) {
    const t = state.territories[tid];
    if (t) t.naval_units = 0;
  }
}

// ── Fleet income ──────────────────────────────────────────────────────────────

/** Fleet income per building type (only port / naval_base generate fleets). */
const FLEET_INCOME: Record<string, number> = {
  port: 1,
  naval_base: 2,
};

/**
 * Add fleet income for the given player based on their port / naval_base buildings.
 * Called once per turn in advanceToNextPlayer.
 */
export function collectFleetIncome(state: GameState, playerId: string): void {
  for (const t of Object.values(state.territories)) {
    if (t.owner_id !== playerId || t.naval_units == null) continue;
    const buildings = t.buildings ?? [];
    for (const b of buildings) {
      const income = FLEET_INCOME[b];
      if (income) t.naval_units += income;
    }
  }
}

// ── Fleet movement ────────────────────────────────────────────────────────────

export interface FleetMoveResult {
  success: boolean;
  error?: string;
}

/**
 * Move `count` fleets from one territory to another along a sea connection.
 */
export function moveFleets(
  state: GameState,
  fromId: string,
  toId: string,
  count: number,
  map: GameMap,
  playerId: string,
): FleetMoveResult {
  const from = state.territories[fromId];
  const to = state.territories[toId];

  if (!from || from.owner_id !== playerId) return { success: false, error: 'Not your territory' };
  if (!to || to.owner_id !== playerId) return { success: false, error: 'Destination not owned' };
  if (from.naval_units == null || from.naval_units < count) {
    return { success: false, error: 'Not enough fleets' };
  }
  if (count <= 0) return { success: false, error: 'Invalid fleet count' };
  if (to.naval_units == null) return { success: false, error: 'Destination is not coastal' };

  // Validate sea connection between from and to
  const seaConnected = map.connections.some(
    (c) => c.type === 'sea' && ((c.from === fromId && c.to === toId) || (c.from === toId && c.to === fromId)),
  );
  if (!seaConnected) return { success: false, error: 'No sea connection' };

  from.naval_units -= count;
  to.naval_units += count;
  return { success: true };
}

// ── Naval combat ──────────────────────────────────────────────────────────────

export interface NavalCombatResult {
  attacker_rolls: number[];
  defender_rolls: number[];
  attacker_losses: number;
  defender_losses: number;
  attacker_won: boolean;
}

function rollDice(count: number): number[] {
  // Server-authoritative combat dice MUST come from a CSPRNG. Math.random
  // is seeded from V8's xorshift state, which is not cryptographic and is
  // potentially predictable across calls — unacceptable for game outcomes.
  return Array.from({ length: Math.max(1, count) }, () => randomInt(1, 7));
}

/**
 * Resolve fleet-vs-fleet combat.
 * Mirror of land combat: compare sorted dice, attacker wins ties only on strict >.
 */
export function resolveNavalCombat(attackerFleets: number, defenderFleets: number): NavalCombatResult {
  const aDice = Math.min(attackerFleets, 3);
  const dDice = Math.min(defenderFleets, 2);

  const aRolls = rollDice(aDice).sort((a, b) => b - a);
  const dRolls = rollDice(dDice).sort((a, b) => b - a);

  let aLosses = 0;
  let dLosses = 0;
  const comparisons = Math.min(aRolls.length, dRolls.length);
  for (let i = 0; i < comparisons; i++) {
    if (aRolls[i] > dRolls[i]) {
      dLosses++;
    } else {
      aLosses++;
    }
  }

  return {
    attacker_rolls: aRolls,
    defender_rolls: dRolls,
    attacker_losses: aLosses,
    defender_losses: dLosses,
    attacker_won: defenderFleets - dLosses <= 0,
  };
}

// ── Amphibious assault (sea-lane crossing) ────────────────────────────────────

/** Max bonus defense dice a surviving enemy fleet can add to a contested landing. */
export const NAVAL_BOMBARDMENT_DEFENSE_CAP = 3;

/**
 * Bonus defense dice the defender's *surviving* fleet contributes to a contested
 * amphibious landing: +1 per two fleets, rounded up, capped. Any standing fleet
 * bombards the beachhead at least a little; a large fleet caps the penalty so a
 * sufficiently strong land force can still take the beach.
 */
export function navalBombardmentDefenseDice(survivingDefenderFleets: number): number {
  if (survivingDefenderFleets <= 0) return 0;
  return Math.min(NAVAL_BOMBARDMENT_DEFENSE_CAP, Math.ceil(survivingDefenderFleets / 2));
}

export interface SeaCrossingResult {
  /** The fleet exchange that occurred; undefined when the target had no fleets. */
  navalResult?: NavalCombatResult;
  /** True if the attacker kept a ship afloat to ferry the troops, so the land assault proceeds. */
  canLand: boolean;
  /** Bonus defense dice from surviving enemy fleets bombarding the landing (0 when uncontested). */
  bombardmentDefenseBonus: number;
  /** True when the attacker's fleet was wiped out in the crossing (canLand is then false). */
  fleetSunk: boolean;
}

/**
 * Resolve an amphibious sea-lane crossing, mutating fleet counts on both
 * territories. Unlike a pure naval battle, the land assault is **not** gated on
 * annihilating the enemy fleet: as long as the attacker keeps one ship afloat to
 * ferry the troops, the landing proceeds — any surviving enemy fleet merely
 * bombards it, granting the defender bonus defense dice.
 *
 * This removes the "island + naval base = unconquerable" attrition spiral (where
 * a 3+ fleet garrison could never be zeroed in a single exchange, so every
 * landing aborted while the garrison regenerated) while keeping naval superiority
 * valuable: uncontested landings are clean, contested ones are bloody, and a
 * fleet sunk mid-crossing still fails — but bringing more ships always works.
 *
 * Caller must have already verified the attacker has ≥1 fleet and a sea
 * connection exists.
 */
export function resolveSeaCrossing(
  attackerTerritory: TerritoryState,
  defenderTerritory: TerritoryState,
): SeaCrossingResult {
  const attackerFleets = attackerTerritory.naval_units ?? 0;
  const defenderFleets = defenderTerritory.naval_units ?? 0;

  // Uncontested landing — consume one ferry fleet, no bombardment.
  if (defenderFleets <= 0) {
    attackerTerritory.naval_units = Math.max(0, attackerFleets - 1);
    return { canLand: true, bombardmentDefenseBonus: 0, fleetSunk: false };
  }

  const navalResult = resolveNavalCombat(attackerFleets, defenderFleets);
  attackerTerritory.naval_units = Math.max(0, attackerFleets - navalResult.attacker_losses);
  defenderTerritory.naval_units = Math.max(0, defenderFleets - navalResult.defender_losses);

  // No ship left to ferry the landing — the assault fails, but the territory is
  // not a permanent wall: a larger fleet next time will get troops ashore.
  if ((attackerTerritory.naval_units ?? 0) <= 0) {
    return { navalResult, canLand: false, bombardmentDefenseBonus: 0, fleetSunk: true };
  }

  const bombardmentDefenseBonus = navalBombardmentDefenseDice(defenderTerritory.naval_units ?? 0);
  // Consume one ferry fleet for the crossing.
  attackerTerritory.naval_units = Math.max(0, (attackerTerritory.naval_units ?? 0) - 1);

  return { navalResult, canLand: true, bombardmentDefenseBonus, fleetSunk: false };
}
