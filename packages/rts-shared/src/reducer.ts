import {
  RTS_MARKET_COST_GOLD,
  RTS_SCHEMA_VERSION,
  RTS_STARTING_GOLD,
  RTS_STARTING_UNITS,
  RTS_UNIT_COST_GOLD,
} from './constants.js';
import { isNeighbor } from './graph.js';
import { checkDominationWin } from './income.js';
import type { RtsGameState, RtsMapTerrain, RtsUnit } from './types.js';

export type RtsCommand =
  | { type: 'startPicking' }
  | { type: 'pickStart'; territoryId: string }
  | { type: 'moveUnit'; unitId: string; toTerritoryId: string; toNodeId: string }
  | { type: 'resolveClaim'; claim: boolean }
  | { type: 'buyUnit' }
  | { type: 'buildMarket'; territoryId: string }
  | { type: 'assignWork'; unitId: string; marketTerritoryId: string }
  | { type: 'unassignWork'; unitId: string };

function copyTerritories(s: RtsGameState['territories']): RtsGameState['territories'] {
  return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { ...v }]));
}

function copyUnits(u: RtsUnit[]): RtsUnit[] {
  return u.map((x) => ({ ...x, work: x.work ? { ...x.work } : null }));
}

export function recomputePendingClaim(
  state: RtsGameState,
  units: RtsUnit[],
  territories: RtsGameState['territories'],
): RtsGameState['pendingClaim'] {
  for (const tid of state.territoryOrder) {
    if (territories[tid]!.ownerPlayerIndex != null) continue;
    for (let p = 0; p < state.players.length; p++) {
      const c = units.filter((u) => u.territoryId === tid && u.playerIndex === p).length;
      if (c >= 2) return { playerIndex: p, territoryId: tid };
    }
  }
  return null;
}

/**
 * Garrison resolution. The previous implementation reverted ownership and
 * razed buildings on **any** owned territory whose garrison count fell to
 * zero — including the moment a player moved their last unit out of their
 * own town hall to attack. That handed the territory back as neutral and
 * an opponent could re-claim it with a 2-unit walk-in. Classic-Risk-style
 * behavior: an unoccupied territory you own remains yours until an enemy
 * physically takes it.
 *
 * New rules:
 *   1. If the owner still has at least one unit there → no change.
 *   2. If the territory is empty AND no enemy units are present → keep
 *      ownership and buildings. Workers tied to a market remain assigned
 *      so they will resume earning when the owner returns.
 *   3. If the territory is empty AND enemy units are present → ownership
 *      transfers to the enemy and buildings are razed (classic mode:
 *      capture razes Town Hall and Market). Any worker assignments that
 *      reference the razed market are cleared.
 *
 * Note: in the current ruleset, `applyRtsCommand.moveUnit` rejects moves
 * into a territory owned by another player (line ~187) so case (3) is only
 * reachable when ownership flows through `null`. This still matters once
 * combat is added, and the rules above make the state machine predictable.
 */
export function runGarrison(
  state: RtsGameState,
  units: RtsUnit[],
  territories: RtsGameState['territories'],
): { territories: RtsGameState['territories']; units: RtsUnit[] } {
  const terrs = copyTerritories(territories);
  let uu = copyUnits(units);
  for (const id of state.territoryOrder) {
    const t = { ...terrs[id]! };
    if (t.ownerPlayerIndex == null) continue;
    const owner = t.ownerPlayerIndex;
    const ownerCount = uu.filter((u) => u.territoryId === id && u.playerIndex === owner).length;
    if (ownerCount > 0) {
      terrs[id] = t;
      continue;
    }

    const enemies = uu.filter((u) => u.territoryId === id && u.playerIndex !== owner);
    if (enemies.length === 0) {
      // Owner has temporarily vacated the territory but no rival is here to
      // contest it. Keep ownership and buildings intact — a return visit
      // re-garrisons without losing anything.
      terrs[id] = t;
      continue;
    }

    // Enemy presence with no defenders → capture. Classic Risk razes
    // captured infrastructure: Town Hall and Market both go down.
    const newOwner = enemies[0]!.playerIndex;
    terrs[id] = { ...t, ownerPlayerIndex: newOwner, hasTownHall: false, hasMarket: false };
    uu = uu.map((u) =>
      u.work?.territoryId === id && u.work.kind === 'market' ? { ...u, work: null } : u,
    );
  }
  return { territories: terrs, units: uu };
}

