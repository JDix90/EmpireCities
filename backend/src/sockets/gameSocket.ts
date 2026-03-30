import type { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { verifyAccessToken } from '../utils/jwt';
import { query, queryOne } from '../db/postgres';
import { CustomMap } from '../db/mongo/MapModel';
import {
  initializeGameState,
  advanceToNextPlayer,
  checkVictory,
  drawCard,
  redeemCardSet,
  syncTerritoryCounts,
  calculateContinentBonuses,
} from '../game-engine/state/gameStateManager';
import { resolveCombat, calculateReinforcements } from '../game-engine/combat/combatResolver';
import { computeAiTurn } from '../game-engine/ai/aiBot';
import type { GameState, GameMap, AiDifficulty } from '../types';
import { config } from '../config';

// In-memory store: gameId → { state, map, connectedSockets }
const activeGames = new Map<string, {
  state: GameState;
  map: GameMap;
  connectedSockets: Map<string, string>; // socketId → playerId
}>();

export function initGameSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: config.frontendUrl,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // ── Authentication middleware ─────────────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('Authentication required'));
    const payload = verifyAccessToken(token);
    if (!payload) return next(new Error('Invalid or expired token'));
    (socket as Socket & { userId: string; username: string }).userId = payload.sub;
    (socket as Socket & { userId: string; username: string }).username = payload.username;
    next();
  });

  io.on('connection', (socket) => {
    const userId = (socket as Socket & { userId: string }).userId;
    console.log(`[Socket] Connected: ${userId} (${socket.id})`);

    // ── Join Game Room ──────────────────────────────────────────────────────
    socket.on('game:join', async ({ gameId }: { gameId: string }) => {
      try {
        const game = await queryOne<{
          game_id: string; era_id: string; map_id: string; status: string; settings_json: string;
        }>(
          'SELECT game_id, era_id, map_id, status, settings_json FROM games WHERE game_id = $1',
          [gameId]
        );
        if (!game) return socket.emit('error', { message: 'Game not found' });

        const players = await query<{
          player_index: number; user_id: string | null; username: string | null;
          player_color: string; is_ai: boolean; ai_difficulty: string | null; is_eliminated: boolean;
        }>(
          `SELECT gp.player_index, gp.user_id, u.username, gp.player_color,
                  gp.is_ai, gp.ai_difficulty, gp.is_eliminated
           FROM game_players gp
           LEFT JOIN users u ON u.user_id = gp.user_id
           WHERE gp.game_id = $1
           ORDER BY gp.player_index`,
          [gameId]
        );

        // Verify this user is a participant
        const isParticipant = players.some((p) => p.user_id === userId);
        if (!isParticipant) return socket.emit('error', { message: 'Not a participant in this game' });

        socket.join(gameId);

        // Initialize game state if not already active
        if (!activeGames.has(gameId) && game.status === 'in_progress') {
          // Load last saved state from DB
          const savedState = await queryOne<{ state_json: GameState }>(
            `SELECT state_json FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1`,
            [gameId]
          );

          if (savedState) {
            // Load map
            const mapDoc = await CustomMap.findOne({ map_id: game.map_id }).lean();
            if (mapDoc) {
              const gameMap: GameMap = {
                map_id: mapDoc.map_id,
                name: mapDoc.name,
                territories: mapDoc.territories,
                connections: mapDoc.connections,
                regions: mapDoc.regions,
              };
              activeGames.set(gameId, {
                state: savedState.state_json,
                map: gameMap,
                connectedSockets: new Map(),
              });
            }
          }
        }

        const room = activeGames.get(gameId);
        if (room) {
          room.connectedSockets.set(socket.id, userId);
          socket.emit('game:state', buildClientState(room.state, userId, room.state.settings.fog_of_war));
        }

        socket.emit('game:joined', { gameId, playerIndex: players.find((p) => p.user_id === userId)?.player_index });
      } catch (err) {
        console.error('[Socket] game:join error:', err);
        socket.emit('error', { message: 'Failed to join game' });
      }
    });

    // ── Start Game ──────────────────────────────────────────────────────────
    socket.on('game:start', async ({ gameId }: { gameId: string }) => {
      try {
        const game = await queryOne<{
          game_id: string; era_id: string; map_id: string; status: string; settings_json: object;
        }>(
          'SELECT game_id, era_id, map_id, status, settings_json FROM games WHERE game_id = $1',
          [gameId]
        );
        if (!game || game.status !== 'waiting') {
          return socket.emit('error', { message: 'Game cannot be started' });
        }

        const players = await query<{
          player_index: number; user_id: string | null; username: string | null;
          player_color: string; is_ai: boolean; ai_difficulty: string | null;
        }>(
          `SELECT gp.player_index, gp.user_id, u.username, gp.player_color, gp.is_ai, gp.ai_difficulty
           FROM game_players gp
           LEFT JOIN users u ON u.user_id = gp.user_id
           WHERE gp.game_id = $1
           ORDER BY gp.player_index`,
          [gameId]
        );

        // Load map
        const mapDoc = await CustomMap.findOne({ map_id: game.map_id }).lean();
        if (!mapDoc) return socket.emit('error', { message: 'Map not found' });

        const gameMap: GameMap = {
          map_id: mapDoc.map_id,
          name: mapDoc.name,
          territories: mapDoc.territories,
          connections: mapDoc.connections,
          regions: mapDoc.regions,
        };

        const playerStates = players.map((p) => ({
          player_id: p.user_id ?? `ai_${p.player_index}`,
          player_index: p.player_index,
          username: p.username ?? `AI Bot ${p.player_index}`,
          color: p.player_color,
          is_ai: p.is_ai,
          ai_difficulty: (p.ai_difficulty as AiDifficulty) ?? undefined,
          is_eliminated: false,
          mmr: 1000,
        }));

        const settings = game.settings_json as GameState['settings'];
        const state = initializeGameState(game.game_id, game.era_id as GameState['era'], gameMap, playerStates, settings);

        // Populate connectedSockets from sockets currently in the room
        const connectedSockets = new Map<string, string>();
        const socketsInRoom = await io.in(gameId).fetchSockets();
        for (const s of socketsInRoom) {
          const ext = s as Socket & { userId?: string };
          if (ext.userId) {
            connectedSockets.set(s.id, ext.userId);
          }
        }

        activeGames.set(gameId, { state, map: gameMap, connectedSockets });

        // Update DB
        await query('UPDATE games SET status = $1, started_at = NOW() WHERE game_id = $2', ['in_progress', gameId]);
        await saveGameState(gameId, state);

        io.to(gameId).emit('game:started', { gameId });
        broadcastState(io, gameId, state);

        // If first player is AI, trigger AI turn
        if (state.players[state.current_player_index].is_ai) {
          setTimeout(() => processAiTurn(io, gameId), 1500);
        }
      } catch (err) {
        console.error('[Socket] game:start error:', err);
        socket.emit('error', { message: 'Failed to start game' });
      }
    });

    // ── Draft Action ────────────────────────────────────────────────────────
    socket.on('game:draft', ({ gameId, territoryId, units }: { gameId: string; territoryId: string; units: number }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      const { state } = room;

      const currentPlayer = state.players[state.current_player_index];
      if (currentPlayer.player_id !== userId) return socket.emit('error', { message: 'Not your turn' });
      if (state.phase !== 'draft') return socket.emit('error', { message: 'Not in draft phase' });

      if (units < 1 || units > state.draft_units_remaining) {
        return socket.emit('error', { message: `Cannot place ${units} units (${state.draft_units_remaining} remaining)` });
      }

      const territory = state.territories[territoryId];
      if (!territory || territory.owner_id !== userId) {
        return socket.emit('error', { message: 'Invalid territory' });
      }

      territory.unit_count += units;
      state.draft_units_remaining -= units;
      broadcastState(io, gameId, state);
    });

    // ── Attack Action ───────────────────────────────────────────────────────
    socket.on('game:attack', ({ gameId, fromId, toId }: { gameId: string; fromId: string; toId: string }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      const { state, map } = room;

      const currentPlayer = state.players[state.current_player_index];
      if (currentPlayer.player_id !== userId) return socket.emit('error', { message: 'Not your turn' });
      if (state.phase !== 'attack') return socket.emit('error', { message: 'Not in attack phase' });

      const fromTerritory = state.territories[fromId];
      const toTerritory = state.territories[toId];

      if (!fromTerritory || fromTerritory.owner_id !== userId) {
        return socket.emit('error', { message: 'Invalid attacking territory' });
      }
      if (!toTerritory || toTerritory.owner_id === userId) {
        return socket.emit('error', { message: 'Invalid defending territory' });
      }
      if (fromTerritory.unit_count < 2) {
        return socket.emit('error', { message: 'Not enough units to attack' });
      }

      // Verify adjacency
      const isAdjacent = map.connections.some(
        (c) => (c.from === fromId && c.to === toId) || (c.from === toId && c.to === fromId)
      );
      if (!isAdjacent) return socket.emit('error', { message: 'Territories not adjacent' });

      const result = resolveCombat(fromTerritory.unit_count, toTerritory.unit_count);

      fromTerritory.unit_count -= result.attacker_losses;
      toTerritory.unit_count -= result.defender_losses;

      let cardEarned = false;
      if (result.territory_captured) {
        toTerritory.owner_id = userId;
        toTerritory.unit_count = Math.min(fromTerritory.unit_count - 1, 3);
        fromTerritory.unit_count = Math.max(1, fromTerritory.unit_count - toTerritory.unit_count);
        cardEarned = true;

        // Check if defender is eliminated
        const defenderId = toTerritory.owner_id;
        const defenderPlayer = state.players.find((p) => p.player_id === defenderId);
        if (defenderPlayer) {
          syncTerritoryCounts(state);
          if (defenderPlayer.territory_count === 0) {
            defenderPlayer.is_eliminated = true;
            // Transfer cards to attacker
            currentPlayer.cards.push(...defenderPlayer.cards);
            defenderPlayer.cards = [];
          }
        }
      }

      syncTerritoryCounts(state);

      if (cardEarned) drawCard(state, userId);

      // Check victory
      const winnerId = checkVictory(state);
      if (winnerId) {
        state.phase = 'game_over';
        state.winner_id = winnerId;
        finalizeGame(io, gameId, state, winnerId);
      }

      io.to(gameId).emit('game:combat_result', { fromId, toId, result });
      broadcastState(io, gameId, state);
    });

    // ── Advance Phase ───────────────────────────────────────────────────────
    socket.on('game:advance_phase', ({ gameId }: { gameId: string }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      const { state, map } = room;

      const currentPlayer = state.players[state.current_player_index];
      if (currentPlayer.player_id !== userId) return socket.emit('error', { message: 'Not your turn' });

      if (state.phase === 'draft') {
        state.draft_units_remaining = 0;
        state.phase = 'attack';
      } else if (state.phase === 'attack') {
        state.phase = 'fortify';
      } else if (state.phase === 'fortify') {
        advanceToNextPlayer(state, map);
        saveGameState(gameId, state);

        // Trigger AI if next player is AI
        if (state.players[state.current_player_index].is_ai) {
          setTimeout(() => processAiTurn(io, gameId), 1500);
        }
      }

      broadcastState(io, gameId, state);
    });

    // ── Fortify Action ──────────────────────────────────────────────────────
    socket.on('game:fortify', ({ gameId, fromId, toId, units }: {
      gameId: string; fromId: string; toId: string; units: number;
    }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      const { state, map } = room;

      const currentPlayer = state.players[state.current_player_index];
      if (currentPlayer.player_id !== userId) return socket.emit('error', { message: 'Not your turn' });
      if (state.phase !== 'fortify') return socket.emit('error', { message: 'Not in fortify phase' });

      const from = state.territories[fromId];
      const to = state.territories[toId];
      if (!from || from.owner_id !== userId || !to || to.owner_id !== userId) {
        return socket.emit('error', { message: 'Invalid territories for fortification' });
      }
      if (units >= from.unit_count) {
        return socket.emit('error', { message: 'Must leave at least 1 unit behind' });
      }

      // Verify path exists via BFS
      if (!pathExists(fromId, toId, state, map, userId)) {
        return socket.emit('error', { message: 'No connected path between territories' });
      }

      from.unit_count -= units;
      to.unit_count += units;
      broadcastState(io, gameId, state);
    });

    // ── Redeem Cards ────────────────────────────────────────────────────────
    socket.on('game:redeem_cards', ({ gameId, cardIds }: { gameId: string; cardIds: string[] }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      const { state } = room;

      const currentPlayer = state.players[state.current_player_index];
      if (currentPlayer.player_id !== userId) return socket.emit('error', { message: 'Not your turn' });

      try {
        const bonus = redeemCardSet(state, userId, cardIds);
        state.draft_units_remaining += bonus;
        socket.emit('game:cards_redeemed', { bonus });
        broadcastState(io, gameId, state);
      } catch (err: unknown) {
        socket.emit('error', { message: err instanceof Error ? err.message : 'Card redemption failed' });
      }
    });

    // ── Disconnect ──────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`[Socket] Disconnected: ${userId} (${socket.id})`);
      for (const [gameId, room] of activeGames.entries()) {
        room.connectedSockets.delete(socket.id);
      }
    });
  });

  return io;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function broadcastState(io: Server, gameId: string, state: GameState): void {
  const room = activeGames.get(gameId);
  if (!room) return;

  // Send filtered state to each connected socket
  if (room.connectedSockets.size > 0) {
    for (const [socketId, playerId] of room.connectedSockets.entries()) {
      const filteredState = buildClientState(state, playerId, state.settings.fog_of_war);
      io.to(socketId).emit('game:state', filteredState);
    }
  } else {
    // Fallback: no tracked sockets (e.g. right after start); broadcast to whole room
    io.to(gameId).emit('game:state', buildClientState(state, null, false));
  }
  io.to(gameId).emit('game:state_public', buildClientState(state, null, false));
}

