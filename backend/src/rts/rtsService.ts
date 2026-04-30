import {
  applyRtsCommand,
  type RtsCommand,
  type RtsGameState,
  type RtsMapTerrain,
  tickRtsState,
} from '@erasofempire/rts-shared';
import { nanoid } from 'nanoid';
import { query, queryOne } from '../db/postgres';
import { CustomMap } from '../db/mongo/MapModel.js';
import { makeLobbyRtsState, mergeRtsPlayerRows } from './initialRtsState';
import { loadRtsState, saveRtsState } from './persistRtsState';
import { parseRtsTerrainFromMapDoc } from './loadTerrain';
import { readMapFileJson } from './rtsMapFile';
import { FifoSet } from '../utils/fifoSet';

export type RtsRoom = {
  state: RtsGameState;
  terrain: RtsMapTerrain;
  tickId: ReturnType<typeof setInterval> | null;
  gameId: string;
  marketIntervalMs: number;
};

const rooms = new Map<string, RtsRoom>();
/**
 * Per-game replay-protection set. Bounded so a long-running room can't
 * grow unboundedly, and FIFO so we never wholesale-clear the set (the old
 * `Set.clear()` strategy left a 1-action window where the same action_id
 * would re-execute, which is exactly the problem dedupe is supposed to
 * prevent).
 */
const ACTION_DEDUPE_CAP = 1024;
const actionDedupe = new Map<string, FifoSet<string>>();

function dedupeSet(gameId: string): FifoSet<string> {
  let s = actionDedupe.get(gameId);
  if (!s) {
    s = new FifoSet<string>(ACTION_DEDUPE_CAP);
    actionDedupe.set(gameId, s);
  }
  return s;
}

function nextUnitId(): string {
  return `u-${nanoid(8)}`;
}

function marketMs(): number {
  const n = Number(process.env.RTS_MARKET_INCOME_INTERVAL_MS);
  if (Number.isFinite(n) && n > 0) return n;
  return 30_000;
}

export async function getTerrainForMapId(mapId: string): Promise<RtsMapTerrain> {
  const doc = await CustomMap.findOne({ map_id: mapId }).lean();
  if (doc && (doc as { rts_terrain?: unknown }).rts_terrain) {
    return parseRtsTerrainFromMapDoc((doc as { rts_terrain: unknown }).rts_terrain, mapId);
  }
  const json = readMapFileJson(mapId) as { rts_terrain: unknown; map_id: string };
  if (!json.rts_terrain) throw new Error(`rts_terrain missing for map ${mapId}`);
  return parseRtsTerrainFromMapDoc(json.rts_terrain, mapId);
}

export function getRtsRoom(gameId: string): RtsRoom | null {
  return rooms.get(gameId) ?? null;
}

export function shutdownRtsGame(gameId: string): void {
  const r = rooms.get(gameId);
  if (r?.tickId) clearInterval(r.tickId);
  rooms.delete(gameId);
  // Drop the dedupe map for this game so we don't accumulate state for
  // games that ended hours/days ago. Action ids are scoped per game and
  // never reused, so dropping is safe.
  actionDedupe.delete(gameId);
}

function ensureTick(room: RtsRoom) {
  if (room.state.phase !== 'playing') {
    if (room.tickId) {
      clearInterval(room.tickId);
      room.tickId = null;
    }
    return;
  }
  if (room.tickId) return;
  room.tickId = setInterval(() => {
    void (async () => {
      const { state, terrain, gameId } = room;
      if (state.phase !== 'playing') {
        if (room.tickId) {
          clearInterval(room.tickId);
          room.tickId = null;
        }
        return;
      }
      const nxt = tickRtsState(state, state.gameTimeMs + 1000, terrain);
      if (nxt === state) return;
      room.state = nxt;
      await saveRtsState(gameId, nxt);
    })();
  }, 1000);
}

