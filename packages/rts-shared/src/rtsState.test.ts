import { describe, expect, it } from 'vitest';
import { RTS_STARTING_GOLD } from './constants.js';
import { tickRtsState } from './income.js';
import { applyRtsCommand, createEmptyRtsState, runGarrison } from './reducer.js';
import type { RtsGameState, RtsMapTerrain, RtsTerritory } from './types.js';

const sliceTerritoryIds = ['a', 'b', 'c', 'd', 'e'] as const;

function makeTerris(): Record<string, RtsTerritory> {
  const o: Record<string, RtsTerritory> = {};
  for (const id of sliceTerritoryIds) {
    o[id] = { name: id, ownerPlayerIndex: null, hasTownHall: false, hasMarket: false };
  }
  return o;
}

function buildChainTerrain(mapId: string, tids: readonly string[]): RtsMapTerrain {
  const t: RtsMapTerrain = { mapId, territories: {} };
  for (const id of tids) {
    t.territories[id] = {
      nodes: [
        { id: 'n0', u: 0.2, v: 0.5 },
        { id: 'n1', u: 0.8, v: 0.5 },
      ],
      edges: [{ from: 'n0', to: 'n1' }],
      frontiers: {},
      spawnNodeId: 'n0',
    };
  }
  for (let i = 0; i < tids.length - 1; i++) {
    const a = tids[i]!;
    const b = tids[i + 1]!;
    t.territories[a]!.frontiers[b] = [{ thisNode: 'n1', neighborNode: 'n0' }];
    t.territories[b]!.frontiers[a] = [{ thisNode: 'n0', neighborNode: 'n1' }];
  }
  return t;
}

const chainTerrain = buildChainTerrain('rts_slice_v1', sliceTerritoryIds);

function nextIdFactory() {
  let n = 0;
  return () => `u${n++}`;
}

function lobbySolo() {
  const nextId = nextIdFactory();
  return {
    state: createEmptyRtsState({
      mapId: 'rts_slice_v1',
      territoryOrder: [...sliceTerritoryIds],
      territories: makeTerris(),
      players: [{ playerIndex: 0, userId: 'h', color: '#c00', gold: 0 }],
      tuning: { marketIncomeIntervalMs: 3_000 },
    }),
    nextId,
  };
}