function buildClientState(state: GameState, playerId: string | null, fogOfWar: boolean): GameState {
  if (!fogOfWar || !playerId) return state;

  // Build visible territory set
  const visibleIds = new Set<string>();
  for (const [tid, tState] of Object.entries(state.territories)) {
    if (tState.owner_id === playerId) visibleIds.add(tid);
  }

  // Add adjacent territories
  const filtered = { ...state, territories: { ...state.territories } };
  for (const [tid, tState] of Object.entries(state.territories)) {
    if (!visibleIds.has(tid)) {
      filtered.territories[tid] = { ...tState, unit_count: -1 }; // -1 = hidden
    }
  }

  // Hide other players' cards
  filtered.players = state.players.map((p) =>
    p.player_id === playerId ? p : { ...p, cards: [] }
  );

  return filtered;
}

async function saveGameState(gameId: string, state: GameState): Promise<void> {
  try {
    await query(
      'INSERT INTO game_states (game_id, turn_number, state_json) VALUES ($1, $2, $3)',
      [gameId, state.turn_number, JSON.stringify(state)]
    );
  } catch (err) {
    console.error('[Socket] Failed to save game state:', err);
  }
}

async function finalizeGame(io: Server, gameId: string, state: GameState, winnerId: string): Promise<void> {
  try {
    await query('UPDATE games SET status = $1, ended_at = NOW(), winner_id = $2 WHERE game_id = $3', [
      'completed', winnerId, gameId,
    ]);
    await saveGameState(gameId, state);
    io.to(gameId).emit('game:over', { winner_id: winnerId });
    activeGames.delete(gameId);
  } catch (err) {
    console.error('[Socket] Failed to finalize game:', err);
  }
}