export async function ensureRtsRoom(gameId: string): Promise<RtsRoom> {
  const mims = marketMs();
  const m = getRtsRoom(gameId);
  if (m) {
    m.terrain = await getTerrainForMapId(m.state.mapId);
    m.marketIntervalMs = mims;
    m.state = syncPlayerTuning(m.state, mims);
    return m;
  }
  const row = await queryOne<{
    map_id: string;
  }>(`SELECT map_id FROM games WHERE game_id = $1 AND game_mode = 'rts'`, [gameId]);
  if (!row) throw new Error('RTS game not found');
  const terrain = await getTerrainForMapId(row.map_id);
  const saved = (await loadRtsState(gameId)) as RtsGameState | null;
  if (saved) {
    const pSync = await query<{
      player_index: number;
      user_id: string | null;
      is_ai: boolean;
      player_color: string;
    }>(
      'SELECT player_index, user_id, is_ai, player_color FROM game_players WHERE game_id = $1 ORDER BY player_index',
      [gameId],
    );
    const merged0 = saved.phase === 'lobby' || saved.phase === 'picking' ? mergeRtsPlayerRows(saved, pSync) : saved;
    const merged = syncPlayerTuning(merged0, mims);
    const room: RtsRoom = {
      state: merged,
      terrain,
      tickId: null,
      gameId,
      marketIntervalMs: mims,
    };
    rooms.set(gameId, room);
    await saveRtsState(gameId, merged);
    ensureTick(room);
    return room;
  }
  const json = readMapFileJson(row.map_id) as { territories: { territory_id: string; name: string }[] };
  const tids = json.territories.map((t) => t.territory_id);
  const names: Record<string, string> = {};
  for (const t of json.territories) names[t.territory_id] = t.name;
  const pRows = await query<{ player_index: number; user_id: string | null; is_ai: boolean; player_color: string }>(
    'SELECT player_index, user_id, is_ai, player_color FROM game_players WHERE game_id = $1 ORDER BY player_index',
    [gameId],
  );
  const state = makeLobbyRtsState({
    mapId: row.map_id,
    territoryIds: tids,
    namesById: names,
    players: pRows,
    marketIntervalMs: mims,
  });
  const room: RtsRoom = { state, terrain, tickId: null, gameId, marketIntervalMs: mims };
  rooms.set(gameId, room);
  await saveRtsState(gameId, state);
  return room;
}

function syncPlayerTuning(s: RtsGameState, interval: number): RtsGameState {
  return { ...s, tuning: { marketIncomeIntervalMs: interval } };
}

export async function runRtsCommand(
  gameId: string,
  userId: string,
  command: RtsCommand,
  actionId?: string,
): Promise<{ ok: true; state: RtsGameState } | { ok: false; error: string }> {
  const g = await queryOne<{ game_mode: string }>(`SELECT game_mode FROM games WHERE game_id = $1`, [gameId]);
  if (!g || g.game_mode !== 'rts') return { ok: false, error: 'Not an RTS game' };
  if (actionId) {
    const s = dedupeSet(gameId);
    if (s.has(actionId)) {
      const room0 = getRtsRoom(gameId) ?? (await ensureRtsRoom(gameId).catch(() => null));
      if (room0) return { ok: true, state: room0.state };
      return { ok: false, error: 'No state' };
    }
    // FifoSet self-evicts the oldest entry past `cap`, no manual clear.
    s.add(actionId);
  }
  const room = await ensureRtsRoom(gameId);
  const interval = room.marketIntervalMs;
  room.state = syncPlayerTuning(room.state, interval);
  const pRows = await query<{ user_id: string | null; is_ai: boolean; player_index: number }>(
    'SELECT user_id, is_ai, player_index FROM game_players WHERE game_id = $1 ORDER BY player_index',
    [gameId],
  );
  const me = pRows.find(
    (p: { user_id: string | null; is_ai: boolean; player_index: number }) => p.user_id === userId && !p.is_ai,
  );
  if (me == null) return { ok: false, error: 'Not a player' };
  const playerIndex = me.player_index;
  const res = applyRtsCommand(room.state, room.terrain, command, playerIndex, nextUnitId);
  if (!res.ok) return res;
  room.state = res.state;
  ensureTick(room);
  await saveRtsState(gameId, room.state);
  return { ok: true, state: room.state };
}