describe('RTS reducer', () => {
  it('pickStart grants gold, Town Hall, and 3 units', () => {
    const { state, nextId } = lobbySolo();
    const s1 = applyRtsCommand(state, chainTerrain, { type: 'startPicking' }, 0, nextId);
    expect(s1.ok).toBe(true);
    if (!s1.ok) return;
    const s2 = applyRtsCommand(s1.state, chainTerrain, { type: 'pickStart', territoryId: 'a' }, 0, nextId);
    expect(s2.ok).toBe(true);
    if (!s2.ok) return;
    const st = s2.state;
    expect(st.phase).toBe('playing');
    expect(st.players[0]!.gold).toBe(RTS_STARTING_GOLD);
    expect(st.territories['a']!.hasTownHall).toBe(true);
    expect(st.units).toHaveLength(3);
  });

  it('moves a unit one step to n1 in same territory', () => {
    const { state, nextId } = lobbySolo();
    const s0 = applyRtsCommand(state, chainTerrain, { type: 'startPicking' }, 0, nextId);
    expect(s0.ok).toBe(true);
    if (!s0.ok) return;
    const s = applyRtsCommand(s0.state, chainTerrain, { type: 'pickStart', territoryId: 'a' }, 0, nextId);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    const u0 = s.state.units[0]!.id;
    const mv = applyRtsCommand(
      s.state,
      chainTerrain,
      { type: 'moveUnit', unitId: u0, toTerritoryId: 'a', toNodeId: 'n1' },
      0,
      nextId,
    );
    expect(mv.ok).toBe(true);
    if (mv.ok) expect(mv.state.units[0]!.nodeId).toBe('n1');
  });

  it('preserves ownership and buildings when an owned territory is temporarily empty (no enemies)', () => {
    // Regression: the previous implementation flipped ownership to null and
    // razed buildings the moment a player moved their last unit out, allowing
    // a 2-unit walk-in claim. Classic-Risk-style behaviour: empty + no rival
    // = still yours.
    const t = makeTerris();
    t['a'] = { name: 'a', ownerPlayerIndex: 0, hasTownHall: true, hasMarket: true };
    const stub: RtsGameState = {
      schemaVersion: 1,
      mapId: 'm',
      phase: 'playing',
      gameTimeMs: 0,
      lastIncomeAccrualTimeMs: 0,
      players: [{ playerIndex: 0, userId: 'h', color: '#c00', gold: 10 }],
      territoryOrder: [...sliceTerritoryIds],
      territories: t,
      units: [],
      pickingOrder: [],
      availableStartIds: [],
      winnerPlayerIndex: null,
      pendingClaim: null,
      tuning: { marketIncomeIntervalMs: 30_000 },
    };
    const g = runGarrison(stub, [], t);
    expect(g.territories['a']!.ownerPlayerIndex).toBe(0);
    expect(g.territories['a']!.hasTownHall).toBe(true);
    expect(g.territories['a']!.hasMarket).toBe(true);
  });

  it('transfers ownership and razes buildings when an enemy garrisons an empty owned territory', () => {
    // Classic mode: capture razes Town Hall and Market. A worker assigned to
    // the (now-razed) market has its assignment cleared.
    const t = makeTerris();
    t['a'] = { name: 'a', ownerPlayerIndex: 0, hasTownHall: true, hasMarket: true };
    const enemyUnit = {
      id: 'e1',
      playerIndex: 1,
      territoryId: 'a',
      nodeId: 'n0',
      work: null,
    };
    const detachedWorker = {
      id: 'w1',
      playerIndex: 0,
      territoryId: 'b',
      nodeId: 'n0',
      work: { kind: 'market' as const, territoryId: 'a' },
    };
    const stub: RtsGameState = {
      schemaVersion: 1,
      mapId: 'm',
      phase: 'playing',
      gameTimeMs: 0,
      lastIncomeAccrualTimeMs: 0,
      players: [
        { playerIndex: 0, userId: 'h', color: '#c00', gold: 10 },
        { playerIndex: 1, userId: 'e', color: '#00c', gold: 0 },
      ],
      territoryOrder: [...sliceTerritoryIds],
      territories: t,
      units: [enemyUnit, detachedWorker],
      pickingOrder: [],
      availableStartIds: [],
      winnerPlayerIndex: null,
      pendingClaim: null,
      tuning: { marketIncomeIntervalMs: 30_000 },
    };
    const g = runGarrison(stub, stub.units, t);
    expect(g.territories['a']!.ownerPlayerIndex).toBe(1);
    expect(g.territories['a']!.hasTownHall).toBe(false);
    expect(g.territories['a']!.hasMarket).toBe(false);
    // Worker lost its market job because the market was razed.
    const workerAfter = g.units.find((u) => u.id === 'w1');
    expect(workerAfter?.work).toBeNull();
  });

  it('keeps owner unchanged while at least one friendly unit remains (basic occupation rule)', () => {
    const t = makeTerris();
    t['a'] = { name: 'a', ownerPlayerIndex: 0, hasTownHall: true, hasMarket: false };
    const friendly = {
      id: 'f1',
      playerIndex: 0,
      territoryId: 'a',
      nodeId: 'n0',
      work: null,
    };
    const stub: RtsGameState = {
      schemaVersion: 1,
      mapId: 'm',
      phase: 'playing',
      gameTimeMs: 0,
      lastIncomeAccrualTimeMs: 0,
      players: [{ playerIndex: 0, userId: 'h', color: '#c00', gold: 10 }],
      territoryOrder: [...sliceTerritoryIds],
      territories: t,
      units: [friendly],
      pickingOrder: [],
      availableStartIds: [],
      winnerPlayerIndex: null,
      pendingClaim: null,
      tuning: { marketIncomeIntervalMs: 30_000 },
    };
    const g = runGarrison(stub, stub.units, t);
    expect(g.territories['a']!.ownerPlayerIndex).toBe(0);
    expect(g.territories['a']!.hasTownHall).toBe(true);
  });

  it('market income accrues every interval', () => {
    const { state, nextId } = lobbySolo();
    const p1 = applyRtsCommand(state, chainTerrain, { type: 'startPicking' }, 0, nextId);
    if (!p1.ok) return;
    const p2 = applyRtsCommand(p1.state, chainTerrain, { type: 'pickStart', territoryId: 'a' }, 0, nextId);
    if (!p2.ok) return;
    const p3 = applyRtsCommand(
      p2.state,
      chainTerrain,
      { type: 'buildMarket', territoryId: 'a' },
      0,
      nextId,
    );
    if (!p3.ok) return;
    const p4 = applyRtsCommand(
      p3.state,
      chainTerrain,
      { type: 'assignWork', unitId: p3.state.units[0]!.id, marketTerritoryId: 'a' },
      0,
      nextId,
    );
    if (!p4.ok) return;
    const after = tickRtsState(p4.state, 3_000, chainTerrain);
    expect(after.players[0]!.gold).toBe(6);
  });

  it("ignores income from units assigned within the current interval (anti-flicker)", () => {
    // Setup: build a market at tick 0, then advance the simulated game
    // clock past the first tick before assigning. The unit was NOT working
    // during the [0, 3000] interval, so we should not earn for that boundary.
    const { state, nextId } = lobbySolo();
    const p1 = applyRtsCommand(state, chainTerrain, { type: 'startPicking' }, 0, nextId);
    if (!p1.ok) return;
    const p2 = applyRtsCommand(p1.state, chainTerrain, { type: 'pickStart', territoryId: 'a' }, 0, nextId);
    if (!p2.ok) return;
    const p3 = applyRtsCommand(
      p2.state,
      chainTerrain,
      { type: 'buildMarket', territoryId: 'a' },
      0,
      nextId,
    );
    if (!p3.ok) return;

    // Simulate the player twiddling the clock to JUST before the first
    // income tick fires by pre-advancing gameTimeMs to 2_999. Then the
    // assign command stamps assignedAtMs = 2_999.
    const stagedState = { ...p3.state, gameTimeMs: 2_999 };
    const p4 = applyRtsCommand(
      stagedState,
      chainTerrain,
      { type: 'assignWork', unitId: stagedState.units[0]!.id, marketTerritoryId: 'a' },
      0,
      nextId,
    );
    if (!p4.ok) return;
    expect(p4.state.units[0]!.work?.assignedAtMs).toBe(2_999);

    // After pickStart (10g) - buildMarket (5g) = 5g baseline.
    const baseline = p4.state.players[0]!.gold;
    expect(baseline).toBe(5);

    // First income boundary at t=3_000. Unit was assigned at 2_999, so
    // (assigned + interval) = 5_999 > 3_000 → no income.
    const after1 = tickRtsState(p4.state, 3_000, chainTerrain);
    expect(after1.players[0]!.gold).toBe(baseline);

    // Advance to t=6_000, the next boundary. Unit has now been working since
    // 2_999, so 2_999 + 3_000 = 5_999 ≤ 6_000 → income earned for this tick.
    const after2 = tickRtsState(after1, 6_000, chainTerrain);
    expect(after2.players[0]!.gold).toBe(baseline + 1);
  });
});
