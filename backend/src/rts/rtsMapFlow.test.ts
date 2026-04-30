/**
 * Map + engine smoke: full vertical slice in-process (no DB).
 */
import { describe, expect, it } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { applyRtsCommand, tickRtsState } from '@erasofempire/rts-shared';
import { parseRtsTerrainFromMapDoc } from './loadTerrain';

function readSlice(): { terrain: ReturnType<typeof parseRtsTerrainFromMapDoc> } {
  const p = path.join(process.cwd(), 'database', 'maps', 'rts_slice_v1.json');
  const p2 = path.join(process.cwd(), '..', 'database', 'maps', 'rts_slice_v1.json');
  const file = fs.existsSync(p) ? p : p2;
  const json = JSON.parse(fs.readFileSync(file, 'utf-8')) as { map_id: string; rts_terrain: unknown };
  return { terrain: parseRtsTerrainFromMapDoc(json.rts_terrain, json.map_id) };
}

describe('rts map + command flow (smoke)', () => {
  it('move, build market, assign, income tick (shared engine)', () => {
    const { terrain } = readSlice();
    let n = 0;
    const nextId = () => `u${n++}`;
    let s = applyRtsCommand(
      {
        schemaVersion: 1,
        mapId: 'rts_slice_v1',
        phase: 'lobby',
        gameTimeMs: 0,
        lastIncomeAccrualTimeMs: 0,
        players: [{ playerIndex: 0, userId: 'a', color: '#c00', gold: 0 }],
        territoryOrder: Object.keys(terrain.territories),
        territories: Object.fromEntries(
          Object.keys(terrain.territories).map((id) => [id, { name: id, ownerPlayerIndex: null, hasTownHall: false, hasMarket: false }]),
        ),
        units: [],
        pickingOrder: [],
        availableStartIds: [],
        winnerPlayerIndex: null,
        pendingClaim: null,
        tuning: { marketIncomeIntervalMs: 3_000 },
      },
      terrain,
      { type: 'startPicking' },
      0,
      nextId,
    );
    if (!s.ok) throw s;
    s = applyRtsCommand(
      s.state,
      terrain,
      { type: 'pickStart', territoryId: 'rts_march_1' },
      0,
      nextId,
    );
    if (!s.ok) throw s;
    s = applyRtsCommand(
      s.state,
      terrain,
      { type: 'buildMarket', territoryId: 'rts_march_1' },
      0,
      nextId,
    );
    if (!s.ok) throw s;
    s = applyRtsCommand(
      s.state,
      terrain,
      { type: 'assignWork', unitId: s.state.units[0]!.id, marketTerritoryId: 'rts_march_1' },
      0,
      nextId,
    );
    if (!s.ok) throw s;
    const after = tickRtsState(s.state, 3_000, terrain);
    expect(after.players[0]!.gold).toBeGreaterThan(4);
  });
});