export function applyRtsCommand(
  state: RtsGameState,
  terrain: RtsMapTerrain,
  cmd: RtsCommand,
  actorPlayerIndex: number,
  /** Used for new unit ids in tests; server can pass monotonic. */
  nextId: () => string,
): { ok: true; state: RtsGameState } | { ok: false; error: string } {
  if (state.phase === 'ended') return { ok: false, error: 'Game is over' };

  if (state.pendingClaim) {
    if (state.pendingClaim.playerIndex === actorPlayerIndex) {
      if (cmd.type !== 'resolveClaim') {
        return { ok: false, error: 'Resolve the territory claim first' };
      }
    } else if (cmd.type === 'resolveClaim') {
      return { ok: false, error: 'No claim for you' };
    }
  } else if (cmd.type === 'resolveClaim') {
    return { ok: false, error: 'No pending claim' };
  }

  const s: RtsGameState = { ...state, ...copyInner(state) };

  if (cmd.type === 'startPicking') {
    if (state.phase !== 'lobby') return { ok: false, error: 'Not in lobby' };
    if (actorPlayerIndex !== 0) return { ok: false, error: 'Only host' };
    return {
      ok: true,
      state: {
        ...s,
        phase: 'picking',
        pickingOrder: state.players.map((_, i) => i),
        availableStartIds: [...state.territoryOrder],
      },
    };
  }

  if (cmd.type === 'pickStart') {
    if (s.phase !== 'picking') return { ok: false, error: 'Not picking' };
    if (s.pickingOrder[0] !== actorPlayerIndex) return { ok: false, error: 'Not your pick' };
    if (!s.availableStartIds.includes(cmd.territoryId)) return { ok: false, error: 'Unavailable' };
    const tterrain = terrain.territories[cmd.territoryId];
    if (!tterrain) return { ok: false, error: 'Unknown territory' };

    const newUnits: RtsUnit[] = [];
    for (let i = 0; i < RTS_STARTING_UNITS; i++) {
      newUnits.push({
        id: nextId(),
        playerIndex: actorPlayerIndex,
        territoryId: cmd.territoryId,
        nodeId: tterrain.spawnNodeId,
        work: null,
      });
    }
    const pGold = s.players.map((p, i) => (i === actorPlayerIndex ? { ...p, gold: RTS_STARTING_GOLD } : { ...p }));
    const newTerrs = { ...s.territories, [cmd.territoryId]: { ...s.territories[cmd.territoryId]!, ownerPlayerIndex: actorPlayerIndex, hasTownHall: true, hasMarket: false } };
    let pickingOrder = s.pickingOrder.slice(1);
    let availableStartIds = s.availableStartIds.filter((x) => x !== cmd.territoryId);
    let phase: RtsGameState['phase'] = s.phase;
    let gameTimeMs = s.gameTimeMs;
    let lastIncomeAccrualTimeMs = s.lastIncomeAccrualTimeMs;
    if (pickingOrder.length === 0) {
      phase = 'playing';
      gameTimeMs = 0;
      lastIncomeAccrualTimeMs = 0;
    }
    return {
      ok: true,
      state: {
        ...s,
        players: pGold,
        units: [...s.units, ...newUnits],
        territories: newTerrs,
        pickingOrder,
        availableStartIds,
        phase,
        gameTimeMs,
        lastIncomeAccrualTimeMs,
      },
    };
  }

  if (s.phase !== 'playing') {
    if (['moveUnit', 'resolveClaim', 'buyUnit', 'buildMarket', 'assignWork', 'unassignWork'].includes(cmd.type)) {
      return { ok: false, error: 'Not playing' };
    }
  }

  if (cmd.type === 'resolveClaim') {
    if (!s.pendingClaim) return { ok: false, error: 'Nothing to resolve' };
    if (s.pendingClaim.playerIndex !== actorPlayerIndex) return { ok: false, error: 'Not your claim' };
    const { territoryId, playerIndex: claimer } = s.pendingClaim;
    let newTerrs = copyTerritories(s.territories);
    if (cmd.claim) {
      newTerrs[territoryId] = { ...newTerrs[territoryId]!, ownerPlayerIndex: claimer, hasTownHall: false, hasMarket: false };
    }
    let uu = copyUnits(s.units);
    let st: RtsGameState = { ...s, territories: newTerrs, pendingClaim: null, units: uu };
    const g = runGarrison(st, st.units, st.territories);
    st = { ...st, ...g, pendingClaim: recomputePendingClaim(s, g.units, g.territories) };
    const w = checkDominationWin(st, st.territories);
    if (w) st = { ...st, phase: 'ended', winnerPlayerIndex: w.winnerPlayerIndex };
    return { ok: true, state: st };
  }

  if (cmd.type === 'moveUnit') {
    const u = s.units.find((x) => x.id === cmd.unitId);
    if (!u) return { ok: false, error: 'No unit' };
    if (u.playerIndex !== actorPlayerIndex) return { ok: false, error: 'Not your unit' };
    if (u.work) return { ok: false, error: 'Unit is working' };
    if (!isNeighbor(terrain, u.territoryId, u.nodeId, cmd.toTerritoryId, cmd.toNodeId, terrain.territories[u.territoryId]!)) {
      return { ok: false, error: 'Invalid move' };
    }
    const destT = s.territories[cmd.toTerritoryId];
    if (!destT) return { ok: false, error: 'Bad dest' };
    if (destT.ownerPlayerIndex != null && destT.ownerPlayerIndex !== actorPlayerIndex) {
      return { ok: false, error: 'Enemy territory' };
    }
    let uu2 = s.units.map((x) => (x.id === cmd.unitId ? { ...x, territoryId: cmd.toTerritoryId, nodeId: cmd.toNodeId } : x));
    const g0 = runGarrison({ ...s, units: uu2 }, uu2, s.territories);
    let st2: RtsGameState = { ...s, ...g0, pendingClaim: recomputePendingClaim(s, g0.units, g0.territories) };
    const w = checkDominationWin(st2, st2.territories);
    if (w) st2 = { ...st2, phase: 'ended', winnerPlayerIndex: w.winnerPlayerIndex };
    return { ok: true, state: st2 };
  }

  if (cmd.type === 'buyUnit') {
    const p = s.players[actorPlayerIndex]!;
    if (p.gold < RTS_UNIT_COST_GOLD) return { ok: false, error: 'Not enough gold' };
    const th = Object.keys(s.territories).find(
      (id) => s.territories[id]!.ownerPlayerIndex === actorPlayerIndex && s.territories[id]!.hasTownHall,
    );
    if (!th) return { ok: false, error: 'No Town Hall' };
    const tterrain = terrain.territories[th]!;
    return {
      ok: true,
      state: {
        ...s,
        players: s.players.map((q, i) => (i === actorPlayerIndex ? { ...q, gold: q.gold - RTS_UNIT_COST_GOLD } : q)),
        units: [
          ...s.units,
          { id: nextId(), playerIndex: actorPlayerIndex, territoryId: th, nodeId: tterrain.spawnNodeId, work: null },
        ],
      },
    };
  }

  if (cmd.type === 'buildMarket') {
    const p0 = s.players[actorPlayerIndex]!;
    if (p0.gold < RTS_MARKET_COST_GOLD) return { ok: false, error: 'Not enough gold' };
    const t0 = s.territories[cmd.territoryId];
    if (!t0 || t0.ownerPlayerIndex !== actorPlayerIndex) return { ok: false, error: 'Not your territory' };
    if (t0.hasMarket) return { ok: false, error: 'Market exists' };
    return {
      ok: true,
      state: {
        ...s,
        players: s.players.map((q, i) => (i === actorPlayerIndex ? { ...q, gold: q.gold - RTS_MARKET_COST_GOLD } : q)),
        territories: { ...s.territories, [cmd.territoryId]: { ...t0, hasMarket: true } },
      },
    };
  }

  if (cmd.type === 'assignWork') {
    const p = s.units.find((x) => x.id === cmd.unitId);
    if (!p || p.playerIndex !== actorPlayerIndex) return { ok: false, error: 'Bad unit' };
    if (p.work) return { ok: false, error: 'Already working' };
    const t = s.territories[cmd.marketTerritoryId];
    if (!t || t.ownerPlayerIndex !== actorPlayerIndex || !t.hasMarket) return { ok: false, error: 'No market' };
    if (p.territoryId !== cmd.marketTerritoryId) return { ok: false, error: 'Unit not at market' };
    return {
      ok: true,
      state: {
        ...s,
        units: s.units.map((u) =>
          u.id === cmd.unitId
            ? {
                ...u,
                work: {
                  kind: 'market' as const,
                  territoryId: cmd.marketTerritoryId,
                  // Stamp the assignment time so income.ts can ignore freshly-
                  // assigned units this tick (anti-flicker guard).
                  assignedAtMs: s.gameTimeMs,
                },
              }
            : u,
        ),
      },
    };
  }

  if (cmd.type === 'unassignWork') {
    const p = s.units.find((x) => x.id === cmd.unitId);
    if (!p || p.playerIndex !== actorPlayerIndex) return { ok: false, error: 'Bad unit' };
    return { ok: true, state: { ...s, units: s.units.map((u) => (u.id === cmd.unitId ? { ...u, work: null } : u)) } };
  }

  return { ok: false, error: 'Unknown command' };
}

function copyInner(state: RtsGameState): Partial<RtsGameState> {
  return {
    players: state.players.map((p) => ({ ...p })),
    units: copyUnits(state.units),
    territories: copyTerritories(state.territories),
    pickingOrder: [...state.pickingOrder],
    availableStartIds: [...state.availableStartIds],
    territoryOrder: [...state.territoryOrder],
  };
}

export function createEmptyRtsState(over: Partial<RtsGameState> & Pick<RtsGameState, 'mapId' | 'territoryOrder' | 'players' | 'territories'> & { tuning: RtsGameState['tuning'] }): RtsGameState {
  return {
    schemaVersion: RTS_SCHEMA_VERSION,
    phase: 'lobby',
    gameTimeMs: 0,
    lastIncomeAccrualTimeMs: 0,
    units: [],
    pendingClaim: null,
    winnerPlayerIndex: null,
    pickingOrder: [],
    availableStartIds: [],
    ...over,
  } as RtsGameState;
}
