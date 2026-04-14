import type { Server as HttpServer } from 'http';
import * as fs from 'fs';
import * as path from 'path';
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
  findRedeemableCardIds,
  syncTerritoryCounts,
  calculateContinentBonuses,
  appendWinProbabilitySnapshot,
  repairDraftUnitsIfMissing,
  autoPlaceDraftUnits,
  repairLegacyGameState,
} from '../game-engine/state/gameStateManager';
import { resolveCombat, calculateReinforcements } from '../game-engine/combat/combatResolver';
import {
  validateBuild,
  applyBuild,
  getBuildingDefenseBonus,
  onTerritoryCapture,
} from '../game-engine/state/economyManager';
import { validateResearch, applyResearch, getPlayerAttackBonus, getPlayerDefenseBonus } from '../game-engine/state/techManager';
import { getWonderDefenseBonus, getWonderSeaAttackDice, getWonderInfluenceRange } from '../game-engine/state/wonderManager';
import { getTechNodeById, getEraFactions, getEraTechTree } from '../game-engine/eras';
import { resolveEventChoice, getTemporaryModifierValue } from '../game-engine/events/eventCardManager';
import { moveFleets, resolveNavalCombat } from '../game-engine/state/navalManager';
import { onCaptureStabilityPenalty, onInfluenceStabilityPenalty } from '../game-engine/state/stabilityManager';
import type { BuildingType } from '../types';
import { runAiWithTimeout } from '../game-engine/ai/runAiWithTimeout';
import { selectAiBuildingPlacement, selectAiTechResearch } from '../game-engine/ai/aiBot';
import { recordGameResults, computeRanks } from '../game-engine/state/statsManager';
import { checkAndUnlockAchievements } from '../game-engine/achievements/achievementService';
import { pgPool } from '../db/postgres';
import { INITIAL_MU, INITIAL_PHI } from '../game-engine/rating/ratingService';
import { getTutorialMap } from '../game-engine/tutorial/tutorialScript';
import type { GameState, GameMap, AiDifficulty } from '../types';
import { config } from '../config';
import {
  scheduleAsyncDeadline,
  cancelAsyncDeadline,
  setDeadlineProcessor,
} from '../workers/asyncDeadlineWorker';
import { notifyTurnChange } from '../services/notificationService';

function loadMapFromDoc(mapDoc: any): GameMap {
  return {
    map_id: mapDoc.map_id,
    name: mapDoc.name,
    territories: mapDoc.territories,
    connections: mapDoc.connections,
    regions: mapDoc.regions,
    canvas_width: mapDoc.canvas_width,
    canvas_height: mapDoc.canvas_height,
    projection_bounds: mapDoc.projection_bounds,
    globe_view: mapDoc.globe_view,
  };
}

async function resolveMap(mapId: string): Promise<GameMap | null> {
  if (mapId === 'tutorial') return getTutorialMap();
  const mapDoc = await CustomMap.findOne({ map_id: mapId }).lean();
  if (mapDoc) return loadMapFromDoc(mapDoc);

  // Fallback: load from static JSON files in database/maps/
  const jsonPath = path.resolve(__dirname, '../../../database/maps', `${mapId}.json`);
  if (fs.existsSync(jsonPath)) {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    return loadMapFromDoc(data);
  }
  return null;
}

// In-memory store: gameId → { state, map, connectedSockets }
const activeGames = new Map<string, {
  state: GameState;
  map: GameMap;
  connectedSockets: Map<string, string>; // socketId → playerId
}>();

function isUnclaimedOwner(ownerId: string | null | undefined): boolean {
  return ownerId == null || ownerId === '' || ownerId === 'neutral';
}

// Turn timer enforcement: gameId → timeout handle
const turnTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Prevent overlapping AI turns: gameId → true while processAiTurn is running
const aiInFlight = new Set<string>();

let gameIoSingleton: Server | null = null;

/** For HTTP handlers (invites, etc.) that need to emit to user rooms. */
export function getGameIo(): Server | null {
  return gameIoSingleton;
}

