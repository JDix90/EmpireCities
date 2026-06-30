import type { Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import { Server, Socket } from 'socket.io';
import { verifyAccessToken } from '../utils/jwt';
import { query, queryOne } from '../db/postgres';
import { emitGameError, GameErrorCode } from './socketErrors';
import { armEvictionTimer, cancelEvictionTimer, pendingEvictionCount } from './evictionTimers';
import { decideTurnTimerRearm } from './turnTimerRearm';
import {
  initializeGameState,
  getStartingPlayerIndex,
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
  advancePhaseOnTimeout,
} from '../game-engine/state/gameStateManager';
import { calculateReinforcements } from '../game-engine/combat/combatResolver';
import { getMarchToSeaBonus, recordMarchToSeaResult } from '../game-engine/combat/combatModifiers';
import {
  validateBuild,
  applyBuild,
  getBuildingDefenseBonus,
  getSeaDefenseBonus,
} from '../game-engine/state/economyManager';
import { validateResearch, applyResearch, getPlayerAttackBonus, getPlayerDefenseBonus, getPlayerReinforceBonus, getEraTechTreeForPlayer } from '../game-engine/state/techManager';
import { markPlayerAway, applySeatReclaim, AWAY_AI_GRACE_MS } from '../game-engine/state/seatTakeover';
import { buildAdvanceEraClientPreview, executeAdvanceEra } from '../game-engine/eraAdvancement/advanceEra';
import { projectMapToEraFloor, unlockTerritoriesForFloor } from '../game-engine/eraAdvancement/territoryUnlock';
import { transformBoardOnAdvance } from '../game-engine/eraAdvancement/boardTransformTrigger';
import { createSeededRng } from '../game-engine/victory/missions';
import { getEraIdForAdvancementIndex } from '../game-engine/eraAdvancement/constants';
import { executeLandAttack } from '../game-engine/combat/executeLandAttack';
import { getWonderDefenseBonus, getWonderSeaAttackDice, getWonderInfluenceRange } from '../game-engine/state/wonderManager';
import { getTechNodeById, getEraTechTree } from '../game-engine/eras';
import { getPlayerFaction } from '../game-engine/eras/factionLineage';
import { resolveEventChoice, getTemporaryModifierValue, getDisplayScaledCard } from '../game-engine/events/eventCardManager';
import { moveFleets, resolveNavalCombat, resolveSeaCrossing } from '../game-engine/state/navalManager';
import { onInfluenceStabilityPenalty, getDeployCap } from '../game-engine/state/stabilityManager';
import { getAdjacentTerritoryIds, getInfluenceHopLimit, isTerritoryReachableWithinHops } from '../game-engine/state/influenceManager';
import {
  connectionRequiresMoonAccess,
  fortifyEndpointsRequireOrbitAccess,
  territoryRequiresOrbitAccessForClaim,
  getOrbitAccessResult,
  formatOrbitAccessError,
  isLaneSealedForPlayer,
  canSealLane,
  tickLaneBlockades,
  GALAXY_LANE_SEAL_DURATION,
} from '../game-engine/state/moonAccess';
import type { BuildingType } from '../types';
import { runAiWithTimeout } from '../game-engine/ai/runAiWithTimeout';
import { evaluateAiEraAdvancement } from '../game-engine/ai/aiEraAdvancement';
import { selectAiBuildingPlacement, selectAiTechResearch } from '../game-engine/ai/aiBot';
import { recordGameResults, computeRanks, redactGuestRatings } from '../game-engine/state/statsManager';
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
import { incrementPlayCount } from '../modules/maps/mapService';
import type { GameState, GameMap, AiDifficulty, PlayerState } from '../types';
import { normalizeGameSettings } from '../game-engine/state/gameSettings';
import { config } from '../config';
import { registerChatHandlers } from './handlers/chatHandler';
import { registerSocketRateLimit } from './socketRateLimit';
import { registerSocketAuth } from './socketAuth';
import { redactPlayersForViewer, maskHiddenTerritories } from './clientStateRedaction';
import { aiPlayerName } from '@borderfall/shared';
import type { SocketContext } from './handlers/types';
import { checkAndRecordActionId, clearActionIdempotency } from './actionIdempotency';
import { captureProbBefore, commitActionDecision, clearDecisionLog, getDecisionLog, summarizeDecisionLog, territoryName } from './actionAttribution';
import { evaluateCoachingTip } from '../game-engine/coaching/coachingDetectors';
import { getFortifyUnitsValidationError, getStartGameAuthorizationError } from './socketGuards';
import { buildRedisAdapter } from './redisAdapter';
import { isPlayerConnected } from './redisGameStore';
import {
  getCachedRoom,
  setCachedRoom,
  getCachedRoomCount,
  loadAuthoritativeRoom,
  withLockedRoom,
  GameRoomNotFoundError,
  persistGameStateAfterMutation,
  flushGameState,
  flushAllPendingPostgresSaves,
  saveGameMapAuthoritative,
  evictGameRoom,
  onPlayerConnected,
  onPlayerDisconnected,
  hasHumanConnections,
  forEachConnectedGame,
  tryAcquireAiTurn,
  releaseAiTurn,
  isAiTurnInFlight,
  type ActiveGameRoom,
} from './gameRoomManager';
import { runWithGameLock } from './gameLock';
import { resolveMap } from './mapResolver';
import {
  isSameLobbyMap,
  lobbyMapChangeBlockedReason,
  parseLobbyMapChangeValue,
  type LobbyMapChangeValue,
} from '../game-engine/lobby/lobbyMapChange';
import {
  buildMapMetaFromDoc,
  formatRulesAndTheaterDisplay as formatLobbyMapChangeDisplay,
  validateLobbyMapChangePair,
} from '../game-engine/lobby/lobbyEraMapCompatibility';
import {
  scheduleTurnTimeout,
  cancelTurnTimeout,
  setTurnTimerProcessor,
  stopTurnTimerWorker,
  turnTimerQueue,
} from '../workers/gameTimerWorker';
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
  TERRITORY_ABILITY_DEFS,
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
  buildEraAdvanceMapVisual,
  buildReinforceMapVisual,
  emitEventCardMapVisuals,
  emitMapVisual,
} from '../game-engine/visuals/mapVisualEvents';
import {
  executeTechAbility,
  isGameScopedAbility,
} from '../game-engine/abilities/executeTechAbility';
import {
  attachCombatAbilityCallouts,
  buildCombatAbilityCallouts,
} from '../game-engine/combat/combatAbilityCallouts';

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
export function getActiveGameMetrics(): { activeGameRooms: number; pendingEvictions: number } {
  return { activeGameRooms: getCachedRoomCount(), pendingEvictions: pendingEvictionCount() };
}

