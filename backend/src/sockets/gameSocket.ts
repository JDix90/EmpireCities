import type { Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Server, Socket } from 'socket.io';
import { verifyAccessToken } from '../utils/jwt';
import { query, queryOne } from '../db/postgres';
import { getMapById } from '../modules/maps/mapService';
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
  getSeaDefenseBonus,
  onTerritoryCapture,
} from '../game-engine/state/economyManager';
import { validateResearch, applyResearch, getPlayerAttackBonus, getPlayerDefenseBonus, getPlayerReinforceBonus } from '../game-engine/state/techManager';
import { getWonderDefenseBonus, getWonderSeaAttackDice, getWonderInfluenceRange } from '../game-engine/state/wonderManager';
import { getTechNodeById, getEraFactions, getEraTechTree } from '../game-engine/eras';
import { resolveEventChoice, getTemporaryModifierValue } from '../game-engine/events/eventCardManager';
import { moveFleets, resolveNavalCombat } from '../game-engine/state/navalManager';
import { onCaptureStabilityPenalty, onInfluenceStabilityPenalty, getDeployCap } from '../game-engine/state/stabilityManager';
import { getAdjacentTerritoryIds, getInfluenceHopLimit, isTerritoryReachableWithinHops } from '../game-engine/state/influenceManager';
import {
  connectionRequiresMoonAccess,
  fortifyEndpointsRequireOrbitAccess,
  territoryRequiresOrbitAccessForClaim,
  getOrbitAccessResult,
  formatOrbitAccessError,
} from '../game-engine/state/moonAccess';
import type { BuildingType } from '../types';
import { runAiWithTimeout } from '../game-engine/ai/runAiWithTimeout';
import { selectAiBuildingPlacement, selectAiTechResearch } from '../game-engine/ai/aiBot';
import { recordGameResults, computeRanks } from '../game-engine/state/statsManager';
import { checkAndUnlockAchievements } from '../game-engine/achievements/achievementService';
import { pgPool } from '../db/postgres';
import { getInitialRatings } from '../game-engine/rating/ratingService';
import {
  updateWinStreak,
  updateDailyStreak,
  updateSeasonTier,
  checkLevelCosmetic,
  checkOnboardingQuests,
} from '../game-engine/progression/progressionService';
import { updateFriendStreaks } from '../game-engine/progression/friendStreakService';
import { updateChallengeProgress, type GameChallengeEvent } from '../game-engine/progression/challengeService';
import { checkReferralCompletion } from '../game-engine/progression/referralService';
import { recordActivity } from '../services/activityService';
import { recordServerEvent } from '../services/analyticsEvents';
import { generateAndStorePostMatchAnalysis, updateSkillProfilesFromGameState } from '../services/playerValueEnhancements';
import { getTutorialMap } from '../game-engine/tutorial/tutorialScript';
import { incrementPlayCount } from '../modules/maps/mapService';
import type { GameState, GameMap, AiDifficulty } from '../types';
import { normalizeGameSettings } from '../game-engine/state/gameSettings';
import { config } from '../config';
import { isSafeMapId } from '../utils/mapId';
import { registerChatHandlers } from './handlers/chatHandler';
import type { SocketContext } from './handlers/types';
import { checkAndRecordActionId, clearActionIdempotency } from './actionIdempotency';
import { captureProbBefore, commitActionDecision, clearDecisionLog, getDecisionLog, summarizeDecisionLog, territoryName } from './actionAttribution';
import { evaluateCoachingTip } from '../game-engine/coaching/coachingDetectors';
import { getFortifyUnitsValidationError, getStartGameAuthorizationError } from './socketGuards';
import {
  scheduleAsyncDeadline,
  cancelAsyncDeadline,
  setDeadlineProcessor,
} from '../workers/asyncDeadlineWorker';
import { notifyTurnChange } from '../services/notificationService';
import type { DailyPuzzleSpec } from '../game-engine/daily/dailyPuzzleTypes';
import { createPuzzleDieRoll } from '../game-engine/daily/puzzleDice';
import { applyDailyPuzzleScenario } from '../game-engine/daily/applyDailyPuzzleScenario';
import { applyTutorialModuleBoost } from '../game-engine/tutorial/applyTutorialModuleBoost';
import { applyTutorialSettingsLab } from '../game-engine/tutorial/applyTutorialSettingsLab';
import { getDailyPuzzleSpec, maybeResolveDailyPuzzle } from './dailyPuzzleSocket';
import {
  attackerIgnoresDefenseBuilding,
  expandFogVisibilityFromRecon,
  getFortifyMoveLimit,
  getInfluenceUnitCost,
  getPrecisionStrikeMinUnits,
  getUnderdefendedAttackDiceBonus,
  playerHasUnlockedAbility,
} from '../game-engine/abilities/techAbilities';
import {
  buildStrikeAnimationPayload,
  emitAbilityStrikeVisuals,
  emitPreAttackAirStrikeVisuals,
  shouldEmitAbilityStrikeVisuals,
} from '../game-engine/abilities/strikeAnimation';
import {
  buildCombatMapVisual,
  buildFortifyMapVisual,
  buildInfluenceMapVisual,
  buildNavalMapVisual,
  buildReinforceMapVisual,
  emitEventCardMapVisuals,
  emitMapVisual,
} from '../game-engine/visuals/mapVisualEvents';
import {
  consumeAttackBuffs,
  executeTechAbility,
  isGameScopedAbility,
} from '../game-engine/abilities/executeTechAbility';

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
    map_kind: mapDoc.map_kind,
    worlds: mapDoc.worlds,
    orbit_access: mapDoc.orbit_access,
  };
}

const CURATED_STATIC_REGIONAL_MAP_IDS = new Set<string>([
  'community_britain_925',
  'community_horn_africa',
  'community_australia_1337',
  'community_flooded_north_america',
  'era_galaxy',
]);