async function processAiTurn(io: Server, gameId: string): Promise<void> {
  const room = activeGames.get(gameId);
  if (!room) return;
  const { state, map } = room;

  const currentPlayer = state.players[state.current_player_index];
  if (!currentPlayer.is_ai) return;

  const difficulty = currentPlayer.ai_difficulty ?? 'medium';
  const actions = computeAiTurn(state, map, difficulty);

  for (const action of actions) {
    await new Promise((resolve) => setTimeout(resolve, 600)); // Simulate thinking delay

    if (action.type === 'draft' && action.to && action.units) {
      const t = state.territories[action.to];
      const clamped = Math.min(action.units, state.draft_units_remaining);
      if (t && t.owner_id === currentPlayer.player_id && clamped > 0) {
        t.unit_count += clamped;
        state.draft_units_remaining -= clamped;
      }
    } else if (action.type === 'attack' && action.from && action.to) {
      const from = state.territories[action.from];
      const to = state.territories[action.to];
      if (from && to && from.unit_count >= 2) {
        const result = resolveCombat(from.unit_count, to.unit_count);
        from.unit_count -= result.attacker_losses;
        to.unit_count -= result.defender_losses;
        if (result.territory_captured) {
          to.owner_id = currentPlayer.player_id;
          to.unit_count = Math.min(from.unit_count - 1, 3);
          from.unit_count = Math.max(1, from.unit_count - to.unit_count);
          drawCard(state, currentPlayer.player_id);
        }
        syncTerritoryCounts(state);
        io.to(gameId).emit('game:combat_result', { fromId: action.from, toId: action.to, result });
      }
    } else if (action.type === 'fortify' && action.from && action.to && action.units) {
      const from = state.territories[action.from];
      const to = state.territories[action.to];
      if (from && to && from.unit_count > action.units) {
        from.unit_count -= action.units;
        to.unit_count += action.units;
      }
    } else if (action.type === 'end_phase') {
      if (state.phase === 'draft') {
        state.draft_units_remaining = 0;
        state.phase = 'attack';
      } else if (state.phase === 'attack') {
        state.phase = 'fortify';
      } else if (state.phase === 'fortify') {
        advanceToNextPlayer(state, map);
        await saveGameState(gameId, state);
      }
    }

    broadcastState(io, gameId, state);

    const winnerId = checkVictory(state);
    if (winnerId) {
      state.phase = 'game_over';
      state.winner_id = winnerId;
      await finalizeGame(io, gameId, state, winnerId);
      return;
    }
  }

  // If next player is also AI, chain
  if (state.players[state.current_player_index].is_ai) {
    setTimeout(() => processAiTurn(io, gameId), 1000);
  }
}

function pathExists(
  fromId: string,
  toId: string,
  state: GameState,
  map: GameMap,
  ownerId: string
): boolean {
  const adj: Record<string, string[]> = {};
  for (const conn of map.connections) {
    if (!adj[conn.from]) adj[conn.from] = [];
    if (!adj[conn.to]) adj[conn.to] = [];
    adj[conn.from].push(conn.to);
    adj[conn.to].push(conn.from);
  }

  const visited = new Set<string>();
  const queue = [fromId];
  visited.add(fromId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === toId) return true;
    for (const neighbor of (adj[current] ?? [])) {
      if (!visited.has(neighbor) && state.territories[neighbor]?.owner_id === ownerId) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return false;
}