export function initGameSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: config.corsOrigins.length === 1 ? config.corsOrigins[0] : config.corsOrigins,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // ── Register async deadline processor ───────────────────────────────────
  setDeadlineProcessor(async (job) => {
    const { gameId, turnNumber, playerIndex } = job.data;
    let room = activeGames.get(gameId);

    // Re-hydrate game from DB if evicted
    if (!room) {
      const game = await queryOne<{ map_id: string; status: string }>(
        'SELECT map_id, status FROM games WHERE game_id = $1',
        [gameId],
      );
      if (!game || game.status !== 'in_progress') return;
      const saved = await queryOne<{ state_json: GameState }>(
        'SELECT state_json FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1',
        [gameId],
      );
      if (!saved) return;
      const gameMap = await resolveMap(game.map_id);
      if (!gameMap) return;
      repairDraftUnitsIfMissing(saved.state_json, gameMap);
      repairLegacyGameState(saved.state_json, gameMap);
      activeGames.set(gameId, { state: saved.state_json, map: gameMap, connectedSockets: new Map() });
      room = activeGames.get(gameId)!;
    }

    const { state, map } = room;

    // Stale-job guard: only process if turn/player still match
    if (state.phase === 'game_over') return;
    if (state.turn_number !== turnNumber || state.current_player_index !== playerIndex) return;

    // Auto-place draft units
    const placed = autoPlaceDraftUnits(state);
    if (placed > 0) {
      broadcastState(io, gameId, state);
      io.to(gameId).emit('game:turn_timeout', { appliedDraft: true, unitsPlaced: placed });
    }

    advanceToNextPlayer(state, map);
    await saveGameState(gameId, state);
    broadcastEventCard(io, gameId, state, map);
    broadcastState(io, gameId, state);

    // Schedule next deadline or trigger AI
    if (!state.active_event?.choices?.length) {
      startTurnTimer(io, gameId, state, map);
    }
    if (state.players[state.current_player_index].is_ai) {
      setTimeout(() => processAiTurn(io, gameId), 1500);
    }
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
    socket.join(`user:${userId}`);

    // ── Join Game Room ──────────────────────────────────────────────────────
    socket.on('game:join', async ({ gameId }: { gameId: string }) => {
      try {
        const game = await queryOne<{
          game_id: string;
          era_id: string;
          map_id: string;
          status: string;
          settings_json: string | Record<string, unknown>;
          join_code: string | null;
        }>(
          'SELECT game_id, era_id, map_id, status, settings_json, join_code FROM games WHERE game_id = $1',
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

        if (game.status === 'waiting') {
          let settingsParsed: Record<string, unknown> = {};
          try {
            const sj = game.settings_json;
            settingsParsed =
              typeof sj === 'string' ? (JSON.parse(sj) as Record<string, unknown>) : (sj as Record<string, unknown>) ?? {};
          } catch {
            settingsParsed = {};
          }
          io.to(gameId).emit('game:lobby_updated', {
            game_id: game.game_id,
            era_id: game.era_id,
            map_id: game.map_id,
            status: game.status,
            join_code: game.join_code ?? null,
            settings_json: settingsParsed,
            players: players.map((p) => ({
              player_index: p.player_index,
              user_id: p.user_id,
              username: p.username,
              player_color: p.player_color,
              is_ai: p.is_ai,
              ai_difficulty: p.ai_difficulty,
              is_eliminated: p.is_eliminated,
              final_rank: null as number | null,
            })),
          });
        }

        // Initialize game state if not already active
        if (!activeGames.has(gameId) && game.status === 'in_progress') {
          // Load last saved state from DB
          const savedState = await queryOne<{ state_json: GameState }>(
            `SELECT state_json FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1`,
            [gameId]
          );

          if (savedState) {
            const gameMap = await resolveMap(game.map_id);
            if (!gameMap) {
              console.error(`[Socket] MAP_LOAD_FAILED: game=${gameId} map_id=${game.map_id}`);
              return socket.emit('error', { message: 'Map unavailable; the game cannot be resumed right now', code: 'MAP_LOAD_FAILED' });
            }
            repairDraftUnitsIfMissing(savedState.state_json, gameMap);
            repairLegacyGameState(savedState.state_json, gameMap);
            activeGames.set(gameId, {
              state: savedState.state_json,
              map: gameMap,
              connectedSockets: new Map(),
            });
          }
        }

        const room = activeGames.get(gameId);
        if (room) {
          room.connectedSockets.set(socket.id, userId);
          socket.emit('game:state', buildClientState(room.state, userId, room.state.settings.fog_of_war));

          // Re-broadcast any pending choice-based event card so reconnecting players see the modal
          if (room.state.active_event?.choices?.length) {
            socket.emit('game:event_card', room.state.active_event);
          }

          // Resume AI turn if it's an AI's turn and no AI processing is already in-flight
          const currentAiPlayer = room.state.players[room.state.current_player_index];
          if (currentAiPlayer?.is_ai && room.state.phase !== 'game_over' && !aiInFlight.has(gameId)) {
            if (room.state.phase === 'territory_select') {
              setTimeout(() => processAiTerritorySelect(io, gameId), 800);
            } else {
              setTimeout(() => processAiTurn(io, gameId), 1500);
            }
          }

          // For async games, ensure the deadline job is still scheduled (may be lost on server restart)
          if (room.state.settings.async_mode && room.state.phase !== 'game_over' && !currentAiPlayer?.is_ai) {
            import('../workers/asyncDeadlineWorker').then(({ asyncDeadlineQueue }) => {
              const jobId = `deadline:${gameId}:${room!.state.turn_number}`;
              asyncDeadlineQueue.getJob(jobId).then((job) => {
                if (!job) {
                  // Re-schedule from DB deadline
                  queryOne<{ async_turn_deadline: Date | null }>(
                    'SELECT async_turn_deadline FROM games WHERE game_id = $1',
                    [gameId],
                  ).then((g) => {
                    if (g?.async_turn_deadline) {
                      const remainingSec = Math.max(10, Math.floor((new Date(g.async_turn_deadline).getTime() - Date.now()) / 1000));
                      scheduleAsyncDeadline(gameId, room!.state.turn_number, room!.state.current_player_index, remainingSec)
                        .catch(() => {});
                    }
                  }).catch(() => {});
                }
              }).catch(() => {});
            }).catch(() => {});
          }
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
        if (!game) {
          return socket.emit('error', { message: 'Game not found' });
        }

        // Already in progress: host (or client) clicked Start after reconnect; DB says started but UI may not have received game:started
        if (game.status === 'in_progress') {
          let room = activeGames.get(gameId);
          if (!room) {
            const savedState = await queryOne<{ state_json: GameState }>(
              `SELECT state_json FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1`,
              [gameId]
            );
            if (!savedState) {
              return socket.emit('error', { message: 'Game state not found' });
            }
            const gameMap = await resolveMap(game.map_id);
            if (!gameMap) {
              console.error(`[Socket] MAP_LOAD_FAILED: game=${gameId} map_id=${game.map_id}`);
              return socket.emit('error', { message: 'Map unavailable; the game cannot be resumed right now', code: 'MAP_LOAD_FAILED' });
            }
            repairDraftUnitsIfMissing(savedState.state_json, gameMap);
            repairLegacyGameState(savedState.state_json, gameMap);
            activeGames.set(gameId, {
              state: savedState.state_json,
              map: gameMap,
              connectedSockets: new Map(),
            });
            room = activeGames.get(gameId);
          }
          if (!room) return socket.emit('error', { message: 'Failed to resume game' });
          room.connectedSockets.set(socket.id, userId);
          socket.emit('game:started', { gameId });
          socket.emit('game:state', buildClientState(room.state, userId, room.state.settings.fog_of_war));
          return;
        }

        if (game.status !== 'waiting') {
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

        // Load map (tutorial maps are hardcoded; others from Mongo)
        const gameMap = await resolveMap(game.map_id);
        if (!gameMap) return socket.emit('error', { message: 'Map not found' });

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
          const ext = s as unknown as { id: string; userId?: string };
          if (ext.userId) {
            connectedSockets.set(ext.id, ext.userId);
          }
        }

        activeGames.set(gameId, { state, map: gameMap, connectedSockets });

        // Compute game_type based on actual player composition at start
        const humanCount = players.filter((p) => !p.is_ai).length;
        const aiPlayerCount = players.filter((p) => p.is_ai).length;
        const gameType = aiPlayerCount === 0 ? 'multiplayer' : humanCount <= 1 ? 'solo' : 'hybrid';

        // Update DB
        await query('UPDATE games SET status = $1, started_at = NOW(), game_type = $2 WHERE game_id = $3', ['in_progress', gameType, gameId]);
        await saveGameState(gameId, state);

        io.to(gameId).emit('game:started', { gameId });
        broadcastState(io, gameId, state);

        // If first player is AI, trigger AI turn (or AI territory select); otherwise start turn timer
        if (state.players[state.current_player_index].is_ai) {
          if (state.phase === 'territory_select') {
            setTimeout(() => processAiTerritorySelect(io, gameId), 800);
          } else {
            setTimeout(() => processAiTurn(io, gameId), 1500);
          }
        } else {
          startTurnTimer(io, gameId, state, gameMap);
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
      scheduleDebouncedSave(gameId);
    });

    // ── Territory Selection (territory draft mode) ────────────────────────
    socket.on('game:select_territory', ({ gameId, territoryId }: { gameId: string; territoryId: string }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      const { state, map } = room;

      if (state.phase !== 'territory_select') return socket.emit('error', { message: 'Not in territory selection phase' });
      const currentPlayer = state.players[state.current_player_index];
      if (currentPlayer.player_id !== userId) return socket.emit('error', { message: 'Not your turn' });

      const territory = state.territories[territoryId];
      if (!territory) return socket.emit('error', { message: 'Territory not found' });
      if (!isUnclaimedOwner(territory.owner_id)) return socket.emit('error', { message: 'Territory already claimed' });

      // Claim the territory
      territory.owner_id = userId;
      territory.unit_count = state.settings.initial_unit_count;
      currentPlayer.territory_count = Object.values(state.territories).filter((t) => t.owner_id === userId).length;

      // Advance to next player (round-robin, skip eliminated)
      const total = state.players.length;
      let next = (state.current_player_index + 1) % total;
      let attempts = 0;
      while (state.players[next].is_eliminated && attempts < total) {
        next = (next + 1) % total;
        attempts++;
      }
      state.current_player_index = next;
      state.turn_started_at = Date.now();

      // Check if all territories are claimed
      const unclaimed = Object.values(state.territories).filter((t) => isUnclaimedOwner(t.owner_id)).length;
      if (unclaimed === 0) {
        // Transition to draft phase
        state.phase = 'draft';
        state.current_player_index = 0;
        state.turn_number = 1;
        state.turn_started_at = Date.now();
        const firstPlayer = state.players[0];
        const bonus = calculateContinentBonuses(state, map, firstPlayer.player_id);
        state.draft_units_remaining = calculateReinforcements(
          firstPlayer.territory_count,
          bonus,
          state.players.length,
        );
      }

      broadcastState(io, gameId, state);
      scheduleDebouncedSave(gameId);

      // If next player is AI and still in territory_select, trigger AI pick
      const nextPlayer = state.players[state.current_player_index];
      if (nextPlayer.is_ai && state.phase === 'territory_select') {
        setTimeout(() => processAiTerritorySelect(io, gameId), 800);
      } else if (nextPlayer.is_ai && state.phase === 'draft') {
        setTimeout(() => processAiTurn(io, gameId), 1500);
      } else if (!nextPlayer.is_ai && state.phase === 'draft') {
        startTurnTimer(io, gameId, state, map);
      }
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

      // Enforce active truce — block attacking a player the current player has a truce with
      const defenderPlayer = state.players.find((p) => p.player_id === toTerritory.owner_id);
      if (defenderPlayer) {
        const truceEntry = state.diplomacy.find(
          (d) =>
            (d.player_index_a === currentPlayer.player_index && d.player_index_b === defenderPlayer.player_index) ||
            (d.player_index_a === defenderPlayer.player_index && d.player_index_b === currentPlayer.player_index),
        );
        if (truceEntry?.status === 'truce' && truceEntry.truce_turns_remaining > 0) {
          return socket.emit('error', { message: 'You have an active truce with this player' });
        }
      }

      // Track most-recently-attacked opponent for event card truce targeting
      if (toTerritory.owner_id) {
        currentPlayer.last_attacked_player_id = toTerritory.owner_id;
      }

      // Determine attack dice count
      // Modern era precision strike: 3 dice when attacker has ≥3 units committed
      const precisionDiceOverride =
        state.era_modifiers?.precision_strike && fromTerritory.unit_count >= 4
          ? 3
          : undefined;

      // Discovery era sea lanes: check if the connection is a sea lane — if so, attacker gets only 2 dice
      // (unless the attacker owns the Lighthouse wonder, which grants 3 sea-attack dice)
      const connection = map.connections.find(
        (c) => (c.from === fromId && c.to === toId) || (c.from === toId && c.to === fromId)
      );
      const wonderSeaDice = state.settings.economy_enabled && connection?.type === 'sea'
        ? getWonderSeaAttackDice(state, userId)
        : 0;
      const seaLanesOverride =
        state.era_modifiers?.sea_lanes && connection?.type === 'sea'
          ? Math.min(fromTerritory.unit_count - 1, wonderSeaDice > 0 ? wonderSeaDice : 2)
          : undefined;

      // Naval warfare: sea-lane attacks require fleets when naval_enabled
      if (state.settings.naval_enabled && connection?.type === 'sea') {
        if (!fromTerritory.naval_units || fromTerritory.naval_units <= 0) {
          return socket.emit('error', { message: 'No fleet to traverse sea lane' });
        }
        const defenderFleets = toTerritory.naval_units ?? 0;
        if (defenderFleets > 0) {
          // Resolve naval combat first
          const navalResult = resolveNavalCombat(fromTerritory.naval_units, defenderFleets);
          fromTerritory.naval_units = Math.max(0, fromTerritory.naval_units - navalResult.attacker_losses);
          toTerritory.naval_units = Math.max(0, defenderFleets - navalResult.defender_losses);
          io.to(gameId).emit('game:naval_combat_result', {
            fromId, toId,
            result: navalResult,
          });
          if (!navalResult.attacker_won) {
            // Naval defeat — abort land attack
            broadcastState(io, gameId, state);
            scheduleDebouncedSave(gameId);
            return;
          }
        }
        // Attacker won naval combat or no defenders — consume 1 fleet for the crossing
        fromTerritory.naval_units = Math.max(0, fromTerritory.naval_units - 1);
      }

      const attackerDiceOverride = precisionDiceOverride ?? seaLanesOverride;

      // Economy: building defense bonus + tech tree passive defense bonus + faction passive defense
      const buildingDefenseBonus = getBuildingDefenseBonus(state, toId);
      const techDefenseBonus = state.settings.tech_trees_enabled
        ? getPlayerDefenseBonus(state, toTerritory.owner_id ?? '')
        : 0;
      const defenderFaction = state.settings.factions_enabled
        ? (() => {
            const dp = state.players.find((p) => p.player_id === toTerritory.owner_id);
            return dp?.faction_id ? getEraFactions(state.era).find((f) => f.faction_id === dp.faction_id) : undefined;
          })()
        : undefined;
      const factionDefenseBonus = defenderFaction?.passive_defense_bonus ?? 0;
      const eventDefenseBonus = state.settings.events_enabled && toTerritory.owner_id
        ? getTemporaryModifierValue(state, toTerritory.owner_id, 'defense_modifier')
        : 0;
      const wonderDefenseBonus = state.settings.economy_enabled
        ? getWonderDefenseBonus(state, toTerritory.owner_id ?? '')
        : 0;
      const totalDefenseBonus = buildingDefenseBonus + techDefenseBonus + factionDefenseBonus + eventDefenseBonus + wonderDefenseBonus;
      const defenderDiceOverride = totalDefenseBonus > 0
        ? Math.min(toTerritory.unit_count, 2) + totalDefenseBonus
        : undefined;

      // Tech tree passive attack bonus + faction passive attack bonus
      const techAttackBonus = state.settings.tech_trees_enabled
        ? getPlayerAttackBonus(state, userId)
        : 0;
      const attackerFaction = state.settings.factions_enabled && currentPlayer.faction_id
        ? getEraFactions(state.era).find((f) => f.faction_id === currentPlayer.faction_id)
        : undefined;
      const factionAttackBonus = attackerFaction?.passive_attack_bonus ?? 0;
      const eventAttackBonus = state.settings.events_enabled
        ? getTemporaryModifierValue(state, userId, 'attack_modifier')
        : 0;
      const combinedAttackBonus = techAttackBonus + factionAttackBonus + eventAttackBonus;
      const finalAttackerDiceOverride = attackerDiceOverride !== undefined
        ? attackerDiceOverride + combinedAttackBonus
        : combinedAttackBonus > 0
          ? Math.min(fromTerritory.unit_count - 1, 3) + combinedAttackBonus
          : undefined;

      const result = resolveCombat(
      fromTerritory.unit_count,
      toTerritory.unit_count,
      finalAttackerDiceOverride,
      defenderDiceOverride,
      undefined,
      state.era_modifiers,
    );

      fromTerritory.unit_count -= result.attacker_losses;
      toTerritory.unit_count -= result.defender_losses;

      let cardEarned = false;
      let defenderEliminated = false;
      const defenderId = toTerritory.owner_id;
      if (result.territory_captured) {
        toTerritory.owner_id = userId;
        toTerritory.unit_count = Math.min(fromTerritory.unit_count - 1, 3);
        fromTerritory.unit_count = Math.max(1, fromTerritory.unit_count - toTerritory.unit_count);
        cardEarned = true;
        // Raze buildings on capture
        onTerritoryCapture(state, toId);
        // Stability penalty on captured territory
        if (state.settings.stability_enabled) {
          onCaptureStabilityPenalty(state, toId);
        }
        // Track for blitzkrieg achievement
        const capturingPlayer = state.players.find((p) => p.player_id === userId);
        if (capturingPlayer) {
          capturingPlayer.territories_captured_this_turn = (capturingPlayer.territories_captured_this_turn ?? 0) + 1;
          if ((capturingPlayer.territories_captured_this_turn) > (capturingPlayer.territories_captured_turn_max ?? 0)) {
            capturingPlayer.territories_captured_turn_max = capturingPlayer.territories_captured_this_turn;
          }
        }

        const defenderPlayer = state.players.find((p) => p.player_id === defenderId);
        if (defenderPlayer) {
          syncTerritoryCounts(state);
          if (defenderPlayer.territory_count === 0) {
            defenderPlayer.is_eliminated = true;
            defenderEliminated = true;
            currentPlayer.cards.push(...defenderPlayer.cards);
            defenderPlayer.cards = [];
            io.to(gameId).emit('game:player_eliminated', {
              playerId: defenderId,
              eliminatorId: userId,
              eliminatorName: currentPlayer.username,
              eliminatedName: defenderPlayer.username,
            });
          }
        }
      }

      if (cardEarned) drawCard(state, userId);

      // Check victory
      const victoryResult = checkVictory(state, map);
      if (victoryResult) {
        const { winnerIds, condition } = victoryResult;
        const winnerId = winnerIds[0]!;
        state.phase = 'game_over';
        state.winner_id = winnerId;
        state.winner_ids = winnerIds;
        state.victory_condition = condition;
        finalizeGame(io, gameId, state, winnerIds);
      } else if (defenderEliminated) {
        appendWinProbabilitySnapshot(state);
      }

      io.to(gameId).emit('game:combat_result', { fromId, toId, result });
      broadcastState(io, gameId, state);
      scheduleDebouncedSave(gameId);
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
        broadcastEventCard(io, gameId, state, map);

        // Trigger AI if next player is AI; otherwise restart turn timer
        if (state.players[state.current_player_index].is_ai) {
          clearTurnTimer(gameId, state);
          setTimeout(() => processAiTurn(io, gameId), 1500);
        } else if (!state.active_event?.choices?.length) {
          // Don't start timer while a choice-based event awaits resolution
          startTurnTimer(io, gameId, state, map);
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

      // Enforce fortify move limit (wartime_logistics allows 2 per turn, otherwise 1)
      const fortifyMoveLimit = state.era_modifiers?.wartime_logistics ? 2 : 1;
      const movesUsed = state.fortify_moves_used ?? 0;
      if (movesUsed >= fortifyMoveLimit) {
        return socket.emit('error', { message: `Fortify limit reached (${fortifyMoveLimit} moves per turn)` });
      }

      from.unit_count -= units;
      to.unit_count += units;
      state.fortify_moves_used = movesUsed + 1;
      broadcastState(io, gameId, state);
      scheduleDebouncedSave(gameId);
    });

    // ── Redeem Cards ────────────────────────────────────────────────────────
    socket.on('game:redeem_cards', ({ gameId, cardIds }: { gameId: string; cardIds: string[] }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      const { state } = room;

      const currentPlayer = state.players[state.current_player_index];
      if (currentPlayer.player_id !== userId) return socket.emit('error', { message: 'Not your turn' });
      if (state.phase !== 'draft') return socket.emit('error', { message: 'Cards can only be redeemed during the draft phase' });

      try {
        const bonus = redeemCardSet(state, userId, cardIds);
        state.draft_units_remaining += bonus;
        currentPlayer.cards_redeemed_count = (currentPlayer.cards_redeemed_count ?? 0) + 1;
        socket.emit('game:cards_redeemed', { bonus });
        broadcastState(io, gameId, state);
        scheduleDebouncedSave(gameId);
      } catch (err: unknown) {
        socket.emit('error', { message: err instanceof Error ? err.message : 'Card redemption failed' });
      }
    });

    // ── Build (Economy) ──────────────────────────────────────────────────────
    socket.on('game:build', ({ gameId, territoryId, buildingType }: {
      gameId: string; territoryId: string; buildingType: BuildingType;
    }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      const { state } = room;

      const currentPlayer = state.players[state.current_player_index];
      if (currentPlayer.player_id !== userId) return socket.emit('error', { message: 'Not your turn' });
      // Allow building in draft OR fortify phase so players have flexibility
      if (state.phase !== 'draft' && state.phase !== 'fortify') {
        return socket.emit('error', { message: 'Buildings can only be constructed during draft or fortify phase' });
      }

      // Check whether the building type is unlocked via tech tree (if enabled)
      const unlockedTechs = currentPlayer.unlocked_techs ?? [];
      let techUnlocked = true;
      if (state.settings.tech_trees_enabled) {
        const techTree = getEraTechTree(state.era);
        const requiringNode = techTree.find((node) => node.unlocks_building === buildingType);
        if (requiringNode) {
          techUnlocked = unlockedTechs.includes(requiringNode.tech_id);
        }
      }

      const validation = validateBuild(state, userId, territoryId, buildingType, techUnlocked);
      if (!validation.valid) {
        return socket.emit('error', { message: validation.error ?? 'Cannot build here' });
      }

      applyBuild(state, userId, territoryId, buildingType);
      socket.emit('game:build_result', { territoryId, buildingType, success: true });
      // Announce wonder construction to the whole room
      if (buildingType.startsWith('wonder_')) {
        io.to(gameId).emit('game:wonder_built', {
          wonderId: buildingType,
          builderName: currentPlayer.username,
          builderColor: currentPlayer.color,
          territoryId,
        });
      }
      broadcastState(io, gameId, state);
      scheduleDebouncedSave(gameId);
    });

    // ── Naval Move (relocate fleets between own coastal territories) ─────────
    socket.on('game:naval_move', ({ gameId, fromId, toId, count }: {
      gameId: string; fromId: string; toId: string; count: number;
    }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      const { state, map } = room;

      if (!state.settings.naval_enabled) return socket.emit('error', { message: 'Naval warfare not enabled' });
      const currentPlayer = state.players[state.current_player_index];
      if (currentPlayer.player_id !== userId) return socket.emit('error', { message: 'Not your turn' });
      if (state.phase !== 'attack' && state.phase !== 'fortify') {
        return socket.emit('error', { message: 'Fleets can only move during attack or fortify phase' });
      }

      const result = moveFleets(state, fromId, toId, count, map, userId);
      if (!result.success) return socket.emit('error', { message: result.error ?? 'Fleet move failed' });

      broadcastState(io, gameId, state);
      scheduleDebouncedSave(gameId);
    });

    // ── Naval Attack (standalone fleet combat / blockade) ────────────────────
    socket.on('game:naval_attack', ({ gameId, fromId, toId }: {
      gameId: string; fromId: string; toId: string;
    }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      const { state, map } = room;

      if (!state.settings.naval_enabled) return socket.emit('error', { message: 'Naval warfare not enabled' });
      const currentPlayer = state.players[state.current_player_index];
      if (currentPlayer.player_id !== userId) return socket.emit('error', { message: 'Not your turn' });
      if (state.phase !== 'attack') return socket.emit('error', { message: 'Not in attack phase' });

      const fromTerritory = state.territories[fromId];
      const toTerritory = state.territories[toId];
      if (!fromTerritory || fromTerritory.owner_id !== userId) {
        return socket.emit('error', { message: 'Invalid attacking territory' });
      }
      if (!toTerritory || toTerritory.owner_id === userId) {
        return socket.emit('error', { message: 'Invalid target territory' });
      }
      if (!fromTerritory.naval_units || fromTerritory.naval_units <= 0) {
        return socket.emit('error', { message: 'No fleets to attack with' });
      }
      if (toTerritory.naval_units == null) {
        return socket.emit('error', { message: 'Target is not a coastal territory' });
      }

      // Validate sea connection
      const seaConnected = map.connections.some(
        (c) => c.type === 'sea' && ((c.from === fromId && c.to === toId) || (c.from === toId && c.to === fromId)),
      );
      if (!seaConnected) return socket.emit('error', { message: 'No sea connection' });

      const navalResult = resolveNavalCombat(fromTerritory.naval_units, toTerritory.naval_units || 1);
      fromTerritory.naval_units = Math.max(0, fromTerritory.naval_units - navalResult.attacker_losses);
      toTerritory.naval_units = Math.max(0, (toTerritory.naval_units ?? 0) - navalResult.defender_losses);

      io.to(gameId).emit('game:naval_combat_result', { fromId, toId, result: navalResult });
      broadcastState(io, gameId, state);
      scheduleDebouncedSave(gameId);
    });

    // ── Research Tech ────────────────────────────────────────────────────────
    socket.on('game:research_tech', ({ gameId, techId }: { gameId: string; techId: string }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      const { state } = room;

      const currentPlayer = state.players[state.current_player_index];
      if (currentPlayer.player_id !== userId) return socket.emit('error', { message: 'Not your turn' });
      if (state.phase !== 'draft' && state.phase !== 'fortify') {
        return socket.emit('error', { message: 'Technology can only be researched during draft or fortify phase' });
      }

      const validation = validateResearch(state, userId, techId);
      if (!validation.valid) {
        return socket.emit('error', { message: validation.error ?? 'Cannot research this technology' });
      }

      applyResearch(state, userId, validation.node!);
      socket.emit('game:research_result', { techId, success: true, node: validation.node });
      broadcastState(io, gameId, state);
      scheduleDebouncedSave(gameId);
    });

    // ── Use Ability ──────────────────────────────────────────────────────────
    // Generic handler for once-per-turn faction/tech abilities not covered by
    // dedicated events (influence, blitzkrieg, etc.).
    socket.on('game:use_ability', ({ gameId, abilityId, params }: {
      gameId: string;
      abilityId: string;
      params?: Record<string, unknown>;
    }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      const { state, map } = room;

      const currentPlayer = state.players[state.current_player_index];
      if (currentPlayer.player_id !== userId) return socket.emit('error', { message: 'Not your turn' });

      // Check ability cooldown (once per turn) — skip for once-per-game abilities
      const GAME_SCOPED_ABILITIES = ['atom_bomb'];
      const isGameScoped = GAME_SCOPED_ABILITIES.includes(abilityId);
      const uses = currentPlayer.ability_uses ?? {};
      if (!isGameScoped && uses[abilityId]) {
        return socket.emit('error', { message: `Ability '${abilityId}' already used this turn` });
      }
      if (isGameScoped && (currentPlayer.used_game_abilities ?? []).includes(abilityId)) {
        return socket.emit('error', { message: `Ability '${abilityId}' has already been used this game` });
      }

      // Validate ability ownership — must come from faction or unlocked tech
      const faction = state.settings.factions_enabled && currentPlayer.faction_id
        ? getEraFactions(state.era).find((f) => f.faction_id === currentPlayer.faction_id)
        : undefined;
      const hasFactionAbility = faction?.ability_id === abilityId;

      const unlockedTechs = currentPlayer.unlocked_techs ?? [];
      const techTree = state.settings.tech_trees_enabled ? getEraTechTree(state.era) : [];
      const hasTechAbility = techTree.some(
        (n) => unlockedTechs.includes(n.tech_id) && n.unlocks_ability === abilityId
      );

      if (!hasFactionAbility && !hasTechAbility) {
        return socket.emit('error', { message: `Ability '${abilityId}' is not available to you` });
      }

      // Record turn-scoped use now; game-scoped uses are recorded inside each handler
      // only after all guards pass, so a failed validation doesn't consume the ability.
      if (!isGameScoped) {
        currentPlayer.ability_uses = { ...uses, [abilityId]: 1 };
      }

      // ── Ability: blitzkrieg (WW2 Germany) ──────────────────────────────────
      if (abilityId === 'blitzkrieg' || abilityId === 'double_blitz') {
        // Mark state so next captured territory allows a free bonus attack
        state.blitzkrieg_attacked = false; // reset — the flag means "bonus attack already fired"
        socket.emit('game:ability_result', { abilityId, success: true, effect: 'blitzkrieg_ready' });
        broadcastState(io, gameId, state);
        return;
      }

      // ── Ability: guerrilla_warfare (China WW2) — place 1 free unit ─────────
      if (abilityId === 'guerrilla_warfare') {
        const territoryId = params?.territoryId as string;
        if (!territoryId) return socket.emit('error', { message: 'Provide territoryId' });
        const t = state.territories[territoryId];
        if (!t || t.owner_id !== userId) return socket.emit('error', { message: 'Invalid territory' });
        t.unit_count += 1;
        syncTerritoryCounts(state);
        socket.emit('game:ability_result', { abilityId, success: true, territoryId });
        broadcastState(io, gameId, state);
        scheduleDebouncedSave(gameId);
        return;
      }

      // ── Ability: cyber_attack — remove 1 enemy unit ────────────────────────
      if (abilityId === 'cyber_attack') {
        const territoryId = params?.territoryId as string;
        if (!territoryId) return socket.emit('error', { message: 'Provide territoryId' });
        const t = state.territories[territoryId];
        if (!t || t.owner_id === userId) return socket.emit('error', { message: 'Invalid enemy territory' });
        // Verify adjacency
        const isAdj = map.connections.some(
          (c) => (c.from === territoryId && Object.keys(state.territories).some(
            (tid) => tid === c.to && state.territories[tid]?.owner_id === userId
          )) || (c.to === territoryId && Object.keys(state.territories).some(
            (tid) => tid === c.from && state.territories[tid]?.owner_id === userId
          ))
        );
        if (!isAdj) return socket.emit('error', { message: 'Territory not adjacent to any of your territories' });
        t.unit_count = Math.max(1, t.unit_count - 1);
        socket.emit('game:ability_result', { abilityId, success: true, territoryId });
        broadcastState(io, gameId, state);
        scheduleDebouncedSave(gameId);
        return;
      }

      // ── Ability: atom_bomb — once per game, devastate a territory ──────────
      // Instantly eliminates all units in the target territory, leaving it
      // unowned with 1 unit. Phase must be attack.
      if (abilityId === 'atom_bomb') {
        if (state.phase !== 'attack') {
          return socket.emit('error', { message: 'Atom bomb can only be used during the attack phase' });
        }
        const targetId = params?.territoryId as string | undefined;
        if (!targetId) return socket.emit('error', { message: 'Provide params.territoryId' });
        const target = state.territories[targetId];
        if (!target) return socket.emit('error', { message: 'Invalid territory' });
        if (target.owner_id === userId) return socket.emit('error', { message: 'Cannot bomb your own territory' });

        // Record the once-per-game use here — after all guards have passed
        currentPlayer.used_game_abilities = [...(currentPlayer.used_game_abilities ?? []), abilityId];

        const previousOwner = target.owner_id;
        const previousUnits = target.unit_count;

        // Devastate: leave neutral with 1 unit, destroy all buildings
        target.owner_id = null;
        target.unit_count = 1;
        target.buildings = [];
        target.naval_units = 0;
        if (target.stability != null) target.stability = 0;

        syncTerritoryCounts(state);

        // Eliminate owner if they run out of territories
        if (previousOwner) {
          const prevPlayer = state.players.find((p) => p.player_id === previousOwner);
          if (prevPlayer && prevPlayer.territory_count === 0) {
            prevPlayer.is_eliminated = true;
            currentPlayer.cards.push(...prevPlayer.cards);
            prevPlayer.cards = [];
            io.to(gameId).emit('game:player_eliminated', {
              playerId: previousOwner,
              eliminatorId: userId,
              eliminatorName: currentPlayer.username,
              eliminatedName: prevPlayer.username,
            });
          }
        }

        socket.emit('game:ability_result', {
          abilityId,
          success: true,
          effect: 'atom_bomb_detonated',
          territoryId: targetId,
          previousOwner,
          previousUnits,
        });
        io.to(gameId).emit('game:atom_bomb', {
          attackerId: userId,
          attackerName: currentPlayer.username,
          attackerColor: currentPlayer.color,
          territoryId: targetId,
        });

        broadcastState(io, gameId, state);
        scheduleDebouncedSave(gameId);

        const atomBombVictoryResult = checkVictory(state, map);
        if (atomBombVictoryResult) {
          const { winnerIds, condition } = atomBombVictoryResult;
          const winnerId = winnerIds[0]!;
          state.phase = 'game_over';
          state.winner_id = winnerId;
          state.winner_ids = winnerIds;
          state.victory_condition = condition;
          finalizeGame(io, gameId, state, winnerIds);
        }
        return;
      }

      // Default: acknowledge but take no mechanical action (client-side visual only)
      socket.emit('game:ability_result', { abilityId, success: true });
      broadcastState(io, gameId, state);
    });

    // ── Influence (Cold War / Risorgimento era ability) ──────────────────────
    // Converts a neutral or enemy territory within influence_range hops of any
    // owned territory, costing 3 of the current player's units (spread across
    // adjacent owned territories). Only one use per turn.
    socket.on('game:influence', ({ gameId, targetId }: { gameId: string; targetId: string }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      const { state, map } = room;

      const currentPlayer = state.players[state.current_player_index];
      if (currentPlayer.player_id !== userId) return socket.emit('error', { message: 'Not your turn' });
      if (state.phase !== 'attack') return socket.emit('error', { message: 'Influence can only be used in the attack phase' });

      const modifiers = state.era_modifiers;
      const canInfluence = modifiers?.influence_spread || modifiers?.carbonari_network;
      if (!canInfluence) return socket.emit('error', { message: 'Influence ability not available this era' });

      const INFLUENCE_COOLDOWN_TURNS = 3;
      const INFLUENCE_MAX_TARGET_UNITS = 3;

      const cooldownRemaining = state.influence_cooldown_remaining ?? 0;
      if (cooldownRemaining > 0) {
        return socket.emit('error', { message: `Influence ability on cooldown (${cooldownRemaining} turn${cooldownRemaining > 1 ? 's' : ''} remaining)` });
      }

      const target = state.territories[targetId];
      if (!target) return socket.emit('error', { message: 'Invalid territory' });
      if (target.owner_id === userId) return socket.emit('error', { message: 'Cannot influence your own territory' });

      // BFS to check target is within influence_range hops from any owned territory
      const baseHopLimit = modifiers?.influence_range ?? 1;
      const wonderRangeBonus = state.settings.economy_enabled
        ? getWonderInfluenceRange(state, userId)
        : 0;
      const hopLimit = baseHopLimit + wonderRangeBonus;
      const adjacency: Record<string, string[]> = {};
      for (const conn of map.connections) {
        if (!adjacency[conn.from]) adjacency[conn.from] = [];
        if (!adjacency[conn.to]) adjacency[conn.to] = [];
        adjacency[conn.from].push(conn.to);
        adjacency[conn.to].push(conn.from);
      }

      const ownedSet = new Set(
        Object.entries(state.territories)
          .filter(([, t]) => t.owner_id === userId)
          .map(([id]) => id)
      );

      let reachable = false;
      const visited = new Set<string>(ownedSet);
      let frontier = [...ownedSet];
      for (let hop = 0; hop < hopLimit; hop++) {
        const next: string[] = [];
        for (const tid of frontier) {
          for (const nid of (adjacency[tid] ?? [])) {
            if (!visited.has(nid)) {
              visited.add(nid);
              next.push(nid);
              if (nid === targetId) { reachable = true; break; }
            }
          }
          if (reachable) break;
        }
        frontier = next;
        if (reachable) break;
      }

      if (!reachable) {
        return socket.emit('error', { message: 'Target territory not within influence range' });
      }

      // Garibaldi's Redshirts: free influence on neutral territories within 1 hop (exempt from cooldown & cost)
      const isGaribaldiUse =
        !!modifiers?.carbonari_network &&
        currentPlayer.unlocked_techs?.includes('riso_garibaldi') &&
        target.owner_id === null;

      if (isGaribaldiUse) {
        if ((currentPlayer.ability_uses?.['riso_garibaldi'] ?? 0) >= 1) {
          return socket.emit('error', { message: "Garibaldi's Redshirts already used this turn" });
        }
      } else {
        // Unit cap: cannot influence a well-defended territory
        if (target.unit_count > INFLUENCE_MAX_TARGET_UNITS) {
          return socket.emit('error', { message: `Influence can only seize territories with ≤${INFLUENCE_MAX_TARGET_UNITS} defending units` });
        }

        // Cost: player must have at least 3 total units to spare (1 in reserve)
        const totalUnits = Object.values(state.territories)
          .filter((t) => t.owner_id === userId)
          .reduce((sum, t) => sum + t.unit_count, 0);
        if (totalUnits < 4) {
          return socket.emit('error', { message: 'Not enough units to pay influence cost (need 3 spare)' });
        }

        // Deduct 3 units from the largest owned adjacent territory
        const adjacentOwned = (adjacency[targetId] ?? [])
          .filter((nid) => state.territories[nid]?.owner_id === userId)
          .sort((a, b) => (state.territories[b]?.unit_count ?? 0) - (state.territories[a]?.unit_count ?? 0));

        if (adjacentOwned.length === 0) {
          return socket.emit('error', { message: 'No adjacent owned territory to project influence from' });
        }

        let remaining = 3;
        for (const tid of adjacentOwned) {
          const t = state.territories[tid];
          if (!t) continue;
          const canSpend = Math.min(remaining, t.unit_count - 1);
          t.unit_count -= canSpend;
          remaining -= canSpend;
          if (remaining <= 0) break;
        }

        if (remaining > 0) {
          return socket.emit('error', { message: 'Not enough units in adjacent territories to pay influence cost' });
        }
      }

      const previousOwner = target.owner_id;
      target.owner_id = userId;
      target.unit_count = 1;
      if (isGaribaldiUse) {
        currentPlayer.ability_uses = { ...currentPlayer.ability_uses, riso_garibaldi: 1 };
      } else {
        state.influence_cooldown_remaining = INFLUENCE_COOLDOWN_TURNS;
      }

      // Stability penalty on influenced territory
      if (state.settings.stability_enabled) {
        onInfluenceStabilityPenalty(state, targetId);
      }

      syncTerritoryCounts(state);

      if (previousOwner) {
        const prevPlayer = state.players.find((p) => p.player_id === previousOwner);
        if (prevPlayer && prevPlayer.territory_count === 0) {
          prevPlayer.is_eliminated = true;
          currentPlayer.cards.push(...prevPlayer.cards);
          prevPlayer.cards = [];
          io.to(gameId).emit('game:player_eliminated', {
            playerId: previousOwner,
            eliminatorId: userId,
            eliminatorName: currentPlayer.username,
            eliminatedName: prevPlayer.username,
          });
        }
      }

      const influenceVictoryResult = checkVictory(state, map);
      if (influenceVictoryResult) {
        const { winnerIds, condition } = influenceVictoryResult;
        const winnerId = winnerIds[0]!;
        state.phase = 'game_over';
        state.winner_id = winnerId;
        state.winner_ids = winnerIds;
        state.victory_condition = condition;
        finalizeGame(io, gameId, state, winnerIds);
      } else {
        scheduleDebouncedSave(gameId);
      }

      socket.emit('game:influence_result', { targetId, previousOwner });
      broadcastState(io, gameId, state);
    });

    // ── Event Card Choice ───────────────────────────────────────────────────
    socket.on('game:event_choice', ({ gameId, choiceId }: { gameId: string; choiceId: string }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      const { state } = room;

      const currentPlayer = state.players[state.current_player_index];
      if (currentPlayer.player_id !== userId) return socket.emit('error', { message: 'Not your turn' });

      if (!state.active_event) return socket.emit('error', { message: 'No active event card' });
      if (!state.active_event.choices?.length) return socket.emit('error', { message: 'This event has no choices' });

      const ok = resolveEventChoice(state, state.active_event.card_id, choiceId);
      if (!ok) return socket.emit('error', { message: 'Invalid choice' });

      scheduleDebouncedSave(gameId);
      io.to(gameId).emit('game:event_card_resolved', { cardId: state.active_event?.card_id ?? '' });
      broadcastState(io, gameId, state);
      // Restart turn timer now that the blocking event choice is resolved (human players only)
      const roomAfterChoice = activeGames.get(gameId);
      if (roomAfterChoice && !roomAfterChoice.state.players[roomAfterChoice.state.current_player_index].is_ai) {
        startTurnTimer(io, gameId, roomAfterChoice.state, roomAfterChoice.map);
      }
    });

    // ── In-game chat ────────────────────────────────────────────────────────
    socket.on('game:chat', ({ gameId, message }: { gameId: string; message: string }) => {
      const room = activeGames.get(gameId);
      if (!room) return;
      if (room.connectedSockets.get(socket.id) !== userId) return;

      const raw = String(message).trim().slice(0, 500);
      if (!raw) return;

      // Allow GIF messages from trusted domains; sanitise everything else
      const gifMatch = raw.match(/^\[gif:(https:\/\/media1?\.tenor\.com\/[^\]]+)\]$/);
      const clean = gifMatch
        ? raw // pass through validated GIF URL
        : raw.slice(0, 200).replace(/</g, '&lt;').replace(/>/g, '&gt;');
      if (!clean) return;

      const player = room.state.players.find((p) => p.player_id === userId);
      io.to(gameId).emit('game:chat_message', {
        gameId,
        playerId: userId,
        username: player?.username ?? 'Unknown',
        color: player?.color ?? '#888',
        message: clean,
        timestamp: Date.now(),
      });
    });

    // ── Leave (Save & Leave) ────────────────────────────────────────────
    socket.on('game:leave', async ({ gameId }: { gameId: string }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      const { state } = room;

      if (state.phase === 'game_over') return;

      await saveGameState(gameId, state);
      room.connectedSockets.delete(socket.id);
      socket.leave(gameId);
      socket.emit('game:left', { gameId });

      // If no human sockets remain, keep game in memory for 5 min then evict
      const hasHumanConnections = [...room.connectedSockets.values()].some((pid) =>
        state.players.some((p) => p.player_id === pid && !p.is_ai)
      );
      if (!hasHumanConnections) {
        const evictionTimer = setTimeout(() => {
          const current = activeGames.get(gameId);
          if (current && current.connectedSockets.size === 0) {
            // For async games, don't cancel the deadline — BullMQ handles it independently
            if (!current.state.settings.async_mode) {
              clearTurnTimer(gameId, current.state);
            }
            activeGames.delete(gameId);
            aiInFlight.delete(gameId);
            console.log(`[Socket] Evicted inactive game ${gameId} from memory`);
          }
        }, 5 * 60 * 1000);
        evictionTimer.unref();
      }
    });

    // ── Propose Truce ─────────────────────────────────────────────────────
    socket.on('game:propose_truce', ({ gameId, targetPlayerId }: { gameId: string; targetPlayerId: string }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      const { state } = room;

      if (!state.settings.diplomacy_enabled) {
        return socket.emit('error', { message: 'Diplomacy is disabled' });
      }
      const proposer = state.players.find((p) => p.player_id === userId);
      const target = state.players.find((p) => p.player_id === targetPlayerId);
      if (!proposer || proposer.is_eliminated) return socket.emit('error', { message: 'Invalid proposer' });
      if (!target || target.is_eliminated) return socket.emit('error', { message: 'Target is eliminated' });
      if (proposer.player_id === target.player_id) return socket.emit('error', { message: 'Cannot propose truce to yourself' });
      if (state.phase !== 'attack') return socket.emit('error', { message: 'Can only propose truces during attack phase' });

      // Check no existing truce
      const existing = state.diplomacy.find(
        (e) =>
          (e.player_index_a === proposer.player_index && e.player_index_b === target.player_index) ||
          (e.player_index_a === target.player_index && e.player_index_b === proposer.player_index),
      );
      if (existing?.status === 'truce') {
        return socket.emit('error', { message: 'Already in a truce with this player' });
      }

      // Check no duplicate pending
      const alreadyPending = (state.pending_truces ?? []).some(
        (pt) =>
          (pt.proposer_id === userId && pt.target_id === targetPlayerId) ||
          (pt.proposer_id === targetPlayerId && pt.target_id === userId),
      );
      if (alreadyPending) {
        return socket.emit('error', { message: 'Truce proposal already pending' });
      }

      // AI target: always decline
      if (target.is_ai) {
        socket.emit('game:truce_result', {
          accepted: false,
          proposerId: userId,
          targetId: targetPlayerId,
          targetName: target.username,
        });
        return;
      }

      // Human target: queue pending proposal
      if (!state.pending_truces) state.pending_truces = [];
      state.pending_truces.push({ proposer_id: userId, target_id: targetPlayerId });

      io.to(`user:${targetPlayerId}`).emit('game:truce_proposal', {
        gameId,
        proposerId: userId,
        proposerName: proposer.username,
        proposerColor: proposer.color,
      });

      socket.emit('game:truce_result', { pending: true, targetName: target.username });
    });

    // ── Respond to Truce Proposal ──────────────────────────────────────────
    socket.on('game:truce_response', ({ gameId, proposerId, accepted }: { gameId: string; proposerId: string; accepted: boolean }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      const { state } = room;

      if (!state.pending_truces) return socket.emit('error', { message: 'No pending truce' });

      const idx = state.pending_truces.findIndex(
        (pt) => pt.proposer_id === proposerId && pt.target_id === userId,
      );
      if (idx === -1) return socket.emit('error', { message: 'No pending truce from this player' });

      state.pending_truces.splice(idx, 1);

      const proposer = state.players.find((p) => p.player_id === proposerId);
      const target = state.players.find((p) => p.player_id === userId);

      if (accepted && proposer && target) {
        const entry = state.diplomacy.find(
          (e) =>
            (e.player_index_a === proposer.player_index && e.player_index_b === target.player_index) ||
            (e.player_index_a === target.player_index && e.player_index_b === proposer.player_index),
        );
        if (entry) {
          entry.status = 'truce';
          entry.truce_turns_remaining = 3;
        }
        // Track for diplomat achievement
        if (!proposer.is_ai) {
          proposer.truces_established = [...new Set([...(proposer.truces_established ?? []), target.player_id])];
        }
        if (!target.is_ai) {
          target.truces_established = [...new Set([...(target.truces_established ?? []), proposer.player_id])];
        }
      }

      io.to(gameId).emit('game:truce_result', {
        accepted,
        proposerId,
        proposerName: proposer?.username ?? proposerId,
        targetId: userId,
        targetName: target?.username ?? userId,
      });

      if (accepted) {
        broadcastState(io, gameId, state);
      }
    });

    // ── Resign ────────────────────────────────────────────────────────────
    socket.on('game:resign', async ({ gameId }: { gameId: string }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      const { state, map } = room;

      const player = state.players.find((p) => p.player_id === userId);
      if (!player || player.is_eliminated) return socket.emit('error', { message: 'Cannot resign' });

      player.is_eliminated = true;

      // Make all their territories neutral (unowned)
      for (const t of Object.values(state.territories)) {
        if (t.owner_id === userId) {
          t.owner_id = null;
          t.unit_count = Math.max(1, Math.floor(t.unit_count / 2));
        }
      }
      syncTerritoryCounts(state);

      io.to(gameId).emit('game:player_resigned', {
        playerId: userId,
        playerName: player.username,
      });

      // If it was this player's turn, advance
      const currentPlayer = state.players[state.current_player_index];
      if (currentPlayer.player_id === userId) {
        advanceToNextPlayer(state, map);
        broadcastEventCard(io, gameId, state, map);
        if (state.players[state.current_player_index].is_ai) {
          setTimeout(() => processAiTurn(io, gameId), 1500);
        }
      }

      const resignVictoryResult = checkVictory(state, map);
      if (resignVictoryResult) {
        const { winnerIds, condition } = resignVictoryResult;
        const winnerId = winnerIds[0]!;
        state.phase = 'game_over';
        state.winner_id = winnerId;
        state.winner_ids = winnerIds;
        state.victory_condition = condition;
        await finalizeGame(io, gameId, state, winnerIds);
      } else {
        await saveGameState(gameId, state);
      }

      broadcastState(io, gameId, state);
    });

    // ── Matchmaking socket shortcuts ────────────────────────────────────────
    socket.on('matchmaking:join', async ({ era_id, bucket }: { era_id: string; bucket: string }) => {
      try {
        await query(
          `UPDATE ranked_queue SET socket_id = $1 WHERE user_id = $2`,
          [socket.id, userId],
        );
      } catch { /* queue row may not exist yet */ }
    });

    socket.on('matchmaking:leave', async () => {
      try {
        await query('DELETE FROM ranked_queue WHERE user_id = $1', [userId]);
      } catch { /* ignore */ }
    });

    // ── Disconnect ──────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`[Socket] Disconnected: ${userId} (${socket.id})`);
      // Clean up matchmaking queue on disconnect
      query('DELETE FROM ranked_queue WHERE socket_id = $1', [socket.id]).catch(() => {});
      for (const [gameId, room] of activeGames.entries()) {
        if (!room.connectedSockets.has(socket.id)) continue;
        room.connectedSockets.delete(socket.id);

        // Schedule eviction if no human sockets remain
        if (room.state.phase !== 'game_over') {
          const hasHumanConnections = [...room.connectedSockets.values()].some((pid) =>
            room.state.players.some((p) => p.player_id === pid && !p.is_ai)
          );
          if (!hasHumanConnections) {
            saveGameState(gameId, room.state);
            const evictionTimer = setTimeout(() => {
              const current = activeGames.get(gameId);
              if (current && current.connectedSockets.size === 0) {
                if (!current.state.settings.async_mode) {
                  clearTurnTimer(gameId, current.state);
                }
                activeGames.delete(gameId);
                aiInFlight.delete(gameId);
                console.log(`[Socket] Evicted inactive game ${gameId} from memory after disconnect`);
              }
            }, 5 * 60 * 1000);
            evictionTimer.unref();
          }
        }
      }
    });
  });

  gameIoSingleton = io;
  return io;
}

/** Clear turn timers, flush debounced saves, and close Socket.IO during graceful shutdown. */
export async function shutdownGameSocket(io: Server): Promise<void> {
  for (const t of turnTimers.values()) clearTimeout(t);
  turnTimers.clear();
  await flushAllPendingSaves();
  // Stop async deadline worker (BullMQ jobs persist in Redis for next startup)
  const { stopAsyncDeadlineWorker } = await import('../workers/asyncDeadlineWorker');
  await stopAsyncDeadlineWorker();
  return new Promise((resolve, reject) => {
    io.close((err) => (err ? reject(err) : resolve()));
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * After advanceToNextPlayer, if an event card was drawn, broadcast it and clear
 * instant (no-choice) events. Choice-based events stay on state until resolved.
 */
function broadcastEventCard(io: Server, gameId: string, state: GameState, map: GameMap): void {
  if (!state.active_event) return;
  const card = { ...state.active_event };

  // Attach result_summary when an instant effect was just applied
  if (state.active_event_result) {
    const result = state.active_event_result;
    if (result.global) {
      card.result_summary = [{ territory_id: '__global__', name: 'All territories', delta: -1 }];
    } else if (result.affected_territories && result.affected_territories.length > 0) {
      card.result_summary = result.affected_territories.map(({ territory_id, delta }) => ({
        territory_id,
        name: map.territories.find((t) => t.territory_id === territory_id)?.name ?? territory_id,
        delta,
      }));
    }
    state.active_event_result = undefined;
  }

  io.to(gameId).emit('game:event_card', card);
  // If the card had no choices, the effect was already applied in advanceToNextPlayer — clear it
  if (!card.choices || card.choices.length === 0) {
    state.active_event = undefined;
  }
}

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
  const stripSecretMissions = (s: GameState): GameState => ({
    ...s,
    players: s.players.map((p) =>
      playerId !== null && p.player_id === playerId ? p : { ...p, secret_mission: null },
    ),
  });

  if (!fogOfWar || !playerId) return stripSecretMissions(state);

  // Build visible territory set
  const visibleIds = new Set<string>();
  for (const [tid, tState] of Object.entries(state.territories)) {
    if (tState.owner_id === playerId) visibleIds.add(tid);
  }

  // Add adjacent territories
  const filtered: GameState = { ...state, territories: { ...state.territories } };
  for (const [tid, tState] of Object.entries(state.territories)) {
    if (!visibleIds.has(tid)) {
      filtered.territories[tid] = { ...tState, unit_count: -1 }; // -1 = hidden
    }
  }

  // Hide other players' cards
  filtered.players = state.players.map((p) =>
    p.player_id === playerId ? p : { ...p, cards: [] },
  );

  return stripSecretMissions(filtered);
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

// ── Debounced save ────────────────────────────────────────────────────────
const DEBOUNCE_MS = 800;
const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleDebouncedSave(gameId: string): void {
  const existing = pendingSaves.get(gameId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pendingSaves.delete(gameId);
    const room = activeGames.get(gameId);
    if (room) saveGameState(gameId, room.state);
  }, DEBOUNCE_MS);
  timer.unref();
  pendingSaves.set(gameId, timer);
}

async function flushAllPendingSaves(): Promise<void> {
  const saves: Promise<void>[] = [];
  for (const [gameId, timer] of pendingSaves.entries()) {
    clearTimeout(timer);
    const room = activeGames.get(gameId);
    if (room) saves.push(saveGameState(gameId, room.state));
  }
  pendingSaves.clear();
  await Promise.allSettled(saves);
}

const CAMPAIGN_ERAS = ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern'] as const;

async function handleCampaignCompletion(io: Server, gameId: string, state: GameState, winnerId: string): Promise<void> {
  const campaignRow = await queryOne<{ campaign_id: string; current_era_index: number; prestige_points: number }>(
    `SELECT uc.campaign_id, uc.current_era_index, uc.prestige_points
     FROM user_campaigns uc
     JOIN campaign_entries ce ON ce.campaign_id = uc.campaign_id
     WHERE ce.game_id = $1 AND uc.status = 'active'
     LIMIT 1`,
    [gameId],
  );
  if (!campaignRow) return;

  const won = !!winnerId && !state.players.find((p) => p.player_id === winnerId)?.is_ai;
  await query(
    `INSERT INTO campaign_entries (id, campaign_id, era_id, game_id, won, completed_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())
     ON CONFLICT (campaign_id, era_id) DO UPDATE SET won = EXCLUDED.won, game_id = EXCLUDED.game_id, completed_at = NOW()`,
    [campaignRow.campaign_id, state.era, gameId, won],
  );

  if (won) {
    const newIdx = campaignRow.current_era_index + 1;
    const newPrestige = campaignRow.prestige_points + 1;
    if (newIdx >= CAMPAIGN_ERAS.length) {
      await query(
        `UPDATE user_campaigns SET status = 'completed', completed_at = NOW() WHERE campaign_id = $1`,
        [campaignRow.campaign_id],
      );
    } else {
      await query(
        `UPDATE user_campaigns SET current_era_index = $1, prestige_points = $2 WHERE campaign_id = $3`,
        [newIdx, newPrestige, campaignRow.campaign_id],
      );
      io.to(`user:${winnerId}`).emit('game:campaign_advanced', {
        next_era: CAMPAIGN_ERAS[newIdx],
        campaign_id: campaignRow.campaign_id,
      });
    }
  }
}

async function finalizeGame(io: Server, gameId: string, state: GameState, winnerIds: string[]): Promise<void> {
  const winnerId = winnerIds[0]!;
  clearTurnTimer(gameId, state);
  appendWinProbabilitySnapshot(state);

  // Persist to DB first — only emit game:over to clients on success
  try {
    await query('UPDATE games SET status = $1, ended_at = NOW(), winner_id = $2 WHERE game_id = $3', [
      'completed', winnerId, gameId,
    ]);
    await saveGameState(gameId, state);
  } catch (err) {
    console.error('[Socket] Failed to persist game completion:', err);
    // Roll back in-memory so next attempt can retry
    state.phase = 'fortify';
    state.winner_id = undefined;
    io.to(gameId).emit('error', { message: 'Failed to save game result; please reload to retry' });
    return;
  }

  // Record daily challenge entry (non-critical)
  try {
    const dailyRow = await queryOne<{ daily_challenge_date: string }>(
      `SELECT settings_json->>'daily_challenge_date' AS daily_challenge_date FROM games WHERE game_id = $1`,
      [gameId],
    );
    if (dailyRow?.daily_challenge_date) {
      const humanPlayer = state.players.find((p) => !p.is_ai);
      if (humanPlayer) {
        await query(
          `INSERT INTO daily_challenge_entries (challenge_date, user_id, won, turn_count, territory_count)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (challenge_date, user_id) DO NOTHING`,
          [
            dailyRow.daily_challenge_date,
            humanPlayer.player_id,
            humanPlayer.player_id === winnerId,
            state.turn_number,
            humanPlayer.territory_count,
          ],
        );
      }
    }
  } catch (dailyErr) {
    console.error('[Socket] Failed to record daily challenge entry:', dailyErr);
  }

  // Campaign hook (non-critical)
  if (state.settings?.is_campaign) {
    try {
      await handleCampaignCompletion(io, gameId, state, winnerId);
    } catch (campErr) {
      console.error('[Socket] Campaign hook failed:', campErr);
    }
  }

  // Post-game stats (non-critical — failures logged but game:over still sent)
  let resultCtx: Awaited<ReturnType<typeof recordGameResults>>;
  try {
    resultCtx = await recordGameResults(gameId, state, winnerId);
  } catch (err) {
    console.error('[Socket] Failed to record game results:', err);
    resultCtx = { ratingDeltas: new Map(), isRanked: false, xpEarnedByPlayer: {} };
  }

  const unlockedByPlayer: Record<string, string[]> = {};
  const humanPlayers = state.players.filter((p) => !p.is_ai);
  const ranks = computeRanks(state.players, winnerId);

  if (humanPlayers.length > 0) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const ratingRows = (await client.query<{ user_id: string; mu: number; phi: number }>(
        `SELECT user_id, mu, phi FROM user_ratings
         WHERE user_id = ANY($1) AND rating_type = $2`,
        [humanPlayers.map((p) => p.player_id), resultCtx.isRanked ? 'ranked' : 'solo'],
      )).rows;
      const ratingMap = new Map(ratingRows.map((r) => [r.user_id, { mu: r.mu, phi: r.phi }]));
      const avgMu = ratingRows.length > 0
        ? ratingRows.reduce((s, r) => s + r.mu, 0) / ratingRows.length
        : INITIAL_MU;

      const gameRow = await client.query<{ game_type: string; is_ranked: boolean }>(
        'SELECT game_type, COALESCE(is_ranked, false) AS is_ranked FROM games WHERE game_id = $1',
        [gameId],
      );
      const gameType = (gameRow.rows[0]?.game_type ?? 'solo') as 'solo' | 'multiplayer' | 'hybrid';

      for (const p of humanPlayers) {
        const myRating = ratingMap.get(p.player_id) ?? { mu: INITIAL_MU, phi: INITIAL_PHI };
        const unlocked = await checkAndUnlockAchievements(client, {
          userId: p.player_id,
          gameId,
          gameState: state,
          winnerId,
          rank: ranks.get(p.player_id) ?? state.players.length,
          totalPlayers: state.players.length,
          gameType,
          isRanked: resultCtx.isRanked,
          playerMu: myRating.mu,
          opponentAvgMu: avgMu,
        });
        if (unlocked.length > 0) unlockedByPlayer[p.player_id] = unlocked;
      }
      await client.query('COMMIT');
    } catch (achErr) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[Socket] Achievement check failed:', achErr);
    } finally {
      client.release();
    }
  }

  const winner = state.players.find((p) => p.player_id === winnerId);
  const stats = {
    winner_id: winnerId,
    winner_ids: winnerIds,
    winner_name: winner?.username ?? 'Unknown',
    turn_count: state.turn_number,
    players: state.players.map((p) => ({
      player_id: p.player_id,
      username: p.username,
      color: p.color,
      territory_count: p.territory_count,
      is_eliminated: p.is_eliminated,
      is_ai: p.is_ai,
    })),
    win_probability_history: state.win_probability_history ?? [],
    rating_deltas: Object.fromEntries(resultCtx.ratingDeltas),
    is_ranked: resultCtx.isRanked,
    achievements_unlocked: unlockedByPlayer,
    xp_earned_by_player: resultCtx.xpEarnedByPlayer,
    victory_condition: state.victory_condition,
  };
  io.to(gameId).emit('game:over', stats);

  // Clean up after a delay so clients can see final state
  setTimeout(() => activeGames.delete(gameId), 30000);
}

