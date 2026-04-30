// ============================================================
// Naval Manager — fleets, ports, sea-lane combat
// ============================================================

import { randomInt } from 'crypto';
import type { GameState, GameMap } from '../../types';

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