/** Locked mutation with Redis reload, user-visible errors on failure. */
async function mutateLockedRoom(
  gameId: string,
  socket: Socket,
  durationMs: number,
  fn: (room: ActiveGameRoom) => Promise<unknown>,
  action?: string,
): Promise<void> {
  try {
    await withLockedRoom(gameId, fn, { durationMs });
  } catch (err) {
    if (err instanceof GameRoomNotFoundError) {
      console.warn('[Socket] Room unavailable for', action ?? 'action', 'on', gameId);
      emitGameError(
        socket,
        GameErrorCode.GAME_NOT_FOUND,
        'This game is no longer available — it may have ended or been removed.',
      );
      return;
    }
    console.error('[Socket] Locked mutation failed for', action ?? 'action', 'on', gameId, err);
    emitGameError(socket, GameErrorCode.ACTION_FAILED, 'Action failed — please try again');
  }
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
  is_ranked: boolean;
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
  | 'naval_enabled'
  | 'map_change';

type WaitingLobbyProposal = {
  id: string;
  proposerId: string;
  proposerName: string;
  setting: LobbyProposalSettingKey;
  label: string;
  displayValue: string;
  proposedValue: boolean | number | LobbyMapChangeValue;
  yesVotes: string[];
  noVotes: string[];
  createdAt: number;
};

const lobbyProposalsByGame = new Map<string, WaitingLobbyProposal[]>();

const LOBBY_PROPOSABLE_SETTINGS: Record<LobbyProposalSettingKey, {
  label: string;
  parseValue: (value: unknown) => boolean | number | LobbyMapChangeValue | null;
  displayValue: (value: boolean | number | LobbyMapChangeValue) => string;
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
  map_change: {
    label: 'Map & Era',
    parseValue: (value) => parseLobbyMapChangeValue(value),
    displayValue: (value) => {
      const v = value as LobbyMapChangeValue;
      return formatLobbyMapChangeDisplay(v.era_id, v.map_id);
    },
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
    `SELECT game_id, era_id, map_id, status, settings_json, join_code,
            COALESCE(is_ranked, false) AS is_ranked
     FROM games WHERE game_id = $1`,
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

async function applyApprovedLobbyMapChange(
  io: Server,
  gameId: string,
  lobby: WaitingLobbyDetails,
  value: LobbyMapChangeValue,
): Promise<void> {
  await query(
    'UPDATE games SET era_id = $2, map_id = $3 WHERE game_id = $1',
    [gameId, value.era_id, value.map_id],
  );
  await query('UPDATE game_players SET faction_id = NULL WHERE game_id = $1', [gameId]);

  if (lobby.settings.era_advancement_enabled && value.era_id !== 'ancient') {
    const nextSettings = normalizeGameSettings({
      ...lobby.settings,
      era_advancement_enabled: undefined,
    });
    await query('UPDATE games SET settings_json = $2 WHERE game_id = $1', [gameId, JSON.stringify(nextSettings)]);
  }

  const gameMap = await resolveMap(value.map_id);
  if (gameMap) {
    // Lobby preview shows the starting board (era floor 0); growth territories
    // appear in-game as eras advance. No-op for maps without growth tags.
    io.to(gameId).emit('game:map', { mapId: value.map_id, map: projectMapToEraFloor(gameMap, 0) });
  }
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

/** Thrown by the AI turn's delay() when the seat is reclaimed mid-turn, to abort cleanly. */
class SeatReclaimedDuringAiTurn extends Error {}

// Away-seat model: when a human disconnects, their seat is marked *away* (see
// markPlayerAway / markSeatAway) — NOT converted to AI. The AI merely covers the
// seat's turns after a short reconnect window (AWAY_AI_GRACE_MS, derived from the
// persisted away_since so it survives restarts), and the player reclaims instantly
// on return. These maps hold the per-game in-memory timers used to drive that.
//
// Background reclaim retries, keyed `${gameId}:${playerId}`. A reclaim that
// arrives while an away-AI turn holds the room lock is retried until it lands (or
// the seat is no longer away), so a reconnect is never silently dropped.
const reclaimRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
// Pending "let the AI cover the away seat's current turn" timers, keyed by gameId.
const awayAiTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Clear a game's pending away-AI + reclaim-retry timers (eviction / game over). */
function clearGameSeatTimers(gameId: string): void {
  const away = awayAiTimers.get(gameId);
  if (away) {
    clearTimeout(away);
    awayAiTimers.delete(gameId);
  }
  for (const [key, timer] of reclaimRetryTimers) {
    if (key.startsWith(`${gameId}:`)) {
      clearTimeout(timer);
      reclaimRetryTimers.delete(key);
    }
  }
}

const EVICTION_DELAY_MS = 5 * 60 * 1000;

/**
 * Arm the no-humans eviction check for a game.
 *
 * The timer is tracked per game (any game:join cancels it via
 * cancelEvictionTimer) and the final check trusts actual socket.io room
 * membership over the hand-rolled presence sets. The presence sets can be
 * corrupted by leave/rejoin races: a transient GamePage remount (StrictMode,
 * suspense flip, navigation) emits game:leave and rejoins within
 * milliseconds, but the leave handler's late presence decrement lands after
 * the rejoin's increment — making a connected player invisible. That race
 * used to get LIVE games evicted five minutes later: turn timer cancelled
 * (clock dead at 0:00), Redis state deleted, AI processing stalled.
 */
function armGameEviction(io: Server, gameId: string, mapId: string, reason: string): void {
  armEvictionTimer(gameId, EVICTION_DELAY_MS, () => {
    void (async () => {
      try {
        // Authoritative liveness: any socket still in the game room (resolved
        // across instances by the adapter) means the game is not abandoned.
        const liveSockets = await io.in(gameId).fetchSockets();
        if (liveSockets.length > 0) return;

        const current = await loadAuthoritativeRoom(gameId, mapId);
        if (!current) return;
        if (await hasHumanConnections(gameId, current.state)) return;

        if (!current.state.settings.async_mode) {
          clearTurnTimer(gameId, current.state);
        }
        void evictGameRoom(gameId);
        clearGameSeatTimers(gameId);
        clearActionIdempotency(gameId);
        spectatorSeqCounters.delete(gameId);
        spectatorStateBuffers.delete(gameId);
        console.log(`[Socket] Evicted inactive game ${gameId} from memory (${reason})`);
      } catch (err) {
        console.error('[Socket] Eviction check failed for', gameId, err);
      }
    })();
  });
}

/**
 * Mark a disconnected human's seat as *away*. The seat keeps its territories and
 * army and stays a human (is_ai unchanged); the AI just covers its turns while
 * away, and the player reclaims instantly on reconnect (reclaimAwaySeat). If it's
 * the away player's turn, the away-AI is scheduled (after the reconnect window).
 */
async function markSeatAway(io: Server, gameId: string, playerId: string): Promise<void> {
  try {
    await withLockedRoom(gameId, async (room) => {
      const { state, map } = room;
      if (state.phase === 'game_over') return;

      const player = state.players.find((p) => p.player_id === playerId);
      if (!player) return;
      // Still connected on another socket/tab, or nothing to do.
      if (await isPlayerConnected(gameId, playerId)) return;
      if (!markPlayerAway(player, Date.now())) return;

      console.log(`[Socket] Player away: ${playerId} in game ${gameId} (AI will cover their turns)`);
      recordServerEvent('seat_player_away', {
        game_id: gameId,
        player_id: playerId,
        turn_number: state.turn_number,
      }, playerId);

      await persistGameStateAfterMutation(gameId, state);

      io.to(gameId).emit('game:player_away', {
        player_id: playerId,
        username: player.username,
      });
      broadcastState(io, gameId, state);

      // If it's their turn, route through the turn driver so the AI covers it
      // once the reconnect window elapses.
      if (state.players[state.current_player_index]?.player_id === playerId) {
        startTurnTimer(io, gameId, state, map);
      }
    });
  } catch (err) {
    if (!(err instanceof GameRoomNotFoundError)) {
      console.error('[Socket] markSeatAway failed for', gameId, playerId, err);
    }
  }
}

/**
 * Schedule the AI to cover the current (away) seat's turn once its reconnect
 * window elapses. Restart-safe: the remaining wait is derived from the persisted
 * away_since, and the fired handler re-guards on is_ai||is_away, so a reconnect in
 * the meantime simply makes it a no-op. Idempotent per game.
 */
function scheduleAwayAiTurn(io: Server, gameId: string, awaySince: number | null | undefined): void {
  const existing = awayAiTimers.get(gameId);
  if (existing) clearTimeout(existing);
  const remainingMs = Math.max(0, AWAY_AI_GRACE_MS - (Date.now() - (awaySince ?? Date.now())));
  const timer = setTimeout(() => {
    awayAiTimers.delete(gameId);
    void driveCurrentSeatIfAi(io, gameId);
  }, remainingMs + 1000);
  timer.unref();
  awayAiTimers.set(gameId, timer);
}

/** Dispatch the AI for the current seat if it's AI-driven or away (phase-aware). */
async function driveCurrentSeatIfAi(io: Server, gameId: string): Promise<void> {
  const room = getCachedRoom(gameId) ?? (await loadAuthoritativeRoom(gameId).catch(() => null));
  if (!room) return;
  const current = room.state.players[room.state.current_player_index];
  if (!current || (!current.is_ai && !current.is_away)) return;
  if (room.state.phase === 'territory_select') {
    void processAiTerritorySelect(io, gameId);
  } else {
    void processAiTurn(io, gameId);
  }
}

/**
 * Hand an away seat back when the human returns: clear the away flag, announce
 * the return, and — if it's their turn — (re)start their turn clock (the away-AI
 * ran without a human clock). Present / AI / eliminated seats are untouched.
 *
 * Returns:
 *  - 'reclaimed': the seat was handed back (state broadcast).
 *  - 'noop': nothing to do (not away, eliminated, or game over).
 *  - 'contended': an away-AI turn currently holds the room lock; the caller should
 *    retry shortly (scheduleReclaimRetry) so the return is never dropped.
 *
 * processAiTurn holds the room lock for the whole turn (30s TTL) and its delay()
 * aborts once the seat is no longer away, so a return either lands between turns
 * or is retried — never interleaved with an away-AI action.
 */
type ReclaimResult = 'reclaimed' | 'noop' | 'contended';

function isLockContentionError(err: unknown): boolean {
  if (err instanceof GameRoomNotFoundError) return false;
  const e = err as { name?: string; message?: string } | null;
  return /ExecutionError|LockError|quorum/i.test(`${e?.name ?? ''} ${e?.message ?? String(err)}`);
}

async function reclaimAwaySeat(io: Server, gameId: string, playerId: string): Promise<ReclaimResult> {
  let reclaimed = false;
  try {
    await withLockedRoom(gameId, async (room) => {
      const { state, map } = room;
      if (state.phase === 'game_over') return;

      const player = state.players.find((p) => p.player_id === playerId);
      if (!player || !applySeatReclaim(player)) return;
      reclaimed = true;

      // No game_players write needed: an away seat never flipped is_ai, so the
      // row already reads as a human — only the in-state away flag is cleared.
      await persistGameStateAfterMutation(gameId, state);

      console.log(`[Socket] Player returned: ${playerId} resumed their seat in game ${gameId}`);
      recordServerEvent('seat_player_returned', {
        game_id: gameId,
        player_id: playerId,
        turn_number: state.turn_number,
      }, playerId);

      io.to(gameId).emit('game:player_returned', {
        player_id: playerId,
        username: player.username,
      });
      broadcastState(io, gameId, state);

      // If it's now their turn, the away-AI had no human clock running — start it
      // so the returning player gets a full turn timer instead of a dead clock.
      const current = state.players[state.current_player_index];
      if (
        current?.player_id === playerId &&
        state.phase !== 'territory_select' &&
        !(await isAiTurnInFlight(gameId))
      ) {
        startTurnTimer(io, gameId, state, map);
      }
    });
  } catch (err) {
    // An in-flight away-AI turn holds the lock — signal the caller to retry rather
    // than dropping the return and leaving the AI in their seat.
    if (isLockContentionError(err)) return 'contended';
    if (!(err instanceof GameRoomNotFoundError)) {
      console.error('[Socket] Seat return failed for', gameId, playerId, err);
    }
  }
  return reclaimed ? 'reclaimed' : 'noop';
}

/**
 * Keep retrying a return that lost the race to an in-flight away-AI turn, until it
 * lands or stops being applicable. Bounded (~40s) and self-clearing; stops early
 * if the player disconnects again (markSeatAway re-owns that seat).
 */
function scheduleReclaimRetry(io: Server, gameId: string, playerId: string): void {
  const key = `${gameId}:${playerId}`;
  if (reclaimRetryTimers.has(key)) return; // already retrying this seat
  let attemptsLeft = 20;
  const tick = async () => {
    reclaimRetryTimers.delete(key);
    if (!(await isPlayerConnected(gameId, playerId))) return; // left again
    let result: ReclaimResult = 'noop';
    try {
      result = await reclaimAwaySeat(io, gameId, playerId);
    } catch {
      result = 'contended';
    }
    if (result === 'contended' && --attemptsLeft > 0) {
      const t = setTimeout(() => void tick(), 2000);
      t.unref();
      reclaimRetryTimers.set(key, t);
    }
  };
  const t = setTimeout(() => void tick(), 2000);
  t.unref();
  reclaimRetryTimers.set(key, t);
}

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

// Tracks the last turn (per game) for which we honored a client `game:turn_ready`
// ack, so a single turn's timer can be realigned to the globe-render moment at
// most once. Without this a client could repeatedly emit the ack to keep
// resetting its own countdown and stall the game.
const turnReadyAcked = new Map<string, string>();
// A turn-ready ack is only honored shortly after the turn began. A late ack
// (e.g. from a reconnect deep into the turn) must not hand the player a fresh
// full clock.
const TURN_READY_MAX_WINDOW_MS = 20_000;

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
    // Cap inbound packet size. Every client→server event here is small (chat is
    // ≤500 chars, actions carry a few ids/ints, lobby settings are a small
    // object); the engine.io default is 1 MB, which lets a client buffer a
    // megabyte per packet before our Zod/handler validation runs. 32 KB is far
    // above any legitimate payload while removing that amplification headroom.
    // (This bounds RECEIVED data only — server→client state broadcasts are
    // unaffected.)
    maxHttpBufferSize: 32 * 1024,
  });

  // ── Phase 1: Redis adapter for cross-instance Socket.io broadcasting ────
  // Transparent with a single instance; required for horizontal scaling.
  io.adapter(buildRedisAdapter());

  // ── Register async deadline processor ───────────────────────────────────
  setDeadlineProcessor(async (job) => {
    const { gameId, turnNumber, playerIndex } = job.data;
    await runWithGameLock(gameId, async () => {
      const game = await queryOne<{ map_id: string; status: string }>(
        'SELECT map_id, status FROM games WHERE game_id = $1',
        [gameId],
      );
      if (!game || game.status !== 'in_progress') return;
      const room = await loadAuthoritativeRoom(gameId, game.map_id);
      if (!room) return;
      getOrBuildAdjacency(room.map);

      const { state, map } = room;

      // Stale-job guard: only process if turn/player still match
      if (state.phase === 'game_over') return;
      if (state.turn_number !== turnNumber || state.current_player_index !== playerIndex) return;

      const autoDraft = autoPlaceDraftUnits(state);
      if (autoDraft.total > 0) {
        emitAutoDraftMapVisuals(io, gameId, state, autoDraft.placements);
        broadcastState(io, gameId, state);
      }
      // Emitted before advanceToNextPlayer so clients can attribute the
      // timeout to the player whose deadline lapsed. phaseAdvanced drives the
      // explanation toast — async deadlines always forfeit the whole turn.
      io.to(gameId).emit('game:turn_timeout', {
        phaseAdvanced: 'next_turn',
        appliedDraft: autoDraft.total > 0,
        unitsPlaced: autoDraft.total,
      });

      advanceToNextPlayer(state, map);
      {
        // Turn-passing can end the game (turn-cap stalemate guard).
        const asyncVictory = checkVictory(state, map);
        if (asyncVictory) {
          const { winnerIds, condition } = asyncVictory;
          state.phase = 'game_over';
          state.winner_id = winnerIds[0]!;
          state.winner_ids = winnerIds;
          state.victory_condition = condition;
          await finalizeGame(io, gameId, state, winnerIds);
          broadcastState(io, gameId, state);
          return;
        }
      }
      await saveGameState(gameId, state);
      broadcastEventCard(io, gameId, state, map);
      broadcastState(io, gameId, state);
      maybeEmitCoachingTip(io, gameId, state, map);

      const humanAfterAsync = state.players.find((p) => !p.is_ai);
      if (humanAfterAsync && maybeResolveDailyPuzzle(io, gameId, room, null, humanAfterAsync.player_id, finalizeGame)) {
        return;
      }

      if (!state.active_event?.choices?.length) {
        startTurnTimer(io, gameId, state, map);
      }
      if (state.players[state.current_player_index].is_ai) {
        setTimeout(() => processAiTurn(io, gameId), 1500);
      }
    });
  });

  // ── Phase 7: BullMQ turn timer processor (real-time mode) ─────────────────
  setTurnTimerProcessor(async (job) => {
    const { gameId } = job.data;
    await runWithGameLock(gameId, async () => {
      const game = await queryOne<{ map_id: string; status: string }>(
        'SELECT map_id, status FROM games WHERE game_id = $1',
        [gameId],
      );
      if (!game || game.status !== 'in_progress') return;
      const room = await loadAuthoritativeRoom(gameId, game.map_id);
      if (!room) return;
      getOrBuildAdjacency(room.map);

      if (room.state.phase === 'game_over') return;

      // Real-time timeout: advance ONE phase (draft → attack → fortify) so the
      // active player doesn't silently forfeit their attack/fortify phases by
      // letting the draft clock run out. Only a fortify-phase timeout ends the turn.
      const adv = advancePhaseOnTimeout(room.state, room.map);

      if (adv.kind === 'phase') {
        if (adv.autoDraft.total > 0) {
          emitAutoDraftMapVisuals(io, gameId, room.state, adv.autoDraft.placements);
        }
        // Same player continues into the next phase — re-arm their timer first
        // so the saved/broadcast state carries the fresh phase_deadline_at.
        startTurnTimer(io, gameId, room.state, room.map);
        io.to(gameId).emit('game:turn_timeout', {
          phaseAdvanced: adv.newPhase,
          appliedDraft: adv.autoDraft.total > 0,
          unitsPlaced: adv.autoDraft.total,
          deadline_at: room.state.phase_deadline_at ?? null,
        });
        await saveGameState(gameId, room.state);
        broadcastState(io, gameId, room.state);
        maybeEmitCoachingTip(io, gameId, room.state, room.map);
        return;
      }

      // Fortify timed out → turn handed to the next player (advanceToNextPlayer
      // already ran inside advancePhaseOnTimeout).
      io.to(gameId).emit('game:turn_timeout', { phaseAdvanced: 'next_turn' });
      {
        // Turn-passing can end the game (turn-cap stalemate guard).
        const timeoutVictory = checkVictory(room.state, room.map);
        if (timeoutVictory) {
          const { winnerIds, condition } = timeoutVictory;
          room.state.phase = 'game_over';
          room.state.winner_id = winnerIds[0]!;
          room.state.winner_ids = winnerIds;
          room.state.victory_condition = condition;
          await finalizeGame(io, gameId, room.state, winnerIds);
          broadcastState(io, gameId, room.state);
          return;
        }
      }
      await saveGameState(gameId, room.state);
      broadcastEventCard(io, gameId, room.state, room.map);
      broadcastState(io, gameId, room.state);
      maybeEmitCoachingTip(io, gameId, room.state, room.map);

      const humanT = room.state.players.find((p) => !p.is_ai);
      if (humanT && maybeResolveDailyPuzzle(io, gameId, room, null, humanT.player_id, finalizeGame)) {
        return;
      }

      if (!room.state.active_event?.choices?.length) {
        startTurnTimer(io, gameId, room.state, room.map);
      }

      if (room.state.players[room.state.current_player_index].is_ai) {
        setTimeout(() => processAiTurn(io, gameId), 1500);
      }
    });
  });
  // Processor registered above; worker started from index.ts after initGameSocket returns.

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
    // Record the token's expiry so registerSocketAuth can stop the socket
    // acting on an expired credential (and let it refresh in place).
    socket.data.tokenExp = payload.exp;
    next();
  });

  io.on('connection', (socket) => {
    const userId = (socket as Socket & { userId: string }).userId;
    const username = (socket as Socket & { username: string }).username;
    console.log(`[Socket] Connected: ${userId} (${socket.id})`);
    socket.join(`user:${userId}`);

    // Enforce access-token expiry on the live socket (the handshake only checks
    // it once) and accept `auth:refresh` to extend it in place. Registered
    // BEFORE the rate limiter so an expired event is dropped before any work.
    registerSocketAuth(socket);

    // Per-user inbound throttle (shared Redis limiter). Installed before any
    // handler so every event — chat, gameplay, joins — passes through it.
    registerSocketRateLimit(socket, userId);

    // ── Extracted handlers ──────────────────────────────────────────────────
    const ctx: SocketContext = {
      io, socket, userId, username,
      getRoom: getCachedRoom, broadcastState, scheduleDebouncedSave, isSocketUsersTurn,
    };
    registerChatHandlers(ctx);

    // ── Join Game Room ──────────────────────────────────────────────────────
    socket.on('game:join', async ({ gameId }: { gameId: string }) => {
      try {
        const game = await queryOne<WaitingLobbyGameRow>(
          `SELECT game_id, era_id, map_id, status, settings_json, join_code,
                  COALESCE(is_ranked, false) AS is_ranked
           FROM games WHERE game_id = $1`,
          [gameId],
        );
        if (!game) return emitGameError(socket, GameErrorCode.GAME_DELETED, 'Game not found');

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
        if (!isParticipant) return emitGameError(socket, GameErrorCode.NOT_PARTICIPANT, 'Not a participant in this game');

        // A client socket is a singleton, so navigating between games can leave
        // it subscribed to a previous game's room. Leave any stale game/spectator
        // rooms before joining so this socket never receives another game's
        // broadcasts (which would flicker the client between two games).
        for (const room of socket.rooms) {
          if (
            room !== socket.id &&
            room !== `user:${userId}` &&
            room !== gameId &&
            room !== `${gameId}:spectators`
          ) {
            socket.leave(room);
          }
        }

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
          const waitingMap = await resolveMap(game.map_id);
          if (waitingMap) {
            socket.emit('game:map', { mapId: game.map_id, map: projectMapToEraFloor(waitingMap, 0) });
          }
        }

        // Load in-progress state from Redis (never serve a stale per-instance cache on join/reconnect).
        let room: ActiveGameRoom | null = null;
        if (game.status === 'in_progress') {
          room = await loadAuthoritativeRoom(gameId, game.map_id);
          if (!room) {
            console.error(`[Socket] MAP_LOAD_FAILED: game=${gameId} map_id=${game.map_id}`);
            return socket.emit('error', { message: 'Map unavailable; the game cannot be resumed right now', code: 'MAP_LOAD_FAILED' });
          }
          getOrBuildAdjacency(room.map);
        }

        if (room) {
          await onPlayerConnected(gameId, socket.id, userId);
          // If the player was away (AI covering their turns), hand the seat back
          // now that they've returned, then reload the refreshed state. If an
          // away-AI turn currently holds the lock, retry in the background so the
          // return is never silently dropped.
          const reclaimResult = await reclaimAwaySeat(io, gameId, userId);
          if (reclaimResult === 'reclaimed') {
            room = (await loadAuthoritativeRoom(gameId, game.map_id)) ?? room;
          } else if (reclaimResult === 'contended') {
            scheduleReclaimRetry(io, gameId, userId);
          }
          // A player is here — any pending no-humans eviction is now wrong.
          cancelEvictionTimer(gameId);
          socket.emit('game:state', buildClientState(room.state, userId, room.state.settings.fog_of_war));
          // Embed the map directly in the join handshake so private/pending
          // custom maps don't have to be re-fetched via the public REST
          // endpoint (which now requires the requester to be the creator
          // or have access to a public+approved map).
          socket.emit('game:map', {
            mapId: room.state.map_id,
            map: projectMapToEraFloor(room.map, room.state.map_era_floor ?? 0),
          });

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
          if (currentAiPlayer?.is_ai && room.state.phase !== 'game_over' && !(await isAiTurnInFlight(gameId))) {
            if (room.state.phase === 'territory_select') {
              setTimeout(() => processAiTerritorySelect(io, gameId), 800);
            } else {
              setTimeout(() => processAiTurn(io, gameId), 1500);
            }
          }

          // Real-time games: an eviction race or restart can cancel the BullMQ
          // timeout while clients keep an armed deadline — the HUD clock dies
          // at 0:00 and the phase never advances. Restore it on (re)join: an
          // unexpired deadline is kept (a reconnect must never grant extra
          // clock), a missing/expired one gets a fresh timer.
          if (!room.state.settings.async_mode && room.state.phase !== 'game_over' && !currentAiPlayer?.is_ai) {
            try {
              const job = await turnTimerQueue.getJob(`turn-${gameId}`);
              const decision = decideTurnTimerRearm({
                hasScheduledJob: !!job,
                phase: room.state.phase,
                asyncMode: !!room.state.settings.async_mode,
                turnTimerSeconds: room.state.settings.turn_timer_seconds,
                currentPlayerIsAi: !!currentAiPlayer?.is_ai,
                deadlineAt: room.state.phase_deadline_at,
                now: Date.now(),
              });
              if (decision.kind === 'remaining') {
                scheduleTurnTimeout(gameId, decision.delayMs).catch((err) =>
                  console.error('[Socket] Turn-timer re-arm (remaining) failed for', gameId, err),
                );
              } else if (decision.kind === 'fresh') {
                console.warn('[Socket] Re-arming lost turn timer for', gameId, '(deadline missing or expired)');
                startTurnTimer(io, gameId, room.state, room.map);
                broadcastState(io, gameId, room.state);
              }
            } catch (err) {
              console.error('[Socket] Turn-timer re-arm check failed for', gameId, err);
            }
          }

          // For async games, ensure the deadline job is still scheduled (may be lost on server restart)
          if (room.state.settings.async_mode && room.state.phase !== 'game_over' && !currentAiPlayer?.is_ai) {
            import('../workers/asyncDeadlineWorker').then(({ asyncDeadlineQueue }) => {
              const jobId = `deadline-${gameId}-${room!.state.turn_number}`;
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
        if (!game) return emitGameError(socket, GameErrorCode.GAME_DELETED, 'Game not found');
        if (game.status !== 'in_progress') return socket.emit('error', { message: 'Game is not in progress' });

        const spectatorRoom = `${gameId}:spectators`;
        socket.join(spectatorRoom);
        socket.data = { ...socket.data, spectating: gameId };

        const room = await loadAuthoritativeRoom(gameId, game.map_id);
        if (room) getOrBuildAdjacency(room.map);

        // Increment spectator count
        await query('UPDATE games SET spectator_count = spectator_count + 1 WHERE game_id = $1', [gameId]).catch(() => {});

        let spectators = spectatorSocketsByGame.get(gameId);
        if (!spectators) {
          spectators = new Set();
          spectatorSocketsByGame.set(gameId, spectators);
        }
        spectators.add(socket.id);

        if (room) {
          recordSpectatorState(gameId, room.state);
          const initEntry = getDelayedSpectatorState(gameId);
          socket.emit('game:state', initEntry
            ? { ...initEntry.state, _spectator_seq: initEntry.seq }
            : buildClientState(room.state, null, room.state.settings.fog_of_war));
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
        await runWithGameLock(gameId, async () => {
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
          return emitGameError(socket, GameErrorCode.GAME_DELETED, 'Game not found');
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
          const room = await loadAuthoritativeRoom(gameId, game.map_id);
          if (!room) {
            return socket.emit('error', { message: 'Game state not found' });
          }
          getOrBuildAdjacency(room.map);
          await onPlayerConnected(gameId, socket.id, userId);
          socket.emit('game:started', buildGameStartedPayload(gameId, room.state));
          socket.emit('game:map', {
            mapId: room.state.map_id,
            map: projectMapToEraFloor(room.map, room.state.map_era_floor ?? 0),
          });
          socket.emit('game:state', buildClientState(room.state, userId, room.state.settings.fog_of_war));
          return;
        }

        if (game.status !== 'waiting') {
          return socket.emit('error', { message: 'Game cannot be started' });
        }
        const result = await startWaitingGameLocked(io, gameId);
        if (!result.ok) {
          return socket.emit('error', { message: result.error });
        }
        });
      } catch (err) {
        console.error('[Socket] game:start error:', err);
        socket.emit('error', { message: 'Failed to start game' });
      }
    });

    // ── Draft Action ────────────────────────────────────────────────────────
    socket.on('game:draft', async ({ gameId, territoryId, units, action_id }: { gameId: string; territoryId: string; units: number; action_id?: string }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
      const { state, map } = room;

      const currentPlayer = state.players[state.current_player_index];
      if (!currentPlayer) return socket.emit('error', { message: 'Not your turn' });
      if (!isSocketUsersTurn(state, userId, username)) return socket.emit('error', { message: 'Not your turn' });
      if (state.phase !== 'draft') return socket.emit('error', { message: 'Not in draft phase' });

      repairDraftUnitsIfMissing(state, map);
      // Reject non-integer counts (e.g. a crafted `units: 1.5`) before the range
      // check — fractional values would corrupt unit_count and propagate through
      // combat/reinforcement math. (game:fortify already guards this via
      // getFortifyUnitsValidationError; draft/naval did not.)
      if (!Number.isInteger(units)) {
        return socket.emit('error', { message: 'Unit count must be a whole number' });
      }
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
      void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
      });
    });

    // ── Territory Selection (territory draft mode) ────────────────────────
    socket.on('game:select_territory', async ({ gameId, territoryId, action_id }: { gameId: string; territoryId: string; action_id?: string }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
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
        const starterIdx = getStartingPlayerIndex(state);
        state.current_player_index = starterIdx;
        state.turn_number = 1;
        state.turn_started_at = Date.now();
        const firstPlayer = state.players[starterIdx];
        const bonus = calculateContinentBonuses(state, map, firstPlayer.player_id);
        const passiveReinforceBonus = getPlayerReinforceBonus(state, firstPlayer.player_id);
        state.draft_units_remaining = calculateReinforcements(
          firstPlayer.territory_count,
          bonus,
          state.players.length,
        ) + passiveReinforceBonus;
      }

      broadcastState(io, gameId, state);
      void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));

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
    });

    // ── Attack Action ───────────────────────────────────────────────────────
    socket.on('game:attack', async ({ gameId, fromId, toId, action_id, breakTruce }: { gameId: string; fromId: string; toId: string; action_id?: string; breakTruce?: boolean }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
      if (!checkAndRecordActionId(gameId, userId, action_id)) return;
      const { state, map } = room;

      const currentPlayer = state.players[state.current_player_index];
      if (!isSocketUsersTurn(state, userId, username)) return socket.emit('error', { message: 'Not your turn' });
      if (state.phase !== 'attack') return socket.emit('error', { message: 'Not in attack phase' });
      if (currentPlayer.era_advanced_this_turn) {
        return socket.emit('error', { message: 'Cannot attack after advancing this turn' });
      }

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
        if (isLaneSealedForPlayer(state, fromId, toId, currentPlayer.player_id)) {
          return socket.emit('error', { message: 'That hyperspace lane is sealed' });
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

      const connection = map.connections.find(
        (c) => (c.from === fromId && c.to === toId) || (c.from === toId && c.to === fromId)
      );

      // Naval warfare: amphibious sea-lane assault when naval_enabled. The land
      // attack is no longer gated on annihilating the enemy fleet — as long as a
      // ship survives to ferry the troops, the landing proceeds and any surviving
      // enemy fleet bombards it (bonus defender dice below). This removes the
      // "island + naval base = unconquerable" attrition spiral.
      let navalBombardmentDefenseBonus = 0;
      if (state.settings.naval_enabled && connection?.type === 'sea') {
        if (!fromTerritory.naval_units || fromTerritory.naval_units <= 0) {
          return socket.emit('error', { message: 'No fleet to traverse sea lane' });
        }
        const crossing = resolveSeaCrossing(fromTerritory, toTerritory);
        if (crossing.navalResult) {
          io.to(gameId).emit('game:naval_combat_result', {
            fromId, toId,
            result: crossing.navalResult,
          });
          emitMapVisual(io, gameId, buildNavalMapVisual({
            fromId,
            toId,
            attackerId: userId,
            attackerLosses: crossing.navalResult.attacker_losses,
            defenderLosses: crossing.navalResult.defender_losses,
            attackerWon: crossing.navalResult.attacker_won,
            state,
          }));
        }
        if (!crossing.canLand) {
          // Fleet sunk crossing the strait — the landing fails this turn, but the
          // target is not a wall: bring more ships and try again.
          broadcastState(io, gameId, state);
          void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
          return;
        }
        navalBombardmentDefenseBonus = crossing.bombardmentDefenseBonus;
      }

      // Consume one-shot attack buffs (air strike pre-damage, extra die, ignore
      // defense building) only once the attack is committed to land combat. Doing
      // this AFTER the sea-lane/naval gate prevents a "no fleet" rejection or a
      // naval defeat from silently burning the buffs for no benefit.
      // Blitzkrieg: this attack qualifies as the bonus follow-up if the source
      // matches the territory we just captured from while the doctrine was active.
      const isBlitzkriegBonusAttack =
        !!state.blitzkrieg_active
        && (state.blitzkrieg_bonus_attacks_remaining ?? 0) > 0
        && state.blitzkrieg_bonus_source_id === fromId;

      // March to the Sea (ACW): +1 attack die on up to 3 consecutive chain captures.
      const marchToSeaBonus = getMarchToSeaBonus(currentPlayer, fromId);

      const puzzleSpecPre = getDailyPuzzleSpec(state);
      const stateBeforePuzzle =
        puzzleSpecPre && puzzleSpecPre.archetype !== 'domination'
          ? (JSON.parse(JSON.stringify(state)) as GameState)
          : null;
      const puzzleDieRoll = state.puzzle_dice_queue?.length ? createPuzzleDieRoll(state) : undefined;

      const attackProbBefore = captureProbBefore(state, userId);
      const defenderIdBeforeCombat = toTerritory.owner_id;
      const attackerUnitsCommitted = fromTerritory.unit_count;

      // Single source of truth for the land exchange — shared with the AI handler
      // and the balance sim. Socket-only concerns (visuals, callouts, stat
      // recording, blitzkrieg state, elimination broadcast) stay here, around it.
      const landOutcome = executeLandAttack(state, userId, fromId, toId, {
        connection,
        dieRoll: puzzleDieRoll,
        extraAttackBonuses: {
          truce_retaliation: truceRetaliationBonus,
          blitzkrieg: isBlitzkriegBonusAttack ? 1 : 0,
          march_to_sea: marchToSeaBonus,
        },
        extraDefenseBonuses: {
          truce_break: truceBrokenDefenseBonus,
          naval_bombardment: navalBombardmentDefenseBonus,
        },
        onCapture: (s) => {
          // Classic Risk: at most one territory card per turn (reset in advanceToNextPlayer).
          if (!currentPlayer.card_earned_this_turn) {
            drawCard(s, userId);
            currentPlayer.card_earned_this_turn = true;
          }
        },
      });
      if (!landOutcome) {
        return socket.emit('error', { message: 'Invalid attack' });
      }
      const result = landOutcome.result;
      // Bail out if combat was invalid (e.g. defender hit 0 units via a race).
      // executeLandAttack left state unmutated in this case.
      if (result.error) {
        return socket.emit('error', { message: result.error });
      }

      // Air-strike pre-attack damage visual (the damage was applied inside
      // executeLandAttack; this still precedes game:combat_result below).
      if (landOutcome.preAttackDamageApplied > 0) {
        emitPreAttackAirStrikeVisuals(io, gameId, {
          preAttackDamage: landOutcome.preAttackDamageApplied,
          fromTerritoryId: fromId,
          targetTerritoryId: toId,
          attacker: { player_id: userId, username: currentPlayer.username, color: currentPlayer.color },
          defenderId: defenderIdBeforeCombat,
          state,
          map,
        });
      }

      attachCombatAbilityCallouts(
        result,
        buildCombatAbilityCallouts({
          state,
          attackerId: userId,
          toId,
          attackBuffs: landOutcome.attackBuffs,
          abilityUses: currentPlayer.ability_uses,
          rawAttackerLosses: landOutcome.rawAttackerLosses,
        }),
      );

      // Accumulate per-player combat stats for post-game breakdown
      const defenderId = defenderIdBeforeCombat;
      recordCombatResult(gameId, userId, defenderId ?? null, result, {
        isSea: connection?.type === 'sea',
      });

      // Server-authoritative remaining units on the attacking territory (drives
      // the client's "Attack again" button) — taken before any capture move-in.
      result.source_units_after = landOutcome.sourceUnitsAfter;

      let defenderEliminated = false;
      if (result.territory_captured) {
        // Track for blitzkrieg achievement
        const capturingPlayer = state.players.find((p) => p.player_id === userId);
        if (capturingPlayer) {
          capturingPlayer.territories_captured_this_turn = (capturingPlayer.territories_captured_this_turn ?? 0) + 1;
          if ((capturingPlayer.territories_captured_this_turn) > (capturingPlayer.territories_captured_turn_max ?? 0)) {
            capturingPlayer.territories_captured_turn_max = capturingPlayer.territories_captured_this_turn;
          }
        }

        // Blitzkrieg: a capture arms one bonus attack from the same source territory.
        if (state.blitzkrieg_active && (state.blitzkrieg_bonus_attacks_remaining ?? 0) > 0) {
          state.blitzkrieg_bonus_source_id = fromId;
        }

        // Elimination broadcast (cards transferred + is_eliminated set in executeLandAttack).
        if (landOutcome.defenderEliminated) {
          defenderEliminated = true;
          const defenderPlayer = state.players.find((p) => p.player_id === defenderId);
          if (defenderPlayer) {
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

      // Consume one Blitzkrieg bonus once the follow-up attack resolves (success
      // or failure). Double Blitz: if this bonus attack captured, the block above
      // re-armed the source; a failed bonus clears it so another capture re-arms.
      if (isBlitzkriegBonusAttack) {
        const remaining = (state.blitzkrieg_bonus_attacks_remaining ?? 1) - 1;
        state.blitzkrieg_bonus_attacks_remaining = remaining;
        state.blitzkrieg_attacked = true;
        if (remaining <= 0) {
          state.blitzkrieg_active = false;
          state.blitzkrieg_bonus_source_id = null;
        } else if (!result.territory_captured) {
          state.blitzkrieg_bonus_source_id = null;
        }
      }

      // Advance/break the March to the Sea chain based on whether this eligible
      // hop captured. Only counts when the +1 chain die was actually applied.
      recordMarchToSeaResult(currentPlayer, marchToSeaBonus > 0, toId, result.territory_captured);
      // Keep all players' territory_count authoritative after the exchange.
      syncTerritoryCounts(state);

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
        void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
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
      void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
      });
    });

    // ── Advance Phase ───────────────────────────────────────────────────────
    socket.on('game:advance_phase', async ({ gameId, action_id }: { gameId: string; action_id?: string }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
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
        // Restart the per-phase clock so the timeout deadline is consistent whether
        // the player advances manually or lets the timer fire.
        if (!state.active_event?.choices?.length) startTurnTimer(io, gameId, state, map);
      } else if (state.phase === 'attack') {
        state.phase = 'fortify';
        if (!state.active_event?.choices?.length) startTurnTimer(io, gameId, state, map);
      } else if (state.phase === 'fortify') {
        // Defensive reset: `advanceToNextPlayer` resets fortify_moves_used at
        // turn start, but we also clear it here so any code path that reads
        // the state between this advance and the next turn sees a clean
        // counter (matters for AI debugging and replay reconstruction).
        state.fortify_moves_used = 0;
        advanceToNextPlayer(state, map);
        broadcastEventCard(io, gameId, state, map);

        // Turn-passing can itself end the game (turn-cap stalemate guard,
        // start-of-turn eliminations) — without this check a max_turns game
        // only ends when someone happens to attack or resign.
        const turnPassVictory = checkVictory(state, map);
        if (turnPassVictory) {
          const { winnerIds, condition } = turnPassVictory;
          state.phase = 'game_over';
          state.winner_id = winnerIds[0]!;
          state.winner_ids = winnerIds;
          state.victory_condition = condition;
          await finalizeGame(io, gameId, state, winnerIds);
          broadcastState(io, gameId, state);
          return;
        }

        if (maybeResolveDailyPuzzle(io, gameId, room, null, userId, finalizeGame)) {
          broadcastState(io, gameId, state);
          void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
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
      void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
      });
    });

    // The client emits this once its map (globe / 2D) has rendered and it is the
    // local human's turn. We realign turn_started_at to "now" so the HUD
    // countdown reflects the time the player can actually act, and reschedule
    // the real-time turn timeout to match. Guarded: only once per (turn, seat)
    // and only within a short window after the turn began (see TURN_READY_*).
    socket.on('game:turn_ready', async ({ gameId }: { gameId: string }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
        const { state, map } = room;
        const seconds = state.settings.turn_timer_seconds;
        if (!seconds || seconds <= 0 || state.settings.async_mode) return;
        if (!isSocketUsersTurn(state, userId, username)) return;
        const currentPlayer = state.players[state.current_player_index];
        if (currentPlayer.is_ai) return;
        // A choice-based event pauses the timer; don't restart it here.
        if (state.active_event?.choices?.length) return;

        const key = `${state.turn_number}:${state.current_player_index}`;
        if (turnReadyAcked.get(gameId) === key) return;
        turnReadyAcked.set(gameId, key);
        // Late acks are recorded (to dedupe) but do not reset the clock.
        if (Date.now() - state.turn_started_at > TURN_READY_MAX_WINDOW_MS) return;

        state.turn_started_at = Date.now();
        startTurnTimer(io, gameId, state, map);
        broadcastState(io, gameId, state);
        void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
      });
    });

    // ── Fortify Action ──────────────────────────────────────────────────────
    socket.on('game:fortify', async ({ gameId, fromId, toId, units, action_id }: {
      gameId: string; fromId: string; toId: string; units: number; action_id?: string;
    }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
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
        if (isLaneSealedForPlayer(state, fromId, toId, currentPlayer.player_id)) {
          return socket.emit('error', { message: 'That hyperspace lane is sealed' });
        }
      }

      const fortifyMoveLimit = getFortifyMoveLimit(state, userId);
      const movesUsed = state.fortify_moves_used ?? 0;
      if (movesUsed >= fortifyMoveLimit) {
        return socket.emit('error', {
          message: fortifyMoveLimit === 1
            ? 'You can only fortify once per turn.'
            : `Fortify limit reached (${fortifyMoveLimit} moves per turn)`,
        });
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
      // Confirm the move to the actor so the client shows its "Moved N troops"
      // toast only on success — never alongside a rejection error toast.
      socket.emit('game:fortify_result', { fromId, toId, units });
      broadcastState(io, gameId, state);
      void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
      });
    });

    // ── Redeem Cards ────────────────────────────────────────────────────────
    socket.on('game:redeem_cards', async ({ gameId, cardIds, action_id }: { gameId: string; cardIds: string[]; action_id?: string }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
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
        void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
      } catch (err: unknown) {
        socket.emit('error', { message: err instanceof Error ? err.message : 'Card redemption failed' });
      }
      });
    });

    // ── Build (Economy) ──────────────────────────────────────────────────────
    socket.on('game:build', async ({ gameId, territoryId, buildingType, action_id }: {
      gameId: string; territoryId: string; buildingType: BuildingType; action_id?: string;
    }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
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
        const techTree = getEraTechTreeForPlayer(state, userId);
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
        void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
        return;
      }
      broadcastState(io, gameId, state);
      void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
      });
    });

    // ── Naval Move (relocate fleets between own coastal territories) ─────────
    socket.on('game:naval_move', async ({ gameId, fromId, toId, count, action_id }: {
      gameId: string; fromId: string; toId: string; count: number; action_id?: string;
    }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
      if (!checkAndRecordActionId(gameId, userId, action_id)) return;
      const { state, map } = room;

      if (!state.settings.naval_enabled) return socket.emit('error', { message: 'Naval warfare not enabled' });
      const currentPlayer = state.players[state.current_player_index];
      if (!isSocketUsersTurn(state, userId, username)) return socket.emit('error', { message: 'Not your turn' });
      if (state.phase !== 'attack' && state.phase !== 'fortify') {
        return socket.emit('error', { message: 'Fleets can only move during attack or fortify phase' });
      }
      if (!Number.isInteger(count) || count < 1) {
        return socket.emit('error', { message: 'Fleet count must be a positive whole number' });
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
      void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
      });
    });

    // ── Naval Attack (standalone fleet combat / blockade) ────────────────────
    socket.on('game:naval_attack', async ({ gameId, fromId, toId, action_id }: {
      gameId: string; fromId: string; toId: string; action_id?: string;
    }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
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
      void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
      });
    });

    // ── Tutorial Settings Lab (advanced_settings lesson) ─────────────────────
    socket.on('game:tutorial_apply_settings', async ({
      gameId,
      settings,
    }: {
      gameId: string;
      settings: Record<string, boolean>;
    }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
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
      void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
      });
    });

    // ── Research Tech ────────────────────────────────────────────────────────
    socket.on('game:advance_era', async ({ gameId, action_id }: { gameId: string; action_id?: string }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
      if (!checkAndRecordActionId(gameId, userId, action_id)) return;
      const { state } = room;

      const currentPlayer = state.players[state.current_player_index];
      if (!isSocketUsersTurn(state, userId, username)) {
        return socket.emit('error', { message: 'Not your turn' });
      }
      if (state.phase !== 'draft' && state.phase !== 'attack') {
        return socket.emit('error', { message: 'Era advancement is only available during draft or attack phase' });
      }

      const result = executeAdvanceEra(state, userId);
      if (!result.success) {
        return socket.emit('error', { message: result.error ?? 'Cannot advance era' });
      }

      const nextEraId = getEraIdForAdvancementIndex(state, currentPlayer.current_era_index ?? 0);
      emitMapVisual(io, gameId, buildEraAdvanceMapVisual({
        playerId: userId,
        eraId: nextEraId,
        state,
      }));

      // Reaching a new era changes the shared board: either recompose it onto the
      // next era's map (board-transform flag) or open new neutral frontiers on the
      // current map (growth). The helper emits game:map + the matching cue;
      // broadcastState (below) then syncs garrisons/ownership.
      room.map = await applyEraBoardChange(io, gameId, state, room.map, nextEraId);

      commitActionDecision(
        gameId, state, userId, 'advance_era',
        `Advanced to ${nextEraId}`,
        captureProbBefore(state, userId),
      );
      socket.emit('game:advance_era_result', { success: true, era_id: nextEraId });
      broadcastState(io, gameId, state);
      void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
      });
    });

    socket.on('game:research_tech', async ({ gameId, techId, action_id }: { gameId: string; techId: string; action_id?: string }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
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
        void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
        return;
      }
      broadcastState(io, gameId, state);
      void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
      });
    });

    // ── Use Ability ──────────────────────────────────────────────────────────
    // Generic handler for once-per-turn faction/tech abilities not covered by
    // dedicated events (influence, blitzkrieg, etc.).
    socket.on('game:use_ability', async ({ gameId, abilityId, params, action_id }: {
      gameId: string;
      abilityId: string;
      params?: Record<string, unknown>;
      action_id?: string;
    }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
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
        ? getPlayerFaction(state, currentPlayer)
        : undefined;
      const hasFactionAbility = faction?.ability_id === abilityId;

      const unlockedTechs = currentPlayer.unlocked_techs ?? [];
      const techTree = state.settings.tech_trees_enabled ? getEraTechTreeForPlayer(state, userId) : [];
      const hasTechAbility = techTree.some(
        (n) => unlockedTechs.includes(n.tech_id) && n.unlocks_ability === abilityId
      );
      // A once-per-game ability carried from a prior era (e.g. an undetonated
      // Atom Bomb) is usable even though its unlocking tech is gone.
      const hasLegacyCharge = (currentPlayer.legacy_ability_charges?.[abilityId] ?? 0) > 0;

      if (!hasFactionAbility && !hasTechAbility && !hasLegacyCharge) {
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
        // Double Blitz grants two chained bonus attacks; Blitzkrieg grants one.
        state.blitzkrieg_bonus_attacks_remaining = abilityId === 'double_blitz' ? 2 : 1;
        recordAbility(`Activated ${abilityId}`);
        socket.emit('game:ability_result', { abilityId, success: true, effect: 'blitzkrieg_ready' });
        broadcastState(io, gameId, state);
        void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
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
        void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
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

      // Consume a carried legacy charge on success (executeTechAbility already
      // records the underlying game-scoped ability in used_game_abilities).
      if (currentPlayer.legacy_ability_charges?.[abilityId]) {
        const remaining = { ...currentPlayer.legacy_ability_charges };
        delete remaining[abilityId];
        currentPlayer.legacy_ability_charges = remaining;
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
        void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
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
        void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
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
      void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
      });
    });

    // ── Influence (Cold War / Risorgimento era ability) ──────────────────────
    // Converts a neutral or enemy territory within influence_range hops of any
    // owned territory, costing 3 of the current player's units (spread across
    // adjacent owned territories). Only one use per turn.
    socket.on('game:influence', async ({ gameId, targetId, action_id }: { gameId: string; targetId: string; action_id?: string }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
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

      // Papal Dispensation: the first influence attempt against the Papal States
      // each turn is rejected outright. The charge refreshes every turn.
      if (target.owner_id && state.settings.factions_enabled) {
        const defender = state.players.find((p) => p.player_id === target.owner_id);
        const defFaction = defender
          ? getPlayerFaction(state, defender)
          : undefined;
        if (defFaction?.ability_id === 'papal_dispensation' && defender && !defender.influence_block_used_this_turn) {
          defender.influence_block_used_this_turn = true;
          broadcastState(io, gameId, state);
          return socket.emit('error', { message: 'Papal Dispensation blocked your influence attempt' });
        }
      }

      // BFS to check target is within influence_range hops from any owned territory
      const baseHopLimit = modifiers?.influence_range ?? 1;
      const unlockedTechs = currentPlayer.unlocked_techs ?? [];
      const techTree = state.settings.tech_trees_enabled ? getEraTechTreeForPlayer(state, userId) : [];
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
          // Clamp to >= 0: a transient unit_count of 0 on an owned territory would
          // make (unit_count - 1) negative, and a negative "spend" would otherwise
          // ADD units while inflating the remaining-cost counter.
          const canSpend = Math.max(0, Math.min(remaining, t.unit_count - 1));
          if (canSpend === 0) continue;
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
        void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
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
    });

    // ── Event Card Choice ───────────────────────────────────────────────────
    socket.on('game:event_choice', async ({ gameId, choiceId, action_id }: { gameId: string; choiceId: string; action_id?: string }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
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
      void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
      io.to(gameId).emit('game:event_card_resolved', { cardId: eventCardId });
      io.to(`${gameId}:spectators`).emit('game:event_card_resolved', { cardId: eventCardId });
      broadcastState(io, gameId, state);
      // Restart turn timer now that the blocking event choice is resolved (human players only)
      if (!room.state.players[room.state.current_player_index].is_ai) {
        startTurnTimer(io, gameId, room.state, room.map);
      }
      });
    });

    // ── Set Coaching ─────────────────────────────────────────────────────────
    // Mid-game toggle for in-turn coaching. Only the (single) human player in
    // an eligible game can flip this. Server enforces eligibility; ineligible
    // games silently no-op so a tampered client can't enable coaching in a
    // multi-human or ranked match.
    socket.on('game:set_coaching', async ({ gameId, enabled }: { gameId: string; enabled: boolean }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
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
      void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
      });
    });

    // Chat handlers extracted to handlers/chatHandler.ts

    socket.on('game:lobby_propose', async ({ gameId, setting, value }: { gameId: string; setting: string; value: unknown }) => {
      await runWithGameLock(gameId, async () => {
      const lobby = await loadWaitingLobbyDetails(gameId);
      if (!lobby) return emitGameError(socket, GameErrorCode.GAME_DELETED, 'Game not found');
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

      if (settingKey === 'map_change') {
        const mapValue = parsedValue as LobbyMapChangeValue;
        const blocked = lobbyMapChangeBlockedReason({
          era_id: lobby.game.era_id,
          map_id: lobby.game.map_id,
          is_ranked: lobby.game.is_ranked,
          settings: lobby.settings,
        });
        if (blocked) return socket.emit('error', { message: blocked });

        const proposerAdmin = await queryOne<{ is_admin: boolean }>(
          'SELECT COALESCE(is_admin, false) AS is_admin FROM users WHERE user_id = $1',
          [userId],
        );
        const resolved = await resolveMap(mapValue.map_id);
        if (!resolved) return socket.emit('error', { message: 'Map not found' });

        const pairError = validateLobbyMapChangePair(mapValue, {
          isAdmin: proposerAdmin?.is_admin === true,
          settings: lobby.settings,
          is_ranked: lobby.game.is_ranked,
          player_count: lobby.players.length,
          map_meta: buildMapMetaFromDoc(resolved),
        });
        if (pairError) return socket.emit('error', { message: pairError });

        if (isSameLobbyMap({ era_id: lobby.game.era_id, map_id: lobby.game.map_id }, mapValue)) {
          return socket.emit('error', { message: 'That map is already selected' });
        }
      } else if (String(lobby.settings[settingKey]) === String(parsedValue)) {
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
    });

    socket.on('game:lobby_vote', async ({ gameId, proposalId, approve }: { gameId: string; proposalId: string; approve: boolean }) => {
      await runWithGameLock(gameId, async () => {
      const lobby = await loadWaitingLobbyDetails(gameId);
      if (!lobby) return emitGameError(socket, GameErrorCode.GAME_DELETED, 'Game not found');
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
        if (proposal.setting === 'map_change') {
          await applyApprovedLobbyMapChange(
            io,
            gameId,
            lobby,
            proposal.proposedValue as LobbyMapChangeValue,
          );
        } else {
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
        }

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

      // Decrement presence FIRST — before any other await. A leave emitted by
      // a transient remount is chased by a rejoin within milliseconds; if our
      // decrement lands after that rejoin's increment, the player becomes
      // invisible to every later presence check. Doing it first preserves the
      // leave→join event order in the presence store too.
      await onPlayerDisconnected(gameId, socket.id, userId);

      const gameMeta = await queryOne<{ map_id: string; status: string }>(
        'SELECT map_id, status FROM games WHERE game_id = $1',
        [gameId],
      );
      if (!gameMeta || gameMeta.status !== 'in_progress') {
        return;
      }

      const room = await loadAuthoritativeRoom(gameId, gameMeta.map_id);
      if (!room) {
        return;
      }
      const { state } = room;

      if (state.phase === 'game_over') {
        return;
      }

      await saveGameState(gameId, state);

      const humansConnected = await hasHumanConnections(gameId, state);
      if (!humansConnected) {
        armGameEviction(io, gameId, state.map_id, 'after leave');
      }
    });

    // ── Propose Truce ─────────────────────────────────────────────────────
    socket.on('game:propose_truce', async ({ gameId, targetPlayerId, action_id }: { gameId: string; targetPlayerId: string; action_id?: string }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
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
      void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
      });
    });

    // ── Seal a hyperspace lane (galaxy contestable lanes) ─────────────────────
    socket.on('game:seal_lane', async ({ gameId, fromId, toId, action_id }: { gameId: string; fromId: string; toId: string; action_id?: string }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
        if (!checkAndRecordActionId(gameId, userId, action_id)) return;
        const { state, map } = room;
        if (!isSocketUsersTurn(state, userId, username)) return socket.emit('error', { message: 'Not your turn' });
        if (state.phase !== 'attack' && state.phase !== 'fortify') {
          return socket.emit('error', { message: 'Seal lanes during your attack or fortify phase' });
        }
        const check = canSealLane(state, map, fromId, toId, userId);
        if (!check.ok || !check.laneId) {
          return socket.emit('error', { message: check.error ?? 'Cannot seal that lane' });
        }
        if (!state.lane_blockades) state.lane_blockades = {};
        state.lane_blockades[check.laneId] = { owner_id: userId, turns_remaining: GALAXY_LANE_SEAL_DURATION };
        socket.emit('game:lane_sealed', { laneId: check.laneId, fromId, toId, turns: GALAXY_LANE_SEAL_DURATION });
        await persistGameStateAfterMutation(gameId, state);
        broadcastState(io, gameId, state);
      });
    });

    // ── Respond to Truce Proposal ──────────────────────────────────────────
    socket.on('game:truce_response', async ({ gameId, proposerId, accepted, action_id }: { gameId: string; proposerId: string; accepted: boolean; action_id?: string }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
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
      void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
      });
    });

    // ── Resign ────────────────────────────────────────────────────────────
    socket.on('game:resign', async ({ gameId, action_id }: { gameId: string; action_id?: string }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
      if (!checkAndRecordActionId(gameId, userId, action_id)) return;
      const { state, map } = room;

      const player = state.players.find((p) => p.player_id === userId);
      if (!player || player.is_eliminated) return socket.emit('error', { message: 'Cannot resign' });

      player.is_eliminated = true;
      player.has_resigned = true;

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
            rating_provisional: {},
            is_ranked: false,
            achievements_unlocked: {},
            xp_earned_by_player: {},
          });
          broadcastState(io, gameId, state);
          return;
        }

        // Out of grace window: credit the leading surviving AI with the win
        // and run the normal finalize path so the resigner takes a real loss.
        // The condition is 'resignation', not 'last_standing' — nobody was
        // eliminated, and the defeat screen should say what actually happened.
        const aiWinner = survivingAi[0]!;
        state.phase = 'game_over';
        state.winner_id = aiWinner.player_id;
        state.winner_ids = [aiWinner.player_id];
        state.victory_condition = 'resignation';
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
      forEachConnectedGame((gameId, sockets) => {
        if (!sockets.has(socket.id)) return;
        const departedPlayerId = sockets.get(socket.id)!;
        void onPlayerDisconnected(gameId, socket.id, departedPlayerId);

        void (async () => {
          const gameMeta = await queryOne<{ map_id: string }>(
            'SELECT map_id FROM games WHERE game_id = $1 AND status = $2',
            [gameId, 'in_progress'],
          );
          if (!gameMeta) return;

          const room = await loadAuthoritativeRoom(gameId, gameMeta.map_id);
          if (!room || room.state.phase === 'game_over') return;

          const humansConnected = await hasHumanConnections(gameId, room.state);
          if (!humansConnected) {
            await saveGameState(gameId, room.state);
            armGameEviction(io, gameId, room.state.map_id, 'after disconnect');
          }
          // Mark the departed human's seat as away so the AI covers their turns
          // (after a short reconnect window) instead of the table stalling. Runs
          // regardless of whether other humans remain — markSeatAway re-checks
          // presence under the lock and no-ops if they reconnected on another tab.
          // Skip async (correspondence) games: there, being disconnected between
          // 12–24h turns is normal, and the async deadline already covers absence.
          if (
            departedPlayerId &&
            !room.state.settings.async_mode &&
            room.state.players.some(
              (p) => p.player_id === departedPlayerId && !p.is_ai && !p.is_eliminated,
            ) &&
            !(await isPlayerConnected(gameId, departedPlayerId))
          ) {
            void markSeatAway(io, gameId, departedPlayerId);
          }
        })();
      });
    });
  });

  gameIoSingleton = io;
  return io;
}