async function processAiTerritorySelect(io: Server, gameId: string): Promise<void> {
  const room = activeGames.get(gameId);
  if (!room) return;
  const { state, map } = room;

  if (state.phase !== 'territory_select') return;

  const currentPlayer = state.players[state.current_player_index];
  if (!currentPlayer.is_ai) return;

  const difficulty = currentPlayer.ai_difficulty ?? 'medium';
  const unclaimed = Object.entries(state.territories)
    .filter(([, t]) => isUnclaimedOwner(t.owner_id))
    .map(([id]) => id);

  if (unclaimed.length === 0) return;

  // Build adjacency map for smart territory selection
  const adj: Record<string, string[]> = {};
  for (const conn of map.connections) {
    if (!adj[conn.from]) adj[conn.from] = [];
    if (!adj[conn.to]) adj[conn.to] = [];
    adj[conn.from].push(conn.to);
    adj[conn.to].push(conn.from);
  }

  let chosenId: string;

  if (difficulty === 'hard' || difficulty === 'expert') {
    // Prefer unclaimed territories adjacent to already-owned territories (clustering)
    const owned = new Set(
      Object.entries(state.territories)
        .filter(([, t]) => t.owner_id === currentPlayer.player_id)
        .map(([id]) => id)
    );

    const adjacentUnclaimed = unclaimed.filter((id) =>
      (adj[id] ?? []).some((n) => owned.has(n))
    );

    if (adjacentUnclaimed.length > 0) {
      // Expert: score by region bonus potential
      if (difficulty === 'expert') {
        const regionBonus: Record<string, number> = {};
        for (const r of map.regions) regionBonus[r.region_id] = r.bonus;
        const scored = adjacentUnclaimed.map((id) => {
          const mt = map.territories.find((t) => t.territory_id === id);
          return { id, score: mt ? (regionBonus[mt.region_id] ?? 0) : 0 };
        });
        scored.sort((a, b) => b.score - a.score);
        chosenId = scored[0].id;
      } else {
        chosenId = adjacentUnclaimed[Math.floor(Math.random() * adjacentUnclaimed.length)];
      }
    } else if (owned.size === 0) {
      // First pick: choose a territory in a high-bonus region
      const regionBonus: Record<string, number> = {};
      for (const r of map.regions) regionBonus[r.region_id] = r.bonus;
      const scored = unclaimed.map((id) => {
        const mt = map.territories.find((t) => t.territory_id === id);
        return { id, score: mt ? (regionBonus[mt.region_id] ?? 0) : 0 };
      });
      scored.sort((a, b) => b.score - a.score);
      // Pick from top 3 to add some variety
      const topN = scored.slice(0, Math.min(3, scored.length));
      chosenId = topN[Math.floor(Math.random() * topN.length)].id;
    } else {
      chosenId = unclaimed[Math.floor(Math.random() * unclaimed.length)];
    }
  } else {
    // Easy / Medium: random pick
    chosenId = unclaimed[Math.floor(Math.random() * unclaimed.length)];
  }

  // Claim the territory
  const territory = state.territories[chosenId];
  territory.owner_id = currentPlayer.player_id;
  territory.unit_count = state.settings.initial_unit_count;
  currentPlayer.territory_count = Object.values(state.territories).filter(
    (t) => t.owner_id === currentPlayer.player_id
  ).length;

  // Advance to next player
  const total = state.players.length;
  let next = (state.current_player_index + 1) % total;
  let attempts = 0;
  while (state.players[next].is_eliminated && attempts < total) {
    next = (next + 1) % total;
    attempts++;
  }
  state.current_player_index = next;
  state.turn_started_at = Date.now();

  // Check if all territories are claimed
  const remaining = Object.values(state.territories).filter((t) => isUnclaimedOwner(t.owner_id)).length;
  if (remaining === 0) {
    state.phase = 'draft';
    state.current_player_index = 0;
    state.turn_number = 1;
    state.turn_started_at = Date.now();
    const firstPlayer = state.players[0];
    const bonus = calculateContinentBonuses(state, map, firstPlayer.player_id);
    state.draft_units_remaining = calculateReinforcements(
      firstPlayer.territory_count,
      bonus,
      state.players.length,
    );
  }

  broadcastState(io, gameId, state);
  scheduleDebouncedSave(gameId);

  // Chain: next AI pick or transition to human/draft
  const nextPlayer = state.players[state.current_player_index];
  if (nextPlayer.is_ai && state.phase === 'territory_select') {
    setTimeout(() => processAiTerritorySelect(io, gameId), 800);
  } else if (nextPlayer.is_ai && state.phase === 'draft') {
    setTimeout(() => processAiTurn(io, gameId), 1500);
  } else if (!nextPlayer.is_ai && state.phase === 'draft') {
    startTurnTimer(io, gameId, state, map);
  }
}

