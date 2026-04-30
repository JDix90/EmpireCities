import { RTS_MVP_DOMINATION_TERRITORIES } from './constants.js';
import type { RtsGameState, RtsMapTerrain, RtsTerritory } from './types.js';

/**
 * Add gold for each completed income interval. Advances lastIncomeAccrualTimeMs in
 * full-interval steps; leaves remainder so intermediate times are not lost.
 *
 * Anti-flicker rule: a unit only earns income for an interval boundary `t`
 * if it was assigned at least one full interval before `t`. This prevents
 * the "assign just before tick, unassign just after, repeat" exploit that
 * could double-dip income across multiple markets.
 */
export function accrueMarketIncome(state: RtsGameState, newGameTimeMs: number, terrain: RtsMapTerrain): RtsGameState {
  if (state.phase !== 'playing') {
    return { ...state, gameTimeMs: newGameTimeMs };
  }
  const { marketIncomeIntervalMs: interval } = state.tuning;
  if (interval <= 0) return { ...state, gameTimeMs: newGameTimeMs };

  const players = state.players.map((p) => ({ ...p, gold: p.gold }));
  let t = state.lastIncomeAccrualTimeMs;
  const end = newGameTimeMs;
  const territoryIds = Object.keys(terrain.territories);
  // Walk interval boundaries
  while (t + interval <= end) {
    t += interval;
    for (const terrId of territoryIds) {
      if (!state.territories[terrId]?.hasMarket) continue;
      const workers = countWorkingUnits(state, terrId, t, interval);
      if (workers === 0) continue;
      const o = state.territories[terrId]!.ownerPlayerIndex;
      if (o == null) continue;
      if (o >= 0 && o < players.length) {
        players[o]!.gold += workers;
      }
    }
  }
  return { ...state, gameTimeMs: newGameTimeMs, lastIncomeAccrualTimeMs: t, players };
}

function countWorkingUnits(
  state: RtsGameState,
  marketTerrId: string,
  tickTimeMs: number,
  interval: number,
): number {
  let n = 0;
  for (const u of state.units) {
    if (
      u.territoryId === marketTerrId &&
      u.work?.kind === 'market' &&
      u.work.territoryId === marketTerrId &&
      // Must have been assigned for at least one full interval as of this
      // boundary. Older saves predate `assignedAtMs`; treat them as
      // grandfathered (always earn).
      (u.work.assignedAtMs == null || u.work.assignedAtMs + interval <= tickTimeMs)
    ) {
      n++;
    }
  }
  return n;
}

/** Count how many owned territories; instant win in MVP. */
export function getOwnedTerritoryCount(territories: Record<string, RtsTerritory>, playerIndex: number): number {
  let c = 0;
  for (const t of Object.values(territories)) {
    if (t.ownerPlayerIndex === playerIndex) c++;
  }
  return c;
}

/** Call from server when advancing the game clock (e.g. every 1s tick). */
export function tickRtsState(state: RtsGameState, newGameTimeMs: number, terrain: RtsMapTerrain): RtsGameState {
  if (state.phase !== 'playing') {
    return { ...state, gameTimeMs: newGameTimeMs };
  }
  return accrueMarketIncome(state, newGameTimeMs, terrain);
}

export function checkDominationWin(
  state: RtsGameState,
  territories: Record<string, RtsTerritory>,
): { winnerPlayerIndex: number } | null {
  for (let p = 0; p < state.players.length; p++) {
    if (getOwnedTerritoryCount(territories, p) >= RTS_MVP_DOMINATION_TERRITORIES) {
      return { winnerPlayerIndex: p };
    }
  }
  return null;
}