async function resolveMap(mapId: string): Promise<GameMap | null> {
  if (mapId === 'tutorial') return getTutorialMap();
  // Curated regional maps should always resolve from static JSON so gameplay
  // uses the exact shipped geometry (avoids stale DB copies).
  if (CURATED_STATIC_REGIONAL_MAP_IDS.has(mapId)) {
    if (!isSafeMapId(mapId)) return null;
    const curatedPath = path.resolve(__dirname, '../../../database/maps', `${mapId}.json`);
    if (fs.existsSync(curatedPath)) {
      const data = JSON.parse(fs.readFileSync(curatedPath, 'utf-8'));
      return loadMapFromDoc(data);
    }
    return null;
  }
  const mapFromDb = await getMapById(mapId);
  if (mapFromDb) return mapFromDb;

  // Fallback: load from static JSON files in database/maps/
  if (!isSafeMapId(mapId)) return null;
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

// Per-game per-player combat accumulator (keyed gameId -> playerId -> stats)
interface PlayerCombatStats {
  attacks: number;
  attack_wins: number;
  defenses: number;
  defense_wins: number;
  territories_captured: number;
  /** Total units lost across attack + defense roles. */
  units_lost: number;
  /** Total units destroyed across attack + defense roles. */
  units_destroyed: number;
  /** Subset of attacks launched across sea connections (only meaningful when naval_enabled). */
  sea_attacks: number;
  /** Number of opposing players this player eliminated (last territory captured / influence-eliminated). */
  eliminations_dealt: number;
}
const gameCombatStats = new Map<string, Map<string, PlayerCombatStats>>();

function ensureCombatStats(gameId: string, playerId: string): PlayerCombatStats {
  if (!gameCombatStats.has(gameId)) gameCombatStats.set(gameId, new Map());
  const gm = gameCombatStats.get(gameId)!;
  if (!gm.has(playerId)) {
    gm.set(playerId, {
      attacks: 0,
      attack_wins: 0,
      defenses: 0,
      defense_wins: 0,
      territories_captured: 0,
      units_lost: 0,
      units_destroyed: 0,
      sea_attacks: 0,
      eliminations_dealt: 0,
    });
  }
  return gm.get(playerId)!;
}

function recordCombatResult(
  gameId: string,
  attackerId: string,
  defenderId: string | null,
  result: { attacker_losses: number; defender_losses: number; territory_captured: boolean },
  options: { isSea?: boolean } = {},
): void {
  const atk = ensureCombatStats(gameId, attackerId);
  atk.attacks++;
  if (options.isSea) atk.sea_attacks++;
  if (result.defender_losses > result.attacker_losses) atk.attack_wins++;
  if (result.territory_captured) atk.territories_captured++;
  atk.units_lost += result.attacker_losses;
  atk.units_destroyed += result.defender_losses;

  if (defenderId) {
    const def = ensureCombatStats(gameId, defenderId);
    def.defenses++;
    if (result.attacker_losses > result.defender_losses) def.defense_wins++;
    def.units_lost += result.defender_losses;
    def.units_destroyed += result.attacker_losses;
  }
}

/** Increment the eliminations counter for a player who just knocked out another. */
function recordElimination(gameId: string, eliminatorId: string): void {
  const stats = ensureCombatStats(gameId, eliminatorId);
  stats.eliminations_dealt++;
}

/** For GET /metrics/json — count of in-memory game rooms (ops signal, not player count). */
export function getActiveGameMetrics(): { activeGameRooms: number } {
  return { activeGameRooms: activeGames.size };
}

type WaitingLobbyPlayerRow = {
  player_index: number;
  user_id: string | null;
  username: string | null;
  faction_id: string | null;
  player_color: string;
  is_ai: boolean;
  ai_difficulty: string | null;
  is_eliminated: boolean;
};

type WaitingLobbyGameRow = {
  game_id: string;
  era_id: string;
  map_id: string;
  status: string;
  settings_json: string | Record<string, unknown>;
  join_code: string | null;
};

type WaitingLobbyDetails = {
  game: WaitingLobbyGameRow;
  players: WaitingLobbyPlayerRow[];
  settings: Record<string, unknown>;
  humanPlayers: WaitingLobbyPlayerRow[];
};

type LobbyProposalSettingKey =
  | 'fog_of_war'
  | 'turn_timer_seconds'
  | 'diplomacy_enabled'
  | 'initial_unit_count'
  | 'factions_enabled'
  | 'naval_enabled';

type WaitingLobbyProposal = {
  id: string;
  proposerId: string;
  proposerName: string;
  setting: LobbyProposalSettingKey;
  label: string;
  displayValue: string;
  proposedValue: boolean | number;
  yesVotes: string[];
  noVotes: string[];
  createdAt: number;
};

const lobbyProposalsByGame = new Map<string, WaitingLobbyProposal[]>();

const LOBBY_PROPOSABLE_SETTINGS: Record<LobbyProposalSettingKey, {
  label: string;
  parseValue: (value: unknown) => boolean | number | null;
  displayValue: (value: boolean | number) => string;
}> = {
  fog_of_war: {
    label: 'Fog of War',
    parseValue: (value) => (typeof value === 'boolean' ? value : null),
    displayValue: (value) => (value ? 'On' : 'Off'),
  },
  turn_timer_seconds: {
    label: 'Turn Timer',
    parseValue: (value) => {
      if (typeof value !== 'number') return null;
      return [0, 60, 120, 180, 300, 600].includes(value) ? value : null;
    },
    displayValue: (value) => {
      const secondsValue = Number(value);
      if (secondsValue === 0) return 'No limit';
      const minutes = Math.floor(secondsValue / 60);
      const seconds = secondsValue % 60;
      return `${minutes}:${String(seconds).padStart(2, '0')}`;
    },
  },
  diplomacy_enabled: {
    label: 'Diplomacy',
    parseValue: (value) => (typeof value === 'boolean' ? value : null),
    displayValue: (value) => (value ? 'On' : 'Off'),
  },
  initial_unit_count: {
    label: 'Starting Units',
    parseValue: (value) => {
      if (typeof value !== 'number') return null;
      return [1, 3, 5].includes(value) ? value : null;
    },
    displayValue: (value) => String(value),
  },
  factions_enabled: {
    label: 'Factions',
    parseValue: (value) => (typeof value === 'boolean' ? value : null),
    displayValue: (value) => (value ? 'On' : 'Off'),
  },
  naval_enabled: {
    label: 'Naval',
    parseValue: (value) => (typeof value === 'boolean' ? value : null),
    displayValue: (value) => (value ? 'On' : 'Off'),
  },
};

function parseLobbySettings(raw: string | Record<string, unknown>): Record<string, unknown> {
  try {
    return typeof raw === 'string'
      ? (JSON.parse(raw) as Record<string, unknown>)
      : (raw as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

async function loadWaitingLobbyDetails(gameId: string): Promise<WaitingLobbyDetails | null> {
  const game = await queryOne<WaitingLobbyGameRow>(
    'SELECT game_id, era_id, map_id, status, settings_json, join_code FROM games WHERE game_id = $1',
    [gameId],
  );
  if (!game) return null;

  const players = await query<WaitingLobbyPlayerRow>(
    `SELECT gp.player_index, gp.user_id, u.username, gp.player_color,
            gp.is_ai, gp.ai_difficulty, gp.is_eliminated, gp.faction_id
     FROM game_players gp
     LEFT JOIN users u ON u.user_id = gp.user_id
     WHERE gp.game_id = $1
     ORDER BY gp.player_index`,
    [gameId],
  );

  const settings = parseLobbySettings(game.settings_json);
  const humanPlayers = players.filter((player) => !player.is_ai && !!player.user_id);
  return { game, players, settings, humanPlayers };
}

function getLobbyProposalThreshold(humanCount: number): number {
  return Math.max(1, Math.floor(humanCount / 2) + 1);
}

function serializeLobbyProposals(gameId: string, humanPlayers: WaitingLobbyPlayerRow[], viewerId?: string) {
  const playerCount = Math.max(1, humanPlayers.length);
  const threshold = getLobbyProposalThreshold(playerCount);
  return (lobbyProposalsByGame.get(gameId) ?? []).map((proposal) => ({
    id: proposal.id,
    proposer: proposal.proposerId,
    proposerName: proposal.proposerName,
    setting: proposal.setting,
    label: proposal.label,
    displayValue: proposal.displayValue,
    yesVotes: proposal.yesVotes.length,
    noVotes: proposal.noVotes.length,
    playerCount,
    threshold,
    myVote: viewerId
      ? proposal.yesVotes.includes(viewerId)
        ? true
        : proposal.noVotes.includes(viewerId)
          ? false
          : null
      : null,
    createdAt: proposal.createdAt,
  }));
}

async function emitWaitingLobbySnapshot(io: Server, gameId: string, details?: WaitingLobbyDetails): Promise<void> {
  const lobby = details ?? await loadWaitingLobbyDetails(gameId);
  if (!lobby) return;
  io.to(gameId).emit('game:lobby_updated', {
    game_id: lobby.game.game_id,
    era_id: lobby.game.era_id,
    map_id: lobby.game.map_id,
    status: lobby.game.status,
    join_code: lobby.game.join_code ?? null,
    settings_json: lobby.settings,
    players: lobby.players.map((player) => ({
      player_index: player.player_index,
      user_id: player.user_id,
      username: player.username,
      player_color: player.player_color,
      is_ai: player.is_ai,
      ai_difficulty: player.ai_difficulty,
      is_eliminated: player.is_eliminated,
      final_rank: null as number | null,
      faction_id: player.faction_id ?? null,
    })),
  });
}

async function emitLobbyProposalUpdates(io: Server, gameId: string, details?: WaitingLobbyDetails): Promise<void> {
  const lobby = details ?? await loadWaitingLobbyDetails(gameId);
  if (!lobby) return;
  const socketsInRoom = await io.in(gameId).fetchSockets();
  for (const roomSocket of socketsInRoom) {
    const roomUserId = roomSocket.data?.userId as string | undefined;
    roomSocket.emit('game:lobby_proposal_update', serializeLobbyProposals(gameId, lobby.humanPlayers, roomUserId));
  }
}

function isUnclaimedOwner(ownerId: string | null | undefined): boolean {
  return ownerId == null || ownerId === '' || ownerId === 'neutral';
}

function isSocketUsersTurn(state: GameState, socketUserId: string, _socketUsername?: string): boolean {
  // The username argument is preserved for call-site compatibility but is
  // intentionally ignored: usernames are not security identifiers. With the
  // collision-prone Guest_XXXX scheme that previously generated 4-digit
  // suffixes (now fixed in /auth/guest), two simultaneous guests could share
  // a username, and this fallback would let either of them act on the
  // other's turn. We rely exclusively on the JWT subject (`socketUserId`).
  const currentPlayer = state.players[state.current_player_index];
  if (!currentPlayer) return false;
  if (currentPlayer.player_id === socketUserId) return true;

  // Edge-case alignment: an admin / migration may have shifted player_id
  // strings while preserving player_index. We still allow the turn if the
  // JWT subject maps to the active player_index.
  const byId = state.players.find((p) => p.player_id === socketUserId);
  return Boolean(byId && byId.player_index === currentPlayer.player_index);
}

// Turn timer enforcement: gameId → timeout handle
const turnTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Prevent overlapping AI turns: gameId → true while processAiTurn is running
const aiInFlight = new Set<string>();

const SPECTATOR_DELAY_MS = 30_000;
const SPECTATOR_BROADCAST_MS = 3_000;
const SPECTATOR_BUFFER_LIMIT = 24;
const SPECTATOR_CHAT_COOLDOWN_MS = 2_000;

// Adjacency cache: map_id → territory_id → neighbour_ids[]
// Built once per unique map when the first room using it loads; reused for fog
// visibility in buildClientState across all subsequent calls for that map.
const adjacencyByMapId = new Map<string, Map<string, string[]>>();

function getOrBuildAdjacency(map: GameMap): Map<string, string[]> {
  const cached = adjacencyByMapId.get(map.map_id);
  if (cached) return cached;
  const adj = new Map<string, string[]>();
  for (const conn of map.connections) {
    if (!adj.has(conn.from)) adj.set(conn.from, []);
    if (!adj.has(conn.to)) adj.set(conn.to, []);
    adj.get(conn.from)!.push(conn.to);
    adj.get(conn.to)!.push(conn.from);
  }
  adjacencyByMapId.set(map.map_id, adj);
  return adj;
}

const spectatorSocketsByGame = new Map<string, Set<string>>();
const spectatorStateBuffers = new Map<string, Array<{ timestamp: number; state: GameState; seq: number }>>();
const spectatorBroadcastLoops = new Map<string, ReturnType<typeof setInterval>>();
const spectatorSeqCounters = new Map<string, number>();

let gameIoSingleton: Server | null = null;

/** For HTTP handlers (invites, etc.) that need to emit to user rooms. */
export function getGameIo(): Server | null {
  return gameIoSingleton;
}

/**
 * Public re-export so HTTP route handlers (e.g. /api/lobby/faction-select)
 * can trigger a lobby broadcast without circular-import issues.
 */
export async function emitWaitingLobbySnapshotPublic(io: Server, gameId: string): Promise<void> {
  return emitWaitingLobbySnapshot(io, gameId);
}

export function initGameSocket(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: config.corsOrigins.length === 1 ? config.corsOrigins[0] : config.corsOrigins,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    // Ping cadence tuning (QA L3):
    //  - pingInterval 20s: server pings every 20s. Below 25s we react to
    //    flaky mobile networks faster; above ~15s we'd wake mobile radios
    //    unnecessarily.
    //  - pingTimeout 25s: a missed pong window of 25s is enough to ride out
    //    typical 4G→WiFi handoffs (~5–15s) without false-positive disconnects
    //    while still cutting dead sockets ~½ as fast as the previous 60s.
    //  - upgradeTimeout 10s: bound how long a transport upgrade can stall the
    //    handshake, so a degraded WebSocket path falls back to long-polling
    //    rather than hanging the player.
    //  - connectTimeout 30s: keep the initial connect grace generous; mobile
    //    cold starts can take a beat behind a captive portal.
    pingInterval: 20_000,
    pingTimeout: 25_000,
    upgradeTimeout: 10_000,
    connectTimeout: 30_000,
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
      getOrBuildAdjacency(gameMap);
      activeGames.set(gameId, { state: saved.state_json, map: gameMap, connectedSockets: new Map() });
      room = activeGames.get(gameId)!;
    }

    const { state, map } = room;

    // Stale-job guard: only process if turn/player still match
    if (state.phase === 'game_over') return;
    if (state.turn_number !== turnNumber || state.current_player_index !== playerIndex) return;

    // Auto-place draft units
    const autoDraft = autoPlaceDraftUnits(state);
    if (autoDraft.total > 0) {
      emitAutoDraftMapVisuals(io, gameId, state, autoDraft.placements);
      broadcastState(io, gameId, state);
      io.to(gameId).emit('game:turn_timeout', { appliedDraft: true, unitsPlaced: autoDraft.total });
    }

    advanceToNextPlayer(state, map);
    await saveGameState(gameId, state);
    broadcastEventCard(io, gameId, state, map);
    broadcastState(io, gameId, state);
    maybeEmitCoachingTip(io, gameId, state, map);

    const humanAfterAsync = state.players.find((p) => !p.is_ai);
    if (humanAfterAsync && maybeResolveDailyPuzzle(io, gameId, room, null, humanAfterAsync.player_id, finalizeGame)) {
      return;
    }

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
    socket.data.userId = payload.sub;
    socket.data.username = payload.username;
    next();
  });

  io.on('connection', (socket) => {
    const userId = (socket as Socket & { userId: string }).userId;
    const username = (socket as Socket & { username: string }).username;
    console.log(`[Socket] Connected: ${userId} (${socket.id})`);
    socket.join(`user:${userId}`);

    // ── Extracted handlers ──────────────────────────────────────────────────
    const ctx: SocketContext = {
      io, socket, userId, username,
      activeGames, broadcastState, scheduleDebouncedSave, isSocketUsersTurn,
    };
    registerChatHandlers(ctx);

    // ── Join Game Room ──────────────────────────────────────────────────────
    socket.on('game:join', async ({ gameId }: { gameId: string }) => {
      try {
        const game = await queryOne<WaitingLobbyGameRow>(
          'SELECT game_id, era_id, map_id, status, settings_json, join_code FROM games WHERE game_id = $1',
          [gameId]
        );
        if (!game) return socket.emit('error', { message: 'Game not found' });

        const players = await query<WaitingLobbyPlayerRow>(
          `SELECT gp.player_index, gp.user_id, u.username, gp.player_color,
                  gp.is_ai, gp.ai_difficulty, gp.is_eliminated, gp.faction_id
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
        // Cache player info for lobby chat
        const thisPlayer = players.find((p) => p.user_id === userId);
        socket.data = { ...socket.data, username: thisPlayer?.username ?? username, color: thisPlayer?.player_color ?? '#888' };

        if (game.status === 'waiting') {
          const waitingDetails: WaitingLobbyDetails = {
            game,
            players,
            settings: parseLobbySettings(game.settings_json),
            humanPlayers: players.filter((player) => !player.is_ai && !!player.user_id),
          };
          await emitWaitingLobbySnapshot(io, gameId, waitingDetails);
          await emitLobbyProposalUpdates(io, gameId, waitingDetails);
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
            getOrBuildAdjacency(gameMap);
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
          // Embed the map directly in the join handshake so private/pending
          // custom maps don't have to be re-fetched via the public REST
          // endpoint (which now requires the requester to be the creator
          // or have access to a public+approved map).
          socket.emit('game:map', { mapId: room.state.map_id, map: room.map });

          // Re-broadcast any pending choice-based event card so reconnecting players see the modal
          if (room.state.active_event?.choices?.length) {
            socket.emit('game:event_card', room.state.active_event);
          }

          // Re-send any pending truce proposals aimed at this user so they see the accept/decline
          // modal even if they disconnected between the proposal and this reconnect.
          if (room.state.pending_truces?.length) {
            for (const pt of room.state.pending_truces) {
              if (pt.target_id === userId) {
                const proposer = room.state.players.find((p) => p.player_id === pt.proposer_id);
                if (proposer) {
                  socket.emit('game:truce_proposal', {
                    gameId,
                    proposerId: pt.proposer_id,
                    proposerName: proposer.username,
                    proposerColor: proposer.color,
                  });
                }
              }
            }
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

    // ── Spectate Game ───────────────────────────────────────────────────────
    socket.on('game:spectate_join', async ({ gameId }: { gameId: string }) => {
      try {
        const game = await queryOne<{ game_id: string; status: string; map_id: string }>(
          'SELECT game_id, status, map_id FROM games WHERE game_id = $1',
          [gameId],
        );
        if (!game) return socket.emit('error', { message: 'Game not found' });
        if (game.status !== 'in_progress') return socket.emit('error', { message: 'Game is not in progress' });

        const spectatorRoom = `${gameId}:spectators`;
        socket.join(spectatorRoom);
        socket.data = { ...socket.data, spectating: gameId };

        if (!activeGames.has(gameId)) {
          const savedState = await queryOne<{ state_json: GameState }>(
            `SELECT state_json FROM game_states WHERE game_id = $1 ORDER BY turn_number DESC LIMIT 1`,
            [gameId],
          );
          if (savedState) {
            const gameMap = await resolveMap(game.map_id);
            if (gameMap) {
              repairDraftUnitsIfMissing(savedState.state_json, gameMap);
              repairLegacyGameState(savedState.state_json, gameMap);
              getOrBuildAdjacency(gameMap);
              activeGames.set(gameId, {
                state: savedState.state_json,
                map: gameMap,
                connectedSockets: new Map(),
              });
            }
          }
        }

        // Increment spectator count
        await query('UPDATE games SET spectator_count = spectator_count + 1 WHERE game_id = $1', [gameId]).catch(() => {});

        let spectators = spectatorSocketsByGame.get(gameId);
        if (!spectators) {
          spectators = new Set();
          spectatorSocketsByGame.set(gameId, spectators);
        }
        spectators.add(socket.id);

        const room = activeGames.get(gameId);
        if (room) {
          recordSpectatorState(gameId, room.state);
          const initEntry = getDelayedSpectatorState(gameId);
          socket.emit('game:state', initEntry
            ? { ...initEntry.state, _spectator_seq: initEntry.seq }
            : buildClientState(room.state, null, false));
          ensureSpectatorBroadcastLoop(io, gameId);

          // Broadcast updated spectator count
          const countRow = await queryOne<{ spectator_count: number }>(
            'SELECT spectator_count FROM games WHERE game_id = $1',
            [gameId],
          );
          io.to(gameId).emit('game:spectator_count', { count: countRow?.spectator_count ?? 0 });
          io.to(spectatorRoom).emit('game:spectator_count', { count: countRow?.spectator_count ?? 0 });
        }

        socket.emit('game:spectate_joined', { gameId });
      } catch (err) {
        console.error('[Socket] game:spectate_join error:', err);
        socket.emit('error', { message: 'Failed to spectate game' });
      }
    });

    socket.on('game:spectate_leave', async ({ gameId }: { gameId: string }) => {
      const spectatorRoom = `${gameId}:spectators`;
      socket.leave(spectatorRoom);
      socket.data = { ...socket.data, spectating: undefined };

      const spectators = spectatorSocketsByGame.get(gameId);
      spectators?.delete(socket.id);
      if (spectators && spectators.size === 0) {
        spectatorSocketsByGame.delete(gameId);
        stopSpectatorBroadcastLoop(gameId);
      }

      await query(
        'UPDATE games SET spectator_count = GREATEST(spectator_count - 1, 0) WHERE game_id = $1',
        [gameId],
      ).catch(() => {});

      const countRow = await queryOne<{ spectator_count: number }>(
        'SELECT spectator_count FROM games WHERE game_id = $1',
        [gameId],
      );
      io.to(gameId).emit('game:spectator_count', { count: countRow?.spectator_count ?? 0 });
      io.to(spectatorRoom).emit('game:spectator_count', { count: countRow?.spectator_count ?? 0 });
    });

    // ── Start Game ──────────────────────────────────────────────────────────
    socket.on('game:start', async ({ gameId }: { gameId: string }) => {
      try {
        const callerSeat = await queryOne<{ player_index: number }>(
          `SELECT player_index
           FROM game_players
           WHERE game_id = $1 AND user_id = $2
           LIMIT 1`,
          [gameId, userId],
        );
        const game = await queryOne<{
          game_id: string; era_id: string; map_id: string; status: string; settings_json: object;
          is_ranked: boolean;
        }>(
          'SELECT game_id, era_id, map_id, status, settings_json, COALESCE(is_ranked, false) AS is_ranked FROM games WHERE game_id = $1',
          [gameId]
        );
        if (!game) {
          return socket.emit('error', { message: 'Game not found' });
        }
        const startAuthError = getStartGameAuthorizationError({
          callerSeat,
          gameStatus: game.status,
        });
        if (startAuthError) {
          return socket.emit('error', { message: startAuthError });
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
            getOrBuildAdjacency(gameMap);
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
          socket.emit('game:map', { mapId: room.state.map_id, map: room.map });
          socket.emit('game:state', buildClientState(room.state, userId, room.state.settings.fog_of_war));
          return;
        }

        if (game.status !== 'waiting') {
          return socket.emit('error', { message: 'Game cannot be started' });
        }
        const players = await query<{
          player_index: number; user_id: string | null; username: string | null;
          player_color: string; is_ai: boolean; ai_difficulty: string | null;
          faction_id: string | null;
        }>(
          `SELECT gp.player_index, gp.user_id, u.username, gp.player_color, gp.is_ai, gp.ai_difficulty,
                  gp.faction_id
           FROM game_players gp
           LEFT JOIN users u ON u.user_id = gp.user_id
           WHERE gp.game_id = $1
           ORDER BY gp.player_index`,
          [gameId]
        );

        // Load map (tutorial maps are hardcoded; others from Postgres via getMapById)
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
          faction_id: p.faction_id ?? undefined,
        }));

        const settings = game.settings_json as GameState['settings'];
        const state = initializeGameState(game.game_id, game.era_id as GameState['era'], gameMap, playerStates, settings);

        const puzzleSpec = getDailyPuzzleSpec(state);
        if (puzzleSpec) {
          const humanId = playerStates.find((p) => !p.is_ai)?.player_id;
          const aiP = playerStates.find((p) => p.is_ai);
          const aiId = aiP?.player_id ?? `ai_${aiP?.player_index ?? 1}`;
          if (humanId) {
            applyDailyPuzzleScenario(state, gameMap, puzzleSpec, humanId, aiId);
          }
        }

        applyTutorialModuleBoost(state);

        // Populate connectedSockets from sockets currently in the room
        const connectedSockets = new Map<string, string>();
        const socketsInRoom = await io.in(gameId).fetchSockets();
        for (const s of socketsInRoom) {
          const remoteUserId = s.data?.userId as string | undefined;
          if (remoteUserId) {
            connectedSockets.set(s.id, remoteUserId);
          }
        }

        getOrBuildAdjacency(gameMap);
        activeGames.set(gameId, { state, map: gameMap, connectedSockets });

        // Compute game_type based on actual player composition at start
        const humanCount = players.filter((p) => !p.is_ai).length;
        const aiPlayerCount = players.filter((p) => p.is_ai).length;
        const gameType = aiPlayerCount === 0 ? 'multiplayer' : humanCount <= 1 ? 'solo' : 'hybrid';

        // Stamp the game-start time once, used by the post-game modal to
        // display total duration. Must come before save below so reconnects
        // see the same value.
        state.game_started_at = Date.now();

        // In-turn coaching eligibility — locked at game start so it can't be
        // weaponised mid-game by replacing humans with AI. Eligibility requires:
        //   • exactly one human player (to prevent giving one of two humans an edge),
        //   • every other seat is AI,
        //   • the game is not ranked (coaching is a casual aid).
        state.coaching_eligible = humanCount === 1 && aiPlayerCount >= 1 && !game.is_ranked;
        if (!state.coaching_eligible && state.settings.coaching_enabled) {
          // Player asked for coaching but game doesn't qualify — clear the flag.
          state.settings.coaching_enabled = undefined;
        }

        // Update DB
        await query('UPDATE games SET status = $1, started_at = NOW(), game_type = $2 WHERE game_id = $3', ['in_progress', gameType, gameId]);
        await saveGameState(gameId, state);
        lobbyProposalsByGame.delete(gameId);

        io.to(gameId).emit('game:started', { gameId });
        // Send the resolved map to every player in the room so client code
        // never has to re-fetch via REST during play (private/pending custom
        // maps would otherwise be invisible to non-creator participants).
        io.to(gameId).emit('game:map', { mapId: state.map_id, map: gameMap });
        broadcastState(io, gameId, state);

        // Increment play count for community/era maps. Server-triggered only:
        // the public REST endpoint that used to do this was unauthenticated
        // and could be hammered to inflate counts.
        void incrementPlayCount(game.map_id).catch((err) => {
          console.error('[Socket] Failed to increment map play count:', err);
        });

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
    socket.on('game:draft', ({ gameId, territoryId, units, action_id }: { gameId: string; territoryId: string; units: number; action_id?: string }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      const { state, map } = room;

      const currentPlayer = state.players[state.current_player_index];
      if (!currentPlayer) return socket.emit('error', { message: 'Not your turn' });
      if (!isSocketUsersTurn(state, userId, username)) return socket.emit('error', { message: 'Not your turn' });
      if (state.phase !== 'draft') return socket.emit('error', { message: 'Not in draft phase' });

      repairDraftUnitsIfMissing(state, map);
      const poolRemaining = state.draft_units_remaining ?? 0;
      if (units < 1 || units > poolRemaining) {
        return socket.emit('error', { message: `Cannot place ${units} units (${poolRemaining} remaining)` });
      }

      // Use the seated player's id (not raw JWT subject) so draft placement stays
      // consistent with isSocketUsersTurn when player_id strings were realigned.
      const actingPlayerId = currentPlayer.player_id;
      const territory = state.territories[territoryId];
      if (!territory || territory.owner_id !== actingPlayerId) {
        return socket.emit('error', { message: 'Invalid territory' });
      }

      if (state.settings.stability_enabled) {
        const cap = getDeployCap(territory.stability, {
          era: state.era,
          turnNumber: state.turn_number,
          economyEnabled: !!state.settings.economy_enabled,
          playerSpecialResource: currentPlayer.special_resource ?? 0,
        });
        const placements = state.draft_placements_this_turn ?? {};
        const alreadyPlaced = placements[territoryId] ?? 0;
        if (alreadyPlaced + units > cap) {
          const remainingCap = Math.max(0, cap - alreadyPlaced);
          return socket.emit('error', {
            message: `Stability cap reached — ${remainingCap} unit${remainingCap === 1 ? '' : 's'} left for this territory this draft`,
          });
        }
      }

      if (!checkAndRecordActionId(gameId, userId, action_id)) {
        return socket.emit('error', { message: 'Action already processed — please wait' });
      }

      const draftProbBefore = captureProbBefore(state, actingPlayerId);
      territory.unit_count += units;
      state.draft_units_remaining -= units;
      if (state.settings.stability_enabled) {
        state.draft_placements_this_turn = state.draft_placements_this_turn ?? {};
        state.draft_placements_this_turn[territoryId] = (state.draft_placements_this_turn[territoryId] ?? 0) + units;
      }
      commitActionDecision(
        gameId, state, userId, 'draft',
        `Deployed ${units} unit${units === 1 ? '' : 's'} to ${territoryName(map, territoryId)}`,
        draftProbBefore,
      );
      emitMapVisual(io, gameId, buildReinforceMapVisual({
        territoryId,
        units,
        totalAfter: territory.unit_count,
        playerId: actingPlayerId,
        state,
      }));
      broadcastState(io, gameId, state);
      scheduleDebouncedSave(gameId);
    });

    // ── Territory Selection (territory draft mode) ────────────────────────
    socket.on('game:select_territory', ({ gameId, territoryId, action_id }: { gameId: string; territoryId: string; action_id?: string }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      if (!checkAndRecordActionId(gameId, userId, action_id)) return;
      const { state, map } = room;

      if (state.phase !== 'territory_select') return socket.emit('error', { message: 'Not in territory selection phase' });
      const currentPlayer = state.players[state.current_player_index];
      if (!isSocketUsersTurn(state, userId, username)) return socket.emit('error', { message: 'Not your turn' });

      const territory = state.territories[territoryId];
      if (!territory) return socket.emit('error', { message: 'Territory not found' });
      if (!isUnclaimedOwner(territory.owner_id)) return socket.emit('error', { message: 'Territory already claimed' });

      if (territoryRequiresOrbitAccessForClaim(map, territoryId)) {
        const access = getOrbitAccessResult(state, currentPlayer, map, state.era);
        if (!access.allowed) {
          return socket.emit('error', { message: formatOrbitAccessError(access) });
        }
      }

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
        state.draft_placements_this_turn = {};
        state.current_player_index = 0;
        state.turn_number = 1;
        state.turn_started_at = Date.now();
        const firstPlayer = state.players[0];
        const bonus = calculateContinentBonuses(state, map, firstPlayer.player_id);
        const passiveReinforceBonus = getPlayerReinforceBonus(state, firstPlayer.player_id);
        state.draft_units_remaining = calculateReinforcements(
          firstPlayer.territory_count,
          bonus,
          state.players.length,
        ) + passiveReinforceBonus;
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
    socket.on('game:attack', ({ gameId, fromId, toId, action_id, breakTruce }: { gameId: string; fromId: string; toId: string; action_id?: string; breakTruce?: boolean }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      if (!checkAndRecordActionId(gameId, userId, action_id)) return;
      const { state, map } = room;

      const currentPlayer = state.players[state.current_player_index];
      if (!isSocketUsersTurn(state, userId, username)) return socket.emit('error', { message: 'Not your turn' });
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

      if (connectionRequiresMoonAccess(map, fromId, toId)) {
        const access = getOrbitAccessResult(state, currentPlayer, map, state.era);
        if (!access.allowed) {
          return socket.emit('error', { message: formatOrbitAccessError(access) });
        }
      }

      // ── Truce enforcement + break-truce logic ────────────────────────────────
      // defenderPlayer is hoisted so the retaliation-bonus check below can also use it.
      const defenderPlayer = state.players.find((p) => p.player_id === toTerritory.owner_id);

      // Retaliation bonus: if a previous attacker broke their truce with us, consume that stored
      // die and add it to this attack — one use only, triggered on the very next attack.
      let truceRetaliationBonus = 0;
      if (defenderPlayer && currentPlayer.truce_break_retaliations) {
        const retalIdx = currentPlayer.truce_break_retaliations.findIndex(
          (r) => r.against_player_id === defenderPlayer.player_id,
        );
        if (retalIdx !== -1) {
          truceRetaliationBonus = currentPlayer.truce_break_retaliations[retalIdx].dice_bonus;
          currentPlayer.truce_break_retaliations.splice(retalIdx, 1);
        }
      }

      // Truce enforcement: block unless the attacker explicitly opts to break it
      let truceBrokenDefenseBonus = 0;
      if (defenderPlayer) {
        const truceEntry = state.diplomacy.find(
          (d) =>
            (d.player_index_a === currentPlayer.player_index && d.player_index_b === defenderPlayer.player_index) ||
            (d.player_index_a === defenderPlayer.player_index && d.player_index_b === currentPlayer.player_index),
        );
        if (truceEntry?.status === 'truce' && truceEntry.truce_turns_remaining > 0) {
          if (!breakTruce) {
            return socket.emit('error', { message: 'You have an active truce with this player' });
          }
          // Player confirmed the truce break — nullify and apply loyalty penalties
          truceEntry.status = 'neutral';
          truceEntry.truce_turns_remaining = 0;
          truceBrokenDefenseBonus = 1; // defender gets +1 die for this single attack

          // Grant the betrayed player a one-use +1 attack die for their next attack against us
          if (!defenderPlayer.truce_break_retaliations) defenderPlayer.truce_break_retaliations = [];
          const existing = defenderPlayer.truce_break_retaliations.find(
            (r) => r.against_player_id === userId,
          );
          if (existing) {
            existing.dice_bonus += 1; // stack if somehow broken twice before use
          } else {
            defenderPlayer.truce_break_retaliations.push({ against_player_id: userId, dice_bonus: 1 });
          }

          // Notify the betrayed player immediately
          io.to(`user:${defenderPlayer.player_id}`).emit('game:truce_broken', {
            breakerName: currentPlayer.username,
            breakerColor: currentPlayer.color,
            breakerId: userId,
          });
        }
      }

      // Track most-recently-attacked opponent for event card truce targeting
      if (toTerritory.owner_id) {
        currentPlayer.last_attacked_player_id = toTerritory.owner_id;
      }

      // Determine attack dice count
      // Modern era precision strike: 3 dice when attacker meets unit threshold
      const precisionMinUnits = getPrecisionStrikeMinUnits(state, userId);
      const precisionDiceOverride =
        state.era_modifiers?.precision_strike && fromTerritory.unit_count >= precisionMinUnits
          ? 3
          : undefined;

      const attackBuffs = consumeAttackBuffs(currentPlayer);

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
          emitMapVisual(io, gameId, buildNavalMapVisual({
            fromId,
            toId,
            attackerId: userId,
            attackerLosses: navalResult.attacker_losses,
            defenderLosses: navalResult.defender_losses,
            attackerWon: navalResult.attacker_won,
            state,
          }));
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
      let buildingDefenseBonus = getBuildingDefenseBonus(state, toId);
      if (attackBuffs.ignoreDefenseBuilding || attackerIgnoresDefenseBuilding(state, userId)) {
        buildingDefenseBonus = 0;
      }
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
      // Fortify the Coast: coastal_battery grants +1 defense die ONLY when the incoming
      // attack traverses a sea connection. Land and orbit attacks receive no bonus.
      const seaDefenseBonus = connection?.type === 'sea'
        ? getSeaDefenseBonus(state, toId)
        : 0;
      const totalDefenseBonus = buildingDefenseBonus + techDefenseBonus + factionDefenseBonus + eventDefenseBonus + wonderDefenseBonus + seaDefenseBonus + truceBrokenDefenseBonus;
      const defenderBonusBreakdown = {
        building: buildingDefenseBonus,
        tech: techDefenseBonus,
        faction: factionDefenseBonus,
        event: eventDefenseBonus,
        wonder: wonderDefenseBonus,
        sea: seaDefenseBonus,
        truce_break: truceBrokenDefenseBonus,
        total: totalDefenseBonus,
      };
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

      // Blitzkrieg: this attack qualifies as the bonus follow-up if the source
      // matches the territory we just captured from while the doctrine was
      // active. The bonus grants +1 attack die for a single attack and is
      // consumed after this resolution (success or failure).
      const isBlitzkriegBonusAttack =
        !!state.blitzkrieg_active
        && !state.blitzkrieg_attacked
        && state.blitzkrieg_bonus_source_id === fromId;
      const blitzkriegBonus = isBlitzkriegBonusAttack ? 1 : 0;
      const underdefendedBonus = getUnderdefendedAttackDiceBonus(state, userId, toTerritory.unit_count);
      const pendingAttackDieBonus = attackBuffs.extraAttackDie ? 1 : 0;

      const combinedAttackBonus =
        techAttackBonus + factionAttackBonus + eventAttackBonus + truceRetaliationBonus
        + blitzkriegBonus + underdefendedBonus + pendingAttackDieBonus;
      const attackerBonusBreakdown = {
        tech: techAttackBonus,
        faction: factionAttackBonus,
        event: eventAttackBonus,
        truce_retaliation: truceRetaliationBonus,
        blitzkrieg: blitzkriegBonus,
        total: combinedAttackBonus,
      };
      const finalAttackerDiceOverride = attackerDiceOverride !== undefined
        ? attackerDiceOverride + combinedAttackBonus
        : combinedAttackBonus > 0
          ? Math.min(fromTerritory.unit_count - 1, 3) + combinedAttackBonus
          : undefined;

      const puzzleSpecPre = getDailyPuzzleSpec(state);
      const stateBeforePuzzle =
        puzzleSpecPre && puzzleSpecPre.archetype !== 'domination'
          ? (JSON.parse(JSON.stringify(state)) as GameState)
          : null;
      const puzzleDieRoll = state.puzzle_dice_queue?.length ? createPuzzleDieRoll(state) : undefined;

      const attackProbBefore = captureProbBefore(state, userId);
      const defenderIdBeforeCombat = toTerritory.owner_id;
      const attackerUnitsCommitted = fromTerritory.unit_count;

      if (attackBuffs.preAttackDamage > 0) {
        toTerritory.unit_count = Math.max(1, toTerritory.unit_count - attackBuffs.preAttackDamage);
        emitPreAttackAirStrikeVisuals(io, gameId, {
          preAttackDamage: attackBuffs.preAttackDamage,
          fromTerritoryId: fromId,
          targetTerritoryId: toId,
          attacker: {
            player_id: userId,
            username: currentPlayer.username,
            color: currentPlayer.color,
          },
          defenderId: defenderIdBeforeCombat,
          state,
          map,
        });
      }

      const result = resolveCombat(
      fromTerritory.unit_count,
      toTerritory.unit_count,
      finalAttackerDiceOverride,
      defenderDiceOverride,
      puzzleDieRoll,
      state.era_modifiers,
    );
      result.attacker_bonus_breakdown = attackerBonusBreakdown;
      result.defender_bonus_breakdown = defenderBonusBreakdown;

      fromTerritory.unit_count -= result.attacker_losses;
      toTerritory.unit_count -= result.defender_losses;

      // Accumulate per-player combat stats for post-game breakdown
      const defenderId = toTerritory.owner_id;
      recordCombatResult(gameId, userId, defenderId ?? null, result, {
        isSea: connection?.type === 'sea',
      });

      let cardEarned = false;
      let defenderEliminated = false;
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

        // ── Blitzkrieg ability: arm bonus attack ──────────────────────────────
        // If the active player has Blitzkrieg active and has not yet fired their
        // bonus attack this turn, the capture they just performed unlocks one
        // bonus attack from the SAME source territory. The next attack
        // originating from `blitzkrieg_bonus_source_id` is treated as the bonus
        // (see attack-handler entry below) and clears the gate.
        if (state.blitzkrieg_active && !state.blitzkrieg_attacked) {
          state.blitzkrieg_bonus_source_id = fromId;
        }

        const defenderPlayer = state.players.find((p) => p.player_id === defenderId);
        if (defenderPlayer) {
          syncTerritoryCounts(state);
          if (defenderPlayer.territory_count === 0) {
            defenderPlayer.is_eliminated = true;
            defenderEliminated = true;
            currentPlayer.cards.push(...defenderPlayer.cards);
            defenderPlayer.cards = [];
            recordElimination(gameId, userId);
            io.to(gameId).emit('game:player_eliminated', {
              playerId: defenderId,
              eliminatorId: userId,
              eliminatorName: currentPlayer.username,
              eliminatedName: defenderPlayer.username,
              secretMission: defenderPlayer.secret_mission ?? null,
            });
          }
        }
      }

      // Classic Risk rule: at most one territory card per turn, regardless of
      // how many captures you make. `card_earned_this_turn` is reset in
      // `advanceToNextPlayer` so multi-attack turns can't farm extra cards.
      if (cardEarned && !currentPlayer.card_earned_this_turn) {
        drawCard(state, userId);
        currentPlayer.card_earned_this_turn = true;
      }

      // Consume the Blitzkrieg bonus once the follow-up attack resolves
      // (success or failure). One bonus per turn — the doctrine is then idle
      // until reactivated next turn.
      if (isBlitzkriegBonusAttack) {
        state.blitzkrieg_attacked = true;
        state.blitzkrieg_bonus_source_id = null;
        state.blitzkrieg_active = false;
      }

      const attackSummary = (() => {
        const fromName = territoryName(map, fromId);
        const toName = territoryName(map, toId);
        const outcome = result.territory_captured
          ? `captured ${toName}`
          : `failed (lost ${result.attacker_losses})`;
        return `Attacked ${fromName} → ${toName} with ${attackerUnitsCommitted} units; ${outcome}`;
      })();

      if (maybeResolveDailyPuzzle(io, gameId, room, stateBeforePuzzle, userId, finalizeGame)) {
        commitActionDecision(gameId, state, userId, 'attack', attackSummary, attackProbBefore);
        io.to(gameId).emit('game:combat_result', { fromId, toId, result });
        emitMapVisual(io, gameId, buildCombatMapVisual({
          fromId,
          toId,
          attackerId: userId,
          defenderId: defenderIdBeforeCombat,
          attackerLosses: result.attacker_losses,
          defenderLosses: result.defender_losses,
          territoryCaptured: result.territory_captured,
          state,
        }));
        broadcastState(io, gameId, state);
        scheduleDebouncedSave(gameId);
        return;
      }

      // Check victory
      const victoryResult = checkVictory(state, map);
      if (victoryResult) {
        const { winnerIds, condition } = victoryResult;
        const winnerId = winnerIds[0]!;
        state.phase = 'game_over';
        state.winner_id = winnerId;
        state.winner_ids = winnerIds;
        state.victory_condition = condition;
        commitActionDecision(gameId, state, userId, 'attack', attackSummary, attackProbBefore);
        finalizeGame(io, gameId, state, winnerIds);
      } else if (defenderEliminated) {
        appendWinProbabilitySnapshot(state);
        commitActionDecision(gameId, state, userId, 'attack', attackSummary, attackProbBefore);
      } else {
        commitActionDecision(gameId, state, userId, 'attack', attackSummary, attackProbBefore);
      }

      io.to(gameId).emit('game:combat_result', { fromId, toId, result });
      emitMapVisual(io, gameId, buildCombatMapVisual({
        fromId,
        toId,
        attackerId: userId,
        defenderId: defenderIdBeforeCombat,
        attackerLosses: result.attacker_losses,
        defenderLosses: result.defender_losses,
        territoryCaptured: result.territory_captured,
        state,
      }));
      broadcastState(io, gameId, state);
      scheduleDebouncedSave(gameId);
    });

    // ── Advance Phase ───────────────────────────────────────────────────────
    socket.on('game:advance_phase', ({ gameId, action_id }: { gameId: string; action_id?: string }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      if (!checkAndRecordActionId(gameId, userId, action_id)) return;
      const { state, map } = room;

      const currentPlayer = state.players[state.current_player_index];
      if (!isSocketUsersTurn(state, userId, username)) return socket.emit('error', { message: 'Not your turn' });

      if (state.phase === 'draft') {
        // Auto-place any unspent draft units on the player's territories
        // before flipping to attack. The previous behaviour silently zeroed
        // out the remaining pool, which was a UX trap (players who clicked
        // "Next Phase" without finishing reinforcement lost the units),
        // and inconsistent with the turn-timer expiration path which
        // already auto-places via `autoPlaceDraftUnits`.
        if (state.draft_units_remaining > 0) {
          const autoDraft = autoPlaceDraftUnits(state);
          if (autoDraft.total > 0) {
            emitAutoDraftMapVisuals(io, gameId, state, autoDraft.placements);
          }
        }
        state.draft_units_remaining = 0;
        state.phase = 'attack';
      } else if (state.phase === 'attack') {
        state.phase = 'fortify';
      } else if (state.phase === 'fortify') {
        // Defensive reset: `advanceToNextPlayer` resets fortify_moves_used at
        // turn start, but we also clear it here so any code path that reads
        // the state between this advance and the next turn sees a clean
        // counter (matters for AI debugging and replay reconstruction).
        state.fortify_moves_used = 0;
        advanceToNextPlayer(state, map);
        broadcastEventCard(io, gameId, state, map);

        if (maybeResolveDailyPuzzle(io, gameId, room, null, userId, finalizeGame)) {
          broadcastState(io, gameId, state);
          scheduleDebouncedSave(gameId);
          return;
        }

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
      maybeEmitCoachingTip(io, gameId, state, map);
    });

    // ── Fortify Action ──────────────────────────────────────────────────────
    socket.on('game:fortify', ({ gameId, fromId, toId, units, action_id }: {
      gameId: string; fromId: string; toId: string; units: number; action_id?: string;
    }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      if (!checkAndRecordActionId(gameId, userId, action_id)) return;
      const { state, map } = room;

      const currentPlayer = state.players[state.current_player_index];
      if (!isSocketUsersTurn(state, userId, username)) return socket.emit('error', { message: 'Not your turn' });
      if (state.phase !== 'fortify') return socket.emit('error', { message: 'Not in fortify phase' });

      const from = state.territories[fromId];
      const to = state.territories[toId];
      if (!from || from.owner_id !== userId || !to || to.owner_id !== userId) {
        return socket.emit('error', { message: 'Invalid territories for fortification' });
      }
      const fortifyUnitsError = getFortifyUnitsValidationError(units);
      if (fortifyUnitsError) {
        return socket.emit('error', { message: fortifyUnitsError });
      }
      if (units >= from.unit_count) {
        return socket.emit('error', { message: 'Must leave at least 1 unit behind' });
      }

      // Verify path exists via BFS
      if (!pathExists(fromId, toId, state, map, userId)) {
        return socket.emit('error', { message: 'No connected path between territories' });
      }

      if (fortifyEndpointsRequireOrbitAccess(map, state.era, fromId, toId)) {
        const access = getOrbitAccessResult(state, currentPlayer, map, state.era);
        if (!access.allowed) {
          return socket.emit('error', { message: formatOrbitAccessError(access) });
        }
      }

      const fortifyMoveLimit = getFortifyMoveLimit(state, userId);
      const movesUsed = state.fortify_moves_used ?? 0;
      if (movesUsed >= fortifyMoveLimit) {
        return socket.emit('error', { message: `Fortify limit reached (${fortifyMoveLimit} moves per turn)` });
      }

      const fortifyProbBefore = captureProbBefore(state, userId);
      from.unit_count -= units;
      to.unit_count += units;
      state.fortify_moves_used = movesUsed + 1;
      commitActionDecision(
        gameId, state, userId, 'fortify',
        `Fortified ${territoryName(map, fromId)} → ${territoryName(map, toId)} with ${units} unit${units === 1 ? '' : 's'}`,
        fortifyProbBefore,
      );
      emitMapVisual(io, gameId, buildFortifyMapVisual({
        fromTerritoryId: fromId,
        toTerritoryId: toId,
        units,
        playerId: currentPlayer.player_id,
        state,
      }));
      broadcastState(io, gameId, state);
      scheduleDebouncedSave(gameId);
    });

    // ── Redeem Cards ────────────────────────────────────────────────────────
    socket.on('game:redeem_cards', ({ gameId, cardIds, action_id }: { gameId: string; cardIds: string[]; action_id?: string }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      if (!checkAndRecordActionId(gameId, userId, action_id)) return;
      const { state } = room;

      const currentPlayer = state.players[state.current_player_index];
      if (!isSocketUsersTurn(state, userId, username)) return socket.emit('error', { message: 'Not your turn' });
      if (state.phase !== 'draft') return socket.emit('error', { message: 'Cards can only be redeemed during the draft phase' });

      const redeemProbBefore = captureProbBefore(state, userId);
      try {
        const bonus = redeemCardSet(state, userId, cardIds);
        state.draft_units_remaining += bonus;
        commitActionDecision(
          gameId, state, userId, 'redeem_cards',
          `Redeemed card set for +${bonus} units`,
          redeemProbBefore,
        );
        socket.emit('game:cards_redeemed', { bonus });
        broadcastState(io, gameId, state);
        scheduleDebouncedSave(gameId);
      } catch (err: unknown) {
        socket.emit('error', { message: err instanceof Error ? err.message : 'Card redemption failed' });
      }
    });

    // ── Build (Economy) ──────────────────────────────────────────────────────
    socket.on('game:build', ({ gameId, territoryId, buildingType, action_id }: {
      gameId: string; territoryId: string; buildingType: BuildingType; action_id?: string;
    }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      if (!checkAndRecordActionId(gameId, userId, action_id)) return;
      const { state, map } = room;

      const currentPlayer = state.players[state.current_player_index];
      if (!isSocketUsersTurn(state, userId, username)) return socket.emit('error', { message: 'Not your turn' });
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

      const specB = getDailyPuzzleSpec(state);
      const stateBeforeBuild =
        specB && specB.archetype !== 'domination'
          ? (JSON.parse(JSON.stringify(state)) as GameState)
          : null;

      const buildProbBefore = captureProbBefore(state, userId);
      applyBuild(state, userId, territoryId, buildingType);
      commitActionDecision(
        gameId, state, userId, 'build',
        `Built ${buildingType.replace(/_/g, ' ')} on ${territoryName(map, territoryId)}`,
        buildProbBefore,
      );
      socket.emit('game:build_result', { territoryId, buildingType, success: true });
      // Quest check: first building
      checkOnboardingQuests(userId, 'build').catch(() => {});
      // Announce wonder construction to the whole room
      if (buildingType.startsWith('wonder_')) {
        io.to(gameId).emit('game:wonder_built', {
          wonderId: buildingType,
          builderName: currentPlayer.username,
          builderColor: currentPlayer.color,
          territoryId,
        });
      }
      if (maybeResolveDailyPuzzle(io, gameId, room, stateBeforeBuild, userId, finalizeGame)) {
        broadcastState(io, gameId, state);
        scheduleDebouncedSave(gameId);
        return;
      }
      broadcastState(io, gameId, state);
      scheduleDebouncedSave(gameId);
    });

    // ── Naval Move (relocate fleets between own coastal territories) ─────────
    socket.on('game:naval_move', ({ gameId, fromId, toId, count, action_id }: {
      gameId: string; fromId: string; toId: string; count: number; action_id?: string;
    }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      if (!checkAndRecordActionId(gameId, userId, action_id)) return;
      const { state, map } = room;

      if (!state.settings.naval_enabled) return socket.emit('error', { message: 'Naval warfare not enabled' });
      const currentPlayer = state.players[state.current_player_index];
      if (!isSocketUsersTurn(state, userId, username)) return socket.emit('error', { message: 'Not your turn' });
      if (state.phase !== 'attack' && state.phase !== 'fortify') {
        return socket.emit('error', { message: 'Fleets can only move during attack or fortify phase' });
      }

      const navalMoveProbBefore = captureProbBefore(state, userId);
      const result = moveFleets(state, fromId, toId, count, map, userId);
      if (!result.success) return socket.emit('error', { message: result.error ?? 'Fleet move failed' });

      commitActionDecision(
        gameId, state, userId, 'naval_move',
        `Moved ${count} fleet${count === 1 ? '' : 's'}: ${territoryName(map, fromId)} → ${territoryName(map, toId)}`,
        navalMoveProbBefore,
      );
      broadcastState(io, gameId, state);
      scheduleDebouncedSave(gameId);
    });

    // ── Naval Attack (standalone fleet combat / blockade) ────────────────────
    socket.on('game:naval_attack', ({ gameId, fromId, toId, action_id }: {
      gameId: string; fromId: string; toId: string; action_id?: string;
    }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      if (!checkAndRecordActionId(gameId, userId, action_id)) return;
      const { state, map } = room;

      if (!state.settings.naval_enabled) return socket.emit('error', { message: 'Naval warfare not enabled' });
      const currentPlayer = state.players[state.current_player_index];
      if (!isSocketUsersTurn(state, userId, username)) return socket.emit('error', { message: 'Not your turn' });
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

      // Enforce active truce — naval attacks are blocked just like land attacks
      const navalDefenderPlayer = state.players.find((p) => p.player_id === toTerritory.owner_id);
      if (navalDefenderPlayer) {
        const navalTruceEntry = state.diplomacy.find(
          (d) =>
            (d.player_index_a === currentPlayer.player_index && d.player_index_b === navalDefenderPlayer.player_index) ||
            (d.player_index_a === navalDefenderPlayer.player_index && d.player_index_b === currentPlayer.player_index),
        );
        if (navalTruceEntry?.status === 'truce' && navalTruceEntry.truce_turns_remaining > 0) {
          return socket.emit('error', { message: 'You have an active truce with this player' });
        }
      }

      const navalAttackProbBefore = captureProbBefore(state, userId);
      const navalResult = resolveNavalCombat(fromTerritory.naval_units, toTerritory.naval_units || 1);
      fromTerritory.naval_units = Math.max(0, fromTerritory.naval_units - navalResult.attacker_losses);
      toTerritory.naval_units = Math.max(0, (toTerritory.naval_units ?? 0) - navalResult.defender_losses);

      commitActionDecision(
        gameId, state, userId, 'naval_attack',
        `Naval attack ${territoryName(map, fromId)} → ${territoryName(map, toId)} (${navalResult.attacker_won ? 'won' : 'lost'})`,
        navalAttackProbBefore,
      );
      io.to(gameId).emit('game:naval_combat_result', { fromId, toId, result: navalResult });
      emitMapVisual(io, gameId, buildNavalMapVisual({
        fromId,
        toId,
        attackerId: userId,
        attackerLosses: navalResult.attacker_losses,
        defenderLosses: navalResult.defender_losses,
        attackerWon: navalResult.attacker_won,
        state,
      }));
      broadcastState(io, gameId, state);
      scheduleDebouncedSave(gameId);
    });

    // ── Tutorial Settings Lab (advanced_settings lesson) ─────────────────────
    socket.on('game:tutorial_apply_settings', ({
      gameId,
      settings,
    }: {
      gameId: string;
      settings: Record<string, boolean>;
    }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      const { state } = room;
      if (!state.settings.tutorial || state.settings.tutorial_lesson_module !== 'advanced_settings') {
        return socket.emit('error', { message: 'Settings Lab is only available in the Advanced Settings tutorial' });
      }
      if (state.settings.tutorial_settings_lab_applied) {
        return socket.emit('game:tutorial_settings_applied', { applied: [] });
      }

      const applied = applyTutorialSettingsLab(state, settings);
      socket.emit('game:tutorial_settings_applied', { applied });
      broadcastState(io, gameId, state);
      scheduleDebouncedSave(gameId);
    });

    // ── Research Tech ────────────────────────────────────────────────────────
    socket.on('game:research_tech', ({ gameId, techId, action_id }: { gameId: string; techId: string; action_id?: string }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      if (!checkAndRecordActionId(gameId, userId, action_id)) return;
      const { state } = room;

      const currentPlayer = state.players[state.current_player_index];
      if (!isSocketUsersTurn(state, userId, username)) return socket.emit('error', { message: 'Not your turn' });
      if (state.phase !== 'draft' && state.phase !== 'fortify') {
        return socket.emit('error', { message: 'Technology can only be researched during draft or fortify phase' });
      }

      const validation = validateResearch(state, userId, techId);
      if (!validation.valid) {
        return socket.emit('error', { message: validation.error ?? 'Cannot research this technology' });
      }

      const specR = getDailyPuzzleSpec(state);
      const stateBeforeResearch =
        specR && specR.archetype !== 'domination'
          ? (JSON.parse(JSON.stringify(state)) as GameState)
          : null;

      const researchProbBefore = captureProbBefore(state, userId);
      applyResearch(state, userId, validation.node!);
      commitActionDecision(
        gameId, state, userId, 'research',
        `Researched ${validation.node?.name ?? techId}`,
        researchProbBefore,
      );
      socket.emit('game:research_result', { techId, success: true, node: validation.node });
      checkOnboardingQuests(userId, 'research').catch(() => {});
      if (maybeResolveDailyPuzzle(io, gameId, room, stateBeforeResearch, userId, finalizeGame)) {
        broadcastState(io, gameId, state);
        scheduleDebouncedSave(gameId);
        return;
      }
      broadcastState(io, gameId, state);
      scheduleDebouncedSave(gameId);
    });

    // ── Use Ability ──────────────────────────────────────────────────────────
    // Generic handler for once-per-turn faction/tech abilities not covered by
    // dedicated events (influence, blitzkrieg, etc.).
    socket.on('game:use_ability', ({ gameId, abilityId, params, action_id }: {
      gameId: string;
      abilityId: string;
      params?: Record<string, unknown>;
      action_id?: string;
    }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      if (!checkAndRecordActionId(gameId, userId, action_id)) return;
      const { state, map } = room;

      const currentPlayer = state.players[state.current_player_index];
      if (!isSocketUsersTurn(state, userId, username)) return socket.emit('error', { message: 'Not your turn' });

      // Check ability cooldown (once per turn) — skip for once-per-game abilities
      const isGameScoped = isGameScopedAbility(abilityId);
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

      const abilityProbBefore = captureProbBefore(state, userId);
      const recordAbility = (summary: string) => {
        commitActionDecision(gameId, state, userId, 'ability', summary, abilityProbBefore);
      };

      // Record turn-scoped use now; game-scoped uses are recorded inside executeTechAbility
      // only after all guards pass, so a failed validation doesn't consume the ability.
      if (!isGameScoped) {
        currentPlayer.ability_uses = { ...uses, [abilityId]: 1 };
      }

      // ── Faction abilities with bespoke handlers ───────────────────────────
      if (abilityId === 'blitzkrieg' || abilityId === 'double_blitz') {
        state.blitzkrieg_active = true;
        state.blitzkrieg_attacked = false;
        state.blitzkrieg_bonus_source_id = null;
        recordAbility(`Activated ${abilityId}`);
        socket.emit('game:ability_result', { abilityId, success: true, effect: 'blitzkrieg_ready' });
        broadcastState(io, gameId, state);
        return;
      }

      if (abilityId === 'guerrilla_warfare') {
        const territoryId = params?.territoryId as string;
        if (!territoryId) return socket.emit('error', { message: 'Provide territoryId' });
        const t = state.territories[territoryId];
        if (!t || t.owner_id !== userId) return socket.emit('error', { message: 'Invalid territory' });
        t.unit_count += 1;
        syncTerritoryCounts(state);
        recordAbility(`Guerrilla warfare: +1 unit on ${territoryName(map, territoryId)}`);
        socket.emit('game:ability_result', { abilityId, success: true, territoryId });
        broadcastState(io, gameId, state);
        scheduleDebouncedSave(gameId);
        return;
      }

      // ── Tech abilities (centralized execution) ────────────────────────────
      const territoryId = params?.territoryId as string | undefined;
      const execResult = executeTechAbility({
        state,
        map,
        playerId: userId,
        abilityId,
        territoryId,
      });

      if (!execResult.success) {
        // Roll back turn-scoped consumption on failure
        if (!isGameScoped) {
          const rolledBack = { ...currentPlayer.ability_uses };
          delete rolledBack[abilityId];
          currentPlayer.ability_uses = rolledBack;
        }
        return socket.emit('error', { message: execResult.error ?? 'Ability failed' });
      }

      if (execResult.effect === 'atom_bomb_detonated' && execResult.territoryId) {
        const previousOwner = execResult.previousOwner;
        if (previousOwner) {
          const prevPlayer = state.players.find((p) => p.player_id === previousOwner);
          if (prevPlayer && prevPlayer.territory_count === 0) {
            prevPlayer.is_eliminated = true;
            currentPlayer.cards.push(...prevPlayer.cards);
            prevPlayer.cards = [];
            recordElimination(gameId, userId);
            io.to(gameId).emit('game:player_eliminated', {
              playerId: previousOwner,
              eliminatorId: userId,
              eliminatorName: currentPlayer.username,
              eliminatedName: prevPlayer.username,
              secretMission: prevPlayer.secret_mission ?? null,
            });
          }
        }
        recordAbility(`Atom bomb on ${territoryName(map, execResult.territoryId)}`);
        const targetOwner = execResult.previousOwner
          ? state.players.find((p) => p.player_id === execResult.previousOwner)
          : undefined;
        emitAbilityStrikeVisuals(io, gameId, buildStrikeAnimationPayload({
          abilityId,
          attackerId: userId,
          attackerName: currentPlayer.username,
          attackerColor: currentPlayer.color,
          territoryId: execResult.territoryId,
          targetOwnerId: execResult.previousOwner ?? null,
          targetOwnerName: targetOwner?.username ?? null,
        }), { state, map });
        socket.emit('game:ability_result', { ...execResult, abilityId, success: true });
        broadcastState(io, gameId, state);
        scheduleDebouncedSave(gameId);
        const atomBombVictoryResult = checkVictory(state, map);
        if (atomBombVictoryResult) {
          const { winnerIds, condition } = atomBombVictoryResult;
          state.phase = 'game_over';
          state.winner_id = winnerIds[0]!;
          state.winner_ids = winnerIds;
          state.victory_condition = condition;
          finalizeGame(io, gameId, state, winnerIds);
        }
        return;
      }

      if (execResult.effect === 'space_station_launched' && execResult.territoryId) {
        recordAbility('Launched Space Station');
        io.to(gameId).emit('game:space_station_launched', {
          playerId: userId,
          playerName: currentPlayer.username,
          playerColor: currentPlayer.color,
          launchTerritoryId: execResult.territoryId,
        });
        socket.emit('game:ability_result', { ...execResult, abilityId, success: true });
        broadcastState(io, gameId, state);
        scheduleDebouncedSave(gameId);
        return;
      }

      const abilityLabel = abilityId.replace(/_/g, ' ');
      if (execResult.territoryId) {
        recordAbility(`${abilityLabel} on ${territoryName(map, execResult.territoryId)}`);
      } else {
        recordAbility(`Activated ${abilityLabel}`);
      }

      if (shouldEmitAbilityStrikeVisuals(abilityId, execResult.effect) && execResult.territoryId) {
        const targetOwner = execResult.previousOwner
          ? state.players.find((p) => p.player_id === execResult.previousOwner)
          : undefined;
        emitAbilityStrikeVisuals(io, gameId, buildStrikeAnimationPayload({
          abilityId,
          attackerId: userId,
          attackerName: currentPlayer.username,
          attackerColor: currentPlayer.color,
          territoryId: execResult.territoryId,
          targetOwnerId: execResult.previousOwner ?? null,
          targetOwnerName: targetOwner?.username ?? null,
        }), { state, map });
      }

      socket.emit('game:ability_result', { ...execResult, abilityId, success: true });
      broadcastState(io, gameId, state);
      scheduleDebouncedSave(gameId);
    });

    // ── Influence (Cold War / Risorgimento era ability) ──────────────────────
    // Converts a neutral or enemy territory within influence_range hops of any
    // owned territory, costing 3 of the current player's units (spread across
    // adjacent owned territories). Only one use per turn.
    socket.on('game:influence', ({ gameId, targetId, action_id }: { gameId: string; targetId: string; action_id?: string }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      if (!checkAndRecordActionId(gameId, userId, action_id)) return;
      const { state, map } = room;

      const currentPlayer = state.players[state.current_player_index];
      if (!isSocketUsersTurn(state, userId, username)) return socket.emit('error', { message: 'Not your turn' });
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
      const unlockedTechs = currentPlayer.unlocked_techs ?? [];
      const techTree = state.settings.tech_trees_enabled ? getEraTechTree(state.era) : [];
      const wonderRangeBonus = state.settings.economy_enabled
        ? getWonderInfluenceRange(state, userId)
        : 0;
      const hopLimit = getInfluenceHopLimit({
        baseHopLimit,
        unlockedTechs,
        techTree,
        wonderRangeBonus,
      });
      const ownedIds = Object.entries(state.territories)
        .filter(([, t]) => t.owner_id === userId)
        .map(([id]) => id);
      const reachable = isTerritoryReachableWithinHops({
        map,
        ownedTerritoryIds: ownedIds,
        targetId,
        hopLimit,
      });

      if (!reachable) {
        return socket.emit('error', { message: 'Target territory not within influence range' });
      }

      // Garibaldi's Redshirts / Détente: free influence on neutral territories within range
      const isDetenteUse =
        target.owner_id === null
        && playerHasUnlockedAbility(state, userId, 'detente_protocol');

      const isGaribaldiUse =
        !!modifiers?.carbonari_network &&
        currentPlayer.unlocked_techs?.includes('riso_garibaldi') &&
        target.owner_id === null;

      if (isDetenteUse) {
        if ((currentPlayer.ability_uses?.detente_protocol ?? 0) >= 1) {
          return socket.emit('error', { message: 'Détente influence already used this turn' });
        }
      } else if (isGaribaldiUse) {
        if ((currentPlayer.ability_uses?.['riso_garibaldi'] ?? 0) >= 1) {
          return socket.emit('error', { message: "Garibaldi's Redshirts already used this turn" });
        }
      } else {
        // Unit cap: cannot influence a well-defended territory
        if (target.unit_count > INFLUENCE_MAX_TARGET_UNITS) {
          return socket.emit('error', { message: `Influence can only seize territories with ≤${INFLUENCE_MAX_TARGET_UNITS} defending units` });
        }

        // Cost: player must have enough spare units to pay the influence cost
        const influenceCost = getInfluenceUnitCost(state, userId);
        const totalUnits = Object.values(state.territories)
          .filter((t) => t.owner_id === userId)
          .reduce((sum, t) => sum + t.unit_count, 0);
        if (totalUnits < influenceCost + 1) {
          return socket.emit('error', { message: `Not enough units to pay influence cost (need ${influenceCost} spare)` });
        }

        // Deduct units from the largest owned adjacent territory
        const adjacentOwned = getAdjacentTerritoryIds(map, targetId)
          .filter((nid) => state.territories[nid]?.owner_id === userId)
          .sort((a, b) => (state.territories[b]?.unit_count ?? 0) - (state.territories[a]?.unit_count ?? 0));

        if (adjacentOwned.length === 0) {
          return socket.emit('error', { message: 'No adjacent owned territory to project influence from' });
        }

        let remaining = influenceCost;
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
      const influenceProbBefore = captureProbBefore(state, userId);
      target.owner_id = userId;
      target.unit_count = 1;
      if (isGaribaldiUse) {
        currentPlayer.ability_uses = { ...currentPlayer.ability_uses, riso_garibaldi: 1 };
      } else if (isDetenteUse) {
        currentPlayer.ability_uses = { ...currentPlayer.ability_uses, detente_protocol: 1 };
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
          recordElimination(gameId, userId);
          io.to(gameId).emit('game:player_eliminated', {
            playerId: previousOwner,
            eliminatorId: userId,
            eliminatorName: currentPlayer.username,
            eliminatedName: prevPlayer.username,
            secretMission: prevPlayer.secret_mission ?? null,
          });
        }
      }

      commitActionDecision(
        gameId, state, userId, 'influence',
        `Influenced ${territoryName(map, targetId)}${isGaribaldiUse ? ' (Garibaldi)' : isDetenteUse ? ' (Détente)' : ''}`,
        influenceProbBefore,
      );

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

      const influenceVariant = isGaribaldiUse ? 'garibaldi' as const
        : isDetenteUse ? 'detente' as const
          : 'seize' as const;

      emitMapVisual(io, gameId, buildInfluenceMapVisual({
        targetId,
        actorId: userId,
        previousOwnerId: previousOwner,
        variant: influenceVariant,
        state,
      }));

      const influenceResultPayload = {
        success: true as const,
        targetId,
        previousOwner,
        actorId: userId,
        actorColor: currentPlayer.color,
        variant: influenceVariant,
      };
      io.to(gameId).emit('game:influence_result', influenceResultPayload);
      io.to(`${gameId}:spectators`).emit('game:influence_result', influenceResultPayload);
      broadcastState(io, gameId, state);
    });

    // ── Event Card Choice ───────────────────────────────────────────────────
    socket.on('game:event_choice', ({ gameId, choiceId, action_id }: { gameId: string; choiceId: string; action_id?: string }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      if (!checkAndRecordActionId(gameId, userId, action_id)) return;
      const { state } = room;

      const currentPlayer = state.players[state.current_player_index];
      if (!isSocketUsersTurn(state, userId, username)) return socket.emit('error', { message: 'Not your turn' });

      if (!state.active_event) return socket.emit('error', { message: 'No active event card' });

      const activeCard = state.active_event;
      const choices = activeCard.choices;
      if (!choices?.length) return socket.emit('error', { message: 'This event has no choices' });

      const eventChoiceProbBefore = captureProbBefore(state, userId);
      const eventCardId = activeCard.card_id;
      const choice = choices.find((c) => c.choice_id === choiceId);
      if (!choice) return socket.emit('error', { message: 'Invalid choice' });

      const eventResult = resolveEventChoice(state, eventCardId, choiceId);
      if (!eventResult) return socket.emit('error', { message: 'Invalid choice' });

      commitActionDecision(
        gameId, state, userId, 'event_choice',
        `Event ${eventCardId}: chose ${choiceId}`,
        eventChoiceProbBefore,
      );
      emitEventCardMapVisuals(io, gameId, {
        cardId: eventCardId,
        effect: choice.effect,
        result: eventResult,
      });
      scheduleDebouncedSave(gameId);
      io.to(gameId).emit('game:event_card_resolved', { cardId: eventCardId });
      io.to(`${gameId}:spectators`).emit('game:event_card_resolved', { cardId: eventCardId });
      broadcastState(io, gameId, state);
      // Restart turn timer now that the blocking event choice is resolved (human players only)
      const roomAfterChoice = activeGames.get(gameId);
      if (roomAfterChoice && !roomAfterChoice.state.players[roomAfterChoice.state.current_player_index].is_ai) {
        startTurnTimer(io, gameId, roomAfterChoice.state, roomAfterChoice.map);
      }
    });

    // ── Set Coaching ─────────────────────────────────────────────────────────
    // Mid-game toggle for in-turn coaching. Only the (single) human player in
    // an eligible game can flip this. Server enforces eligibility; ineligible
    // games silently no-op so a tampered client can't enable coaching in a
    // multi-human or ranked match.
    socket.on('game:set_coaching', ({ gameId, enabled }: { gameId: string; enabled: boolean }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      const { state, map } = room;
      if (!state.coaching_eligible) {
        return socket.emit('error', { message: 'Coaching is not available in this game' });
      }
      const human = state.players.find((p) => !p.is_ai);
      if (!human || human.player_id !== userId) {
        return socket.emit('error', { message: 'Only the human player can toggle coaching' });
      }
      state.settings.coaching_enabled = enabled || undefined;
      broadcastState(io, gameId, state);
      // If they just turned it on and it's already their draft phase, fire a
      // tip immediately so the toggle feels responsive.
      if (enabled && state.phase === 'draft' && state.players[state.current_player_index]?.player_id === userId) {
        maybeEmitCoachingTip(io, gameId, state, map);
      }
      scheduleDebouncedSave(gameId);
    });

    // Chat handlers extracted to handlers/chatHandler.ts

    socket.on('game:lobby_propose', async ({ gameId, setting, value }: { gameId: string; setting: string; value: unknown }) => {
      const lobby = await loadWaitingLobbyDetails(gameId);
      if (!lobby) return socket.emit('error', { message: 'Game not found' });
      if (lobby.game.status !== 'waiting') return socket.emit('error', { message: 'Lobby voting is only available before the game starts' });

      const player = lobby.players.find((entry) => entry.user_id === userId);
      if (!player || player.is_ai) return socket.emit('error', { message: 'Only players in the lobby can propose changes' });

      if (!(setting in LOBBY_PROPOSABLE_SETTINGS)) {
        return socket.emit('error', { message: 'That setting cannot be changed by lobby vote' });
      }

      const settingKey = setting as LobbyProposalSettingKey;
      const definition = LOBBY_PROPOSABLE_SETTINGS[settingKey];
      const parsedValue = definition.parseValue(value);
      if (parsedValue == null) return socket.emit('error', { message: 'Invalid proposed value' });

      if (String(lobby.settings[settingKey]) === String(parsedValue)) {
        return socket.emit('error', { message: 'That setting is already active' });
      }

      const current = lobbyProposalsByGame.get(gameId) ?? [];
      if (current.some((proposal) => proposal.setting === settingKey)) {
        return socket.emit('error', { message: 'There is already an active proposal for that setting' });
      }

      current.push({
        id: randomUUID(),
        proposerId: userId,
        proposerName: player.username ?? socket.data?.username ?? username,
        setting: settingKey,
        label: definition.label,
        displayValue: definition.displayValue(parsedValue),
        proposedValue: parsedValue,
        yesVotes: [userId],
        noVotes: [],
        createdAt: Date.now(),
      });
      lobbyProposalsByGame.set(gameId, current);
      await emitLobbyProposalUpdates(io, gameId, lobby);
    });

    socket.on('game:lobby_vote', async ({ gameId, proposalId, approve }: { gameId: string; proposalId: string; approve: boolean }) => {
      const lobby = await loadWaitingLobbyDetails(gameId);
      if (!lobby) return socket.emit('error', { message: 'Game not found' });
      if (lobby.game.status !== 'waiting') return socket.emit('error', { message: 'Lobby voting is only available before the game starts' });

      const player = lobby.players.find((entry) => entry.user_id === userId);
      if (!player || player.is_ai) return socket.emit('error', { message: 'Only players in the lobby can vote' });

      const proposals = lobbyProposalsByGame.get(gameId) ?? [];
      const proposal = proposals.find((entry) => entry.id === proposalId);
      if (!proposal) return socket.emit('error', { message: 'Proposal not found' });

      proposal.yesVotes = proposal.yesVotes.filter((voteUserId) => voteUserId !== userId);
      proposal.noVotes = proposal.noVotes.filter((voteUserId) => voteUserId !== userId);
      if (approve) proposal.yesVotes.push(userId);
      else proposal.noVotes.push(userId);

      const threshold = getLobbyProposalThreshold(lobby.humanPlayers.length);
      if (proposal.yesVotes.length >= threshold) {
        const normalized = normalizeGameSettings({
          ...lobby.settings,
          [proposal.setting]: proposal.proposedValue,
        });
        const nextSettings = {
          ...normalized,
          max_players:
            typeof lobby.settings.max_players === 'number'
              ? lobby.settings.max_players
              : lobby.players.length,
        };

        await query('UPDATE games SET settings_json = $2 WHERE game_id = $1', [gameId, JSON.stringify(nextSettings)]);
        const remaining = proposals.filter((entry) => entry.id !== proposal.id);
        if (remaining.length > 0) lobbyProposalsByGame.set(gameId, remaining);
        else lobbyProposalsByGame.delete(gameId);

        const refreshedLobby = await loadWaitingLobbyDetails(gameId);
        if (refreshedLobby) {
          await emitWaitingLobbySnapshot(io, gameId, refreshedLobby);
          await emitLobbyProposalUpdates(io, gameId, refreshedLobby);
        }
        return;
      }

      lobbyProposalsByGame.set(gameId, proposals);
      await emitLobbyProposalUpdates(io, gameId, lobby);
    });

    // ── Leave (Save & Leave) ────────────────────────────────────────────
    //
    // `game:leave` is a fire-and-forget cleanup signal that the GamePage
    // useEffect cleanup emits whenever the user navigates away (back to the
    // lobby, into another match, page refresh, React StrictMode double-mount,
    // suspense fallback flip, etc.). It MUST be idempotent and never surface
    // a user-facing error:
    //
    //   • Games in `'waiting'` status (the lobby that pops up right after
    //     "Create Game") have no entry in `activeGames` — that map is only
    //     populated when a game transitions to `'in_progress'`. Treating a
    //     missing room as "Game not found" was producing spurious toast
    //     errors right after creating a new game, especially in
    //     StrictMode dev or whenever the new mount re-registers an `error`
    //     listener before the server's reply arrives.
    //   • Already-evicted games (5-min idle) and finished games likewise
    //     have no in-memory state but still need the socket removed from
    //     the Socket.IO room so the client stops receiving broadcasts.
    socket.on('game:leave', async ({ gameId }: { gameId: string }) => {
      // Always detach from the room and acknowledge — even when there is no
      // in-memory state — so the client stops receiving room broadcasts and
      // any waiting `game:left` listener resolves.
      socket.leave(gameId);
      socket.emit('game:left', { gameId });

      const room = activeGames.get(gameId);
      if (!room) {
        // Waiting / evicted / never-loaded game: nothing more to do. Silent
        // success (no error emit) so a routine navigation never shows a
        // "Game not found" toast.
        return;
      }
      const { state } = room;

      if (state.phase === 'game_over') return;

      await saveGameState(gameId, state);
      room.connectedSockets.delete(socket.id);

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
            clearActionIdempotency(gameId);
            spectatorSeqCounters.delete(gameId);
            spectatorStateBuffers.delete(gameId);
            console.log(`[Socket] Evicted inactive game ${gameId} from memory`);
          }
        }, 5 * 60 * 1000);
        evictionTimer.unref();
      }
    });

    // ── Propose Truce ─────────────────────────────────────────────────────
    socket.on('game:propose_truce', ({ gameId, targetPlayerId, action_id }: { gameId: string; targetPlayerId: string; action_id?: string }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      if (!checkAndRecordActionId(gameId, userId, action_id)) return;
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
    socket.on('game:truce_response', ({ gameId, proposerId, accepted, action_id }: { gameId: string; proposerId: string; accepted: boolean; action_id?: string }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      if (!checkAndRecordActionId(gameId, userId, action_id)) return;
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
    socket.on('game:resign', async ({ gameId, action_id }: { gameId: string; action_id?: string }) => {
      const room = activeGames.get(gameId);
      if (!room) return socket.emit('error', { message: 'Game not found' });
      if (!checkAndRecordActionId(gameId, userId, action_id)) return;
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

      // CRITICAL ORDER: check victory BEFORE advancing to the next player.
      // If a resign leaves only one survivor (e.g. 1v1), advancing first would
      // hand the turn to an AI and schedule processAiTurn, which then runs on
      // a game that is actually over. Evaluate the end condition first, then
      // only advance if the game continues.
      if (maybeResolveDailyPuzzle(io, gameId, room, null, userId, finalizeGame)) {
        await saveGameState(gameId, state);
        broadcastState(io, gameId, state);
        return;
      }

      // If the resigning player was the last human, end the game immediately —
      // there is no value in letting AI bots fight on with no human audience.
      //
      // Anti-exploit policy: a player at turn ≥ 3 who is losing cannot use
      // resignation to escape a rating/streak loss. After the grace window the
      // leading surviving AI is credited with a 'last_standing' victory and
      // the full finalizeGame pipeline runs (ratings, XP, streaks, achievements).
      //
      // The grace window (turns 1–2) exists for honest mis-starts: wrong map,
      // wrong settings, bad initial draft. Early exits are recorded as an
      // 'abandoned' game status with no stat impact. This is deliberately short
      // — any meaningful information about game outcome requires at least a
      // full round of play.
      const RESIGN_GRACE_TURNS = 2;
      const remainingHumans = state.players.filter((p) => !p.is_eliminated && !p.is_ai);
      if (remainingHumans.length === 0) {
        const survivingAi = state.players
          .filter((p) => !p.is_eliminated && p.is_ai)
          .sort((a, b) => b.territory_count - a.territory_count);
        const inGraceWindow = state.turn_number <= RESIGN_GRACE_TURNS;
        const haveAiWinner = survivingAi.length > 0;

        if (inGraceWindow || !haveAiWinner) {
          state.phase = 'game_over';
          state.victory_condition = 'abandoned';
          clearTurnTimer(gameId, state);
          try {
            await pgPool.query(
              `UPDATE games SET status = 'abandoned', ended_at = NOW() WHERE game_id = $1 AND status <> 'completed'`,
              [gameId],
            );
            await saveGameState(gameId, state);
          } catch (err) {
            console.error('[Socket] Failed to persist abandoned game:', err);
          }
          io.to(gameId).emit('game:over', {
            winner_id: null,
            winner_ids: [],
            winner_name: '',
            turn_count: state.turn_number,
            players: state.players.map((p) => ({
              player_id: p.player_id,
              username: p.username,
              color: p.color,
              territory_count: p.territory_count,
              is_eliminated: p.is_eliminated,
              is_ai: p.is_ai,
            })),
            victory_condition: 'abandoned' as const,
            win_probability_history: state.win_probability_history ?? [],
            rating_deltas: {},
            is_ranked: false,
            achievements_unlocked: {},
            xp_earned_by_player: {},
          });
          broadcastState(io, gameId, state);
          return;
        }

        // Out of grace window: credit the leading surviving AI with the win
        // and run the normal finalize path so the resigner takes a real loss.
        const aiWinner = survivingAi[0]!;
        state.phase = 'game_over';
        state.winner_id = aiWinner.player_id;
        state.winner_ids = [aiWinner.player_id];
        state.victory_condition = 'last_standing';
        await finalizeGame(io, gameId, state, [aiWinner.player_id]);
        broadcastState(io, gameId, state);
        return;
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
        broadcastState(io, gameId, state);
        return;
      }

      // Game continues — advance turn if it was this player's turn.
      const currentPlayer = state.players[state.current_player_index];
      if (currentPlayer.player_id === userId) {
        advanceToNextPlayer(state, map);
        broadcastEventCard(io, gameId, state, map);
        // Re-check after advancement: advancement may itself cause elimination
        // (e.g. a player who hit rebellion-floor on their turn-start tick).
        const postAdvanceVictory = checkVictory(state, map);
        if (postAdvanceVictory) {
          const { winnerIds, condition } = postAdvanceVictory;
          state.phase = 'game_over';
          state.winner_id = winnerIds[0]!;
          state.winner_ids = winnerIds;
          state.victory_condition = condition;
          await finalizeGame(io, gameId, state, winnerIds);
          broadcastState(io, gameId, state);
          return;
        }
        if (state.players[state.current_player_index].is_ai) {
          setTimeout(() => processAiTurn(io, gameId), 1500);
        }
      }

      await saveGameState(gameId, state);
      broadcastState(io, gameId, state);
      maybeEmitCoachingTip(io, gameId, state, map);
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

      // Clean up spectator count
      const spectatingGameId = socket.data?.spectating as string | undefined;
      if (spectatingGameId) {
        const spectatorRoom = `${spectatingGameId}:spectators`;
        const spectators = spectatorSocketsByGame.get(spectatingGameId);
        spectators?.delete(socket.id);
        if (spectators && spectators.size === 0) {
          spectatorSocketsByGame.delete(spectatingGameId);
          stopSpectatorBroadcastLoop(spectatingGameId);
        }
        query(
          'UPDATE games SET spectator_count = GREATEST(spectator_count - 1, 0) WHERE game_id = $1',
          [spectatingGameId],
        ).catch(() => {});
        queryOne<{ spectator_count: number }>(
          'SELECT spectator_count FROM games WHERE game_id = $1',
          [spectatingGameId],
        ).then((row) => {
          io.to(spectatingGameId).emit('game:spectator_count', { count: row?.spectator_count ?? 0 });
          io.to(spectatorRoom).emit('game:spectator_count', { count: row?.spectator_count ?? 0 });
        }).catch(() => {});
      }

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
                clearActionIdempotency(gameId);
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
  let resolvedResult: import('../types').EventEffectResult | undefined;

  // Attach result_summary when an instant effect was just applied
  if (state.active_event_result) {
    const result = state.active_event_result;
    resolvedResult = result;
    if (result.global) {
      card.result_summary = [{ territory_id: '__global__', name: 'All territories', delta: -1 }];
    } else {
      const lines: Array<{ territory_id: string; name: string; delta: number }> = [];
      if (result.draft_units_granted && result.draft_units_granted > 0) {
        lines.push({
          territory_id: '__draft_pool__',
          name: 'Your reinforcement pool',
          delta: result.draft_units_granted,
        });
      }
      if (result.affected_territories?.length) {
        for (const row of result.affected_territories) {
          lines.push({
            territory_id: row.territory_id,
            name: map.territories.find((t) => t.territory_id === row.territory_id)?.name ?? row.territory_id,
            delta: row.delta,
          });
        }
      }
      if (lines.length > 0) {
        card.result_summary = lines;
      }
    }
    state.active_event_result = undefined;
  }

  io.to(gameId).emit('game:event_card', card);
  io.to(`${gameId}:spectators`).emit('game:event_card', card);

  if (resolvedResult) {
    emitEventCardMapVisuals(io, gameId, {
      cardId: card.card_id,
      effect: card.effect,
      result: resolvedResult,
    });
  }

  // If the card had no choices, the effect was already applied in advanceToNextPlayer — clear it
  if (!card.choices || card.choices.length === 0) {
    state.active_event = undefined;
  }
}

function emitAutoDraftMapVisuals(
  io: Server,
  gameId: string,
  state: GameState,
  placements: Array<{ territory_id: string; units: number; totalAfter: number }>,
): void {
  const playerId = state.players[state.current_player_index]?.player_id;
  if (!playerId) return;
  for (const row of placements) {
    emitMapVisual(io, gameId, buildReinforceMapVisual({
      territoryId: row.territory_id,
      units: row.units,
      totalAfter: row.totalAfter,
      playerId,
      state,
    }));
  }
}

function broadcastState(io: Server, gameId: string, state: GameState): void {
    // Runtime tripwire: no owned territory should ever have 0 units. If this
    // ever fires, a game-engine path wrote an illegal state (leave-1 rule
    // violated). Auto-correct to keep the game playable, but log loudly so
    // we catch the regression in staging/prod logs.
    for (const territory of Object.values(state.territories)) {
      if (territory.owner_id && territory.unit_count === 0) {
        console.warn(
          `[game-engine][INVARIANT] game=${gameId} turn=${state.turn_number} phase=${state.phase} territory=${territory.territory_id} had 0 units post-mutation; auto-correcting to 1. This is a bug.`,
        );
        territory.unit_count = 1;
      }
    }
  const room = activeGames.get(gameId);
  if (!room) return;

  recordSpectatorState(gameId, state);

  // Send filtered state to each connected socket
  if (room.connectedSockets.size > 0) {
    for (const [socketId, playerId] of room.connectedSockets.entries()) {
      const filteredState = buildClientState(state, playerId, state.settings.fog_of_war);
      io.to(socketId).emit('game:state', filteredState);
    }
  } else {
    // Fallback: no tracked sockets (e.g. right after start); broadcast to whole room
    // Always fog-filter when fog_of_war is enabled to avoid leaking full state
    // to any client that joined the room before connectedSockets tracked it.
    io.to(gameId).emit('game:state', buildClientState(state, null, state.settings.fog_of_war));
  }
  // NOTE: The room-wide `game:state_public` broadcast was removed — it sent an
  // unfiltered state snapshot to every socket in the room regardless of the
  // fog_of_war setting, trivially defeating fog of war. Players now receive
  // only filtered state via `game:state`; delayed/filtered spectator state is
  // served via the dedicated `${gameId}:spectators` room.
}

/**
 * Evaluate coaching detectors and emit a tip to the human player when one
 * applies. No-op when the game isn't eligible, the player has opted out, or
 * no detector finds anything noteworthy.
 *
 * Safe to call after every `advanceToNextPlayer(...) + broadcastState(...)`
 * pair — the gating short-circuits before any detector runs.
 */
function maybeEmitCoachingTip(io: Server, gameId: string, state: GameState, map: GameMap): void {
  if (!state.coaching_eligible) return;
  if (!state.settings.coaching_enabled) return;
  if (state.phase !== 'draft') return;

  const tip = evaluateCoachingTip(state, map);
  if (!tip) return;

  const human = state.players.find((p) => !p.is_ai);
  if (!human) return;
  const room = activeGames.get(gameId);
  if (!room) return;

  // Send only to the human's socket(s) — coaching is private to that player.
  for (const [socketId, playerId] of room.connectedSockets.entries()) {
    if (playerId === human.player_id) {
      io.to(socketId).emit('game:coaching_tip', tip);
    }
  }
}

function recordSpectatorState(gameId: string, state: GameState): void {
  const snapshot = buildClientState(state, null, false);
  const seq = (spectatorSeqCounters.get(gameId) ?? 0) + 1;
  spectatorSeqCounters.set(gameId, seq);
  const buffer = spectatorStateBuffers.get(gameId) ?? [];
  buffer.push({
    timestamp: Date.now(),
    seq,
    state: JSON.parse(JSON.stringify(snapshot)) as GameState,
  });
  while (buffer.length > SPECTATOR_BUFFER_LIMIT) {
    buffer.shift();
  }
  spectatorStateBuffers.set(gameId, buffer);
}

function getDelayedSpectatorState(gameId: string): { state: GameState; seq: number } | null {
  const buffer = spectatorStateBuffers.get(gameId);
  if (!buffer || buffer.length === 0) return null;

  const cutoff = Date.now() - SPECTATOR_DELAY_MS;
  for (let index = buffer.length - 1; index >= 0; index -= 1) {
    if (buffer[index].timestamp <= cutoff) {
      return { state: buffer[index].state, seq: buffer[index].seq };
    }
  }

  return { state: buffer[0].state, seq: buffer[0].seq };
}

function ensureSpectatorBroadcastLoop(io: Server, gameId: string): void {
  if (spectatorBroadcastLoops.has(gameId)) return;

  const timer = setInterval(() => {
    const spectators = spectatorSocketsByGame.get(gameId);
    if (!spectators || spectators.size === 0) {
      stopSpectatorBroadcastLoop(gameId);
      return;
    }

    const entry = getDelayedSpectatorState(gameId);
    if (entry) {
      io.to(`${gameId}:spectators`).emit('game:state', { ...entry.state, _spectator_seq: entry.seq });
    }
  }, SPECTATOR_BROADCAST_MS);
  timer.unref();
  spectatorBroadcastLoops.set(gameId, timer);
}

function stopSpectatorBroadcastLoop(gameId: string): void {
  const timer = spectatorBroadcastLoops.get(gameId);
  if (timer) {
    clearInterval(timer);
    spectatorBroadcastLoops.delete(gameId);
  }
}

function buildClientState(state: GameState, playerId: string | null, fogOfWar: boolean): GameState {
  const stripSecretMissions = (s: GameState): GameState => ({
    ...s,
    // mission_seed_salt is server-only; leaking it would let a client
    // replay the PRNG and read every opponent's mission.
    mission_seed_salt: undefined,
    players: s.players.map((p) =>
      // Reveal mission for: the viewing player, eliminated players, and everyone at game_over
      (playerId !== null && p.player_id === playerId) || p.is_eliminated || state.phase === 'game_over'
        ? p
        : { ...p, secret_mission: null },
    ),
  });

  if (!fogOfWar || !playerId) return stripSecretMissions(state);

  // Owned territories are always visible
  const visibleIds = new Set<string>();
  for (const [tid, tState] of Object.entries(state.territories)) {
    if (tState.owner_id === playerId) visibleIds.add(tid);
  }

  // Adjacent territories are visible (border scouting)
  const adj = adjacencyByMapId.get(state.map_id);
  if (adj) {
    for (const tid of Array.from(visibleIds)) {
      for (const neighbour of adj.get(tid) ?? []) {
        visibleIds.add(neighbour);
      }
    }
    expandFogVisibilityFromRecon(state, playerId, visibleIds, adj);
  }

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
  const campaignRow = await queryOne<{
    campaign_id: string;
    current_era_index: number;
    prestige_points: number;
    path_id: string | null;
    path_carry: Record<string, number>;
    path_narrative: Record<string, string>;
  }>(
    `SELECT uc.campaign_id, uc.current_era_index, uc.prestige_points,
            uc.path_id, uc.path_carry, uc.path_narrative
     FROM user_campaigns uc
     JOIN campaign_entries ce ON ce.campaign_id = uc.campaign_id
     WHERE ce.game_id = $1 AND uc.status = 'active'
     LIMIT 1`,
    [gameId],
  );
  if (!campaignRow) return;

  const won = !!winnerId && !state.players.find((p) => p.player_id === winnerId)?.is_ai;
  const eraIndex = campaignRow.current_era_index;
  const narrativeKey = `era_${eraIndex}_outcome`;
  const updatedNarrative = { ...campaignRow.path_narrative, [narrativeKey]: won ? 'won' : 'lost' };

  await query(
    `INSERT INTO campaign_entries (id, campaign_id, era_id, game_id, won, completed_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())
     ON CONFLICT (campaign_id, era_id) DO UPDATE SET won = EXCLUDED.won, game_id = EXCLUDED.game_id, completed_at = NOW()`,
    [campaignRow.campaign_id, state.era, gameId, won],
  );

  // Determine prestige delta and carry-forward updates
  let prestigeDelta = 1; // standard classic prestige
  let updatedCarry = { ...campaignRow.path_carry };

  if (campaignRow.path_id) {
    // Dynamically import to avoid circular dep; path config is pure data
    const { getPathEraConfig } = await import('../modules/campaign/campaignPaths');
    const pathEra = getPathEraConfig(campaignRow.path_id as any, eraIndex);
    if (pathEra) {
      const delta = won ? pathEra.carry_on_win : pathEra.carry_on_loss;
      // Path deltas may omit `prestige_bonus` entirely (e.g. a path whose
      // signature carry is something else like revolutionary_spirit). When
      // that happens we keep the standard +1 default for wins so the player
      // still progresses; explicit `0` is honored to let paths intentionally
      // award nothing (e.g. carry_on_loss commonly sets `{ prestige_bonus: 0 }`).
      if (delta.prestige_bonus != null) {
        prestigeDelta = delta.prestige_bonus;
        updatedCarry.prestige_bonus = (updatedCarry.prestige_bonus ?? 0) + delta.prestige_bonus;
      } else if (!won) {
        // Omitted on the loss branch — preserve historical "no prestige on loss" behavior.
        prestigeDelta = 0;
      }
      // (Win + omitted prestige_bonus falls through to the +1 default set at declaration.)
      if (delta.survivor_bonus != null) {
        updatedCarry.survivor_bonus = Math.min(8, (updatedCarry.survivor_bonus ?? 0) + delta.survivor_bonus);
      }
      if (delta.revolutionary_spirit != null) {
        updatedCarry.revolutionary_spirit = Math.min(10, (updatedCarry.revolutionary_spirit ?? 0) + delta.revolutionary_spirit);
      }
    }
  }

  const newPrestige = campaignRow.prestige_points + (won ? prestigeDelta : 0);

  if (won) {
    const newIdx = eraIndex + 1;
    if (newIdx >= CAMPAIGN_ERAS.length) {
      await query(
        `UPDATE user_campaigns
         SET status = 'completed', completed_at = NOW(),
             prestige_points = $1, path_carry = $2::jsonb, path_narrative = $3::jsonb
         WHERE campaign_id = $4`,
        [newPrestige, JSON.stringify(updatedCarry), JSON.stringify(updatedNarrative), campaignRow.campaign_id],
      );
    } else {
      await query(
        `UPDATE user_campaigns
         SET current_era_index = $1, prestige_points = $2,
             path_carry = $3::jsonb, path_narrative = $4::jsonb
         WHERE campaign_id = $5`,
        [newIdx, newPrestige, JSON.stringify(updatedCarry), JSON.stringify(updatedNarrative), campaignRow.campaign_id],
      );
      io.to(`user:${winnerId}`).emit('game:campaign_advanced', {
        next_era: CAMPAIGN_ERAS[newIdx],
        campaign_id: campaignRow.campaign_id,
        path_carry: updatedCarry,
      });
    }
  } else {
    // On loss: still update path_carry (carry_on_loss may give spirit/bonus) and narrative
    await query(
      `UPDATE user_campaigns
       SET path_carry = $1::jsonb, path_narrative = $2::jsonb
       WHERE campaign_id = $3`,
      [JSON.stringify(updatedCarry), JSON.stringify(updatedNarrative), campaignRow.campaign_id],
    );
  }
}

async function finalizeGame(io: Server, gameId: string, state: GameState, winnerIds: string[]): Promise<void> {
  const winnerId = winnerIds[0]!;
  clearTurnTimer(gameId, state);
  appendWinProbabilitySnapshot(state);

  // Idempotency guard: finalizeGame can be entered more than once on the same
  // game — e.g. a resign victory check racing with the turn-timer victory
  // check, or a daily puzzle objective resolving on the same turn as a
  // domination win. Without the guard, the second pass would run
  // `recordGameResults` a second time, doubling rating/XP deltas and writing
  // duplicate achievement rows.
  //
  // Gate on the `games.status` transition: the UPDATE only fires when status
  // is not already 'completed'. If rowCount is 0, another finalizer already
  // ran and we bail before any downstream writes (ratings, achievements,
  // campaign, notifications).
  let firstFinalize = false;
  // `games.winner_id` is a UUID referencing users. AI players use synthetic
  // string ids like "ai_1" that are not valid UUIDs, so we must persist NULL
  // for AI wins and keep the synthetic id only in the in-memory/broadcast state.
  const winnerPlayer = state.players.find((p) => p.player_id === winnerId);
  const persistedWinnerId = winnerPlayer?.is_ai ? null : winnerId;
  try {
    const res = await pgPool.query(
      `UPDATE games SET status = $1, ended_at = NOW(), winner_id = $2
       WHERE game_id = $3 AND status <> 'completed'`,
      ['completed', persistedWinnerId, gameId],
    );
    firstFinalize = (res.rowCount ?? 0) > 0;
    if (!firstFinalize) {
      console.warn(`[Socket] finalizeGame called for already-completed game ${gameId}; skipping duplicate writes.`);
      return;
    }
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
        const spec = getDailyPuzzleSpec(state);
        const isDomination = !spec || spec.archetype === 'domination';
        let entryWon = humanPlayer.player_id === winnerId;
        if (entryWon && !isDomination) {
          entryWon = state.puzzle_objective_met === true;
        }
        const mistakes = state.puzzle_feedback_mistakes ?? 0;
        const puzzleScore = Math.max(0, 1000 - mistakes * 12);
        await query(
          `INSERT INTO daily_challenge_entries (
             challenge_date, user_id, won, turn_count, territory_count,
             puzzle_score, objective_met, archetype, move_feedback_mistakes
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (challenge_date, user_id) DO NOTHING`,
          [
            dailyRow.daily_challenge_date,
            humanPlayer.player_id,
            entryWon,
            state.turn_number,
            humanPlayer.territory_count,
            puzzleScore,
            state.puzzle_objective_met ?? null,
            spec?.archetype ?? null,
            mistakes,
          ],
        );
        recordServerEvent('daily_challenge_settled', {
          game_id: gameId,
          challenge_date: dailyRow.daily_challenge_date,
          user_id: humanPlayer.player_id,
          won: entryWon,
          archetype: spec?.archetype ?? 'domination',
          puzzle_score: puzzleScore,
        });
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

  if (resultCtx.isRanked && humanPlayers.length > 0) {
    for (const player of humanPlayers) {
      await query(
        `INSERT INTO ranked_placement_progress (
           user_id, season_id, placement_matches_played, provisional, smurf_risk_score, stall_penalties, updated_at
         ) VALUES ($1, '2026_Q2', 1, true, 0, 0, NOW())
         ON CONFLICT (user_id) DO UPDATE
         SET placement_matches_played = ranked_placement_progress.placement_matches_played + 1,
             provisional = (ranked_placement_progress.placement_matches_played + 1) < 8,
             updated_at = NOW()`,
        [player.player_id],
      );
    }
  }

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
      const initialRatings = getInitialRatings();
      const avgMu = ratingRows.length > 0
        ? ratingRows.reduce((s, r) => s + r.mu, 0) / ratingRows.length
        : initialRatings.mu;

      const gameRow = await client.query<{ game_type: string; is_ranked: boolean }>(
        'SELECT game_type, COALESCE(is_ranked, false) AS is_ranked FROM games WHERE game_id = $1',
        [gameId],
      );
      const gameType = (gameRow.rows[0]?.game_type ?? 'solo') as 'solo' | 'multiplayer' | 'hybrid';

      for (const p of humanPlayers) {
        const myRating = ratingMap.get(p.player_id) ?? { mu: initialRatings.mu, phi: initialRatings.phi };
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

  // ── Progression hooks (non-critical) ──────────────────────────────────
  const progressionByPlayer: Record<string, {
    win_streak: number;
    daily_streak: number;
    daily_streak_milestone: number | null;
    gold_awarded: number;
    gold_multiplier: number;
    level_cosmetic: string | null;
    friend_streak_bonus?: {
      multiplier: number;
      streak: number;
      friends: string[];
    };
  }> = {};
  const friendStreaksByPlayer = await updateFriendStreaks(
    humanPlayers.map((player) => player.player_id),
    state.turn_number,
  ).catch((err) => {
    console.error('[Socket] Friend streak update failed:', err);
    return {} as Awaited<ReturnType<typeof updateFriendStreaks>>;
  });

  for (const p of humanPlayers) {
    try {
      const isWinner = p.player_id === winnerId;
      const client = await pgPool.connect();
      try {
        await client.query('BEGIN');

        // Win streak
        const winStreak = await updateWinStreak(client, p.player_id, isWinner);

        // Daily streak
        const dailyResult = await updateDailyStreak(client, p.player_id);

        // Gold for winning (with streak multiplier)
        let goldAwarded = 0;
        if (isWinner) {
          const baseGold = 20;
          const streakMultiplier = winStreak >= 10 ? 2.0 : winStreak >= 7 ? 1.75 : winStreak >= 5 ? 1.5 : winStreak >= 3 ? 1.25 : 1.0;
          const friendBonusMultiplier = friendStreaksByPlayer[p.player_id]?.multiplier ?? 1;
          goldAwarded = Math.round(baseGold * streakMultiplier * friendBonusMultiplier);
          await client.query('UPDATE users SET gold = COALESCE(gold, 0) + $1 WHERE user_id = $2', [goldAwarded, p.player_id]);
          await client.query(
            'INSERT INTO gold_transactions (user_id, amount, reason) VALUES ($1, $2, $3)',
            [
              p.player_id,
              goldAwarded,
              friendBonusMultiplier > 1
                ? `Game win (${streakMultiplier}× win streak, ${friendBonusMultiplier}× friend streak)`
                : goldAwarded > baseGold
                  ? `Game win (${streakMultiplier}× streak bonus)`
                  : 'Game win',
            ],
          );
        }

        // Season tier tracking (only ranked)
        if (resultCtx.isRanked) {
          const ratingRow = await client.query<{ mu: number }>(
            "SELECT mu FROM user_ratings WHERE user_id = $1 AND rating_type = 'ranked'",
            [p.player_id],
          );
          if (ratingRow.rows[0]) {
            await updateSeasonTier(client, p.player_id, ratingRow.rows[0].mu);
          }
        }

        // Level-up cosmetic
        const userXp = await client.query<{ xp: number; level: number }>(
          'SELECT xp, level FROM users WHERE user_id = $1',
          [p.player_id],
        );
        const currentXp = userXp.rows[0]?.xp ?? 0;
        const oldLevel = userXp.rows[0]?.level ?? 1;
        const xpEarned = resultCtx.xpEarnedByPlayer[p.player_id] ?? 0;
        const newLevel = Math.floor(Math.sqrt((currentXp) / 250)) + 1;
        const prevLevel = Math.floor(Math.sqrt(Math.max(0, currentXp - xpEarned) / 250)) + 1;
        const levelCosmetic = await checkLevelCosmetic(client, p.player_id, prevLevel, newLevel);

        await client.query('COMMIT');

        progressionByPlayer[p.player_id] = {
          win_streak: winStreak,
          daily_streak: dailyResult.streak,
          daily_streak_milestone: dailyResult.milestone,
          gold_awarded: goldAwarded,
          gold_multiplier: isWinner ? (winStreak >= 10 ? 2.0 : winStreak >= 7 ? 1.75 : winStreak >= 5 ? 1.5 : winStreak >= 3 ? 1.25 : 1.0) : 1.0,
          level_cosmetic: levelCosmetic,
          friend_streak_bonus: friendStreaksByPlayer[p.player_id]
            ? {
                multiplier: friendStreaksByPlayer[p.player_id].multiplier,
                streak: friendStreaksByPlayer[p.player_id].streak,
                friends: friendStreaksByPlayer[p.player_id].friends.map((entry) => entry.friendName),
              }
            : undefined,
        };
      } catch (progressErr) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[Socket] Progression hook failed for', p.player_id, progressErr);
      } finally {
        client.release();
      }

      // Quest check (non-transactional, fire-and-forget)
      checkOnboardingQuests(p.player_id, 'game_complete').catch(() => {});

      // Challenge progress (non-critical)
      const challengeEvent: GameChallengeEvent = {
        userId: p.player_id,
        won: p.player_id === winnerId,
        isRanked: resultCtx.isRanked,
        eraId: state.era ?? '',
        buildingsBuilt: Object.values(state.territories).reduce((sum, t) =>
          t.owner_id === p.player_id ? sum + (t.buildings?.length ?? 0) : sum, 0),
        techsResearched: state.players.find((pl) => pl.player_id === p.player_id)?.unlocked_techs
          ? (state.players.find((pl) => pl.player_id === p.player_id)!.unlocked_techs?.length ?? 0)
          : 0,
        territoriesConquered: resultCtx.xpEarnedByPlayer[p.player_id] ? Object.values(state.territories).filter((t) => t.owner_id === p.player_id).length : 0,
        winStreak: progressionByPlayer[p.player_id]?.win_streak ?? 0,
        dailyStreak: progressionByPlayer[p.player_id]?.daily_streak ?? 0,
      };
      updateChallengeProgress(challengeEvent).catch((err) =>
        console.error('[Socket] Challenge progress failed:', err),
      );

      // Referral completion check
      checkReferralCompletion(p.player_id).catch(() => {});

      // Activity feed events (fire-and-forget)
      if (p.player_id === winnerId) {
        recordActivity(p.player_id, 'game_won', {
          game_id: gameId,
          era_id: state.era ?? '',
          username: p.username,
          turn_count: state.turn_number,
        }).catch(() => {});
      }
      if (progressionByPlayer[p.player_id]?.level_cosmetic) {
        const newLevel = Math.floor(Math.sqrt((resultCtx.xpEarnedByPlayer[p.player_id] ?? 0) / 250)) + 1;
        recordActivity(p.player_id, 'level_up', {
          username: p.username,
          level: newLevel,
          cosmetic: progressionByPlayer[p.player_id].level_cosmetic,
        }).catch(() => {});
      }
      if (unlockedByPlayer[p.player_id]?.length) {
        recordActivity(p.player_id, 'achievement_unlocked', {
          username: p.username,
          achievements: unlockedByPlayer[p.player_id],
        }).catch(() => {});
      }
    } catch (outerErr) {
      console.error('[Socket] Outer progression hook failed:', outerErr);
    }
  }

  const winner = state.players.find((p) => p.player_id === winnerId);
  // Snapshot the decision log BEFORE clearing so we can both summarise it
  // for the live modal and pass it to the async post-match pipeline below.
  const finalDecisionLog = getDecisionLog(gameId);
  // Summarise the decision log only for the (single) human player tracked in
  // the log. In solo-vs-AI games this surfaces the human's best/worst move;
  // multi-human games will get extended in a follow-up when per-player
  // logging lands.
  const humanForSummary = state.players.find((p) => !p.is_ai);
  const decisionSummary = humanForSummary
    ? summarizeDecisionLog(finalDecisionLog, humanForSummary.player_id)
    : { total_decisions: 0 };

  // Highest AI difficulty in the game (most descriptive single chip).
  const aiDifficulties = state.players
    .filter((p) => p.is_ai && p.ai_difficulty)
    .map((p) => p.ai_difficulty!);
  const difficultyOrder = ['tutorial', 'easy', 'medium', 'hard', 'expert'] as const;
  const highestAiDifficulty = aiDifficulties.length > 0
    ? aiDifficulties.reduce((a, b) =>
        difficultyOrder.indexOf(a) >= difficultyOrder.indexOf(b) ? a : b)
    : null;

  const stats = {
    winner_id: winnerId,
    winner_ids: winnerIds,
    winner_name: winner?.username ?? 'Unknown',
    turn_count: state.turn_number,
    duration_ms: state.game_started_at ? Date.now() - state.game_started_at : null,
    ai_difficulty: highestAiDifficulty,
    players: state.players.map((p) => ({
      player_id: p.player_id,
      username: p.username,
      color: p.color,
      territory_count: p.territory_count,
      peak_territory_count: p.peak_territory_count ?? p.territory_count,
      cards_redeemed_count: p.cards_redeemed_count ?? 0,
      card_set_bonus_units: p.card_set_bonus_units ?? 0,
      unlocked_techs_count: p.unlocked_techs?.length ?? 0,
      buildings_built_count: Object.values(state.territories).reduce(
        (sum, t) => (t.owner_id === p.player_id ? sum + (t.buildings?.length ?? 0) : sum),
        0,
      ),
      is_eliminated: p.is_eliminated,
      is_ai: p.is_ai,
    })),
    win_probability_history: state.win_probability_history ?? [],
    rating_deltas: Object.fromEntries(resultCtx.ratingDeltas),
    is_ranked: resultCtx.isRanked,
    achievements_unlocked: unlockedByPlayer,
    xp_earned_by_player: resultCtx.xpEarnedByPlayer,
    victory_condition: state.victory_condition,
    progression: progressionByPlayer,
    rematch_config: {
      era_id: state.era,
      map_id: state.map_id,
      settings: state.settings,
      human_player_ids: state.players
        .filter((p) => !p.is_ai && p.player_id !== winnerId)
        .map((p) => p.player_id),
    },
    combat_stats: Object.fromEntries(
      Array.from(gameCombatStats.get(gameId)?.entries() ?? []).map(([pid, s]) => [pid, s]),
    ),
    decision_summary: decisionSummary,
  };
  io.to(gameId).emit('game:over', stats);
  gameCombatStats.delete(gameId);

  clearDecisionLog(gameId);

  // Generate replay highlights + coaching insights asynchronously.
  generateAndStorePostMatchAnalysis(gameId, finalDecisionLog).catch((err) => {
    console.error('[Socket] Post-match analysis pipeline failed:', err);
  });
  updateSkillProfilesFromGameState(state).catch((err) => {
    console.error('[Socket] Skill profile update failed:', err);
  });

  // Clean up after a delay so clients can see final state
  setTimeout(() => {
    activeGames.delete(gameId);
    clearActionIdempotency(gameId);
  }, 30000);
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
    state.draft_placements_this_turn = {};
    state.current_player_index = 0;
    state.turn_number = 1;
    state.turn_started_at = Date.now();
    const firstPlayer = state.players[0];
    const bonus = calculateContinentBonuses(state, map, firstPlayer.player_id);
    const passiveReinforceBonus = getPlayerReinforceBonus(state, firstPlayer.player_id);
    state.draft_units_remaining = calculateReinforcements(
      firstPlayer.territory_count,
      bonus,
      state.players.length,
    ) + passiveReinforceBonus;
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
  // Fog-fair AI planning: when fog_of_war is on, humans see only their own
  // and adjacent territories' unit counts. Passing the raw authoritative
  // state to the AI lets it peek at unit counts everywhere on the map —
  // effectively giving every AI opponent a cheat against human players. We
  // build the same filtered view buildClientState produces for humans, so
  // the AI plans against the same information a human in its seat would.
  // When fog is off, the filter is a no-op (full state passed through).
  const planningState = state.settings.fog_of_war
    ? buildClientState(state, currentPlayer.player_id, true)
    : state;
  const actions = await runAiWithTimeout(planningState, map, difficulty);

  const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 600));

  const doVictoryCheck = async (): Promise<boolean> => {
    if (maybeResolveDailyPuzzle(io, gameId, room, null, currentPlayer.player_id, finalizeGame)) {
      aiInFlight.delete(gameId);
      return true;
    }
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
    let clamped = Math.min(action.units, state.draft_units_remaining);
    if (t && state.settings.stability_enabled) {
      const cap = getDeployCap(t.stability, {
        era: state.era,
        turnNumber: state.turn_number,
        economyEnabled: !!state.settings.economy_enabled,
        playerSpecialResource: currentPlayer.special_resource ?? 0,
      });
      const placements = state.draft_placements_this_turn ?? {};
      const alreadyPlaced = placements[action.to] ?? 0;
      clamped = Math.min(clamped, Math.max(0, cap - alreadyPlaced));
    }
    if (t && t.owner_id === currentPlayer.player_id && clamped > 0) {
      t.unit_count += clamped;
      state.draft_units_remaining -= clamped;
      if (state.settings.stability_enabled) {
        state.draft_placements_this_turn = state.draft_placements_this_turn ?? {};
        state.draft_placements_this_turn[action.to] = (state.draft_placements_this_turn[action.to] ?? 0) + clamped;
      }
      emitMapVisual(io, gameId, buildReinforceMapVisual({
        territoryId: action.to,
        units: clamped,
        totalAfter: t.unit_count,
        playerId: currentPlayer.player_id,
        state,
      }));
    }
    broadcastState(io, gameId, state);
  }

  // Place any remaining draft units while respecting stability caps per territory.
  if (state.draft_units_remaining > 0) {
    const ownedIds = Object.keys(state.territories).filter(
      (tid) => state.territories[tid].owner_id === currentPlayer.player_id,
    );
    let placedAny = true;
    while (state.draft_units_remaining > 0 && placedAny) {
      placedAny = false;
      for (const tid of ownedIds) {
        if (state.draft_units_remaining <= 0) break;
        const territory = state.territories[tid];
        if (!territory) continue;
        if (state.settings.stability_enabled) {
          const cap = getDeployCap(territory.stability, {
            era: state.era,
            turnNumber: state.turn_number,
            economyEnabled: !!state.settings.economy_enabled,
            playerSpecialResource: currentPlayer.special_resource ?? 0,
          });
          const placements = state.draft_placements_this_turn ?? {};
          const alreadyPlaced = placements[tid] ?? 0;
          if (alreadyPlaced >= cap) continue;
          state.draft_placements_this_turn = state.draft_placements_this_turn ?? {};
          state.draft_placements_this_turn[tid] = alreadyPlaced + 1;
        }
        territory.unit_count += 1;
        state.draft_units_remaining -= 1;
        placedAny = true;
      }
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
      const aiTechTree = state.settings.tech_trees_enabled ? getEraTechTree(state.era) : [];
      const aiHopLimit = getInfluenceHopLimit({
        baseHopLimit: modifiers?.influence_range ?? 1,
        unlockedTechs: currentPlayer.unlocked_techs ?? [],
        techTree: aiTechTree,
        wonderRangeBonus: state.settings.economy_enabled
          ? getWonderInfluenceRange(state, currentPlayer.player_id)
          : 0,
      });
      const aiOwnedIds = Object.entries(state.territories)
        .filter(([, t]) => t.owner_id === currentPlayer.player_id)
        .map(([id]) => id);
      if (!isTerritoryReachableWithinHops({
        map,
        ownedTerritoryIds: aiOwnedIds,
        targetId: action.to,
        hopLimit: aiHopLimit,
      })) continue;

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
          recordElimination(gameId, currentPlayer.player_id);
          io.to(gameId).emit('game:player_eliminated', {
            playerId: previousOwner,
            eliminatorId: currentPlayer.player_id,
            eliminatorName: currentPlayer.username,
            eliminatedName: prevPlayer.username,
            secretMission: prevPlayer.secret_mission ?? null,
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

    const aiConnection = map.connections.find(
      (c) => (c.from === action.from && c.to === action.to) || (c.from === action.to && c.to === action.from),
    );

    // Naval sea-lane gating: AI must have a fleet to cross sea connections
    if (state.settings.naval_enabled && aiConnection?.type === 'sea') {
      if (!from.naval_units || from.naval_units <= 0) continue;
      const defenderFleets = to.naval_units ?? 0;
      if (defenderFleets > 0) {
        const aiNavalResult = resolveNavalCombat(from.naval_units, defenderFleets);
        from.naval_units = Math.max(0, from.naval_units - aiNavalResult.attacker_losses);
        to.naval_units = Math.max(0, defenderFleets - aiNavalResult.defender_losses);
        io.to(gameId).emit('game:naval_combat_result', { fromId: action.from, toId: action.to, result: aiNavalResult });
        emitMapVisual(io, gameId, buildNavalMapVisual({
          fromId: action.from,
          toId: action.to,
          attackerId: currentPlayer.player_id,
          attackerLosses: aiNavalResult.attacker_losses,
          defenderLosses: aiNavalResult.defender_losses,
          attackerWon: aiNavalResult.attacker_won,
          state,
        }));
        if (!aiNavalResult.attacker_won) continue;
      }
      from.naval_units = Math.max(0, from.naval_units - 1);
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
    // Fortify the Coast: coastal_battery grants +1 defense die ONLY on sea attacks.
    const aiSeaDefenseBonus = aiConnection?.type === 'sea'
      ? getSeaDefenseBonus(state, action.to)
      : 0;
    const aiTotalDefenseBonus = aiBuildingDefenseBonus + aiTechDefenseBonus + aiFactionDefenseBonus + aiEventDefenseBonus + aiWonderDefenseBonus + aiSeaDefenseBonus;
    const aiDefenderBonusBreakdown = {
      building: aiBuildingDefenseBonus,
      tech: aiTechDefenseBonus,
      faction: aiFactionDefenseBonus,
      event: aiEventDefenseBonus,
      wonder: aiWonderDefenseBonus,
      sea: aiSeaDefenseBonus,
      total: aiTotalDefenseBonus,
    };
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
    const aiAttackerBonusBreakdown = {
      tech: aiTechAttackBonus,
      faction: aiFactionAttackBonus,
      event: aiEventAttackBonus,
      total: aiTotalAttackBonus,
    };
    const aiAttackerDiceOverride = aiTotalAttackBonus > 0
      ? Math.min(from.unit_count - 1, 3) + aiTotalAttackBonus
      : undefined;

    const aiPuzzleDieRoll = state.puzzle_dice_queue?.length ? createPuzzleDieRoll(state) : undefined;

    const result = resolveCombat(
      from.unit_count,
      to.unit_count,
      aiAttackerDiceOverride,
      aiDefenderDiceOverride,
      aiPuzzleDieRoll,
      state.era_modifiers,
    );
    result.attacker_bonus_breakdown = aiAttackerBonusBreakdown;
    result.defender_bonus_breakdown = aiDefenderBonusBreakdown;
    // If resolveCombat returns an error, skip this attack
    if (result.error) {
      // Optionally emit a warning or log for debugging
      console.warn?.('AI attempted invalid combat:', result.error, { from: from.unit_count, to: to.unit_count });
      continue;
    }
    from.unit_count -= result.attacker_losses;
    to.unit_count -= result.defender_losses;
    recordCombatResult(gameId, currentPlayer.player_id, aiDefenderId ?? null, result, {
      isSea: aiConnection?.type === 'sea',
    });
    if (result.territory_captured) {
      to.owner_id = currentPlayer.player_id;
      to.unit_count = Math.min(from.unit_count - 1, 3);
      from.unit_count = Math.max(1, from.unit_count - to.unit_count);
      // One card per turn — gated by state flag (see human handler + advanceToNextPlayer).
      if (!currentPlayer.card_earned_this_turn) {
        drawCard(state, currentPlayer.player_id);
        currentPlayer.card_earned_this_turn = true;
      }
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
          recordElimination(gameId, currentPlayer.player_id);
          io.to(gameId).emit('game:player_eliminated', {
            playerId: aiDefenderId,
            eliminatorId: currentPlayer.player_id,
            eliminatorName: currentPlayer.username,
            eliminatedName: defenderPlayer.username,
            secretMission: defenderPlayer.secret_mission ?? null,
          });
        }
      }
    }
    syncTerritoryCounts(state);
    io.to(gameId).emit('game:combat_result', { fromId: action.from, toId: action.to, result });
    emitMapVisual(io, gameId, buildCombatMapVisual({
      fromId: action.from,
      toId: action.to,
      attackerId: currentPlayer.player_id,
      defenderId: aiDefenderId,
      attackerLosses: result.attacker_losses,
      defenderLosses: result.defender_losses,
      territoryCaptured: result.territory_captured,
      state,
    }));
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
      emitMapVisual(io, gameId, buildFortifyMapVisual({
        fromTerritoryId: action.from,
        toTerritoryId: action.to,
        units: action.units,
        playerId: currentPlayer.player_id,
        state,
      }));
    }
    broadcastState(io, gameId, state);
  }

  // ── End Turn ───────────────────────────────────────────────────────────
  advanceToNextPlayer(state, map);
  await saveGameState(gameId, state);
  broadcastEventCard(io, gameId, state, map);
  broadcastState(io, gameId, state);
  maybeEmitCoachingTip(io, gameId, state, map);

  aiInFlight.delete(gameId);

  if (await doVictoryCheck()) return;

  // If there's an active event with choices and next player is AI, auto-resolve
  if (state.active_event?.choices?.length && state.players[state.current_player_index].is_ai) {
    const aiEvent = state.active_event;
    const choices = aiEvent?.choices;
    if (!choices?.length) return;
    const choice = choices[0]!;
    const eventResult = resolveEventChoice(state, aiEvent.card_id, choice.choice_id);
    if (eventResult) {
      emitEventCardMapVisuals(io, gameId, {
        cardId: aiEvent.card_id,
        effect: choice.effect,
        result: eventResult,
      });
    }
    io.to(gameId).emit('game:event_card_resolved', { cardId: '' });
    io.to(`${gameId}:spectators`).emit('game:event_card_resolved', { cardId: '' });
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
    const autoDraft = autoPlaceDraftUnits(room.state);
    if (autoDraft.total > 0) {
      emitAutoDraftMapVisuals(io, gameId, room.state, autoDraft.placements);
      broadcastState(io, gameId, room.state);
      io.to(gameId).emit('game:turn_timeout', { appliedDraft: true, unitsPlaced: autoDraft.total });
    }

    advanceToNextPlayer(room.state, room.map);
    await saveGameState(gameId, room.state);
    broadcastEventCard(io, gameId, room.state, room.map);
    broadcastState(io, gameId, room.state);
    maybeEmitCoachingTip(io, gameId, room.state, room.map);

    const humanT = room.state.players.find((p) => !p.is_ai);
    if (humanT && maybeResolveDailyPuzzle(io, gameId, room, null, humanT.player_id, finalizeGame)) {
      return;
    }

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
