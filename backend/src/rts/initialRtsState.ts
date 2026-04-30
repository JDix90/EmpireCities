import {
  createEmptyRtsState,
  type RtsGameState,
  type RtsTerritory,
  RTS_DEFAULT_MARKET_INCOME_INTERVAL_MS,
} from '@erasofempire/rts-shared';

const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6'];

export type RtsPlayerRow = { player_index: number; user_id: string | null; is_ai: boolean; player_color: string };

export function makeLobbyRtsState(args: {
  mapId: string;
  territoryIds: string[];
  namesById: Record<string, string>;
  players: RtsPlayerRow[];
  marketIntervalMs: number;
}): RtsGameState {
  const { mapId, territoryIds, namesById, players, marketIntervalMs } = args;
  const territories: Record<string, RtsTerritory> = {};
  for (const id of territoryIds) {
    territories[id] = {
      name: namesById[id] ?? id,
      ownerPlayerIndex: null,
      hasTownHall: false,
      hasMarket: false,
    };
  }
  const rtsPlayers = players
    .filter((p) => !p.is_ai)
    .sort((a, b) => a.player_index - b.player_index)
    .map((p, i) => ({
      playerIndex: p.player_index,
      userId: p.user_id ?? 'unknown',
      color: p.player_color || COLORS[i % COLORS.length]!,
      gold: 0,
    }));
  if (rtsPlayers.length === 0) {
    throw new Error('No human players for RTS');
  }
  return createEmptyRtsState({
    mapId,
    territoryOrder: territoryIds,
    territories,
    players: rtsPlayers,
    tuning: { marketIncomeIntervalMs: marketIntervalMs > 0 ? marketIntervalMs : RTS_DEFAULT_MARKET_INCOME_INTERVAL_MS },
  });
}

/** Reconcile lobby/host state when a second human joins a waiting game. */
export function mergeRtsPlayerRows(state: RtsGameState, rows: RtsPlayerRow[]): RtsGameState {
  const humans = rows.filter((r) => !r.is_ai).sort((a, b) => a.player_index - b.player_index);
  const out = humans.map((r) => {
    const ex = state.players.find((p) => p.playerIndex === r.player_index);
    if (ex) return { ...ex, color: r.player_color, userId: r.user_id ?? ex.userId };
    return {
      playerIndex: r.player_index,
      userId: r.user_id ?? 'unknown',
      color: r.player_color,
      gold: 0,
    };
  });
  return { ...state, players: out };
}

export { COLORS as rtsDefaultColors };