async function processAiTurn(io: Server, gameId: string): Promise<void> {
  if (aiInFlight.has(gameId)) return;
  const room = activeGames.get(gameId);
  if (!room) return;
  const { state, map } = room;

  const currentPlayer = state.players[state.current_player_index];
  if (!currentPlayer.is_ai) return;

  aiInFlight.add(gameId);

  const difficulty = currentPlayer.ai_difficulty ?? 'medium';
  const actions = await runAiWithTimeout(state, map, difficulty);

  const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 600));

  const doVictoryCheck = async (): Promise<boolean> => {
    const victoryResult = checkVictory(state, map);
    if (victoryResult) {
      const { winnerIds, condition } = victoryResult;
      const winnerId = winnerIds[0]!;
      state.phase = 'game_over';
      state.winner_id = winnerId;
      state.winner_ids = winnerIds;
      state.victory_condition = condition;
      aiInFlight.delete(gameId);
      await finalizeGame(io, gameId, state, winnerIds);
      return true;
    }
    return false;
  };

  // ── Draft Phase ────────────────────────────────────────────────────────
  state.phase = 'draft';

  if (difficulty !== 'tutorial') {
    for (;;) {
      const ids = findRedeemableCardIds(currentPlayer.cards);
      if (!ids) break;
      try {
        const bonus = redeemCardSet(state, currentPlayer.player_id, ids);
        state.draft_units_remaining += bonus;
        io.to(gameId).emit('game:cards_redeemed', { bonus });
        await delay();
        broadcastState(io, gameId, state);
        scheduleDebouncedSave(gameId);
      } catch {
        break;
      }
    }
  }

  const firstDraftIdx = actions.findIndex(
    (a) => a.type === 'draft' && a.to && a.units != null,
  );
  if (firstDraftIdx >= 0) {
    actions[firstDraftIdx].units = state.draft_units_remaining;
  } else if (state.draft_units_remaining > 0) {
    const owned = Object.keys(state.territories).find(
      (tid) => state.territories[tid].owner_id === currentPlayer.player_id,
    );
    if (owned) {
      const endIdx = actions.findIndex((a) => a.type === 'end_phase');
      const draftAction = { type: 'draft' as const, to: owned, units: state.draft_units_remaining };
      if (endIdx >= 0) actions.splice(endIdx, 0, draftAction);
      else actions.unshift(draftAction);
    }
  }

  for (const action of actions) {
    if (action.type !== 'draft' || !action.to || !action.units) continue;
    await delay();
    const t = state.territories[action.to];
    const clamped = Math.min(action.units, state.draft_units_remaining);
    if (t && t.owner_id === currentPlayer.player_id && clamped > 0) {
      t.unit_count += clamped;
      state.draft_units_remaining -= clamped;
    }
    broadcastState(io, gameId, state);
  }

  // ── AI Economy: difficulty-gated strategic build and research ──────────
  if (state.settings.economy_enabled || state.settings.tech_trees_enabled) {
    if (state.settings.economy_enabled) {
      const buildDecision = selectAiBuildingPlacement(state, map, currentPlayer.player_id, difficulty);
      if (buildDecision) {
        applyBuild(state, currentPlayer.player_id, buildDecision.territoryId, buildDecision.buildingType);
      }
    }
    if (state.settings.tech_trees_enabled) {
      const techId = selectAiTechResearch(state, currentPlayer.player_id, difficulty);
      if (techId) {
        const techValidation = validateResearch(state, currentPlayer.player_id, techId);
        if (techValidation.valid && techValidation.node) {
          applyResearch(state, currentPlayer.player_id, techValidation.node);
        }
      }
    }
    broadcastState(io, gameId, state);
  }

  // ── Attack Phase ───────────────────────────────────────────────────────
  state.draft_units_remaining = 0;
  state.phase = 'attack';
  broadcastState(io, gameId, state);

  for (const action of actions) {
    if (action.type !== 'attack' || !action.from || !action.to) continue;

    // ── AI influence action (sentinel from === '__influence__') ──
    if (action.from === '__influence__') {
      if ((state.influence_cooldown_remaining ?? 0) > 0) continue;
      const modifiers = state.era_modifiers;
      const canInfluence = modifiers?.influence_spread || modifiers?.carbonari_network;
      if (!canInfluence) continue;

      const target = state.territories[action.to];
      if (!target || target.owner_id === currentPlayer.player_id) continue;
      if (target.unit_count > 3) continue;

      // Cost: need 3 spare units; deduct from adjacent owned territories
      const adjacency: Record<string, string[]> = {};
      for (const conn of map.connections) {
        if (!adjacency[conn.from]) adjacency[conn.from] = [];
        if (!adjacency[conn.to]) adjacency[conn.to] = [];
        adjacency[conn.from].push(conn.to);
        adjacency[conn.to].push(conn.from);
      }

      const totalUnits = Object.values(state.territories)
        .filter((t) => t.owner_id === currentPlayer.player_id)
        .reduce((sum, t) => sum + t.unit_count, 0);
      if (totalUnits < 4) continue;

      const adjacentOwned = (adjacency[action.to] ?? [])
        .filter((nid) => state.territories[nid]?.owner_id === currentPlayer.player_id)
        .sort((a, b) => (state.territories[b]?.unit_count ?? 0) - (state.territories[a]?.unit_count ?? 0));
      if (adjacentOwned.length === 0) continue;

      let remaining = 3;
      for (const tid of adjacentOwned) {
        const t = state.territories[tid];
        if (!t) continue;
        const canSpend = Math.min(remaining, t.unit_count - 1);
        t.unit_count -= canSpend;
        remaining -= canSpend;
        if (remaining <= 0) break;
      }
      if (remaining > 0) continue;

      const previousOwner = target.owner_id;
      target.owner_id = currentPlayer.player_id;
      target.unit_count = 1;
      state.influence_cooldown_remaining = 3;

      // Stability penalty on AI influence capture
      if (state.settings.stability_enabled) {
        onInfluenceStabilityPenalty(state, action.to);
      }

      syncTerritoryCounts(state);

      if (previousOwner) {
        const prevPlayer = state.players.find((p) => p.player_id === previousOwner);
        if (prevPlayer && prevPlayer.territory_count === 0) {
          prevPlayer.is_eliminated = true;
          currentPlayer.cards.push(...prevPlayer.cards);
          prevPlayer.cards = [];
          io.to(gameId).emit('game:player_eliminated', {
            playerId: previousOwner,
            eliminatorId: currentPlayer.player_id,
            eliminatorName: currentPlayer.username,
            eliminatedName: prevPlayer.username,
          });
        }
      }

      broadcastState(io, gameId, state);
      if (await doVictoryCheck()) return;
      continue;
    }

    await delay();
    const from = state.territories[action.from];
    const to = state.territories[action.to];
    if (!from || !to || from.unit_count < 2 || from.owner_id !== currentPlayer.player_id) continue;
    if (to.owner_id === currentPlayer.player_id) continue;

    // Naval sea-lane gating: AI must have a fleet to cross sea connections
    if (state.settings.naval_enabled) {
      const aiConnection = map.connections.find(
        (c) => (c.from === action.from && c.to === action.to) || (c.from === action.to && c.to === action.from),
      );
      if (aiConnection?.type === 'sea') {
        if (!from.naval_units || from.naval_units <= 0) continue;
        const defenderFleets = to.naval_units ?? 0;
        if (defenderFleets > 0) {
          const aiNavalResult = resolveNavalCombat(from.naval_units, defenderFleets);
          from.naval_units = Math.max(0, from.naval_units - aiNavalResult.attacker_losses);
          to.naval_units = Math.max(0, defenderFleets - aiNavalResult.defender_losses);
          io.to(gameId).emit('game:naval_combat_result', { fromId: action.from, toId: action.to, result: aiNavalResult });
          if (!aiNavalResult.attacker_won) continue;
        }
        from.naval_units = Math.max(0, from.naval_units - 1);
      }
    }

    const aiDefenderId = to.owner_id;

    // Combat modifier parity: apply same bonuses as human attack handler
    const aiBuildingDefenseBonus = getBuildingDefenseBonus(state, action.to);
    const aiTechDefenseBonus = state.settings.tech_trees_enabled
      ? getPlayerDefenseBonus(state, aiDefenderId ?? '')
      : 0;
    const aiDefenderFaction = state.settings.factions_enabled
      ? (() => {
          const dp = state.players.find((p) => p.player_id === aiDefenderId);
          return dp?.faction_id ? getEraFactions(state.era).find((f) => f.faction_id === dp.faction_id) : undefined;
        })()
      : undefined;
    const aiFactionDefenseBonus = aiDefenderFaction?.passive_defense_bonus ?? 0;
    const aiEventDefenseBonus = state.settings.events_enabled && aiDefenderId
      ? getTemporaryModifierValue(state, aiDefenderId, 'defense_modifier')
      : 0;
    const aiWonderDefenseBonus = state.settings.economy_enabled
      ? getWonderDefenseBonus(state, aiDefenderId ?? '')
      : 0;
    const aiTotalDefenseBonus = aiBuildingDefenseBonus + aiTechDefenseBonus + aiFactionDefenseBonus + aiEventDefenseBonus + aiWonderDefenseBonus;
    const aiDefenderDiceOverride = aiTotalDefenseBonus > 0
      ? Math.min(to.unit_count, 2) + aiTotalDefenseBonus
      : undefined;

    const aiTechAttackBonus = state.settings.tech_trees_enabled
      ? getPlayerAttackBonus(state, currentPlayer.player_id)
      : 0;
    const aiAttackerFaction = state.settings.factions_enabled && currentPlayer.faction_id
      ? getEraFactions(state.era).find((f) => f.faction_id === currentPlayer.faction_id)
      : undefined;
    const aiFactionAttackBonus = aiAttackerFaction?.passive_attack_bonus ?? 0;
    const aiEventAttackBonus = state.settings.events_enabled
      ? getTemporaryModifierValue(state, currentPlayer.player_id, 'attack_modifier')
      : 0;
    const aiTotalAttackBonus = aiTechAttackBonus + aiFactionAttackBonus + aiEventAttackBonus;
    const aiAttackerDiceOverride = aiTotalAttackBonus > 0
      ? Math.min(from.unit_count - 1, 3) + aiTotalAttackBonus
      : undefined;

    const result = resolveCombat(
      from.unit_count,
      to.unit_count,
      aiAttackerDiceOverride,
      aiDefenderDiceOverride,
      undefined,
      state.era_modifiers,
    );
    from.unit_count -= result.attacker_losses;
    to.unit_count -= result.defender_losses;
    if (result.territory_captured) {
      to.owner_id = currentPlayer.player_id;
      to.unit_count = Math.min(from.unit_count - 1, 3);
      from.unit_count = Math.max(1, from.unit_count - to.unit_count);
      drawCard(state, currentPlayer.player_id);
      // Raze buildings and apply stability penalty on AI capture
      onTerritoryCapture(state, action.to);
      if (state.settings.stability_enabled) {
        onCaptureStabilityPenalty(state, action.to);
      }

      const defenderPlayer = state.players.find((p) => p.player_id === aiDefenderId);
      if (defenderPlayer) {
        syncTerritoryCounts(state);
        if (defenderPlayer.territory_count === 0) {
          defenderPlayer.is_eliminated = true;
          currentPlayer.cards.push(...defenderPlayer.cards);
          defenderPlayer.cards = [];
          io.to(gameId).emit('game:player_eliminated', {
            playerId: aiDefenderId,
            eliminatorId: currentPlayer.player_id,
            eliminatorName: currentPlayer.username,
            eliminatedName: defenderPlayer.username,
          });
        }
      }
    }
    syncTerritoryCounts(state);
    io.to(gameId).emit('game:combat_result', { fromId: action.from, toId: action.to, result });
    broadcastState(io, gameId, state);

    if (await doVictoryCheck()) return;
    if (result.territory_captured) {
      const defP = state.players.find((p) => p.player_id === aiDefenderId);
      if (defP?.is_eliminated) appendWinProbabilitySnapshot(state);
    }
  }

  // ── Fortify Phase ──────────────────────────────────────────────────────
  state.phase = 'fortify';
  broadcastState(io, gameId, state);

  for (const action of actions) {
    if (action.type !== 'fortify' || !action.from || !action.to || !action.units) continue;
    await delay();
    const from = state.territories[action.from];
    const to = state.territories[action.to];
    if (from && to && from.owner_id === currentPlayer.player_id && to.owner_id === currentPlayer.player_id && from.unit_count > action.units) {
      from.unit_count -= action.units;
      to.unit_count += action.units;
    }
    broadcastState(io, gameId, state);
  }

  // ── End Turn ───────────────────────────────────────────────────────────
  advanceToNextPlayer(state, map);
  await saveGameState(gameId, state);
  broadcastEventCard(io, gameId, state, map);
  broadcastState(io, gameId, state);

  aiInFlight.delete(gameId);

  if (await doVictoryCheck()) return;

  // If there's an active event with choices and next player is AI, auto-resolve
  if (state.active_event?.choices?.length && state.players[state.current_player_index].is_ai) {
    const choice = state.active_event.choices[0];
    resolveEventChoice(state, state.active_event.card_id, choice.choice_id);
    io.to(gameId).emit('game:event_card_resolved', { cardId: '' });
    broadcastState(io, gameId, state);
  }

  // Chain if next player is also AI; otherwise restart turn timer for human
  if (state.players[state.current_player_index].is_ai) {
    setTimeout(() => processAiTurn(io, gameId), 1000);
  } else if (!state.active_event?.choices?.length) {
    // Don't start timer while a choice-based event awaits human resolution
    startTurnTimer(io, gameId, state, map);
  }
}