/** Clear turn timers, flush debounced saves, and close Socket.IO during graceful shutdown. */
export async function shutdownGameSocket(io: Server): Promise<void> {
  await flushAllPendingPostgresSaves();
  await stopTurnTimerWorker();
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
  // Display-scale a clone: scalable magnitudes grow with progression and
  // `magnitude_scale` is stamped for the UI badge. Always a fresh clone, so
  // attaching `result_summary` below can't mutate the shared deck constant.
  const card = getDisplayScaledCard(state, state.active_event);
  let resolvedResult: import('../types').EventEffectResult | undefined;

  // Attach result_summary when an instant effect was just applied
  if (state.active_event_result) {
    const result = state.active_event_result;
    resolvedResult = result;
    if (result.global) {
      // Summarize the ACTUAL per-territory change (region_disaster removes "up to
      // value" — territories with few units lose less). Only emit a unit summary
      // when units actually moved; stability/tech globals have no per-territory
      // unit delta and shouldn't claim "All territories -1 unit".
      const affected = result.affected_territories ?? [];
      if (affected.length > 0) {
        const sign = affected[0].delta < 0 ? -1 : 1;
        const maxMagnitude = Math.max(...affected.map((a) => Math.abs(a.delta)));
        card.result_summary = [{ territory_id: '__global__', name: 'Every territory', delta: sign * maxMagnitude }];
      }
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

function buildGameStartedPayload(gameId: string, state: GameState): {
  gameId: string;
  startingPlayerIndex: number;
  startingPlayerName?: string;
} {
  const idx = getStartingPlayerIndex(state);
  const player = state.players[idx];
  return {
    gameId,
    startingPlayerIndex: idx,
    startingPlayerName: player?.username,
  };
}

export type StartGameResult =
  | { ok: true }
  | { ok: false; code: 'NOT_FOUND' | 'ALREADY_STARTED' | 'INVALID_STATUS' | 'MAP_NOT_FOUND'; error: string };

/**
 * Transition a waiting game to in_progress: initialize state, cache the room,
 * broadcast game:started/map/state, and kick off the first AI turn or the
 * human turn timer. Caller must hold the game lock (see startWaitingGame).
 * Shared by the game:start socket handler and auto-start game creation.
 */
async function startWaitingGameLocked(io: Server, gameId: string): Promise<StartGameResult> {
  const game = await queryOne<{
    game_id: string; era_id: string; map_id: string; status: string; settings_json: object;
    is_ranked: boolean;
  }>(
    'SELECT game_id, era_id, map_id, status, settings_json, COALESCE(is_ranked, false) AS is_ranked FROM games WHERE game_id = $1',
    [gameId],
  );
  if (!game) return { ok: false, code: 'NOT_FOUND', error: 'Game not found' };
  if (game.status === 'in_progress') return { ok: false, code: 'ALREADY_STARTED', error: 'Game already started' };
  if (game.status !== 'waiting') return { ok: false, code: 'INVALID_STATUS', error: 'Game cannot be started' };

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
    [gameId],
  );

  // Load map (tutorial maps are hardcoded; others from Postgres via getMapById)
  const gameMap = await resolveMap(game.map_id);
  if (!gameMap) return { ok: false, code: 'MAP_NOT_FOUND', error: 'Map not found' };

  const playerStates = players.map((p) => ({
    player_id: p.user_id ?? `ai_${p.player_index}`,
    player_index: p.player_index,
    username: p.username ?? aiPlayerName(p.player_index),
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

  const socketsInRoom = await io.in(gameId).fetchSockets();
  getOrBuildAdjacency(gameMap);
  setCachedRoom(gameId, state, gameMap);
  for (const s of socketsInRoom) {
    const remoteUserId = s.data?.userId as string | undefined;
    if (remoteUserId) {
      await onPlayerConnected(gameId, s.id, remoteUserId);
    }
  }

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
  await saveGameMapAuthoritative(gameId, gameMap);
  await flushGameState(gameId, state);
  lobbyProposalsByGame.delete(gameId);

  io.to(gameId).emit('game:started', buildGameStartedPayload(gameId, state));
  recordServerEvent('game_started', {
    game_id: gameId,
    map_id: state.map_id,
    human_count: humanCount,
    ai_count: aiPlayerCount,
    game_type: gameType,
    is_ranked: !!game.is_ranked,
    is_tutorial: !!state.settings.tutorial,
  });
  // Send the resolved map to every player in the room so client code
  // never has to re-fetch via REST during play (private/pending custom
  // maps would otherwise be invisible to non-creator participants).
  io.to(gameId).emit('game:map', {
    mapId: state.map_id,
    map: projectMapToEraFloor(gameMap, state.map_era_floor ?? 0),
  });
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

  return { ok: true };
}

/**
 * Lock-acquiring wrapper for callers outside the socket layer (e.g. the
 * auto-start path in POST /api/games). The game:start handler calls the
 * locked variant directly because it already holds the game lock.
 */
export async function startWaitingGame(io: Server, gameId: string): Promise<StartGameResult> {
  return runWithGameLock(gameId, () => startWaitingGameLocked(io, gameId));
}

/**
 * Apply (and emit) the board change an era advance can cause. With the
 * board-transform flag on, recompose the board onto the next era's map when the
 * global era floor rises (returns the new map for the room to install). Otherwise
 * fall back to the growth model (unlock frontiers on the current map). Returns the
 * map the room should now use.
 */
async function applyEraBoardChange(
  io: Server,
  gameId: string,
  state: GameState,
  currentMap: GameMap,
  nextEraId: string,
): Promise<GameMap> {
  if (state.settings.era_advancement_board_transform) {
    const seed = `${gameId}:${state.board_era_index ?? 0}`
      .split('')
      .reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
    const outcome = await transformBoardOnAdvance(state, currentMap, resolveMap, createSeededRng(seed));
    if (outcome) {
      setCachedRoom(gameId, state, outcome.map);
      io.to(gameId).emit('game:map', { mapId: state.map_id, map: outcome.map });
      const last = outcome.summaries[outcome.summaries.length - 1];
      io.to(gameId).emit('game:board_transformed', {
        era_id: state.era,
        board_era_index: state.board_era_index ?? 0,
        seeds: last.seeds,
        neutral: last.neutral,
        total: last.total,
      });
      return outcome.map;
    }
  }
  const unlockedTerritoryIds = unlockTerritoriesForFloor(state, currentMap);
  if (unlockedTerritoryIds.length > 0) {
    io.to(gameId).emit('game:map', {
      mapId: state.map_id,
      map: projectMapToEraFloor(currentMap, state.map_era_floor ?? 0),
    });
    io.to(gameId).emit('game:territories_unlocked', {
      era_id: nextEraId,
      territory_ids: unlockedTerritoryIds,
    });
  }
  return currentMap;
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
  recordSpectatorState(gameId, state);

  const fog = state.settings.fog_of_war;
  const humanPlayers = state.players.filter((p) => !p.is_ai);

  // Per-player delivery via user rooms crosses Socket.io instances (Redis adapter).
  if (humanPlayers.length > 0) {
    for (const player of humanPlayers) {
      const filteredState = buildClientState(state, player.player_id, fog);
      io.to(`user:${player.player_id}`).emit('game:state', filteredState);
    }
    return;
  }

  io.to(gameId).emit('game:state', buildClientState(state, null, fog));
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

  if (tip.category === 'resign_suggestion') {
    // One-shot per game. Persist immediately — call sites run this after
    // their own save, so without an explicit write an eviction or restart
    // would forget the flag and the prompt would nag again.
    state.resign_suggestion_shown = true;
    void persistGameStateAfterMutation(gameId, state).catch((err) =>
      console.error('[Coaching] Failed to persist resign-suggestion flag:', gameId, err),
    );
  }

  io.to(`user:${human.player_id}`).emit('game:coaching_tip', tip);
}

function recordSpectatorState(gameId: string, state: GameState): void {
  // Pass the game's real fog setting so spectators of a fog game get masked
  // territory intel (board control only), not the full board.
  const snapshot = buildClientState(state, null, state.settings.fog_of_war);
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
  // Viewer-scoped era advancement status (transport-only). Computed from the
  // unfiltered state — it describes the viewer's own empire, which fog never
  // hides from them.
  const attachEraPreview = (s: GameState): GameState => {
    if (!playerId || !state.settings.era_advancement_enabled) return s;
    const preview = buildAdvanceEraClientPreview(state, playerId);
    return preview ? { ...s, era_advancement_preview: preview } : s;
  };

  const stripSecretMissions = (s: GameState): GameState => ({
    ...s,
    // mission_seed_salt is server-only; leaking it would let a client
    // replay the PRNG and read every opponent's mission.
    mission_seed_salt: undefined,
    // Reveal each player's secret_mission only to its owner / eliminated players /
    // at game_over, and — when there is no viewing player (spectator/public
    // snapshot) — empty every card hand so spectators can't read players' cards.
    players: redactPlayersForViewer(s.players, playerId, state.phase),
  });

  // No fog → everyone (players and spectators) sees full territory intel.
  // (Spectator card hands are still emptied by redactPlayersForViewer.)
  if (!fogOfWar) return attachEraPreview(stripSecretMissions(state));

  // Fog is on. Compute which territories' exact intel the viewer may see.
  const visibleIds = new Set<string>();
  if (playerId !== null) {
    // Player view: owned territories are always visible…
    for (const [tid, tState] of Object.entries(state.territories)) {
      if (tState.owner_id === playerId) visibleIds.add(tid);
    }
    // …plus adjacent (border scouting) and recon-revealed territories.
    const adj = adjacencyByMapId.get(state.map_id);
    if (adj) {
      for (const tid of Array.from(visibleIds)) {
        for (const neighbour of adj.get(tid) ?? []) {
          visibleIds.add(neighbour);
        }
      }
      expandFogVisibilityFromRecon(state, playerId, visibleIds, adj);
    }
  }
  // Spectator view (playerId === null) in a fog game: visibleIds stays EMPTY, so
  // maskHiddenTerritories masks every territory's exact intel below. Spectators
  // see board control (ownership / borders) but not troop/building/fleet counts,
  // so a player cannot spectate their own live game on a second connection to
  // read the opponent's board.

  const filtered: GameState = {
    ...state,
    territories: maskHiddenTerritories(state.territories, visibleIds),
  };

  // Hide other players' cards for a player view. (Spectator hands are already
  // emptied by redactPlayersForViewer inside stripSecretMissions.)
  if (playerId !== null) {
    filtered.players = state.players.map((p) =>
      p.player_id === playerId ? p : { ...p, cards: [] },
    );
  }

  return attachEraPreview(stripSecretMissions(filtered));
}

async function saveGameState(gameId: string, state: GameState): Promise<void> {
  return flushGameState(gameId, state);
}

function scheduleDebouncedSave(gameId: string): void {
  const room = getCachedRoom(gameId);
  if (!room) return;
  void persistGameStateAfterMutation(gameId, room.state).catch((err) => {
    console.error('[Redis] persist after mutation failed', gameId, err);
  });
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

  let prestigeDelta = 1;
  let updatedCarry = { ...campaignRow.path_carry };

  if (campaignRow.path_id) {
    const { getPathEraConfig } = await import('../modules/campaign/campaignPaths');
    const pathEra = getPathEraConfig(campaignRow.path_id as any, eraIndex);
    if (pathEra) {
      const delta = won ? pathEra.carry_on_win : pathEra.carry_on_loss;
      if (delta.prestige_bonus != null) {
        prestigeDelta = delta.prestige_bonus;
        updatedCarry.prestige_bonus = (updatedCarry.prestige_bonus ?? 0) + delta.prestige_bonus;
      } else if (!won) {
        prestigeDelta = 0;
      }
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
    resultCtx = await recordGameResults(gameId, state, winnerIds);
  } catch (err) {
    console.error('[Socket] Failed to record game results:', err);
    resultCtx = { ratingDeltas: new Map(), ratingProvisional: new Map(), guestPlayerIds: new Set(), isRanked: false, xpEarnedByPlayer: {} };
  }

  const unlockedByPlayer: Record<string, string[]> = {};
  const humanPlayers = state.players.filter((p) => !p.is_ai);
  const ranks = computeRanks(state.players, winnerIds);

  // Per-human activation/retention signal: who finished a game, and the outcome.
  // (For human players, player_id is the user's UUID — see ranked insert below.)
  const finishedDurationMs = state.game_started_at ? Date.now() - state.game_started_at : null;
  for (const human of humanPlayers) {
    recordServerEvent(
      'game_finished',
      {
        game_id: gameId,
        won: winnerIds.includes(human.player_id),
        victory_type: state.victory_condition ?? null,
        duration_ms: finishedDurationMs,
        turn_count: state.turn_number,
        is_tutorial: !!state.settings.tutorial,
        // Lets the funnel segment guest activation (the cohort the signup nudge
        // targets) and measure guest finish → upgrade conversion.
        is_guest: resultCtx.guestPlayerIds.has(human.player_id),
      },
      human.player_id,
    );
  }

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
    // Guests are redacted from both rating maps: competitive numbers are a
    // registered-account feature (their ratings still accrue silently in the
    // DB and carry over on upgrade). The provisional flag lets the defeat
    // screen frame large early-game swings as "calibrating".
    ...redactGuestRatings(resultCtx),
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
  turnReadyAcked.delete(gameId);

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
    clearGameSeatTimers(gameId);
    cancelEvictionTimer(gameId);
    void evictGameRoom(gameId);
    clearActionIdempotency(gameId);
  }, 30000);
}

async function processAiTerritorySelect(io: Server, gameId: string): Promise<void> {
  try {
  await withLockedRoom(gameId, async (room) => {
  const { state, map } = room;

  if (state.phase !== 'territory_select') return;

  const currentPlayer = state.players[state.current_player_index];
  if (!currentPlayer.is_ai && !currentPlayer.is_away) return;

  const difficulty = currentPlayer.ai_difficulty ?? 'medium';
  // Orbit/Moon parity: exclude territories the AI couldn't legally claim (same gate
  // humans hit via territoryRequiresOrbitAccessForClaim). Access doesn't depend on
  // the specific territory, so resolve it once.
  const aiHasOrbitAccess = getOrbitAccessResult(state, currentPlayer, map, state.era).allowed;
  const unclaimed = Object.entries(state.territories)
    .filter(([id, t]) =>
      isUnclaimedOwner(t.owner_id)
      && (aiHasOrbitAccess || !territoryRequiresOrbitAccessForClaim(map, id)))
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
    const starterIdx = getStartingPlayerIndex(state);
    state.current_player_index = starterIdx;
    state.turn_number = 1;
    state.turn_started_at = Date.now();
    const firstPlayer = state.players[starterIdx];
    const bonus = calculateContinentBonuses(state, map, firstPlayer.player_id);
    const passiveReinforceBonus = getPlayerReinforceBonus(state, firstPlayer.player_id);
    state.draft_units_remaining = calculateReinforcements(
      firstPlayer.territory_count,
      bonus,
      state.players.length,
    ) + passiveReinforceBonus;
  }

  broadcastState(io, gameId, state);
  void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));

  // Chain: next AI pick or transition to human/draft
  const nextPlayer = state.players[state.current_player_index];
  if (nextPlayer.is_ai && state.phase === 'territory_select') {
    setTimeout(() => processAiTerritorySelect(io, gameId), 800);
  } else if (nextPlayer.is_ai && state.phase === 'draft') {
    setTimeout(() => processAiTurn(io, gameId), 1500);
  } else if (!nextPlayer.is_ai && state.phase === 'draft') {
    startTurnTimer(io, gameId, state, map);
  }
  }, { durationMs: 10000 });
  } catch (err) {
    // Fire-and-forget caller (setTimeout) — see processAiTurn for why a
    // rethrow here would crash the process.
    if (err instanceof GameRoomNotFoundError) {
      console.warn('[AI] Room unavailable for AI territory select on', gameId);
    } else {
      console.error('[AI] AI territory select failed for', gameId, err);
    }
  }
}

/**
 * AI parity for attack-phase faction self-buffs (war_elephants / banzai_charge /
 * ambush = +1 attack die; testudo = negate attacker losses). Activates the buff
 * once per turn by reusing executeTechAbility, so the buff is then consumed by the
 * AI attack loop exactly as a human's would be. These buffs only ever help, so
 * eager activation before the first attack is a safe parity baseline.
 */
function maybeActivateAiAttackSelfBuff(state: GameState, map: GameMap, player: PlayerState): void {
  if (!state.settings.factions_enabled || !player.faction_id) return;
  const faction = getPlayerFaction(state, player);
  const abilityId = faction?.ability_id;
  if (!abilityId) return;
  const def = TERRITORY_ABILITY_DEFS[abilityId];
  if (!def || def.phase !== 'attack') return;
  if (def.selfBuff !== 'extra_attack_die' && def.selfBuff !== 'negate_attacker_losses') return;
  if ((player.ability_uses ?? {})[abilityId]) return;
  const res = executeTechAbility({ state, map, playerId: player.player_id, abilityId });
  if (res.success) {
    player.ability_uses = { ...(player.ability_uses ?? {}), [abilityId]: 1 };
  }
}

async function processAiTurn(io: Server, gameId: string): Promise<void> {
  if (await isAiTurnInFlight(gameId)) return;
  if (!(await tryAcquireAiTurn(gameId))) return;
  try {
  await withLockedRoom(gameId, async (room) => {
  const { state, map } = room;

  const currentPlayer = state.players[state.current_player_index];
  // Run for AI seats and for *away* human seats (the AI covers their turn).
  if (!currentPlayer.is_ai && !currentPlayer.is_away) return;

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

  const delay = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 600));
    // Defense-in-depth for seat return: if the human came back mid-turn (only
    // reachable if the lock TTL lapsed), abort cleanly rather than keep acting as
    // — and then overwriting — a now-present human seat. An away seat that is
    // still away (or an original AI) keeps playing.
    if (!currentPlayer.is_ai && !currentPlayer.is_away) throw new SeatReclaimedDuringAiTurn();
  };

  const doVictoryCheck = async (): Promise<boolean> => {
    if (maybeResolveDailyPuzzle(io, gameId, room, null, currentPlayer.player_id, finalizeGame)) {
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
      await finalizeGame(io, gameId, state, winnerIds);
      return true;
    }
    return false;
  };

  // ── Draft Phase ────────────────────────────────────────────────────────
  state.phase = 'draft';

  // Economy FIRST: build + research before evaluating advancement, so a bot that
  // satisfies the milestone gate this turn can advance the SAME turn (previously
  // the advance check ran before that turn's research, costing a turn each climb).
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

  if (
    state.settings.era_advancement_enabled
    && difficulty !== 'tutorial'
    && evaluateAiEraAdvancement(state, map, currentPlayer.player_id, difficulty).shouldAdvance
  ) {
    const advanceResult = executeAdvanceEra(state, currentPlayer.player_id);
    if (advanceResult.success) {
      const nextEraId = getEraIdForAdvancementIndex(state, currentPlayer.current_era_index ?? 0);
      emitMapVisual(io, gameId, buildEraAdvanceMapVisual({
        playerId: currentPlayer.player_id,
        eraId: nextEraId,
        state,
      }));
      // Territory growth: an AI reaching a new era can open the same neutral
      // frontiers for everyone (global, first-to-reach). Re-emit the projected
      // map before broadcastState so clients render the additions (or the whole
      // board recomposition under the board-transform flag).
      room.map = await applyEraBoardChange(io, gameId, state, map, nextEraId);
      broadcastState(io, gameId, state);
      void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
      await delay();
    }
  }

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
        void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
      } catch {
        break;
      }
    }
  }

  // AI parity for draft-phase faction abilities (Mass Mobilization, Group A free
  // units, Group B tech-gated placement, Group C reinforcement/economy boosts).
  // Activated BEFORE placement so draft-pool boosters (spice_trade, total_war,
  // imperial_diet) get placed this turn. Reuses executeTechAbility for exact
  // human/bot parity; these effects only ever help, so eager use is safe.
  if (state.settings.factions_enabled && currentPlayer.faction_id) {
    const aiFaction = getPlayerFaction(state, currentPlayer);
    const factionAbilityId = aiFaction?.ability_id;
    const factionDef = factionAbilityId ? TERRITORY_ABILITY_DEFS[factionAbilityId] : undefined;
    const draftAbilityIds = new Set([
      'mass_mobilization', 'total_war', 'peoples_war', 'imperial_diet', 'silk_road', 'house_of_wisdom',
    ]);
    const isDraftAbility = !!factionAbilityId && !!factionDef && factionDef.phase === 'draft'
      && (draftAbilityIds.has(factionAbilityId) || !!factionDef.ownPlacement || !!factionDef.draftReinforcements);
    const gameScoped = !!factionAbilityId && isGameScopedAbility(factionAbilityId);
    const alreadyUsed = !!factionAbilityId && (gameScoped
      ? (currentPlayer.used_game_abilities ?? []).includes(factionAbilityId)
      : !!(currentPlayer.ability_uses ?? {})[factionAbilityId]);
    const techCost = factionDef?.techCost ?? 0;
    const affordable = techCost === 0 || (currentPlayer.tech_points ?? 0) >= techCost;
    if (factionAbilityId && isDraftAbility && !alreadyUsed && affordable) {
      const needsTarget = !!factionDef?.ownPlacement;
      const requiresMoon = factionDef?.ownPlacement?.requiresMoon ?? false;
      const requiresProduction = factionDef?.ownPlacement?.requiresProductionBuilding ?? false;
      const target = needsTarget
        ? Object.values(state.territories)
            .filter((t) => t.owner_id === currentPlayer.player_id
              && (!requiresMoon || t.world_id === 'moon' || t.globe_id === 'moon')
              && (!requiresProduction || (t.buildings ?? []).some((b) =>
                b === 'production_1' || b === 'production_2' || b === 'production_3')))
            .sort((a, b) => b.unit_count - a.unit_count)[0]
        : undefined;
      if (!needsTarget || target) {
        const res = executeTechAbility({
          state,
          map,
          playerId: currentPlayer.player_id,
          abilityId: factionAbilityId,
          territoryId: target?.territory_id,
        });
        if (res.success) {
          if (!gameScoped) {
            currentPlayer.ability_uses = { ...(currentPlayer.ability_uses ?? {}), [factionAbilityId]: 1 };
          }
          broadcastState(io, gameId, state);
        }
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

  // (AI build + research run at the top of the draft phase, before the advance check.)

  // ── Attack Phase ───────────────────────────────────────────────────────
  state.draft_units_remaining = 0;
  state.phase = 'attack';

  // ACW AI: activate March to the Sea once per game on entering the attack phase
  // so the bot benefits from the same chain bonus dice a human would. The bonus
  // only ever helps, so eager activation is a safe parity baseline.
  if (
    state.settings.tech_trees_enabled &&
    playerHasUnlockedAbility(state, currentPlayer.player_id, 'march_to_sea') &&
    !(currentPlayer.used_game_abilities ?? []).includes('march_to_sea')
  ) {
    currentPlayer.march_to_sea_active = true;
    currentPlayer.march_to_sea_hops_used = 0;
    currentPlayer.march_to_sea_last_capture_id = null;
    currentPlayer.used_game_abilities = [...(currentPlayer.used_game_abilities ?? []), 'march_to_sea'];
  }

  // AI parity for faction unit-reduction strikes (precision_airstrike, longbowmen,
  // chevauchée, privateer, cyber_attack). Used once per turn on the AI's first
  // planned enemy attack target to soften it before assaulting — reuses
  // executeTechAbility so reduction / range / coastal rules match the human path.
  if (state.settings.factions_enabled && currentPlayer.faction_id) {
    const aiFaction = getPlayerFaction(state, currentPlayer);
    const strikeId = aiFaction?.ability_id;
    const strikeDef = strikeId ? TERRITORY_ABILITY_DEFS[strikeId] : undefined;
    if (
      strikeId && strikeDef && strikeDef.phase === 'attack' && strikeDef.unitReduction != null
      && !(currentPlayer.ability_uses ?? {})[strikeId]
    ) {
      const firstAttack = actions.find(
        (a) => a.type === 'attack' && a.from && a.from !== '__influence__' && a.to
          && state.territories[a.to]?.owner_id != null
          && state.territories[a.to]?.owner_id !== currentPlayer.player_id,
      );
      if (firstAttack?.to) {
        const res = executeTechAbility({
          state,
          map,
          playerId: currentPlayer.player_id,
          abilityId: strikeId,
          territoryId: firstAttack.to,
        });
        if (res.success) {
          currentPlayer.ability_uses = { ...(currentPlayer.ability_uses ?? {}), [strikeId]: 1 };
        }
      }
    }
  }

  // AI parity: Unification Drive converts a reachable neutral territory for free.
  // executeTechAbility enforces the influence-range reachability check, so the AI
  // scans neutral territories and takes the first one it can legally unify.
  if (state.settings.factions_enabled && currentPlayer.faction_id) {
    const aiFaction = getPlayerFaction(state, currentPlayer);
    if (aiFaction?.ability_id === 'unification_drive' && !(currentPlayer.ability_uses ?? {})['unification_drive']) {
      for (const tid of Object.keys(state.territories)) {
        if (state.territories[tid].owner_id != null) continue;
        const res = executeTechAbility({
          state,
          map,
          playerId: currentPlayer.player_id,
          abilityId: 'unification_drive',
          territoryId: tid,
        });
        if (res.success) {
          currentPlayer.ability_uses = { ...(currentPlayer.ability_uses ?? {}), unification_drive: 1 };
          break;
        }
      }
    }
  }

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
      // Papal Dispensation parity: the Papal States blocks the first influence
      // attempt against it each turn (consumes the per-turn charge).
      if (target.owner_id && state.settings.factions_enabled) {
        const defender = state.players.find((p) => p.player_id === target.owner_id);
        const defFaction = defender
          ? getPlayerFaction(state, defender)
          : undefined;
        if (defFaction?.ability_id === 'papal_dispensation' && defender && !defender.influence_block_used_this_turn) {
          defender.influence_block_used_this_turn = true;
          broadcastState(io, gameId, state);
          continue;
        }
      }
      if (target.unit_count > 3) continue;
      const aiTechTree = state.settings.tech_trees_enabled
        ? getEraTechTreeForPlayer(state, currentPlayer.player_id)
        : [];
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

      // Use the same cost the human path pays so proxy_funding's discount (3 → 2)
      // applies to the AI too, instead of a hardcoded 3.
      const influenceCost = getInfluenceUnitCost(state, currentPlayer.player_id);
      const totalUnits = Object.values(state.territories)
        .filter((t) => t.owner_id === currentPlayer.player_id)
        .reduce((sum, t) => sum + t.unit_count, 0);
      if (totalUnits < influenceCost + 1) continue;

      const adjacentOwned = (adjacency[action.to] ?? [])
        .filter((nid) => state.territories[nid]?.owner_id === currentPlayer.player_id)
        .sort((a, b) => (state.territories[b]?.unit_count ?? 0) - (state.territories[a]?.unit_count ?? 0));
      if (adjacentOwned.length === 0) continue;

      let remaining = influenceCost;
      for (const tid of adjacentOwned) {
        const t = state.territories[tid];
        if (!t) continue;
        const canSpend = Math.max(0, Math.min(remaining, t.unit_count - 1));
        if (canSpend === 0) continue;
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

    // Orbit/Moon access parity: the AI must satisfy the same access requirement a
    // human does to attack across a moon/orbit connection. Without this, a stale or
    // mis-planned action could let the bot invade worlds humans cannot reach.
    if (connectionRequiresMoonAccess(map, action.from, action.to)) {
      if (!getOrbitAccessResult(state, currentPlayer, map, state.era).allowed) continue;
    }

    // Naval sea-lane gating: AI must have a fleet to cross. Amphibious-assault
    // parity with the human handler — the AI lands as long as a ship survives
    // the crossing, taking the same surviving-fleet bombardment penalty.
    let aiNavalBombardmentDefenseBonus = 0;
    if (state.settings.naval_enabled && aiConnection?.type === 'sea') {
      if (!from.naval_units || from.naval_units <= 0) continue;
      const aiCrossing = resolveSeaCrossing(from, to);
      if (aiCrossing.navalResult) {
        io.to(gameId).emit('game:naval_combat_result', { fromId: action.from, toId: action.to, result: aiCrossing.navalResult });
        emitMapVisual(io, gameId, buildNavalMapVisual({
          fromId: action.from,
          toId: action.to,
          attackerId: currentPlayer.player_id,
          attackerLosses: aiCrossing.navalResult.attacker_losses,
          defenderLosses: aiCrossing.navalResult.defender_losses,
          attackerWon: aiCrossing.navalResult.attacker_won,
          state,
        }));
      }
      if (!aiCrossing.canLand) continue;
      aiNavalBombardmentDefenseBonus = aiCrossing.bombardmentDefenseBonus;
    }

    const aiDefenderId = to.owner_id;

    // Truce-break retaliation parity: if a player broke a truce with this AI, the
    // AI's next attack against them gets the stored +1 die — same as the human path.
    let aiTruceRetaliationBonus = 0;
    if (aiDefenderId && currentPlayer.truce_break_retaliations) {
      const retalIdx = currentPlayer.truce_break_retaliations.findIndex(
        (r) => r.against_player_id === aiDefenderId,
      );
      if (retalIdx !== -1) {
        aiTruceRetaliationBonus = currentPlayer.truce_break_retaliations[retalIdx].dice_bonus;
        currentPlayer.truce_break_retaliations.splice(retalIdx, 1);
      }
    }

    // Attack self-buff parity: activate the faction attack buff once per turn
    // (executeLandAttack then consumes it, exactly as the human handler does).
    maybeActivateAiAttackSelfBuff(state, map, currentPlayer);
    const aiMarchToSeaBonus = getMarchToSeaBonus(currentPlayer, action.from);
    const aiPuzzleDieRoll = state.puzzle_dice_queue?.length ? createPuzzleDieRoll(state) : undefined;

    // Single source of truth for the land exchange — shared with the human
    // handler and the balance sim. Socket-only concerns (callouts, stat
    // recording, elimination broadcast, visuals) stay here, around the call.
    const aiOutcome = executeLandAttack(state, currentPlayer.player_id, action.from, action.to, {
      connection: aiConnection,
      dieRoll: aiPuzzleDieRoll,
      extraAttackBonuses: {
        march_to_sea: aiMarchToSeaBonus,
        truce_retaliation: aiTruceRetaliationBonus,
      },
      extraDefenseBonuses: {
        naval_bombardment: aiNavalBombardmentDefenseBonus,
      },
      onCapture: (s, pid) => {
        // One card per turn — gated by state flag (see advanceToNextPlayer reset).
        if (!currentPlayer.card_earned_this_turn) {
          drawCard(s, pid);
          currentPlayer.card_earned_this_turn = true;
        }
      },
    });
    if (!aiOutcome) continue;
    const result = aiOutcome.result;

    attachCombatAbilityCallouts(
      result,
      buildCombatAbilityCallouts({
        state,
        attackerId: currentPlayer.player_id,
        toId: action.to,
        attackBuffs: aiOutcome.attackBuffs,
        abilityUses: currentPlayer.ability_uses,
        rawAttackerLosses: aiOutcome.rawAttackerLosses,
      }),
    );

    // If resolveCombat returned an error, skip this attack (state was not mutated).
    if (result.error) {
      console.warn?.('AI attempted invalid combat:', result.error, { from: from.unit_count, to: to.unit_count });
      continue;
    }
    recordCombatResult(gameId, currentPlayer.player_id, aiDefenderId ?? null, result, {
      isSea: aiConnection?.type === 'sea',
    });
    recordMarchToSeaResult(currentPlayer, aiMarchToSeaBonus > 0, action.to, result.territory_captured);
    // Elimination broadcast (cards already transferred + is_eliminated set inside executeLandAttack).
    if (aiOutcome.defenderEliminated) {
      const defenderPlayer = state.players.find((p) => p.player_id === aiDefenderId);
      if (defenderPlayer) {
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
  state.fortify_moves_used = 0;

  // AI parity: Armored Push grants +1 fortify move. Activate it only when the AI
  // has more fortify moves planned than its base limit allows, so the extra move
  // is actually used. Reuses executeTechAbility for human/bot parity.
  if (state.settings.factions_enabled && currentPlayer.faction_id) {
    const aiFaction = getPlayerFaction(state, currentPlayer);
    if (aiFaction?.ability_id === 'armored_push' && !(currentPlayer.ability_uses ?? {})['armored_push']) {
      const plannedFortifies = actions.filter(
        (a) => a.type === 'fortify' && a.from && a.to && a.units,
      ).length;
      if (plannedFortifies > getFortifyMoveLimit(state, currentPlayer.player_id)) {
        const res = executeTechAbility({ state, map, playerId: currentPlayer.player_id, abilityId: 'armored_push' });
        if (res.success) {
          currentPlayer.ability_uses = { ...(currentPlayer.ability_uses ?? {}), armored_push: 1 };
        }
      }
    }
  }

  broadcastState(io, gameId, state);

  const aiFortifyMoveLimit = getFortifyMoveLimit(state, currentPlayer.player_id);
  for (const action of actions) {
    if (action.type !== 'fortify' || !action.from || !action.to || !action.units) continue;
    // Honor the same per-turn fortify move cap humans get (game:fortify), so an AI
    // planner that emits multiple moves can't exceed the era/tech limit.
    if ((state.fortify_moves_used ?? 0) >= aiFortifyMoveLimit) break;
    await delay();
    const from = state.territories[action.from];
    const to = state.territories[action.to];
    // Orbit/Moon parity: don't let the AI fortify across an orbit endpoint it lacks
    // access for (humans are blocked by fortifyEndpointsRequireOrbitAccess).
    if (fortifyEndpointsRequireOrbitAccess(map, state.era, action.from, action.to)
      && !getOrbitAccessResult(state, currentPlayer, map, state.era).allowed) {
      continue;
    }
    if (from && to && from.owner_id === currentPlayer.player_id && to.owner_id === currentPlayer.player_id && from.unit_count > action.units) {
      from.unit_count -= action.units;
      to.unit_count += action.units;
      state.fortify_moves_used = (state.fortify_moves_used ?? 0) + 1;
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
    // 30s (was 15s): an aggressive expert turn on a large map can chain enough
    // 600ms action delays to exceed 15s, which would let the lock lapse mid-turn
    // and a concurrent seat reclaim interleave. The wider TTL keeps the whole
    // turn atomic; the delay() checkpoint above is the backstop if it still lapses.
  }, { durationMs: 30000 });
  } catch (err) {
    // Every call site is a fire-and-forget setTimeout, so a rethrow here
    // becomes an unhandled rejection that takes down the whole process —
    // one bad AI turn must never end every other game on the server.
    // Recovery: the in-flight lock is released below, and any player
    // reconnect re-triggers the AI turn via the game:join resume path.
    if (err instanceof SeatReclaimedDuringAiTurn) {
      console.warn('[AI] Seat reclaimed mid-turn; aborted AI turn for', gameId);
    } else if (err instanceof GameRoomNotFoundError) {
      console.warn('[AI] Room unavailable for AI turn on', gameId);
    } else {
      console.error('[AI] AI turn failed for', gameId, err);
    }
  } finally {
    await releaseAiTurn(gameId);
  }
}

function startTurnTimer(io: Server, gameId: string, state: GameState, map: GameMap): void {
  clearTurnTimer(gameId, state);
  // Re-decide the away-AI timer for this turn (cleared here; re-armed below if the
  // current seat is away). Keeps a returning player from leaving a stale timer.
  const pendingAway = awayAiTimers.get(gameId);
  if (pendingAway) {
    clearTimeout(pendingAway);
    awayAiTimers.delete(gameId);
  }
  const currentPlayer = state.players[state.current_player_index];
  // Away human seat: the AI covers the turn after the reconnect window — in BOTH
  // timed and untimed games, so the table never stalls on an absent player. This
  // is checked before the no-timer early-return below for exactly that reason.
  // (Async games never mark seats away; the async deadline handles absence.)
  if (currentPlayer.is_away && !currentPlayer.is_ai && !state.settings.async_mode) {
    scheduleAwayAiTurn(io, gameId, currentPlayer.away_since);
    return;
  }
  const seconds = state.settings.turn_timer_seconds;
  if (!seconds || seconds <= 0) return;
  if (currentPlayer.is_ai) return;

  // ── Async mode: use persistent BullMQ job instead of in-memory timer ──
  if (state.settings.async_mode) {
    const deadlineSec = state.settings.async_turn_deadline_seconds ?? seconds;
    state.phase_deadline_at = Date.now() + deadlineSec * 1000;
    emitPhaseDeadline(io, gameId, state);
    persistArmedDeadline(gameId, state);
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

  // ── Real-time mode: BullMQ-backed turn timer (Phase 7) ──
  state.phase_deadline_at = Date.now() + seconds * 1000;
  emitPhaseDeadline(io, gameId, state);
  persistArmedDeadline(gameId, state);
  scheduleTurnTimeout(gameId, seconds * 1000).catch((err) => {
    console.error('[TurnTimer] Failed to schedule turn timeout:', gameId, err);
  });
}

/**
 * Persist the freshly-armed deadline regardless of where the caller sits in
 * its save/broadcast sequence. Several flows save state BEFORE arming the
 * timer; without this, Redis-first reloads (reconnects, next locked mutation)
 * would resurrect the previous, already-expired deadline and clients would
 * show a frozen 0:00 clock. One extra Redis write per armed turn is cheap
 * insurance against that whole ordering class.
 */
function persistArmedDeadline(gameId: string, state: GameState): void {
  void persistGameStateAfterMutation(gameId, state).catch((err) =>
    console.error('[TurnTimer] Failed to persist armed deadline:', gameId, err),
  );
}

/**
 * Push the freshly-armed timer deadline to connected clients. State broadcasts
 * carry `phase_deadline_at` too, but several flows broadcast before the timer
 * is re-armed — this keeps countdowns accurate without reordering every caller.
 */
function emitPhaseDeadline(io: Server, gameId: string, state: GameState): void {
  io.to(gameId).emit('game:phase_deadline', {
    deadline_at: state.phase_deadline_at,
    phase: state.phase,
    turn_number: state.turn_number,
  });
}

function clearTurnTimer(gameId: string, state?: GameState): void {
  cancelTurnTimeout(gameId).catch(() => {});
  if (state) {
    // No timer running means no deadline — otherwise AI turns and event
    // pauses keep broadcasting the previous human's expired clock and the
    // HUD counts down a dead timer to a frozen 0:00.
    state.phase_deadline_at = null;
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