function startTurnTimer(io: Server, gameId: string, state: GameState, map: GameMap): void {
  clearTurnTimer(gameId, state);
  const seconds = state.settings.turn_timer_seconds;
  if (!seconds || seconds <= 0) return;
  const currentPlayer = state.players[state.current_player_index];
  if (currentPlayer.is_ai) return;

  // ── Async mode: use persistent BullMQ job instead of in-memory timer ──
  if (state.settings.async_mode) {
    const deadlineSec = state.settings.async_turn_deadline_seconds ?? seconds;
    // Write deadline to DB for querying
    query(
      'UPDATE games SET async_turn_deadline = NOW() + INTERVAL \'1 second\' * $1 WHERE game_id = $2',
      [deadlineSec, gameId],
    ).catch((err) => console.error('[Socket] Failed to write async deadline:', err));

    // Schedule BullMQ job
    scheduleAsyncDeadline(gameId, state.turn_number, state.current_player_index, deadlineSec)
      .catch((err) => console.error('[Socket] Failed to schedule async deadline:', err));

    // Notify the player it's their turn
    notifyTurnChange(gameId, currentPlayer.player_id, state)
      .catch((err) => console.error('[Socket] Failed to notify turn change:', err));

    return;
  }

  // ── Real-time mode: in-memory setTimeout (short timers ≤ 10 min) ──
  const timer = setTimeout(async () => {
    const room = activeGames.get(gameId);
    if (!room || room.state.phase === 'game_over') return;

    // Auto-place any remaining draft units so reinforcements are never silently lost
    const placed = autoPlaceDraftUnits(room.state);
    if (placed > 0) {
      broadcastState(io, gameId, room.state);
      io.to(gameId).emit('game:turn_timeout', { appliedDraft: true, unitsPlaced: placed });
    }

    advanceToNextPlayer(room.state, room.map);
    await saveGameState(gameId, room.state);
    broadcastEventCard(io, gameId, room.state, room.map);
    broadcastState(io, gameId, room.state);
    // Don't restart timer while a choice-based event is pending resolution
    if (!room.state.active_event?.choices?.length) {
      startTurnTimer(io, gameId, room.state, room.map);
    }

    if (room.state.players[room.state.current_player_index].is_ai) {
      setTimeout(() => processAiTurn(io, gameId), 1500);
    }
  }, seconds * 1000);
  timer.unref();
  turnTimers.set(gameId, timer);
}

function clearTurnTimer(gameId: string, state?: GameState): void {
  const existing = turnTimers.get(gameId);
  if (existing) {
    clearTimeout(existing);
    turnTimers.delete(gameId);
  }
  // Also cancel any pending async deadline job
  if (state) {
    cancelAsyncDeadline(gameId, state.turn_number).catch(() => {});
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
