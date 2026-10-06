import type { Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import { Server, Socket } from 'socket.io';
import { verifyAccessToken } from '../utils/jwt';
import { query, queryOne } from '../db/postgres';
import { emitGameError, GameErrorCode } from './socketErrors';
import { featureFlags } from '../config/featureFlags';
import {
  trackSpectator,
  untrackSpectator,
  pushSpectatorState,
  getDelayedSpectatorState,
  queueSpectatorEvent,
  ensureSpectatorBroadcastLoop,
  clearSpectatorGame,
} from './spectatorBroadcast';
import { armEvictionTimer, cancelEvictionTimer, pendingEvictionCount } from './evictionTimers';
import { decideTurnTimerRearm, isTurnTimerJobCurrent, isAsyncDeadlineJobCurrent } from './turnTimerRearm';
import {
  initializeGameState,
  getStartingPlayerIndex,
  advanceToNextPlayer,
  checkVictory,
  drawCard,
  redeemCardSet,
  syncTerritoryCounts,
  calculateContinentBonuses,
  appendWinProbabilitySnapshot,
  repairDraftUnitsIfMissing,
  autoPlaceDraftUnits,
  advancePhaseOnTimeout,
  claimSelectionTerritory,
  claimableTerritoryIds,
  isUnclaimedOwner,
  passSelectionPick,
} from '../game-engine/state/gameStateManager';
import { calculateReinforcements } from '../game-engine/combat/combatResolver';
import { getMarchToSeaBonus, recordMarchToSeaResult } from '../game-engine/combat/combatModifiers';
import {
  validateBuild,
  applyBuild,
  getBuildingDefenseBonus,
  getSeaDefenseBonus,
} from '../game-engine/state/economyManager';
import {
  applyGarrisonDoctrine,
  validateGarrisonDoctrine,
} from '../game-engine/state/garrisonDoctrines';
import { consumeSealBreaker } from '../game-engine/abilities/lanePowers';
import { GARRISON_DOCTRINE_DISPLAY, type GarrisonDoctrine } from '@borderfall/shared';
import { validateResearch, applyResearch, getPlayerAttackBonus, getPlayerDefenseBonus, getPlayerReinforceBonus, getEraTechTreeForPlayer } from '../game-engine/state/techManager';
import { isBuildingTechUnlocked } from '../game-engine/eraAdvancement/buildingHeritage';
import { markPlayerAway, applySeatReclaim, AWAY_AI_GRACE_MS } from '../game-engine/state/seatTakeover';
import { buildAdvanceEraClientPreview, executeAdvanceEra, isEraAdvancePhase } from '../game-engine/eraAdvancement/advanceEra';
import { projectMapToEraFloor, unlockTerritoriesForFloor, seedsFullBoardAtStart, maxUnlockEra } from '../game-engine/eraAdvancement/territoryUnlock';
import { transformBoardOnAdvance } from '../game-engine/eraAdvancement/boardTransformTrigger';
import { createSeededRng } from '../game-engine/victory/missions';
import { getEraIdForAdvancementIndex } from '../game-engine/eraAdvancement/constants';
import { getPlayerEraModifiers } from '../game-engine/state/eraModifiers';
import { executeLandAttack } from '../game-engine/combat/executeLandAttack';
import { executeBlitzAttack } from '../game-engine/combat/executeBlitzAttack';
import { getWonderDefenseBonus, getWonderSeaAttackDice, getWonderInfluenceRange } from '../game-engine/state/wonderManager';
import { getTechNodeById, getEraTechTree } from '../game-engine/eras';
import { getPlayerFaction } from '../game-engine/eras/factionLineage';
import { resolveEventChoice, getTemporaryModifierValue, getDisplayScaledCard } from '../game-engine/events/eventCardManager';
import { moveFleets, resolveNavalCombat, resolveSeaCrossing } from '../game-engine/state/navalManager';
import { onInfluenceStabilityPenalty, getDeployCap } from '../game-engine/state/stabilityManager';
import { eliminatePlayer } from '../game-engine/state/elimination';
import { activeTruceBetween, agreeTruce, breakTruceBetween } from '../game-engine/state/truces';
import { areAllies, isShieldedFrom, isTeamGame, shieldedTargetError } from '../game-engine/state/teams';
import { fogAdjacency, fogVisibleTerritoryIds as visibleTerritoryIds } from '../game-engine/state/fogOfWar';
import { concededTeamWinners } from '../game-engine/victory/teamVictory';
import { getAdjacentTerritoryIds, getInfluenceHopLimit, isTerritoryReachableWithinHops } from '../game-engine/state/influenceManager';
import { playerHoldsVaultSeal, worldDeployCapBonus } from '../game-engine/state/worldRules';
import { isJumpGateOnlyEdge, jumpGatePartners, syncJumpGateLanes } from '../game-engine/state/jumpGates';
import { isLaneClosedByWeather, syncLaneWeatherLanes } from '../game-engine/state/laneWeather';
import {
  isSurgeProjectorOnlyEdge,
  surgeProjectorCarries,
  syncSurgeProjectorLanes,
} from '../game-engine/state/surgeProjector';
import { fortifyBecomesConvoy, launchConvoy } from '../game-engine/state/transit';
import {
  connectionRequiresMoonAccess,
  fortifyEndpointsRequireOrbitAccess,
  fortifyTraversalFilter,
  territoryRequiresOrbitAccessForClaim,
  selectionExemptTerritoryIds,
  getOrbitAccessResult,
  formatOrbitAccessError,
  isLaneSealedForPlayer,
  canSealLane,
  tickLaneBlockades,
  EMERGENCY_SEAL_ABILITY_ID,
  orbitGatewayTerritoryIds,
  laneSealDuration,
  laneSealHelium3Cost,
  laneSealTick,
  syncLaunchPadLanes,
  nearestLandingZoneFor,
} from '../game-engine/state/moonAccess';

/** The faction ability id that grants Drift Jump (Helion Navigators). */
const DRIFT_JUMP_ABILITY_ID = 'drift_jump';
import type { BuildingType } from '../types';
import { runAiWithTimeout } from '../game-engine/ai/runAiWithTimeout';
import { planAiTurn, playAiTurn, type AiTurnFlags } from '../game-engine/ai/runAiTurn';
import { resignIfBeaten, victoryAfterResignation } from '../game-engine/ai/aiResign';
import { buildAiTurnDigest, snapshotForDigest } from '../game-engine/ai/aiTurnDigest';
import { seatCommanders, styledLevel } from '../game-engine/ai/aiStyles';
import { resignSeat } from '../game-engine/state/resignation';
import { acceptSurrender, surrenderOffered } from '../game-engine/victory/surrender';
import { aiProfile, gameAiDifficulty, keepsTodaysBots, seatAiDifficulty } from '../game-engine/ai/aiProfiles';
import { recordGameResults, computeRanks, redactGuestRatings } from '../game-engine/state/statsManager';
import { checkAndUnlockAchievements } from '../game-engine/achievements/achievementService';
import { pgPool } from '../db/postgres';
import { getInitialRatings } from '../game-engine/rating/ratingService';
import {
  applyWinStreak,
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
import { loadMatchCosmetics } from '../modules/users/matchCosmetics';
import type { GameState, GameMap, AiDifficulty, PlayerState, EraId, MapConnection } from '../types';
import { normalizeGameSettings } from '../game-engine/state/gameSettings';
import { config } from '../config';
import { registerChatHandlers } from './handlers/chatHandler';
import { registerSocketRateLimit } from './socketRateLimit';
import { registerSocketAuth } from './socketAuth';
import {
  redactPlayersForViewer,
  maskHiddenTerritories,
  redactServerOnlyState,
  redactSettingsForClient,
} from './clientStateRedaction';
import { aiPlayerName } from '@borderfall/shared';
import type { SocketContext } from './handlers/types';
import { checkAndRecordActionId, clearActionIdempotency } from './actionIdempotency';
import { MARK_GAME_COMPLETED_SQL } from './gameCompletionSql';
import { captureProbBefore, commitActionDecision, clearDecisionLog, getDecisionLog, summarizeDecisionLog, territoryName } from './actionAttribution';
import { evaluateCoachingTip } from '../game-engine/coaching/coachingDetectors';
import { getFortifyUnitsValidationError, getStartGameAuthorizationError } from './socketGuards';
import { buildRedisAdapter } from './redisAdapter';
import { emitToPlayer } from './playerEvents';
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
  flushPendingPostgresSave,
  flushAllPendingPostgresSaves,
  saveGameMapAuthoritative,
  evictGameRoom,
  onPlayerConnected,
  onPlayerDisconnected,
  hasHumanConnections,
  hasOtherActiveHumanConnected,
  forEachConnectedGame,
  tryAcquireAiTurn,
  releaseAiTurn,
  isAiTurnInFlight,
  type ActiveGameRoom,
} from './gameRoomManager';
import { runWithGameLock } from './gameLock';
import { isUserBanned } from '../services/bans';
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
  applyLobbySettingVote,
  lobbySettingVoteRejection,
  lobbyVoteBringsAlong,
  rebakeSettingsForMapChange,
} from '../modules/games/createGameSettings';
import { galaxySeatCountError, isGalacticAgeGame } from '../modules/games/lobbyCapacity';
import { recordGalaxyGameResult } from '../game-engine/state/galaxyResults';
import {
  scheduleTurnTimeout,
  cancelTurnTimeout,
  setTurnTimerProcessor,
  stopTurnTimerWorker,
  turnTimerJobId,
  turnTimerQueue,
} from '../workers/gameTimerWorker';
import {
  scheduleAsyncDeadline,
  cancelAsyncDeadline,
  setDeadlineProcessor,
  asyncDeadlineJobId,
  asyncDeadlineQueue,
} from '../workers/asyncDeadlineWorker';
import { notifyTurnChange } from '../services/notificationService';
import type { DailyPuzzleSpec } from '../game-engine/daily/dailyPuzzleTypes';
import { createPuzzleDieRoll } from '../game-engine/daily/puzzleDice';
import { applyDailyPuzzleScenario } from '../game-engine/daily/applyDailyPuzzleScenario';
import { applyAuthoredScenario } from '../game-engine/scenarios/applyAuthoredScenario';
import { applyTutorialModuleBoost } from '../game-engine/tutorial/applyTutorialModuleBoost';
import { applyTutorialSettingsLab } from '../game-engine/tutorial/applyTutorialSettingsLab';
import {
  creditedWinnerIds,
  getDailyPuzzleSpec,
  maybeResolveDailyPuzzle,
  settleDailyRun,
  settleObjectiveAtConquest,
} from './dailyPuzzleSocket';
import { computeDailyPuzzleScore } from '../game-engine/daily/puzzleScore';
import { dailyRunWonForGame } from '../game-engine/daily/dailyRunResult';
import {
  beginPuzzleHumanTurn,
  commitPuzzleAttack,
  commitPuzzleDraft,
  commitPuzzleEndAttack,
  commitPuzzleEndTurn,
  commitPuzzleFortify,
  getWarmedPuzzle,
  notePuzzleDraftOpen,
  proposePuzzleAction,
  sanitizeProposal,
  summarizePuzzleRun,
  warmPuzzle,
  type WarmedPuzzle,
} from '../game-engine/daily/puzzlePlay';
import { runScriptedAiTurn } from '../game-engine/daily/puzzle/engineOpponent';
import {
  attackerIgnoresDefenseBuilding,
  consumeBlockadeRunner,
  getFortifyMoveLimit,
  getInfluenceUnitCost,
  getPrecisionStrikeMinUnits,
  getUnderdefendedAttackDiceBonus,
  playerHasUnlockedAbility,
} from '../game-engine/abilities/techAbilities';
import {
  hasMoonGroundAccess,
} from '../game-engine/abilities/moonPowers';
import {
  clearDropAssaultsFor,
  resolveDropAssaultsFor,
  type DropAssaultResolution,
} from '../game-engine/abilities/dropAssault';
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
  isHostileTerritoryAbility,
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
  /**
   * `games.winner_id` — a users.user_id, so NULL when a bot won (bot ids are
   * not UUIDs; see finalizeGame). Only meaningful once status is 'completed'.
   */
  winner_id?: string | null;
};

type WaitingLobbyDetails = {
  game: WaitingLobbyGameRow;
  players: WaitingLobbyPlayerRow[];
  settings: Record<string, unknown>;
  humanPlayers: WaitingLobbyPlayerRow[];
  /** A finished daily game's run result (see dailyRunWonForGame); absent otherwise. */
  dailyWon?: boolean | null;
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

/**
 * The day's warmed v2 solver, or null on a v1 day / a non-daily game
 * (docs/DAILY_PUZZLE_V2.md §5.4). Every v2 hook in the handlers goes through
 * this, so a v1 daily never reaches puzzlePlay at all.
 */
function dailyV2Puzzle(room: { state: GameState; map: GameMap }): WarmedPuzzle | null {
  const spec = getDailyPuzzleSpec(room.state);
  if (!spec?.v2) return null;
  try {
    return getWarmedPuzzle(spec, room.map);
  } catch (err) {
    console.error('[daily v2] could not build the solver for the day', err);
    return null;
  }
}

async function loadWaitingLobbyDetails(gameId: string): Promise<WaitingLobbyDetails | null> {
  const game = await queryOne<WaitingLobbyGameRow>(
    `SELECT game_id, era_id, map_id, status, settings_json, join_code, winner_id,
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

  // The settings the lobby would have been created with on the new theater:
  // what the old one baked in (the Space Age's Moon Race, lunar victory and
  // turn cap) goes, and what the new one needs comes, as at create.
  const gameMap = await resolveMap(value.map_id);
  const nextSettings = {
    ...rebakeSettingsForMapChange({
      settings: lobby.settings,
      from: { era_id: lobby.game.era_id, map_id: lobby.game.map_id },
      to: value,
      hasMoon: gameMap ? buildMapMetaFromDoc(gameMap).has_moon_territories : false,
    }),
    max_players: typeof lobby.settings.max_players === 'number' ? lobby.settings.max_players : lobby.players.length,
  };
  await query('UPDATE games SET settings_json = $2 WHERE game_id = $1', [gameId, JSON.stringify(nextSettings)]);

  if (gameMap) {
    // Lobby preview: for a standalone Space Age game with frontier seeding baked
    // in, show the full authored board so preview matches the in-game board;
    // otherwise the starting board (era-advancement growth appears in-game as eras
    // advance). No-op for maps without growth tags.
    const previewFloor = seedsFullBoardAtStart(value.era_id as EraId, nextSettings, gameMap) ? maxUnlockEra(gameMap) : 0;
    io.to(gameId).emit('game:map', { mapId: value.map_id, map: projectMapToEraFloor(gameMap, previewFloor) });
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

/**
 * Statuses a game can be in once it is over.
 *
 * Both answer a `game:join` with a lobby snapshot: neither has a waiting lobby
 * or a live room, so without one the join replies with silence and the client
 * cannot tell a finished game from an unreachable server. Exported for tests.
 */
export function isEndedGameStatus(status: string): boolean {
  return status === 'completed' || status === 'abandoned';
}

/** The `game:lobby_updated` payload. Exported for tests. */
export function buildLobbySnapshotPayload(lobby: WaitingLobbyDetails) {
  return {
    game_id: lobby.game.game_id,
    era_id: lobby.game.era_id,
    map_id: lobby.game.map_id,
    status: lobby.game.status,
    join_code: lobby.game.join_code ?? null,
    // Lets the ended-game screen name the winner. NULL for a bot win, and
    // the client reads it as exactly that rather than as "unknown".
    winner_id: lobby.game.winner_id ?? null,
    // A daily game's run can be lost on a board its player won, so the ended
    // screen reads this beside winner_id. Null for any other game.
    daily_won: lobby.dailyWon ?? null,
    settings_json: redactSettingsForClient(lobby.settings),
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
  };
}

async function emitWaitingLobbySnapshot(io: Server, gameId: string, details?: WaitingLobbyDetails): Promise<void> {
  const lobby = details ?? await loadWaitingLobbyDetails(gameId);
  if (!lobby) return;
  io.to(gameId).emit('game:lobby_updated', buildLobbySnapshotPayload(lobby));
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
// persisted away_since so it survives restarts) while someone else is at the table
// (driveCurrentSeatIfAi), and the player reclaims instantly on return. These maps
// hold the per-game in-memory timers used to drive that.
//
// Background reclaim retries, keyed `${gameId}:${playerId}`. A reclaim that
// arrives while an away-AI turn holds the room lock is retried until it lands (or
// the seat is no longer away), so a reconnect is never silently dropped.
const reclaimRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
// The same for a disconnect: marking the seat away is retried until it lands
// (or the player is back), so an absent seat always gets its turns covered.
const awayRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
// Pending "let the AI cover the away seat's current turn" timers, keyed by gameId.
const awayAiTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Clear a game's pending away-AI + seat-retry timers (eviction / game over). */
function clearGameSeatTimers(gameId: string): void {
  const away = awayAiTimers.get(gameId);
  if (away) {
    clearTimeout(away);
    awayAiTimers.delete(gameId);
  }
  for (const retries of [reclaimRetryTimers, awayRetryTimers]) {
    for (const [key, timer] of retries) {
      if (key.startsWith(`${gameId}:`)) {
        clearTimeout(timer);
        retries.delete(key);
      }
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
        clearSpectatorGame(gameId);
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
 *
 * Returns 'contended' when another action holds the room lock (a bot or
 * away-AI turn holds it for the whole turn); the caller retries
 * (scheduleAwayRetry), or the seat would never be covered.
 */
async function markSeatAway(io: Server, gameId: string, playerId: string): Promise<SeatChangeResult> {
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
    if (isLockContentionError(err)) return 'contended';
    if (!(err instanceof GameRoomNotFoundError)) {
      console.error('[Socket] markSeatAway failed for', gameId, playerId, err);
    }
  }
  return 'settled';
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
  // The away-AI covers a seat so the players still at the table are not kept
  // waiting. With nobody else there (a solo game, a Daily Challenge, a table
  // that all dropped) the seat waits for its player, whose run must be scored
  // on their own moves. A player who joins re-arms the cover (game:join).
  if (!current.is_ai && !(await hasOtherActiveHumanConnected(gameId, room.state, current.player_id).catch(() => false))) {
    return;
  }
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
type SeatChangeResult = 'settled' | 'contended';

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
 * Retry a seat change that lost the room lock, every 2s, until it lands or
 * stops being applicable. Bounded (~40s) and self-clearing; one chain per seat
 * in each `timers` map.
 */
function retrySeatChange(
  timers: Map<string, ReturnType<typeof setTimeout>>,
  gameId: string,
  playerId: string,
  attempt: () => Promise<SeatChangeResult>,
): void {
  const key = `${gameId}:${playerId}`;
  if (timers.has(key)) return; // already retrying this seat
  let attemptsLeft = 20;
  const schedule = () => {
    const t = setTimeout(() => void tick(), 2000);
    t.unref();
    timers.set(key, t);
  };
  const tick = async () => {
    timers.delete(key);
    let result: SeatChangeResult;
    try {
      result = await attempt();
    } catch {
      result = 'contended';
    }
    if (result === 'contended' && --attemptsLeft > 0) schedule();
  };
  schedule();
}

/**
 * Keep retrying a return that lost the race to an in-flight away-AI turn, until it
 * lands or stops being applicable. Stops early if the player disconnects again
 * (markSeatAway re-owns that seat).
 */
function scheduleReclaimRetry(io: Server, gameId: string, playerId: string): void {
  retrySeatChange(reclaimRetryTimers, gameId, playerId, async () => {
    if (!(await isPlayerConnected(gameId, playerId))) return 'settled'; // left again
    return (await reclaimAwaySeat(io, gameId, playerId)) === 'contended' ? 'contended' : 'settled';
  });
}

/**
 * Keep retrying to mark a departed player away while the room lock is busy.
 * Stops early once they are back (the join reclaims the seat itself).
 */
function scheduleAwayRetry(io: Server, gameId: string, playerId: string): void {
  retrySeatChange(awayRetryTimers, gameId, playerId, async () => {
    if (await isPlayerConnected(gameId, playerId)) return 'settled'; // back again
    return markSeatAway(io, gameId, playerId);
  });
}

// Adjacency cache: map_id → territory_id → neighbour_ids[]
// Built once per unique map when the first room using it loads; reused for fog
// visibility in buildClientState across all subsequent calls for that map.
const adjacencyByMapId = new Map<string, Map<string, string[]>>();

function getOrBuildAdjacency(map: GameMap): Map<string, string[]> {
  const cached = adjacencyByMapId.get(map.map_id);
  if (cached) return cached;
  const adj = fogAdjacency(map);
  adjacencyByMapId.set(map.map_id, adj);
  return adj;
}

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

      const { state, map } = room;

      // Stale-job guard: only the deadline the seat to move still has may
      // lapse (see isAsyncDeadlineJobCurrent).
      if (state.phase === 'game_over') return;
      if (!isAsyncDeadlineJobCurrent({
        job: job.data,
        turnNumber: state.turn_number,
        playerIndex: state.current_player_index,
        armedDeadlineAt: state.phase_deadline_at,
        now: Date.now(),
      })) return;

      // Territory Draft: pick for the seat whose deadline lapsed and carry on,
      // as the real-time clock does. Forfeiting the turn below set the draft
      // phase and left every unclaimed tile neutral at 0 units, which no
      // attack can take.
      if (state.phase === 'territory_select') {
        advancePhaseOnTimeout(state, map);
        await finishSelectionTimeout(io, gameId, room);
        return;
      }

      // The day ran through a choice card nobody answered: answer it with the
      // first choice, as a bot or an away seat does, before the turn is
      // forfeited. Left open, it would pass to the next player's turn. First,
      // so reinforcements the card grants are placed with the rest.
      resolveChoiceCardForAi(io, gameId, state);

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
      landPendingDropAssaults(io, gameId, state, map);
      await syncLaneWeatherAndBroadcastMap(io, gameId, room);
      broadcastTransitArrivals(io, gameId, state, map);
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
      broadcastEventCard(io, gameId, state, map); // before the save: see broadcastEventCard
      await saveGameState(gameId, state);
      broadcastState(io, gameId, state);
      maybeEmitCoachingTip(io, gameId, state, map);

      const humanAfterAsync = state.players.find((p) => !p.is_ai);
      if (humanAfterAsync && maybeResolveDailyPuzzle(io, gameId, room, null, humanAfterAsync.player_id, finalizeGame)) {
        return;
      }

      // Also when the next turn opens on a choice card: the day runs through it.
      startTurnTimer(io, gameId, state, map);
      if (state.players[state.current_player_index].is_ai) {
        setTimeout(() => processAiTurn(io, gameId), 1500);
      }
    });
  });

  // ── Phase 7: BullMQ turn timer processor (real-time mode) ─────────────────
  setTurnTimerProcessor(async (job) => {
    const { gameId, deadlineAt } = job.data;
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
      // Only the clock the game is still running may time it out. A job whose
      // deadline was cleared or re-armed since (the player ended the phase
      // while it waited on the lock) must not end the phase that followed.
      if (!isTurnTimerJobCurrent({
        jobDeadlineAt: deadlineAt,
        armedDeadlineAt: room.state.phase_deadline_at,
        now: Date.now(),
      })) return;

      // The turn's clock ran out, in whichever phase: reinforcements still
      // unplaced are placed and the turn passes on (advancePhaseOnTimeout).
      const timedOutPlayerId = room.state.players[room.state.current_player_index]?.player_id;
      const adv = advancePhaseOnTimeout(room.state, room.map);

      if (adv.kind === 'selection') {
        // Territory Draft: a pick was made for the seat that timed out.
        await finishSelectionTimeout(io, gameId, room);
        return;
      }

      // The rest of the hand-off is every other hand-off's: without it, the
      // incoming player's Drop Assault waited a round, their convoys' arrivals
      // went unannounced, and the map kept last round's lane weather.
      if (adv.autoDraft.total > 0) {
        emitAutoDraftMapVisuals(io, gameId, room.state, adv.autoDraft.placements, timedOutPlayerId);
      }
      io.to(gameId).emit('game:turn_timeout', {
        phaseAdvanced: 'next_turn',
        appliedDraft: adv.autoDraft.total > 0,
        unitsPlaced: adv.autoDraft.total,
      });
      landPendingDropAssaults(io, gameId, room.state, room.map);
      await syncLaneWeatherAndBroadcastMap(io, gameId, room);
      broadcastTransitArrivals(io, gameId, room.state, room.map);
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
      broadcastEventCard(io, gameId, room.state, room.map); // before the save: see broadcastEventCard
      await saveGameState(gameId, room.state);
      broadcastState(io, gameId, room.state);
      maybeEmitCoachingTip(io, gameId, room.state, room.map);

      const humanT = room.state.players.find((p) => !p.is_ai);
      if (humanT && maybeResolveDailyPuzzle(io, gameId, room, null, humanT.player_id, finalizeGame)) {
        return;
      }

      // Pauses a present player's clock on a choice card; covers an away seat.
      startTurnTimer(io, gameId, room.state, room.map);

      if (room.state.players[room.state.current_player_index].is_ai) {
        setTimeout(() => processAiTurn(io, gameId), 1500);
      }
    });
  });
  // Processor registered above; worker started from index.ts after initGameSocket returns.

  // ── Authentication middleware ─────────────────────────────────────────────
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('Authentication required'));
    const payload = verifyAccessToken(token);
    if (!payload) return next(new Error('Invalid or expired token'));
    // A banned account's access token is still within its hour, but it may not
    // hold a game socket (services/bans.ts). A database hiccup lets the
    // connection through rather than locking every player out.
    try {
      if (await isUserBanned(payload.sub)) return next(new Error('Account is banned'));
    } catch (err) {
      console.warn('[Socket] Ban check failed; allowing connection:', err);
    }
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
          `SELECT game_id, era_id, map_id, status, settings_json, join_code, winner_id,
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
            const previewFloor = seedsFullBoardAtStart(game.era_id as EraId, waitingDetails.settings, waitingMap)
              ? maxUnlockEra(waitingMap)
              : 0;
            socket.emit('game:map', { mapId: game.map_id, map: projectMapToEraFloor(waitingMap, previewFloor) });
          }
        }

        // A finished game has no waiting lobby and no live room, so neither
        // branch above nor below fired and the join used to answer with
        // silence. The client cannot tell that apart from a server that never
        // replied: it sat on "Loading lobby…" — a Pre-Game Room screen whose
        // every navigation control is inside `{lobby && …}` and so never
        // rendered — until a 15s timeout replaced it with "the game may no
        // longer exist". Send the snapshot; its `status` is what lets the
        // client say the match is over and offer the replay and the way back.
        // Emitted to this socket alone: nobody else in the room needs it.
        if (isEndedGameStatus(game.status)) {
          const endedSettings = parseLobbySettings(game.settings_json);
          // Only a played-out daily has a run result to show. A failed lookup
          // costs the line its daily reading, never the join.
          const dailyWon = game.status === 'completed' && endedSettings.daily_challenge_date
            ? await dailyRunWonForGame(gameId).catch((err) => {
              console.error('[Socket] Daily run lookup failed for ended game', gameId, err);
              return null;
            })
            : null;
          socket.emit('game:lobby_updated', buildLobbySnapshotPayload({
            game,
            players,
            settings: endedSettings,
            humanPlayers: players.filter((player) => !player.is_ai && !!player.user_id),
            dailyWon,
          }));
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

          // Another player's away seat is covered by an in-memory timer, which a
          // restart or deploy loses. Re-arm it here: the clock restore below
          // does too, but only in a game with a turn timer.
          if (
            currentAiPlayer?.is_away &&
            !currentAiPlayer.is_ai &&
            currentAiPlayer.player_id !== userId &&
            !room.state.settings.async_mode &&
            room.state.phase !== 'game_over' &&
            !awayAiTimers.has(gameId) &&
            !(await isAiTurnInFlight(gameId))
          ) {
            scheduleAwayAiTurn(io, gameId, currentAiPlayer.away_since);
          }

          // Real-time games: an eviction race or restart can cancel the BullMQ
          // timeout while clients keep an armed deadline — the HUD clock dies
          // at 0:00 and the phase never advances. Restore it on (re)join: an
          // unexpired deadline is kept (a reconnect must never grant extra
          // clock), a missing/expired one gets a fresh timer.
          if (!room.state.settings.async_mode && room.state.phase !== 'game_over' && !currentAiPlayer?.is_ai) {
            try {
              const armedDeadline = room.state.phase_deadline_at;
              const job = typeof armedDeadline === 'number'
                ? await turnTimerQueue.getJob(turnTimerJobId(gameId, armedDeadline))
                : undefined;
              const decision = decideTurnTimerRearm({
                hasScheduledJob: !!job,
                phase: room.state.phase,
                asyncMode: !!room.state.settings.async_mode,
                turnTimerSeconds: room.state.settings.turn_timer_seconds,
                currentPlayerIsAi: !!currentAiPlayer?.is_ai,
                deadlineAt: room.state.phase_deadline_at,
                now: Date.now(),
              });
              if (decision.kind === 'remaining' && typeof armedDeadline === 'number') {
                scheduleTurnTimeout(gameId, armedDeadline).catch((err) =>
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

          // For async games, ensure the deadline job is still scheduled (may be
          // lost on server restart). The job is named by the deadline the game
          // carries. A turn with none on record falls back to the deadline
          // stored in Postgres, as before. One already past gets ten seconds.
          if (room.state.settings.async_mode && room.state.phase !== 'game_over' && !currentAiPlayer?.is_ai) {
            const { turn_number: turnNumber, current_player_index: playerIndex, phase_deadline_at: armed } = room.state;
            const restore = (deadlineAt: number) =>
              asyncDeadlineQueue.getJob(asyncDeadlineJobId(gameId, deadlineAt)).then((job) => {
                if (!job) return scheduleAsyncDeadline(gameId, turnNumber, playerIndex, deadlineAt, { minDelayMs: 10_000 });
              });
            const restored = typeof armed === 'number'
              ? restore(armed)
              : queryOne<{ async_turn_deadline: Date | null }>(
                'SELECT async_turn_deadline FROM games WHERE game_id = $1',
                [gameId],
              ).then((g) => {
                if (g?.async_turn_deadline) return restore(new Date(g.async_turn_deadline).getTime());
              });
            restored.catch((err) => console.error('[Socket] Async deadline restore failed for', gameId, err));
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
        // Server-side backstop for the spectate flag — hiding the client
        // entry points alone would leave direct socket joins working.
        if (!featureFlags.spectateEnabled) {
          return socket.emit('error', { message: 'Spectating is currently disabled' });
        }

        const game = await queryOne<{ game_id: string; status: string; map_id: string }>(
          'SELECT game_id, status, map_id FROM games WHERE game_id = $1',
          [gameId],
        );
        if (!game) return emitGameError(socket, GameErrorCode.GAME_DELETED, 'Game not found');
        if (game.status !== 'in_progress') return socket.emit('error', { message: 'Game is not in progress' });

        // A socket spectates one game at a time. Settle the previous game's
        // accounting if the client switched without an explicit leave.
        const previous = socket.data?.spectating as string | undefined;
        if (previous && previous !== gameId) {
          await removeSpectatorSocket(io, socket, previous);
        }

        const room = await loadAuthoritativeRoom(gameId, game.map_id);
        if (!room) {
          // Without a snapshot the client would sit on "Connecting…" forever —
          // surface a retryable error instead.
          return emitGameError(socket, GameErrorCode.GAME_NOT_FOUND, 'Failed to load the game — please try again');
        }
        getOrBuildAdjacency(room.map);

        const spectatorRoom = `${gameId}:spectators`;
        socket.join(spectatorRoom);
        socket.data = { ...socket.data, spectating: gameId };

        // Idempotent count: a duplicate join from the same socket (reconnect
        // races, remount double-effects) must not inflate the persistent count.
        if (trackSpectator(gameId, socket.id)) {
          await query('UPDATE games SET spectator_count = spectator_count + 1 WHERE game_id = $1', [gameId]).catch(() => {});
        }

        recordSpectatorState(gameId, room.state);
        const initEntry = getDelayedSpectatorState(gameId);
        socket.emit('game:state', initEntry
          ? { ...initEntry.state, _spectator_seq: initEntry.seq }
          : buildClientState(room.state, null, room.state.settings.fog_of_war));
        ensureSpectatorBroadcastLoop(io, gameId);

        await broadcastSpectatorCount(io, gameId);

        socket.emit('game:spectate_joined', { gameId });
      } catch (err) {
        console.error('[Socket] game:spectate_join error:', err);
        socket.emit('error', { message: 'Failed to spectate game' });
      }
    });

    socket.on('game:spectate_leave', async ({ gameId }: { gameId: string }) => {
      await removeSpectatorSocket(io, socket, gameId);
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
      if (!currentPlayer) return emitGameError(socket, GameErrorCode.NOT_YOUR_TURN, 'Not your turn');
      if (!isSocketUsersTurn(state, userId, username)) return emitGameError(socket, GameErrorCode.NOT_YOUR_TURN, 'Not your turn');
      if (state.phase !== 'draft') return emitGameError(socket, GameErrorCode.WRONG_PHASE, 'Not in draft phase');

      repairDraftUnitsIfMissing(state, map);
      // Daily v2: the turn's pre-draft position, so the draft grades as one decision.
      const draftPuzzle = dailyV2Puzzle(room);
      if (draftPuzzle) notePuzzleDraftOpen(draftPuzzle, state);
      // Reject non-integer counts (e.g. a crafted `units: 1.5`) before the range
      // check — fractional values would corrupt unit_count and propagate through
      // combat/reinforcement math. (game:fortify already guards this via
      // getFortifyUnitsValidationError; draft/naval did not.)
      if (!Number.isInteger(units)) {
        return emitGameError(socket, GameErrorCode.NON_INTEGER_UNITS, 'Unit count must be a whole number');
      }
      const poolRemaining = state.draft_units_remaining ?? 0;
      if (units < 1 || units > poolRemaining) {
        return emitGameError(socket, GameErrorCode.INSUFFICIENT_UNITS, `Cannot place ${units} units (${poolRemaining} remaining)`);
      }

      // Use the seated player's id (not raw JWT subject) so draft placement stays
      // consistent with isSocketUsersTurn when player_id strings were realigned.
      const actingPlayerId = currentPlayer.player_id;
      const territory = state.territories[territoryId];
      if (!territory || territory.owner_id !== actingPlayerId) {
        return emitGameError(socket, GameErrorCode.NOT_OWNER, 'Invalid territory');
      }

      if (state.settings.stability_enabled) {
        const cap = getDeployCap(territory.stability, {
          era: state.era,
          turnNumber: state.turn_number,
          economyEnabled: !!state.settings.economy_enabled,
          playerSpecialResource: currentPlayer.special_resource ?? 0,
          worldDeployCapBonus: worldDeployCapBonus(state, territory.world_id),
        });
        const placements = state.draft_placements_this_turn ?? {};
        const alreadyPlaced = placements[territoryId] ?? 0;
        if (alreadyPlaced + units > cap) {
          const remainingCap = Math.max(0, cap - alreadyPlaced);
          return emitGameError(
            socket,
            GameErrorCode.STABILITY_CAP,
            `Stability cap reached — ${remainingCap} unit${remainingCap === 1 ? '' : 's'} left for this territory this draft`,
          );
        }
      }

      if (!checkAndRecordActionId(gameId, userId, action_id)) {
        return emitGameError(socket, GameErrorCode.ACTION_IN_FLIGHT, 'Action already processed — please wait');
      }

      const draftProbBefore = captureProbBefore(state, actingPlayerId);
      territory.unit_count += units;
      state.draft_units_remaining -= units;
      if (state.settings.stability_enabled) {
        state.draft_placements_this_turn = state.draft_placements_this_turn ?? {};
        state.draft_placements_this_turn[territoryId] = (state.draft_placements_this_turn[territoryId] ?? 0) + units;
      }
      // Record this manual placement on the per-turn undo stack (always, not just
      // under stability) so game:draft_undo can reverse it. AI/timeout auto-placements
      // and card bonuses deliberately do NOT push here — only the human's own picks.
      state.draft_deployments_this_turn = state.draft_deployments_this_turn ?? [];
      state.draft_deployments_this_turn.push({ territory_id: territoryId, units });
      commitActionDecision(
        gameId, state, userId, 'draft',
        `Deployed ${units} unit${units === 1 ? '' : 's'} to ${territoryName(map, territoryId)}`,
        draftProbBefore,
      );
      emitVisual(io, gameId, state, buildReinforceMapVisual({
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

    // ── Draft Undo ────────────────────────────────────────────────────────
    // Reverse the most recent manual reinforcement placement this turn. Only
    // valid on the acting player's own draft phase; never touches auto-placed
    // (timeout/AI) units or card bonuses (those are not on the undo stack).
    socket.on('game:draft_undo', async ({ gameId, action_id }: { gameId: string; action_id?: string }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
      const { state } = room;

      const currentPlayer = state.players[state.current_player_index];
      if (!currentPlayer) return socket.emit('error', { message: 'Not your turn' });
      if (!isSocketUsersTurn(state, userId, username)) return socket.emit('error', { message: 'Not your turn' });
      if (state.phase !== 'draft') return socket.emit('error', { message: 'Not in draft phase' });
      if (!checkAndRecordActionId(gameId, userId, action_id)) {
        return socket.emit('error', { message: 'Action already processed — please wait' });
      }

      const log = state.draft_deployments_this_turn ?? [];
      const last = log[log.length - 1];
      if (!last) return socket.emit('error', { message: 'Nothing to undo' });

      const territory = state.territories[last.territory_id];
      // Reverse only when cleanly reversible: still owned by the actor and holding
      // enough units that removing the placement leaves ≥1 behind. (Draft phase
      // never changes ownership or unit counts otherwise, so this should hold.)
      if (!territory || territory.owner_id !== currentPlayer.player_id || territory.unit_count < last.units + 1) {
        return socket.emit('error', { message: 'Cannot undo that placement' });
      }

      log.pop();
      territory.unit_count -= last.units;
      state.draft_units_remaining = (state.draft_units_remaining ?? 0) + last.units;
      // Keep the stability-cap tally in step with the reversal.
      if (state.draft_placements_this_turn && state.draft_placements_this_turn[last.territory_id] != null) {
        const remainingAtTerr = state.draft_placements_this_turn[last.territory_id] - last.units;
        if (remainingAtTerr > 0) state.draft_placements_this_turn[last.territory_id] = remainingAtTerr;
        else delete state.draft_placements_this_turn[last.territory_id];
      }
      state.draft_deployments_this_turn = log;

      broadcastState(io, gameId, state);
      void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
      });
    });

    // ── Territory Selection (territory draft mode) ────────────────────────
    socket.on('game:select_territory', async ({ gameId, territoryId, action_id }: { gameId: string; territoryId: string; action_id?: string }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
      if (!checkAndRecordActionId(gameId, userId, action_id)) return;
      const { state, map } = room;

      if (state.phase !== 'territory_select') return emitGameError(socket, GameErrorCode.WRONG_PHASE, 'Not in territory selection phase');
      const currentPlayer = state.players[state.current_player_index];
      if (!isSocketUsersTurn(state, userId, username)) return emitGameError(socket, GameErrorCode.NOT_YOUR_TURN, 'Not your turn');

      const territory = state.territories[territoryId];
      if (!territory) return emitGameError(socket, GameErrorCode.INVALID_TERRITORY, 'Territory not found');
      if (!isUnclaimedOwner(territory.owner_id)) return emitGameError(socket, GameErrorCode.INVALID_TERRITORY, 'Territory already claimed');

      // Seeded neutral frontiers (standalone Space Age) are conquered in play, not
      // drafted during selection — reject the pick (the completion check exempts
      // them too, via selectionExemptTerritoryIds).
      const pickedMapTerritory = map.territories.find((t) => t.territory_id === territoryId);
      if ((pickedMapTerritory?.unlock_era_index ?? 0) > 0) {
        return emitGameError(socket, GameErrorCode.INVALID_TERRITORY, 'Frontier territories are conquered, not claimed');
      }

      if (territoryRequiresOrbitAccessForClaim(map, territoryId)) {
        const access = getOrbitAccessResult(state, currentPlayer, map, state.era);
        if (!access.allowed) {
          return emitGameError(socket, GameErrorCode.ACCESS_DENIED, formatOrbitAccessError(access));
        }
      }

      const { completed: selectionDone } = claimSelectionTerritory(state, map, territoryId);

      broadcastState(io, gameId, state);
      void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));

      // If next player is AI and still in territory_select, trigger AI pick
      const nextPlayer = state.players[state.current_player_index];
      if (nextPlayer.is_ai && !selectionDone) {
        setTimeout(() => processAiTerritorySelect(io, gameId), 800);
      } else if (nextPlayer.is_ai) {
        setTimeout(() => processAiTurn(io, gameId), 1500);
      } else if (!nextPlayer.is_ai) {
        // Each human pick gets its own clock, in the draft as in play.
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
      if (!isSocketUsersTurn(state, userId, username)) return emitGameError(socket, GameErrorCode.NOT_YOUR_TURN, 'Not your turn');
      if (state.phase !== 'attack') return emitGameError(socket, GameErrorCode.WRONG_PHASE, 'Not in attack phase');
      if (currentPlayer.era_advanced_this_turn) {
        return emitGameError(socket, GameErrorCode.ALREADY_ADVANCED, 'Cannot attack after advancing this turn');
      }

      const fromTerritory = state.territories[fromId];
      const toTerritory = state.territories[toId];

      if (!fromTerritory || fromTerritory.owner_id !== userId) {
        return emitGameError(socket, GameErrorCode.NOT_OWNER, 'Invalid attacking territory');
      }
      if (!toTerritory || toTerritory.owner_id === userId) {
        return emitGameError(socket, GameErrorCode.INVALID_TERRITORY, 'Invalid defending territory');
      }
      if (refuseShieldedTarget(socket, state, userId, toTerritory.owner_id)) return;
      if (fromTerritory.unit_count < 2) {
        return emitGameError(socket, GameErrorCode.INSUFFICIENT_UNITS, 'Not enough units to attack');
      }

      // Verify adjacency
      const isAdjacent = map.connections.some(
        (c) => (c.from === fromId && c.to === toId) || (c.from === toId && c.to === fromId)
      );
      if (!isAdjacent) return emitGameError(socket, GameErrorCode.NOT_ADJACENT, 'Territories not adjacent');
      if (isJumpGateOnlyEdge(map, fromId, toId)) {
        return emitGameError(
          socket,
          GameErrorCode.INVALID_TERRITORY,
          'A Jump Gate lane moves your own units — it cannot carry an attack',
        );
      }
      // A Surge Projector lane carries its owner's one crossing and nothing else.
      if (
        isSurgeProjectorOnlyEdge(map, fromId, toId)
        && !surgeProjectorCarries(state, currentPlayer.player_id, fromId, toId)
      ) {
        return emitGameError(
          socket,
          GameErrorCode.INVALID_TERRITORY,
          'A Surge Projector lane carries one crossing, from the gateway that opened it, this attack phase',
        );
      }

      if (connectionRequiresMoonAccess(map, fromId, toId)) {
        const access = getOrbitAccessResult(state, currentPlayer, map, state.era);
        if (!access.allowed) {
          return emitGameError(socket, GameErrorCode.ACCESS_DENIED, formatOrbitAccessError(access));
        }
        // Seal Breaker (lane powers): a charge fired from this gateway opens
        // its next crossing through a closure or a seal alike. Spent only when
        // the lane is actually shut, so an open crossing keeps it.
        const laneShut = isLaneSealedForPlayer(state, fromId, toId, currentPlayer.player_id);
        const sealBroken = laneShut && consumeSealBreaker(currentPlayer, fromId);
        if (!sealBroken && isLaneClosedByWeather(state, fromId, toId)) {
          return emitGameError(
            socket,
            GameErrorCode.LANE_SEALED,
            'A nebula front has closed that hyperspace lane — it clears in a round or two',
          );
        }
        if (
          !sealBroken
          && laneShut
          && !consumeBlockadeRunner(currentPlayer)
        ) {
          return emitGameError(
            socket,
            GameErrorCode.LANE_SEALED,
            'An Emergency Seal closes that hyperspace lane — cross another lane, or wait for it to lift',
          );
        }
      }

      // Neutral off-world garrisons (the Moon, neutral galaxy worlds) need orbit
      // access too — executeLandAttack refuses them without
      // `neutralOffworldCaptureAllowed`, but a bare null outcome surfaces as the
      // generic 'Invalid attack'. Attacks along a `land` edge between two Moon
      // tiles never reach the orbit-edge gate above, so say why here instead.
      if (!toTerritory.owner_id && !!toTerritory.world_id && toTerritory.world_id !== 'earth') {
        const access = getOrbitAccessResult(state, currentPlayer, map, state.era);
        if (!access.allowed) {
          return emitGameError(socket, GameErrorCode.ACCESS_DENIED, formatOrbitAccessError(access));
        }
      }

      // ── Truce enforcement + break-truce logic ────────────────────────────────
      // defenderPlayer is hoisted so the retaliation-bonus check below can also use it.
      const defenderPlayer = state.players.find((p) => p.player_id === toTerritory.owner_id);

      // Truce: refused until the attacker confirms the break. Checked before the
      // retaliation die below is taken, so a refused attack cannot spend it.
      if (refuseUnconfirmedTruceBreak(socket, state, userId, defenderPlayer?.player_id, breakTruce)) return;

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
      const seaAssault = !!state.settings.naval_enabled && connection?.type === 'sea';
      if (seaAssault && (!fromTerritory.naval_units || fromTerritory.naval_units <= 0)) {
        return emitGameError(socket, GameErrorCode.INSUFFICIENT_UNITS, 'No fleet to traverse sea lane');
      }

      // The attack is committed from here, the crossing included: a confirmed
      // one on a truce partner breaks the truce, and the defender gets +1 die
      // for this attack. It used to break before the fleet check above, so a
      // refused sea attack still cost the truce.
      const truceBrokenDefenseBonus = breakTruceAndAlert(io, state, currentPlayer, defenderPlayer?.player_id) ? 1 : 0;

      let navalBombardmentDefenseBonus = 0;
      if (seaAssault) {
        const crossing = resolveSeaCrossing(fromTerritory, toTerritory);
        if (crossing.navalResult) {
          const navalPayload = { fromId, toId, result: crossing.navalResult };
          io.to(gameId).emit('game:naval_combat_result', navalPayload);
          queueSpectatorEvent(gameId, 'game:naval_combat_result', navalPayload);
          emitVisual(io, gameId, state, buildNavalMapVisual({
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

      // Daily v2: grade the target choice (the first exchange on an edge) and
      // raise the plan condition "the human attacked the objective".
      const attackPuzzle = dailyV2Puzzle(room);
      if (attackPuzzle) commitPuzzleAttack(attackPuzzle, state, fromId, toId);

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
        // Neutral off-world garrisons (the Moon) are capturable once the
        // attacker has completed the orbit-access ladder.
        neutralOffworldCaptureAllowed: getOrbitAccessResult(state, currentPlayer, map, state.era).allowed,
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
        return emitGameError(socket, GameErrorCode.ACTION_FAILED, 'Invalid attack');
      }
      const result = landOutcome.result;
      // Bail out if combat was invalid (e.g. defender hit 0 units via a race).
      // executeLandAttack left state unmutated in this case.
      if (result.error) {
        return emitGameError(socket, GameErrorCode.ACTION_FAILED, result.error);
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
        // An exchange that killed defenders without taking the tile is not a
        // failure, and "failed (lost 0)" read as one on the Match Stats panel.
        const outcome = result.territory_captured
          ? `captured ${toName}`
          : result.defender_losses > 0 && result.attacker_losses === 0
            ? `destroyed ${result.defender_losses} defender${result.defender_losses === 1 ? '' : 's'}, ${toName} still holds`
            : result.defender_losses > 0
              ? `traded ${result.attacker_losses} for ${result.defender_losses}, ${toName} still holds`
              : `repelled (lost ${result.attacker_losses})`;
        return `Attacked ${fromName} → ${toName} with ${attackerUnitsCommitted} units; ${outcome}`;
      })();

      if (maybeResolveDailyPuzzle(io, gameId, room, stateBeforePuzzle, userId, finalizeGame)) {
        commitActionDecision(gameId, state, userId, 'attack', attackSummary, attackProbBefore);
        io.to(gameId).emit('game:combat_result', { fromId, toId, result });
        emitVisual(io, gameId, state, buildCombatMapVisual({
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
      emitVisual(io, gameId, state, buildCombatMapVisual({
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
      if (result.territory_captured) await syncJumpGateLanesAfterCapture(io, gameId, state, map);
      void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
      });
    });

    // ── Attack Blitz ─────────────────────────────────────────────────────────
    // "Attack until captured" as ONE event: repeated executeLandAttack
    // exchanges resolved server-side (executeBlitzAttack), emitted as one
    // aggregated game:combat_result. Deliberately narrower than game:attack —
    // land only, never in a daily puzzle — so a convenience button cannot
    // wreck a per-move graded score on the player's behalf. A blitz on a truce
    // partner breaks the truce like any attack, and like any attack only once
    // the player has confirmed it (`breakTruce`). One event, so turn timers and
    // the room lock see it exactly like a single attack.
    socket.on('game:attack_blitz', async ({ gameId, fromId, toId, action_id, breakTruce }: { gameId: string; fromId: string; toId: string; action_id?: string; breakTruce?: boolean }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
      if (!checkAndRecordActionId(gameId, userId, action_id)) return;
      const { state, map } = room;

      if (!featureFlags.attackBlitzEnabled) {
        return emitGameError(socket, GameErrorCode.ACTION_FAILED, 'Blitz attacks are disabled');
      }

      const currentPlayer = state.players[state.current_player_index];
      if (!isSocketUsersTurn(state, userId, username)) return emitGameError(socket, GameErrorCode.NOT_YOUR_TURN, 'Not your turn');
      if (state.phase !== 'attack') return emitGameError(socket, GameErrorCode.WRONG_PHASE, 'Not in attack phase');
      if (currentPlayer.era_advanced_this_turn) {
        return emitGameError(socket, GameErrorCode.ALREADY_ADVANCED, 'Cannot attack after advancing this turn');
      }

      const fromTerritory = state.territories[fromId];
      const toTerritory = state.territories[toId];
      if (!fromTerritory || fromTerritory.owner_id !== userId) {
        return emitGameError(socket, GameErrorCode.NOT_OWNER, 'Invalid attacking territory');
      }
      if (!toTerritory || toTerritory.owner_id === userId) {
        return emitGameError(socket, GameErrorCode.INVALID_TERRITORY, 'Invalid defending territory');
      }
      if (refuseShieldedTarget(socket, state, userId, toTerritory.owner_id)) return;
      if (fromTerritory.unit_count < 2) {
        return emitGameError(socket, GameErrorCode.INSUFFICIENT_UNITS, 'Not enough units to attack');
      }

      const connection = map.connections.find(
        (c) => (c.from === fromId && c.to === toId) || (c.from === toId && c.to === fromId)
      );
      if (!connection) return emitGameError(socket, GameErrorCode.NOT_ADJACENT, 'Territories not adjacent');
      if (isJumpGateOnlyEdge(map, fromId, toId)) {
        return emitGameError(
          socket,
          GameErrorCode.INVALID_TERRITORY,
          'A Jump Gate lane moves your own units — it cannot carry an attack',
        );
      }
      // A Surge Projector lane carries its owner's one crossing and nothing else.
      if (
        isSurgeProjectorOnlyEdge(map, fromId, toId)
        && !surgeProjectorCarries(state, currentPlayer.player_id, fromId, toId)
      ) {
        return emitGameError(
          socket,
          GameErrorCode.INVALID_TERRITORY,
          'A Surge Projector lane carries one crossing, from the gateway that opened it, this attack phase',
        );
      }
      if (connection.type === 'sea') {
        // The crossing pays fleet losses and bombardment per attack; an
        // auto-repeat would burn a navy on one click. Same exclusion the AI
        // grind makes for itself.
        return emitGameError(socket, GameErrorCode.ACTION_FAILED, 'Sea assaults resolve one attack at a time');
      }
      if (getDailyPuzzleSpec(state)) {
        return emitGameError(socket, GameErrorCode.ACTION_FAILED, 'Daily challenges grade each attack as its own move');
      }

      if (connectionRequiresMoonAccess(map, fromId, toId)) {
        const access = getOrbitAccessResult(state, currentPlayer, map, state.era);
        if (!access.allowed) {
          return emitGameError(socket, GameErrorCode.ACCESS_DENIED, formatOrbitAccessError(access));
        }
        if (
          isLaneSealedForPlayer(state, fromId, toId, currentPlayer.player_id)
          && !consumeSealBreaker(currentPlayer, fromId)
        ) {
          return emitGameError(socket, GameErrorCode.LANE_SEALED, 'That hyperspace lane is sealed');
        }
      }

      // Neutral off-world garrisons (the Moon, neutral galaxy worlds) need orbit
      // access too — executeLandAttack refuses them without
      // `neutralOffworldCaptureAllowed`, but a bare null outcome surfaces as the
      // generic 'Invalid attack'. Attacks along a `land` edge between two Moon
      // tiles never reach the orbit-edge gate above, so say why here instead.
      if (!toTerritory.owner_id && !!toTerritory.world_id && toTerritory.world_id !== 'earth') {
        const access = getOrbitAccessResult(state, currentPlayer, map, state.era);
        if (!access.allowed) {
          return emitGameError(socket, GameErrorCode.ACCESS_DENIED, formatOrbitAccessError(access));
        }
      }

      // Truce: refused until the player confirms the break, as a single attack is.
      const defenderPlayer = state.players.find((p) => p.player_id === toTerritory.owner_id);
      if (refuseUnconfirmedTruceBreak(socket, state, userId, defenderPlayer?.player_id, breakTruce)) return;
      // Confirmed: the first exchange is the attack that breaks it, fought at +1 defense die.
      const breaksTruce = !!activeTruceBetween(state, userId, defenderPlayer?.player_id);

      // Retaliation die: consumed exactly as one manual attack would consume it
      // — spliced now, applied to the first exchange only.
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

      if (toTerritory.owner_id) {
        currentPlayer.last_attacked_player_id = toTerritory.owner_id;
      }

      const attackProbBefore = captureProbBefore(state, userId);
      const defenderIdBeforeCombat = toTerritory.owner_id;
      const attackerUnitsCommitted = fromTerritory.unit_count;

      // Per-exchange one-shot bookkeeping mirrors what N manual attacks do.
      // These are set in the bonus callback and read after the exchange
      // resolves — the loop runs both strictly in order.
      let exchangeWasBlitzkriegBonus = false;
      let exchangeMarchBonus = 0;
      const blitz = executeBlitzAttack(state, userId, fromId, toId, {
        connection,
        neutralOffworldCaptureAllowed: getOrbitAccessResult(state, currentPlayer, map, state.era).allowed,
        onCapture: (s) => {
          // Classic Risk: at most one territory card per turn.
          if (!currentPlayer.card_earned_this_turn) {
            drawCard(s, userId);
            currentPlayer.card_earned_this_turn = true;
          }
        },
        extraAttackBonuses: (i) => {
          exchangeWasBlitzkriegBonus =
            !!state.blitzkrieg_active
            && (state.blitzkrieg_bonus_attacks_remaining ?? 0) > 0
            && state.blitzkrieg_bonus_source_id === fromId;
          exchangeMarchBonus = getMarchToSeaBonus(currentPlayer, fromId);
          return {
            truce_retaliation: i === 0 ? truceRetaliationBonus : 0,
            blitzkrieg: exchangeWasBlitzkriegBonus ? 1 : 0,
            march_to_sea: exchangeMarchBonus,
          };
        },
        extraDefenseBonuses: (i) => ({ truce_break: i === 0 && breaksTruce ? 1 : 0 }),
        onExchangeResolved: (outcome) => {
          const exchangeCaptured = outcome.result.territory_captured;
          // A capture re-arms blitzkrieg BEFORE the consume step — the same
          // order game:attack applies them in.
          if (exchangeCaptured && state.blitzkrieg_active && (state.blitzkrieg_bonus_attacks_remaining ?? 0) > 0) {
            state.blitzkrieg_bonus_source_id = fromId;
          }
          if (exchangeWasBlitzkriegBonus) {
            const remaining = (state.blitzkrieg_bonus_attacks_remaining ?? 1) - 1;
            state.blitzkrieg_bonus_attacks_remaining = remaining;
            state.blitzkrieg_attacked = true;
            if (remaining <= 0) {
              state.blitzkrieg_active = false;
              state.blitzkrieg_bonus_source_id = null;
            } else if (!exchangeCaptured) {
              state.blitzkrieg_bonus_source_id = null;
            }
          }
          recordMarchToSeaResult(currentPlayer, exchangeMarchBonus > 0, toId, exchangeCaptured);
        },
      });
      if (!blitz) {
        return emitGameError(socket, GameErrorCode.ACTION_FAILED, 'Invalid attack');
      }
      if (breaksTruce) breakTruceAndAlert(io, state, currentPlayer, defenderPlayer?.player_id);
      const result = blitz.result;
      const firstExchange = blitz.exchanges[0];
      const lastExchange = blitz.exchanges[blitz.exchanges.length - 1];

      // One-shot buffs (air strike, extra die, ignore-building) were consumed
      // by the FIRST exchange; visuals and callouts read from there.
      if (firstExchange.preAttackDamageApplied > 0) {
        emitPreAttackAirStrikeVisuals(io, gameId, {
          preAttackDamage: firstExchange.preAttackDamageApplied,
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
          attackBuffs: firstExchange.attackBuffs,
          abilityUses: currentPlayer.ability_uses,
          rawAttackerLosses: firstExchange.rawAttackerLosses,
        }),
      );

      const defenderId = defenderIdBeforeCombat;
      recordCombatResult(gameId, userId, defenderId ?? null, result, { isSea: false });

      let defenderEliminated = false;
      if (blitz.captured) {
        const capturingPlayer = state.players.find((p) => p.player_id === userId);
        if (capturingPlayer) {
          capturingPlayer.territories_captured_this_turn = (capturingPlayer.territories_captured_this_turn ?? 0) + 1;
          if ((capturingPlayer.territories_captured_this_turn) > (capturingPlayer.territories_captured_turn_max ?? 0)) {
            capturingPlayer.territories_captured_turn_max = capturingPlayer.territories_captured_this_turn;
          }
        }
        if (lastExchange.defenderEliminated) {
          defenderEliminated = true;
          const eliminatedPlayer = state.players.find((p) => p.player_id === defenderId);
          if (eliminatedPlayer) {
            recordElimination(gameId, userId);
            io.to(gameId).emit('game:player_eliminated', {
              playerId: defenderId,
              eliminatorId: userId,
              eliminatorName: currentPlayer.username,
              eliminatedName: eliminatedPlayer.username,
              secretMission: eliminatedPlayer.secret_mission ?? null,
            });
          }
        }
      }
      syncTerritoryCounts(state);

      const attackSummary = (() => {
        const fromName = territoryName(map, fromId);
        const toName = territoryName(map, toId);
        const outcome = blitz.captured
          ? `captured ${toName} in ${blitz.exchanges.length} exchange${blitz.exchanges.length === 1 ? '' : 's'}`
          : `failed after ${blitz.exchanges.length} exchange${blitz.exchanges.length === 1 ? '' : 's'} (lost ${result.attacker_losses})`;
        return `Blitzed ${fromName} → ${toName} with ${attackerUnitsCommitted} units; ${outcome}`;
      })();

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
      emitVisual(io, gameId, state, buildCombatMapVisual({
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
      if (result.territory_captured) await syncJumpGateLanesAfterCapture(io, gameId, state, map);
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
      const advancePuzzle = dailyV2Puzzle(room);

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
        // Daily v2: the draft as a whole is one decision, graded now.
        if (advancePuzzle) commitPuzzleDraft(advancePuzzle, state);
        // The turn's clock runs on: it covers draft, attack and fortify together.
      } else if (state.phase === 'attack') {
        // Daily v2: stopping is a move too.
        if (advancePuzzle) commitPuzzleEndAttack(advancePuzzle, state);
        state.phase = 'fortify';
        // A Surge Projector lane is an attack-phase lane: it closes now.
        await syncSurgeProjectorAndBroadcastMap(io, gameId, state, map);
      } else if (state.phase === 'fortify') {
        // Defensive reset: `advanceToNextPlayer` resets fortify_moves_used at
        // turn start, but we also clear it here so any code path that reads
        // the state between this advance and the next turn sees a clean
        // counter (matters for AI debugging and replay reconstruction).
        // Daily v2: ending the turn without a move is graded like any other.
        if (advancePuzzle) commitPuzzleEndTurn(advancePuzzle, state);
        state.fortify_moves_used = 0;
        advanceToNextPlayer(state, map);
        landPendingDropAssaults(io, gameId, state, map);
        await syncLaneWeatherAndBroadcastMap(io, gameId, room);
        broadcastTransitArrivals(io, gameId, state, map);
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
        } else {
          // Pauses a timed clock on a choice card; covers an away seat.
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
      if (!isSocketUsersTurn(state, userId, username)) return emitGameError(socket, GameErrorCode.NOT_YOUR_TURN, 'Not your turn');
      if (state.phase !== 'fortify') return emitGameError(socket, GameErrorCode.WRONG_PHASE, 'Not in fortify phase');

      const from = state.territories[fromId];
      const to = state.territories[toId];
      if (!from || from.owner_id !== userId || !to || to.owner_id !== userId) {
        return emitGameError(socket, GameErrorCode.NOT_OWNER, 'Invalid territories for fortification');
      }
      const fortifyUnitsError = getFortifyUnitsValidationError(units);
      if (fortifyUnitsError) {
        return emitGameError(socket, GameErrorCode.NON_INTEGER_UNITS, fortifyUnitsError);
      }
      if (units >= from.unit_count) {
        return emitGameError(socket, GameErrorCode.INSUFFICIENT_UNITS, 'Must leave at least 1 unit behind');
      }

      // Verify path exists via BFS, refusing orbit lanes this player cannot
      // cross. Checking only the from/to edge let a longer route through a lane
      // move troops between worlds with the orbit gate shut.
      const canTraverse = fortifyTraversalFilter(state, currentPlayer, map, state.era);
      // Drift Jump (Helion Navigators): once per turn, a fortify between two
      // owned gateway tiles on different worlds needs no connecting route — the
      // drift pilots cross the void between their own beacons. Applied
      // implicitly when an ordinary fortify would fail for lack of a path, so
      // the player just picks the two gateways.
      const driftFaction = state.settings.factions_enabled && currentPlayer.faction_id
        ? getPlayerFaction(state, currentPlayer)
        : undefined;
      let driftJump = false;
      if (
        driftFaction?.ability_id === DRIFT_JUMP_ABILITY_ID
        && !(currentPlayer.ability_uses ?? {})[DRIFT_JUMP_ABILITY_ID]
        && !pathExists(fromId, toId, state, map, userId, canTraverse)
      ) {
        const gateways = orbitGatewayTerritoryIds(map);
        driftJump = gateways.has(fromId) && gateways.has(toId) && from.world_id !== to.world_id;
      }
      if (!driftJump && !pathExists(fromId, toId, state, map, userId, canTraverse)) {
        // Distinguish "you own nothing in between" from "your only route is a
        // lane you cannot use" — the latter is the gate, and saying
        // "not connected" would send the player looking for the wrong problem.
        if (pathExists(fromId, toId, state, map, userId)) {
          const access = getOrbitAccessResult(state, currentPlayer, map, state.era);
          if (!access.allowed) {
            return emitGameError(socket, GameErrorCode.ACCESS_DENIED, formatOrbitAccessError(access));
          }
          return emitGameError(socket, GameErrorCode.LANE_SEALED, 'That hyperspace lane is sealed');
        }
        return emitGameError(socket, GameErrorCode.PATH_NOT_CONNECTED, 'No connected path between territories');
      }

      if (!driftJump && fortifyEndpointsRequireOrbitAccess(map, state.era, fromId, toId)) {
        const access = getOrbitAccessResult(state, currentPlayer, map, state.era);
        if (!access.allowed) {
          return emitGameError(socket, GameErrorCode.ACCESS_DENIED, formatOrbitAccessError(access));
        }
        if (isLaneSealedForPlayer(state, fromId, toId, currentPlayer.player_id)) {
          return emitGameError(socket, GameErrorCode.LANE_SEALED, 'That hyperspace lane is sealed');
        }
      }

      const fortifyMoveLimit = getFortifyMoveLimit(state, userId);
      const movesUsed = state.fortify_moves_used ?? 0;
      if (movesUsed >= fortifyMoveLimit) {
        return emitGameError(
          socket,
          GameErrorCode.FORTIFY_LIMIT,
          fortifyMoveLimit === 1
            ? 'You can only fortify once per turn.'
            : `Fortify limit reached (${fortifyMoveLimit} moves per turn)`,
        );
      }

      const fortifyProbBefore = captureProbBefore(state, userId);
      // Daily v2: graded by the position the move leaves.
      const fortifyPuzzle = dailyV2Puzzle(room);
      if (fortifyPuzzle) commitPuzzleFortify(fortifyPuzzle, state, fromId, toId, units);
      // Galaxy transit: a move between two WORLDS is a convoy — the units leave
      // now and land at this player's next turn start (state/transit.ts).
      const asConvoy = fortifyBecomesConvoy(state, fromId, toId, { driftJump });
      if (asConvoy) {
        launchConvoy(state, userId, fromId, toId, units);
      } else {
        from.unit_count -= units;
        to.unit_count += units;
      }
      state.fortify_moves_used = movesUsed + 1;
      if (driftJump) {
        currentPlayer.ability_uses = { ...(currentPlayer.ability_uses ?? {}), [DRIFT_JUMP_ABILITY_ID]: 1 };
      }
      commitActionDecision(
        gameId, state, userId, 'fortify',
        asConvoy
          ? `Sent ${units} unit${units === 1 ? '' : 's'} from ${territoryName(map, fromId)} to ${territoryName(map, toId)} — arrives next turn`
          : `Fortified ${territoryName(map, fromId)} → ${territoryName(map, toId)} with ${units} unit${units === 1 ? '' : 's'}`,
        fortifyProbBefore,
      );
      emitVisual(io, gameId, state, buildFortifyMapVisual({
        fromTerritoryId: fromId,
        toTerritoryId: toId,
        units,
        playerId: currentPlayer.player_id,
        state,
      }));
      // Confirm the move to the actor so the client shows its "Moved N troops"
      // toast only on success — never alongside a rejection error toast.
      socket.emit('game:fortify_result', { fromId, toId, units, inTransit: asConvoy });
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
        // The payload names the seat, so a client can tell its own redemption
        // from one it merely hears about (the AI path below broadcasts).
        socket.emit('game:cards_redeemed', { bonus, playerId: currentPlayer.player_id });
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

      // Tech gate (current-era research, or an inherited right from an era the
      // player has already left). Shared with the AI build loop so the two can
      // never drift apart.
      const techUnlocked = isBuildingTechUnlocked(state, userId, buildingType);

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
      if (buildingType === 'launch_pad') {
        await announceLaunchPadLane(io, gameId, room, currentPlayer, territoryId);
      }
      if (buildingType === 'jump_gate') {
        await announceJumpGateLanes(io, gameId, room, currentPlayer, territoryId);
      }
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
      if (await finishIfWon(io, gameId, state, map)) return;
      broadcastState(io, gameId, state);
      void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
      });
    });

    // ── Garrison doctrine (Galactic Age, state/garrisonDoctrines.ts) ──────────
    // Train a held tile's garrison Hardened or Forward for PP, in the draft or
    // fortify phase like a build. The validator is the one the AI and the sim
    // use, so the three can never disagree about who may buy what.
    socket.on('game:set_garrison_doctrine', async ({ gameId, territoryId, doctrine, action_id }: {
      gameId: string; territoryId: string; doctrine: GarrisonDoctrine; action_id?: string;
    }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
      if (!checkAndRecordActionId(gameId, userId, action_id)) return;
      const { state, map } = room;
      if (!isSocketUsersTurn(state, userId, username)) return socket.emit('error', { message: 'Not your turn' });
      if (state.phase !== 'draft' && state.phase !== 'fortify') {
        return socket.emit('error', { message: 'Garrisons can only be trained during draft or fortify phase' });
      }
      const validation = validateGarrisonDoctrine(state, userId, territoryId, doctrine);
      if (!validation.valid) {
        return socket.emit('error', { message: validation.error ?? 'Cannot train this garrison' });
      }
      const probBefore = captureProbBefore(state, userId);
      applyGarrisonDoctrine(state, userId, territoryId, doctrine);
      commitActionDecision(
        gameId, state, userId, 'build',
        `Trained a ${GARRISON_DOCTRINE_DISPLAY[doctrine].name} on ${territoryName(map, territoryId)}`,
        probBefore,
      );
      socket.emit('game:garrison_doctrine_result', { territoryId, doctrine, success: true });
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
    socket.on('game:naval_attack', async ({ gameId, fromId, toId, action_id, breakTruce }: {
      gameId: string; fromId: string; toId: string; action_id?: string; breakTruce?: boolean;
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
      if (refuseShieldedTarget(socket, state, userId, toTerritory.owner_id)) return;
      if (!fromTerritory.naval_units || fromTerritory.naval_units <= 0) {
        return socket.emit('error', { message: 'No fleets to attack with' });
      }
      if (toTerritory.naval_units == null) {
        return socket.emit('error', { message: 'Target is not a coastal territory' });
      }
      // An empty harbour has nothing to sink. This used to fight a phantom
      // ship (`naval_units || 1`), so an attacker could lose fleets to nothing.
      if (toTerritory.naval_units <= 0) {
        return socket.emit('error', { message: 'No enemy fleet to attack' });
      }

      // Validate sea connection
      const seaConnected = map.connections.some(
        (c) => c.type === 'sea' && ((c.from === fromId && c.to === toId) || (c.from === toId && c.to === fromId)),
      );
      if (!seaConnected) return socket.emit('error', { message: 'No sea connection' });

      // Truce: a Fleet Attack on a truce partner breaks it like a land attack,
      // once confirmed, and their fleet gets +1 die for this attack.
      if (refuseUnconfirmedTruceBreak(socket, state, userId, toTerritory.owner_id, breakTruce)) return;
      const truceBrokenDefenseDie = breakTruceAndAlert(io, state, currentPlayer, toTerritory.owner_id) ? 1 : 0;

      const navalAttackProbBefore = captureProbBefore(state, userId);
      const navalResult = resolveNavalCombat(fromTerritory.naval_units, toTerritory.naval_units, truceBrokenDefenseDie);
      fromTerritory.naval_units = Math.max(0, fromTerritory.naval_units - navalResult.attacker_losses);
      toTerritory.naval_units = Math.max(0, (toTerritory.naval_units ?? 0) - navalResult.defender_losses);

      commitActionDecision(
        gameId, state, userId, 'naval_attack',
        `Naval attack ${territoryName(map, fromId)} → ${territoryName(map, toId)} (${navalResult.attacker_won ? 'won' : 'lost'})`,
        navalAttackProbBefore,
      );
      io.to(gameId).emit('game:naval_combat_result', { fromId, toId, result: navalResult });
      queueSpectatorEvent(gameId, 'game:naval_combat_result', { fromId, toId, result: navalResult });
      emitVisual(io, gameId, state, buildNavalMapVisual({
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
      if (!isEraAdvancePhase(state.phase)) {
        return socket.emit('error', { message: 'Era advancement is only available during the reinforcement or fortify phase' });
      }

      const result = executeAdvanceEra(state, userId, room.map);
      if (!result.success) {
        return socket.emit('error', { message: result.error ?? 'Cannot advance era' });
      }

      const nextEraId = getEraIdForAdvancementIndex(state, currentPlayer.current_era_index ?? 0);
      emitVisual(io, gameId, state, buildEraAdvanceMapVisual({
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
      if (await finishIfWon(io, gameId, state, room.map)) return;
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
    socket.on('game:use_ability', async ({ gameId, abilityId, params, action_id, breakTruce }: {
      gameId: string;
      abilityId: string;
      params?: Record<string, unknown>;
      action_id?: string;
      breakTruce?: boolean;
    }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
      if (!checkAndRecordActionId(gameId, userId, action_id)) return;
      const { state, map } = room;

      const currentPlayer = state.players[state.current_player_index];
      if (!isSocketUsersTurn(state, userId, username)) return socket.emit('error', { message: 'Not your turn' });

      // Check ability cooldown (once per turn) — skip for once-per-game abilities
      // The game decides: WW2's atomic arsenal makes the bomb once per turn.
      const isGameScoped = isGameScopedAbility(abilityId, state);
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

      // The Moon's own powers (Lunar Export, Orbital Drop) are not tech unlocks:
      // holding lunar ground is the credential. Gating them on
      // sa_lunar_expansion would lock the Lunar Pioneers — who reach the Moon
      // from turn one without researching it — out of the Moon's own tier.
      // See moonPowers.ts hasMoonGroundAccess.
      const hasMoonGroundAbility = hasMoonGroundAccess(state, currentPlayer.player_id, abilityId);

      if (!hasFactionAbility && !hasTechAbility && !hasLegacyCharge && !hasMoonGroundAbility) {
        return socket.emit('error', { message: `Ability '${abilityId}' is not available to you` });
      }

      // A strike, bomb or Drop Assault on a truce partner's ground breaks the
      // truce like an attack, once confirmed. Refused before the use is recorded.
      const abilityTargetId = typeof params?.territoryId === 'string' ? params.territoryId : undefined;
      const hostileTargetOwnerId = abilityTargetId && isHostileTerritoryAbility(abilityId)
        ? state.territories[abilityTargetId]?.owner_id
        : null;
      if (refuseShieldedTarget(socket, state, userId, hostileTargetOwnerId)) return;
      if (refuseUnconfirmedTruceBreak(socket, state, userId, hostileTargetOwnerId, breakTruce)) return;

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

      // The strike went off, or the Drop Assault was declared: either breaks
      // any truce with the target's owner.
      breakTruceAndAlert(io, state, currentPlayer, hostileTargetOwnerId);

      if (execResult.effect === 'atom_bomb_detonated' && execResult.territoryId) {
        const previousOwner = execResult.previousOwner;
        if (previousOwner) {
          const prevPlayer = state.players.find((p) => p.player_id === previousOwner);
          if (prevPlayer && prevPlayer.territory_count === 0) {
            eliminatePlayer(prevPlayer, userId);
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
        // A winning bomb ends the game before anything is broadcast or saved:
        // the board used to go out, and be saved, in a live phase first.
        if (await finishIfWon(io, gameId, state, map)) return;
        broadcastState(io, gameId, state);
        void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
        return;
      }

      if (execResult.effect === 'space_station_launched' && execResult.territoryId) {
        recordAbility('Launched Space Station');
        const launchPayload = {
          playerId: userId,
          playerName: currentPlayer.username,
          playerColor: currentPlayer.color,
          launchTerritoryId: execResult.territoryId,
        };
        io.to(gameId).emit('game:space_station_launched', launchPayload);
        queueSpectatorEvent(gameId, 'game:space_station_launched', launchPayload);
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

      // Surge Projector opened its lane on the map copy: the room needs the map.
      if (execResult.effect === 'surge_projector_opened') await persistAndBroadcastMap(io, gameId, state, map);

      socket.emit('game:ability_result', { ...execResult, abilityId, success: true });
      broadcastState(io, gameId, state);
      void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
      });
    });

    // ── Influence (Cold War / Risorgimento era ability) ──────────────────────
    // Converts a neutral or enemy territory within influence_range hops of any
    // owned territory, costing 3 of the current player's units (spread across
    // adjacent owned territories). Only one use per turn.
    socket.on('game:influence', async ({ gameId, targetId, action_id, breakTruce }: { gameId: string; targetId: string; action_id?: string; breakTruce?: boolean }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
      if (!checkAndRecordActionId(gameId, userId, action_id)) return;
      const { state, map } = room;

      const currentPlayer = state.players[state.current_player_index];
      if (!isSocketUsersTurn(state, userId, username)) return socket.emit('error', { message: 'Not your turn' });
      if (state.phase !== 'attack') return socket.emit('error', { message: 'Influence can only be used in the attack phase' });

      const modifiers = getPlayerEraModifiers(state, currentPlayer.player_id);
      const canInfluence = modifiers.influence_spread || modifiers.carbonari_network;
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
      if (refuseShieldedTarget(socket, state, userId, target.owner_id)) return;
      // Seizing a truce partner's territory breaks the truce like an attack,
      // once confirmed. Refused before Papal Dispensation spends its charge.
      if (refuseUnconfirmedTruceBreak(socket, state, userId, target.owner_id, breakTruce)) return;

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
        !!modifiers.carbonari_network &&
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
      breakTruceAndAlert(io, state, currentPlayer, previousOwner);
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
          eliminatePlayer(prevPlayer, userId);
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

      emitVisual(io, gameId, state, buildInfluenceMapVisual({
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
      queueSpectatorEvent(gameId, 'game:influence_result', influenceResultPayload);
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
      queueSpectatorEvent(gameId, 'game:event_card_resolved', { cardId: eventCardId });
      broadcastState(io, gameId, state);
      // Restart turn timer now that the blocking event choice is resolved (human players only)
      if (!room.state.players[room.state.current_player_index].is_ai) {
        if (!room.state.settings.async_mode) {
          startTurnTimer(io, gameId, room.state, room.map);
        } else if (room.state.phase_deadline_at == null) {
          // An async day has run since the turn opened, card or not:
          // restarting it would grant a fresh one and tell the player again.
          // A turn with no deadline was paused on its card before days ran
          // through cards. It gets its day now, without telling a player who
          // is here to answer.
          startTurnTimer(io, gameId, room.state, room.map, { notify: false });
        }
      }
      });
    });

    // ── Set Coaching ─────────────────────────────────────────────────────────
    // Mid-game toggle for in-turn coaching. Only the (single) human player in
    // an eligible game can flip this. Server enforces eligibility; ineligible
    // games silently no-op so a tampered client can't enable coaching in a
    // multi-human or ranked match.
    // ── Daily v2: what is this move worth? (docs/DAILY_PUZZLE_V2.md §5.4) ──
    // Answered from the day's exact solver before the dice; the client shows
    // the verdict card and either commits the real action or takes back. On a
    // silent day (Friday) nothing is answered and every move is graded on
    // commit alone. Never a game mutation beyond the decision record.
    socket.on('game:puzzle_propose', async ({ gameId, proposal }: { gameId: string; proposal: unknown }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
        const { state } = room;
        if (!isSocketUsersTurn(state, userId, username)) return emitGameError(socket, GameErrorCode.NOT_YOUR_TURN, 'Not your turn');
        const puzzle = dailyV2Puzzle(room);
        const parsed = sanitizeProposal(proposal);
        if (!puzzle || !parsed) {
          socket.emit('game:puzzle_verdict', { gameId, decision: false, silent: !puzzle });
          return;
        }
        const verdict = proposePuzzleAction(puzzle, state, parsed);
        socket.emit('game:puzzle_verdict', { gameId, ...verdict });
        void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
      });
    });

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
      } else {
        const rejection = lobbySettingVoteRejection({
          era_id: lobby.game.era_id,
          map_id: lobby.game.map_id,
          settings: lobby.settings,
          setting: settingKey,
          value: parsedValue,
        });
        if (rejection) return socket.emit('error', { message: rejection });
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
        // Say what else the change turns on, so nobody votes for it blind.
        displayValue: [definition.displayValue(parsedValue), lobbyVoteBringsAlong(lobby.settings, settingKey, parsedValue)]
          .filter(Boolean)
          .join(' — '),
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
          // Other votes may have passed since this one was proposed.
          const rejection = lobbySettingVoteRejection({
            era_id: lobby.game.era_id,
            map_id: lobby.game.map_id,
            settings: lobby.settings,
            setting: proposal.setting,
            value: proposal.proposedValue,
          });
          if (rejection) {
            const rest = proposals.filter((entry) => entry.id !== proposal.id);
            if (rest.length > 0) lobbyProposalsByGame.set(gameId, rest);
            else lobbyProposalsByGame.delete(gameId);
            await emitLobbyProposalUpdates(io, gameId, lobby);
            return socket.emit('error', { message: `That proposal can no longer pass: ${rejection}` });
          }
          const normalized = normalizeGameSettings(
            applyLobbySettingVote(lobby.settings, proposal.setting, proposal.proposedValue),
          );
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
      // Always detach from the room — even when there is no in-memory state —
      // so the client stops receiving room broadcasts.
      socket.leave(gameId);

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

      // Bring the Postgres backup up to date. Never a save of `state`: this
      // handler holds no lock, and that copy predates any move made since.
      flushPendingPostgresSave(gameId);

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
      // Allies already never fight (state/teams.ts): a truce between them would say nothing.
      if (areAllies(state, proposer.player_id, target.player_id)) return socket.emit('error', { message: 'You are already allies' });
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

      emitToPlayer(io, gameId, targetPlayerId, 'game:truce_proposal', {
        proposerId: userId,
        proposerName: proposer.username,
        proposerColor: proposer.color,
      });

      socket.emit('game:truce_result', { pending: true, targetName: target.username });
      void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
      });
    });

    // ── Seal an orbit lane ────────────────────────────────────────────────────
    // One event, two mechanics (see canSealLane): the Space Age Orbital Blockade
    // is a He-3 purchase open to anyone holding an anchor lane's end, and the
    // Galactic Age Emergency Seal is a once-per-turn faction charge that costs
    // nothing. The era decides which rules apply, so the charge is only spent —
    // and only demanded — where it exists.
    socket.on('game:seal_lane', async ({ gameId, fromId, toId, action_id }: { gameId: string; fromId: string; toId: string; action_id?: string }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
        if (!checkAndRecordActionId(gameId, userId, action_id)) return;
        const { state, map } = room;
        if (!isSocketUsersTurn(state, userId, username)) return socket.emit('error', { message: 'Not your turn' });
        if (state.phase !== 'attack' && state.phase !== 'fortify') {
          return socket.emit('error', { message: 'Seal lanes during your attack or fortify phase' });
        }
        const currentPlayer = state.players[state.current_player_index];
        const viaEmergencySeal = state.era !== 'space_age';
        const sealFaction = viaEmergencySeal && state.settings.factions_enabled && currentPlayer?.faction_id
          ? getPlayerFaction(state, currentPlayer)
          : undefined;
        // The Vault holder (any faction) may seal ANY lane; the Custodians'
        // faction charge is limited to lanes touching Nexus. One charge a turn.
        const check = canSealLane(state, map, fromId, toId, userId, sealFaction?.ability_id, {
          vaultHolder: viaEmergencySeal && playerHoldsVaultSeal(state, userId),
        });
        if (!check.ok || !check.laneId) {
          return socket.emit('error', { message: check.error ?? 'Cannot seal that lane' });
        }
        if (viaEmergencySeal) {
          // Emergency Seal is the faction's once-per-turn charge; it shares the
          // ability_uses ledger so the HUD and the AI parity path see it spent.
          const sealUses = currentPlayer.ability_uses ?? {};
          if (sealUses[EMERGENCY_SEAL_ABILITY_ID]) {
            return socket.emit('error', { message: 'Emergency Seal already used this turn' });
          }
          currentPlayer.ability_uses = { ...sealUses, [EMERGENCY_SEAL_ABILITY_ID]: 1 };
        }
        if (!state.lane_blockades) state.lane_blockades = {};
        // Space Age seals cost He-3 and last two rounds; the Galaxy's are free
        // and last one (laneSealDuration). canSealLane has already checked
        // affordability.
        const sealCost = laneSealHelium3Cost(state);
        if (sealCost > 0) {
          const sealer = state.players.find((p) => p.player_id === userId);
          if (sealer) sealer.helium3 = (sealer.helium3 ?? 0) - sealCost;
        }
        state.lane_blockades[check.laneId] = {
          owner_id: userId,
          turns_remaining: laneSealDuration(state),
          tick: laneSealTick(state),
        };
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
      // An offer lapses once either side is out of the game. Accepting one set a
      // truce with a player no longer playing, and credited both sides with it.
      if (proposer?.is_eliminated || target?.is_eliminated) {
        void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
        return socket.emit('error', { message: 'That truce offer has lapsed: a player in it is out of the game' });
      }

      if (accepted && proposer && target) {
        const entry = state.diplomacy.find(
          (e) =>
            (e.player_index_a === proposer.player_index && e.player_index_b === target.player_index) ||
            (e.player_index_a === target.player_index && e.player_index_b === proposer.player_index),
        );
        if (entry) agreeTruce(state, entry);
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

    // ── Accept the bots' surrender ────────────────────────────────────────
    // Offered on the player's own turn while they are clearly winning a game
    // against bots (victory/surrender.ts). The offer is checked again here on
    // the authoritative state; the client's banner is only a prompt.
    socket.on('game:accept_surrender', async ({ gameId, action_id }: { gameId: string; action_id?: string }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
        if (!checkAndRecordActionId(gameId, userId, action_id)) return;
        const { state } = room;
        if (!featureFlags.surrenderOffersEnabled || !acceptSurrender(state, userId)) {
          return socket.emit('error', { message: 'No surrender is on offer' });
        }
        await finalizeGame(io, gameId, state, [userId]);
        broadcastState(io, gameId, state);
      });
    });

    // ── Resign ────────────────────────────────────────────────────────────
    socket.on('game:resign', async ({ gameId, action_id }: { gameId: string; action_id?: string }) => {
      await mutateLockedRoom(gameId, socket, 5000, async (room) => {
      if (!checkAndRecordActionId(gameId, userId, action_id)) return;
      const { state, map } = room;

      const player = state.players.find((p) => p.player_id === userId);
      if (!player || player.is_eliminated) return socket.emit('error', { message: 'Cannot resign' });

      // Eliminated by nobody; their territories turn neutral at half strength.
      resignSeat(state, userId);

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
        // A team game credits the leading side but the resigner's (teamVictory.ts).
        const teamWinners = isTeamGame(state) ? concededTeamWinners(state, userId) : null;
        const inGraceWindow = state.turn_number <= RESIGN_GRACE_TURNS;
        const haveAiWinner = isTeamGame(state) ? teamWinners != null : survivingAi.length > 0;

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
          // Spectators run on the delayed feed; a slim end-signal lands when
          // their board reaches the final state (client only navigates on it).
          queueSpectatorEvent(gameId, 'game:over', {
            winner_ids: [],
            victory_condition: 'abandoned' as const,
            turn_count: state.turn_number,
          });
          broadcastState(io, gameId, state);
          return;
        }

        // Out of grace window: credit the leading surviving AI with the win
        // and run the normal finalize path so the resigner takes a real loss.
        // The condition is 'resignation', not 'last_standing' — nobody was
        // eliminated, and the defeat screen should say what actually happened.
        const creditedWinners = teamWinners ?? [survivingAi[0]!.player_id];
        state.phase = 'game_over';
        state.winner_id = creditedWinners[0]!;
        state.winner_ids = creditedWinners;
        state.victory_condition = 'resignation';
        await finalizeGame(io, gameId, state, creditedWinners);
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
        // A resignation that leaves one commander standing is still a
        // resignation: nobody was eliminated, and the game-over screen should
        // say so rather than "all opponents eliminated".
        state.victory_condition = condition === 'last_standing' ? 'resignation' : condition;
        await finalizeGame(io, gameId, state, winnerIds);
        broadcastState(io, gameId, state);
        return;
      }

      // Game continues — advance turn if it was this player's turn.
      const currentPlayer = state.players[state.current_player_index];
      if (currentPlayer.player_id === userId && state.phase === 'territory_select') {
        // Territory Draft: pass the pick, as a claim or a timeout does. The
        // turn hand-off below would end the draft, leaving the unclaimed tiles
        // neutral at 0 units and no capitals, stability or opening income.
        // The resigner's tiles went back to the pool above.
        passSelectionPick(state);
        if (state.players[state.current_player_index].is_ai) {
          clearTurnTimer(gameId, state);
          setTimeout(() => processAiTerritorySelect(io, gameId), 800);
        } else {
          startTurnTimer(io, gameId, state, map);
        }
      } else if (currentPlayer.player_id === userId) {
        advanceToNextPlayer(state, map);
        landPendingDropAssaults(io, gameId, state, map);
        await syncLaneWeatherAndBroadcastMap(io, gameId, room);
        broadcastTransitArrivals(io, gameId, state, map);
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
        // The resigner's clock stops with their turn: left running, it timed
        // out the next player's phase at the resigner's deadline.
        if (state.players[state.current_player_index].is_ai) {
          clearTurnTimer(gameId, state);
          setTimeout(() => processAiTurn(io, gameId), 1500);
        } else {
          // Pauses a timed clock on a choice card; covers an away seat.
          startTurnTimer(io, gameId, state, map);
        }
      }

      await saveGameState(gameId, state);
      broadcastState(io, gameId, state);
      maybeEmitCoachingTip(io, gameId, state, map);
      });
    });

    // ── Disconnect ──────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`[Socket] Disconnected: ${userId} (${socket.id})`);

      // Clean up spectator count
      const spectatingGameId = socket.data?.spectating as string | undefined;
      if (spectatingGameId) {
        void removeSpectatorSocket(io, socket, spectatingGameId).catch(() => {});
      }

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
            // As in game:leave: no lock here, so never save the loaded copy.
            flushPendingPostgresSave(gameId);
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
            if ((await markSeatAway(io, gameId, departedPlayerId)) === 'contended') {
              scheduleAwayRetry(io, gameId, departedPlayerId);
            }
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
 * End the game now if the move just made won it. For a move that can complete
 * a win without taking a territory (a wonder built or an era reached, which
 * Transcendence needs): checking only at the next hand-off left the incoming
 * player's turn start (income, events, rebellions) to run on a won board first.
 */
async function finishIfWon(io: Server, gameId: string, state: GameState, map: GameMap): Promise<boolean> {
  const victory = checkVictory(state, map);
  if (!victory) return false;
  state.phase = 'game_over';
  state.winner_id = victory.winnerIds[0]!;
  state.winner_ids = victory.winnerIds;
  state.victory_condition = victory.condition;
  await finalizeGame(io, gameId, state, victory.winnerIds);
  broadcastState(io, gameId, state);
  return true;
}

/**
 * After advanceToNextPlayer, if an event card was drawn, broadcast it and clear
 * instant (no-choice) events. Choice-based events stay on state until resolved.
 * Call this BEFORE the hand-off is saved: a state saved with an instant card
 * still active reloads with it, and the next hand-off applied it again.
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
  queueSpectatorEvent(gameId, 'game:event_card', card);

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
  /** Whose units they are, when the turn has already passed on. */
  playerId = state.players[state.current_player_index]?.player_id,
): void {
  if (!playerId) return;
  for (const row of placements) {
    emitVisual(io, gameId, state, buildReinforceMapVisual({
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
  | { ok: false; code: 'NOT_FOUND' | 'ALREADY_STARTED' | 'INVALID_STATUS' | 'MAP_NOT_FOUND' | 'SEAT_COUNT'; error: string };

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

  // The Galactic Age deals a board for two to eight seats and no other count
  // (lobbyCapacity.ts). Create and join hold a lobby to that; this catches the
  // rest — a host alone, with no AI and nobody joined.
  if (isGalacticAgeGame(game.era_id, game.map_id)) {
    const seatError = galaxySeatCountError(players.length);
    if (seatError) return { ok: false, code: 'SEAT_COUNT', error: seatError };
  }

  // Load map (tutorial maps are hardcoded; others from Postgres via getMapById)
  const gameMap = await resolveMap(game.map_id);
  if (!gameMap) return { ok: false, code: 'MAP_NOT_FOUND', error: 'Map not found' };

  // What each human wears, fixed for the match (none with store_v2_enabled off).
  const cosmetics = await loadMatchCosmetics(
    players.flatMap((p) => (p.user_id && !p.is_ai ? [p.user_id] : [])),
  );

  // Bot commanders (ai_personalities_enabled, baked at create): a name for
  // every bot seat, and a style for those at Medium and up, as the lobby
  // showed them (ai/aiStyles.ts seatCommanders).
  const commanders = seatCommanders(game.game_id, game.settings_json as GameState['settings'] | null, players);

  const playerStates = players.map((p) => ({
    player_id: p.user_id ?? `ai_${p.player_index}`,
    player_index: p.player_index,
    username: p.username ?? commanders[p.player_index]?.username ?? aiPlayerName(p.player_index),
    ...(p.is_ai && commanders[p.player_index]?.ai_style ? { ai_style: commanders[p.player_index]!.ai_style } : {}),
    color: p.player_color,
    is_ai: p.is_ai,
    ai_difficulty: (p.ai_difficulty as AiDifficulty) ?? undefined,
    is_eliminated: false,
    mmr: 1000,
    faction_id: p.faction_id ?? undefined,
    ...(p.user_id && !p.is_ai && cosmetics.has(p.user_id) ? { cosmetics: cosmetics.get(p.user_id) } : {}),
  }));

  const settings = game.settings_json as GameState['settings'];
  const state = initializeGameState(game.game_id, game.era_id as GameState['era'], gameMap, playerStates, settings);

  const humanSeatId = playerStates.find((p) => !p.is_ai)?.player_id ?? null;
  const aiSeat = playerStates.find((p) => p.is_ai);
  const aiSeatId = aiSeat ? (aiSeat.player_id ?? `ai_${aiSeat.player_index}`) : null;

  const puzzleSpec = getDailyPuzzleSpec(state);
  if (puzzleSpec && humanSeatId) {
    applyDailyPuzzleScenario(state, gameMap, puzzleSpec, humanSeatId, aiSeatId ?? `ai_1`);
    if (puzzleSpec.v2) {
      // Daily v2: solve the opening now, off this tick, so the first verdict
      // is a memo hit rather than a stall on the player's first click.
      setImmediate(() => {
        try {
          warmPuzzle(puzzleSpec, gameMap);
        } catch (err) {
          console.error('[daily v2] warm-up failed', err);
        }
      });
    }
  }

  // Authored opening position, after the puzzle shaper so a scenario can refine
  // a puzzle board, and before the module boost so a boost still tops up grants.
  applyAuthoredScenario(state, gameMap, state.settings.authored_scenario, humanSeatId, aiSeatId);

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

  // "The Long Game" onboarding quest: starting a multi-day async game against
  // at least one other human. Credited to every human seat — both players are
  // starting their first async game. Fire-and-forget like the other quest hooks.
  if (state.settings.async_mode && humanCount >= 2) {
    for (const player of state.players) {
      if (!player.is_ai) {
        checkOnboardingQuests(player.player_id, 'async_start').catch(() => {});
      }
    }
  }

  recordServerEvent('game_started', {
    game_id: gameId,
    map_id: state.map_id,
    human_count: humanCount,
    ai_count: aiPlayerCount,
    // The game's bot level, the highest among its bots (null with none), so a
    // start can be read against its finish, or its absence, by level.
    ai_difficulty: gameAiDifficulty(state.players),
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
      /**
       * Persist the arriving board, do not just cache it. `setCachedRoom` is
       * this process's memory: another Socket.io instance, or this one after an
       * eviction, reloads the map from Redis — which still held the departing
       * era's. The state had already been rewritten to the new board, so the two
       * disagreed about which territories exist (server 36, client 6). The
       * `games.map_id` column backs the Postgres recovery path and is written
       * once at creation, so it needs the same update; `mapIdForSavedState`
       * prefers the state's own id if this ever fails.
       */
      await saveGameMapAuthoritative(gameId, outcome.map);
      await query('UPDATE games SET map_id = $1 WHERE game_id = $2', [state.map_id, gameId])
        .catch((err) => console.error('[Room] board-transform map_id update failed', gameId, err));
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

/**
 * A new Launch Pad opens an orbit lane in the game's map copy. The lane has to
 * reach every consumer of `map.connections` — adjacency checks, the AI planner,
 * the client's target picker and both map renderers — so the map is persisted
 * and re-sent rather than each of them learning about virtual edges. Only fires
 * when the pad actually added a lane (a pad on the Moon, or one beside an
 * authored spaceport already linked to the same landing zone, adds nothing).
 */
async function announceLaunchPadLane(
  io: Server,
  gameId: string,
  room: ActiveGameRoom,
  builder: PlayerState,
  territoryId: string,
): Promise<void> {
  const { state, map } = room;
  if (!state.territories[territoryId]?.buildings?.includes('launch_pad')) return;
  if (!syncLaunchPadLanes(map, state)) return;
  await saveGameMapAuthoritative(gameId, map).catch((err) =>
    console.error('[Room] launch pad lane persist failed', gameId, err),
  );
  io.to(gameId).emit('game:map', {
    mapId: state.map_id,
    map: projectMapToEraFloor(map, state.map_era_floor ?? 0),
  });
  const zone = nearestLandingZoneFor(map, territoryId);
  const lane = map.connections.find(
    (c) => c.source === 'launch_pad' && (c.from === territoryId || c.to === territoryId),
  );
  const moonTargetId = lane ? (lane.from === territoryId ? lane.to : lane.from) : zone?.moonTarget;
  if (!moonTargetId) return;
  const payload = {
    kind: 'launch_pad' as const,
    playerId: builder.player_id,
    playerName: builder.username,
    playerColor: builder.color,
    territoryId,
    moonTargetId,
  };
  io.to(gameId).emit('game:orbit_lane_opened', payload);
  queueSpectatorEvent(gameId, 'game:orbit_lane_opened', payload);
}

/**
 * A Jump Gate has just gone up: project its new lane(s) onto the game's map copy,
 * persist, and tell the room. Mirrors `announceLaunchPadLane` — same map-authority
 * and projection discipline — but a gate can open SEVERAL lanes at once (one per
 * other world the builder holds a gate on), so each gets its own notice.
 */
async function announceJumpGateLanes(
  io: Server,
  gameId: string,
  room: ActiveGameRoom,
  builder: PlayerState,
  territoryId: string,
): Promise<void> {
  const { state, map } = room;
  if (!state.territories[territoryId]?.buildings?.includes('jump_gate')) return;
  if (!syncJumpGateLanes(map, state)) return;
  await saveGameMapAuthoritative(gameId, map).catch((err) =>
    console.error('[Room] jump gate lane persist failed', gameId, err),
  );
  io.to(gameId).emit('game:map', {
    mapId: state.map_id,
    map: projectMapToEraFloor(map, state.map_era_floor ?? 0),
  });
  for (const partnerId of jumpGatePartners(state, territoryId)) {
    const payload = {
      kind: 'jump_gate' as const,
      playerId: builder.player_id,
      playerName: builder.username,
      playerColor: builder.color,
      territoryId,
      moonTargetId: partnerId,
    };
    io.to(gameId).emit('game:orbit_lane_opened', payload);
    queueSpectatorEvent(gameId, 'game:orbit_lane_opened', payload);
  }
}

/**
 * A capture can take a Jump Gate lane with it: the gate razed, or, under orbital
 * infrastructure, its links cut while the building passes to the captor
 * (`severJumpGateLinks`). Project that onto the game's map copy, persist, and
 * push the new map, so the chart stops drawing a lane nobody can use and the
 * bots stop reading across it. Same discipline as `announceJumpGateLanes`,
 * without the opening notices. No-op when the capture touched no gate.
 */
async function syncJumpGateLanesAfterCapture(
  io: Server,
  gameId: string,
  state: GameState,
  map: GameMap,
): Promise<void> {
  // A capture can also close a Surge Projector lane: taking its far gateway is
  // the one crossing it carries (state/surgeProjector.ts). No-op without one.
  const gatesChanged = syncJumpGateLanes(map, state);
  const surgeChanged = syncSurgeProjectorLanes(map, state);
  if (!gatesChanged && !surgeChanged) return;
  await saveGameMapAuthoritative(gameId, map).catch((err) =>
    console.error('[Room] jump gate lane persist failed', gameId, err),
  );
  io.to(gameId).emit('game:map', {
    mapId: state.map_id,
    map: projectMapToEraFloor(map, state.map_era_floor ?? 0),
  });
}

/**
 * Persist the game's map copy and push it to the room, for a change already
 * projected onto it (the Surge Projector opens its lane inside the ability).
 */
async function persistAndBroadcastMap(io: Server, gameId: string, state: GameState, map: GameMap): Promise<void> {
  await saveGameMapAuthoritative(gameId, map).catch((err) =>
    console.error('[Room] map persist failed', gameId, err),
  );
  io.to(gameId).emit('game:map', {
    mapId: state.map_id,
    map: projectMapToEraFloor(map, state.map_era_floor ?? 0),
  });
}

/**
 * The attack phase ended: a Surge Projector lane closes with it, so it can
 * carry no fortify. No-op (and no broadcast) when none was open.
 */
async function syncSurgeProjectorAndBroadcastMap(io: Server, gameId: string, state: GameState, map: GameMap): Promise<void> {
  if (!syncSurgeProjectorLanes(map, state)) return;
  await persistAndBroadcastMap(io, gameId, state, map);
}

/**
 * Lane weather changed the graph (a surge opened, or one blew over): project it
 * onto the game's map copy, persist, and push the new map to the room. Called
 * after every turn advance, because weather ages with the round rather than with
 * an action. No-op when nothing changed, which is almost always.
 */
async function syncLaneWeatherAndBroadcastMap(
  io: Server,
  gameId: string,
  room: ActiveGameRoom,
): Promise<void> {
  const { state, map } = room;
  // The turn advance also clears a Surge Projector lane (advanceToNextPlayer);
  // the map copy drops it here. No-op without one.
  const weatherChanged = syncLaneWeatherLanes(map, state);
  const surgeChanged = syncSurgeProjectorLanes(map, state);
  if (!weatherChanged && !surgeChanged) return;
  await saveGameMapAuthoritative(gameId, map).catch((err) =>
    console.error('[Room] lane weather persist failed', gameId, err),
  );
  io.to(gameId).emit('game:map', {
    mapId: state.map_id,
    map: projectMapToEraFloor(map, state.map_era_floor ?? 0),
  });
}

/**
 * Convoys that just landed (or turned back, or were lost) at the incoming
 * player's turn start. Told to the whole room: a convoy is a public commitment,
 * so its outcome is public too.
 */
function broadcastTransitArrivals(io: Server, gameId: string, state: GameState, map: GameMap): void {
  const arrivals = state.last_transit_arrivals;
  if (!arrivals || arrivals.length === 0) return;
  const owner = state.players.find((p) => p.player_id === arrivals[0].convoy.owner_id);
  for (const { convoy, outcome } of arrivals) {
    const payload = {
      playerId: convoy.owner_id,
      playerName: owner?.username ?? convoy.owner_id,
      playerColor: owner?.color ?? '#ffffff',
      fromId: convoy.from,
      toId: convoy.to,
      fromName: territoryName(map, convoy.from),
      toName: territoryName(map, convoy.to),
      units: convoy.units,
      outcome,
    };
    io.to(gameId).emit('game:transit_arrived', payload);
    queueSpectatorEvent(gameId, 'game:transit_arrived', payload);
  }
  state.last_transit_arrivals = undefined;
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

  emitToPlayer(io, gameId, human.player_id, 'game:coaching_tip', tip);
}

/**
 * No friendly fire in a team game (state/teams.ts): an attack, strike, bomb,
 * Drop Assault or Influence aimed at an ally's ground is refused with
 * ALLY_TARGET, and one aimed at another side during the opening ceasefire with
 * CEASEFIRE, before anything changes. True when refused.
 */
function refuseShieldedTarget(
  socket: Socket,
  state: GameState,
  playerId: string,
  targetOwnerId: string | null | undefined,
): boolean {
  if (!isShieldedFrom(state, playerId, targetOwnerId)) return false;
  emitGameError(
    socket,
    areAllies(state, playerId, targetOwnerId) ? GameErrorCode.ALLY_TARGET : GameErrorCode.CEASEFIRE,
    shieldedTargetError(state, playerId, targetOwnerId),
  );
  return true;
}

/**
 * Nothing forbids attacking a truce partner, but it breaks the truce, and only
 * once the attacker has said so: an attack on one without `breakTruce` is
 * refused with TRUCE_ACTIVE, and the client asks first. True when refused.
 */
function refuseUnconfirmedTruceBreak(
  socket: Socket,
  state: GameState,
  attackerId: string,
  targetOwnerId: string | null | undefined,
  confirmed: boolean | undefined,
): boolean {
  if (confirmed === true || !activeTruceBetween(state, attackerId, targetOwnerId)) return false;
  emitGameError(socket, GameErrorCode.TRUCE_ACTIVE, 'You have an active truce with this player');
  return true;
}

/**
 * Break the truce an attack has just committed to crossing, if there is one,
 * and tell the betrayed player at once. True when a truce was broken.
 */
function breakTruceAndAlert(
  io: Server,
  state: GameState,
  breaker: PlayerState,
  betrayedId: string | null | undefined,
): boolean {
  if (!breakTruceBetween(state, breaker.player_id, betrayedId)) return false;
  alertTruceBroken(io, state.game_id, breaker, betrayedId!);
  return true;
}

function alertTruceBroken(io: Server, gameId: string, breaker: PlayerState, betrayedId: string): void {
  emitToPlayer(io, gameId, betrayedId, 'game:truce_broken', {
    breakerName: breaker.username,
    breakerColor: breaker.color,
    breakerId: breaker.player_id,
  });
}

/**
 * Land any Drop Assault the incoming player declared last turn (Space Age Moon
 * Race, Phase 2b).
 *
 * Called immediately after every `advanceToNextPlayer`, which is where "the
 * start of the declarer's next turn" actually happens for humans and bots
 * alike — there is no other hook a human turn passes through.
 *
 * The engine resolves the battle through `executeLandAttack`; everything here
 * is the socket's own business around it: the card draw, elimination
 * bookkeeping the resolver cannot do (cards, the eliminated event, stat
 * recording), and telling the table what fell out of the sky. Callers run their
 * existing victory check afterwards, which is what catches a drop that ends the
 * game.
 */
function landPendingDropAssaults(
  io: Server,
  gameId: string,
  state: GameState,
  map: GameMap,
): DropAssaultResolution[] {
  const player = state.players[state.current_player_index];
  if (!player || !state.drop_assaults?.length) return [];

  const resolutions = resolveDropAssaultsFor(state, map, player.player_id, {
    onCapture: (s, pid) => {
      // One card per turn, same rule the ordinary attack path applies.
      if (!player.card_earned_this_turn) {
        drawCard(s, pid);
        player.card_earned_this_turn = true;
      }
    },
  });
  if (resolutions.length === 0) return [];

  for (const res of resolutions) {
    const targetName = territoryName(map, res.assault.target_id);
    if (res.status === 'cancelled') {
      emitToPlayer(io, gameId, player.player_id, 'game:drop_assault_cancelled', {
        targetTerritoryId: res.assault.target_id,
        targetName,
        reason: res.cancelReason ?? 'The drop was cancelled',
      });
      continue;
    }

    const defenderId = res.previousOwner ?? null;
    const defender = defenderId ? state.players.find((p) => p.player_id === defenderId) : undefined;
    if (res.truceBroken && defenderId) alertTruceBroken(io, gameId, player, defenderId);
    const payload = {
      playerId: player.player_id,
      playerName: player.username,
      playerColor: player.color,
      targetTerritoryId: res.assault.target_id,
      targetName,
      captured: !!res.captured,
      defenderId,
      defenderName: defender?.username ?? null,
      attackerLosses: res.outcome?.result.attacker_losses ?? 0,
      defenderLosses: res.outcome?.result.defender_losses ?? 0,
    };
    io.to(gameId).emit('game:drop_assault_landed', payload);
    queueSpectatorEvent(gameId, 'game:drop_assault_landed', payload);

    if (res.outcome?.defenderEliminated && defender) {
      // The resolver moved the cards; the socket owns everything else an
      // elimination means — its record, its event, and clearing the dead
      // player's own drop so it cannot land after they are gone.
      clearDropAssaultsFor(state, defender.player_id);
      recordElimination(gameId, player.player_id);
      io.to(gameId).emit('game:player_eliminated', {
        playerId: defender.player_id,
        eliminatorId: player.player_id,
        eliminatorName: player.username,
        eliminatedName: defender.username,
        secretMission: defender.secret_mission ?? null,
      });
    }
  }

  // A landed drop can take a gate end like any capture; the resolver is
  // synchronous, so the map follows fire-and-forget, as the persist does.
  if (resolutions.some((res) => res.captured)) {
    void syncJumpGateLanesAfterCapture(io, gameId, state, map).catch((err) =>
      console.error('[Room] jump gate lane sync after drop failed', gameId, err),
    );
  }

  syncTerritoryCounts(state);
  broadcastState(io, gameId, state);
  return resolutions;
}

function recordSpectatorState(gameId: string, state: GameState): void {
  // Pass the game's real fog setting so spectators of a fog game get masked
  // territory intel (board control only), not the full board.
  pushSpectatorState(gameId, buildClientState(state, null, state.settings.fog_of_war));
}

/**
 * Settle a spectator socket's departure from a game: room membership,
 * socket.data, in-memory tracking, the persistent count, and the count
 * broadcast. Idempotent — only a socket that was actually tracked touches the
 * persistent count, so a stray leave (e.g. one the client buffered across a
 * reconnect) cannot skew it.
 */
async function removeSpectatorSocket(io: Server, socket: Socket, gameId: string): Promise<void> {
  socket.leave(`${gameId}:spectators`);
  if (socket.data?.spectating === gameId) {
    socket.data = { ...socket.data, spectating: undefined };
  }
  if (!untrackSpectator(gameId, socket.id)) return;

  await query(
    'UPDATE games SET spectator_count = GREATEST(spectator_count - 1, 0) WHERE game_id = $1',
    [gameId],
  ).catch(() => {});
  await broadcastSpectatorCount(io, gameId);
}

async function broadcastSpectatorCount(io: Server, gameId: string): Promise<void> {
  const countRow = await queryOne<{ spectator_count: number }>(
    'SELECT spectator_count FROM games WHERE game_id = $1',
    [gameId],
  ).catch(() => null);
  const count = countRow?.spectator_count ?? 0;
  io.to(gameId).emit('game:spectator_count', { count });
  io.to(`${gameId}:spectators`).emit('game:spectator_count', { count });
}

/**
 * Territories whose exact intel a player may see in a fog game: their own,
 * everything bordering them (border scouting), and whatever recon or a faction
 * passive reveals (state/fogOfWar.ts). The one rule for both `game:state` and
 * map visuals.
 */
function fogVisibleTerritoryIds(state: GameState, playerId: string, map?: GameMap): Set<string> {
  // The adjacency cache only fills once some handler has built it, and on a
  // fresh process the first actions (a draft, a phase change) never do: every
  // border then read as hidden, in game:state and the AI's fogged view alike.
  // Build it from the room's map instead of trusting a cold cache.
  const roomMap = map ?? getCachedRoom(state.game_id)?.map;
  const adj = roomMap ? getOrBuildAdjacency(roomMap) : adjacencyByMapId.get(state.map_id);
  return visibleTerritoryIds(state, playerId, adj);
}

/**
 * Emit a map visual, per viewer when fog is on. Every visual in this file goes
 * through here: a room-wide emit carried a reinforce's exact "Total: N" to
 * every opponent, fog or not.
 */
function emitVisual(
  io: Server,
  gameId: string,
  state: GameState,
  event: Parameters<typeof emitMapVisual>[2],
): void {
  if (!state.settings.fog_of_war) {
    emitMapVisual(io, gameId, event);
    return;
  }
  emitMapVisual(io, gameId, event, {
    viewers: state.players
      .filter((p) => !p.is_ai)
      .map((p) => ({ playerId: p.player_id, visible: fogVisibleTerritoryIds(state, p.player_id) })),
  });
}

function buildClientState(state: GameState, playerId: string | null, fogOfWar: boolean): GameState {
  // Viewer-scoped era advancement status (transport-only). Computed from the
  // unfiltered state — it describes the viewer's own empire, which fog never
  // hides from them.
  const attachEraPreview = (s: GameState): GameState => {
    if (!playerId || !state.settings.era_advancement_enabled) return s;
    // Also scope `era_modifiers` to this viewer. Every client read of it asks
    // "which rules apply to me" — the fortify limit, whether Influence is
    // offered, which badge to show — and the authoritative field holds the
    // GAME's starting era, so a player who had climbed was shown the doctrine
    // of the era they left. Transport-only, like the preview beside it.
    const withModifiers: GameState = { ...s, era_modifiers: getPlayerEraModifiers(state, playerId) };
    const preview = buildAdvanceEraClientPreview(state, playerId);
    return preview ? { ...withModifiers, era_advancement_preview: preview } : withModifiers;
  };

  // Viewer-scoped Stability deploy caps (transport-only), attached while it is
  // the viewer's own draft: how many more units each of their territories can
  // still take this turn. The territory panel offered "Place 12" on a tile
  // whose cap was 3 and learned the limit only from the server's refusal
  // (playtest PT-009); with the cap in the payload it shows and clamps it.
  const attachDraftCaps = (s: GameState): GameState => {
    if (!playerId || !state.settings.stability_enabled || state.phase !== 'draft') return s;
    const viewer = state.players[state.current_player_index];
    if (!viewer || viewer.player_id !== playerId) return s;
    const placements = state.draft_placements_this_turn ?? {};
    const caps: Record<string, number> = {};
    for (const t of Object.values(state.territories)) {
      if (t.owner_id !== playerId) continue;
      const cap = getDeployCap(t.stability, {
        era: state.era,
        turnNumber: state.turn_number,
        economyEnabled: !!state.settings.economy_enabled,
        playerSpecialResource: viewer.special_resource ?? 0,
        worldDeployCapBonus: worldDeployCapBonus(state, t.world_id),
      });
      // Infinity (stability 50+) has no JSON form and means "no cap": leave it out.
      if (!Number.isFinite(cap)) continue;
      caps[t.territory_id] = Math.max(0, cap - (placements[t.territory_id] ?? 0));
    }
    return { ...s, draft_deploy_caps: caps };
  };

  // Viewer-scoped surrender offer (transport-only): the bots offer this
  // viewer their surrender on the viewer's own turn (victory/surrender.ts).
  // Read from the authoritative state, as the server will check it again
  // when the viewer accepts.
  const attachSurrenderOffer = (s: GameState): GameState =>
    playerId && featureFlags.surrenderOffersEnabled && surrenderOffered(state, playerId)
      ? { ...s, surrender_offer: true }
      : s;

  const actingPlayerId = state.players[state.current_player_index]?.player_id;
  const stripSecretMissions = (s: GameState): GameState => ({
    // What no viewer may hold: the mission salt, the daily seeds, a v2 day's
    // answer key and graded decisions, and the daily's dice stream (with the
    // seed or the stream, a client knows every roll before it attacks).
    ...redactServerOnlyState(s),
    // Reveal each player's secret_mission only to its owner / eliminated players /
    // at game_over, and — when there is no viewing player (spectator/public
    // snapshot) — empty every card hand so spectators can't read players' cards.
    players: redactPlayersForViewer(s.players, playerId, state.phase),
    // The reinforcement undo stack is the acting player's private working state —
    // strip it for every other viewer (and spectators) so fog can't be sidestepped
    // by reading where the current player just deployed. The Stability cap's
    // per-territory tally says the same thing, so it goes with it.
    draft_deployments_this_turn:
      playerId !== null && playerId === actingPlayerId ? s.draft_deployments_this_turn : undefined,
    draft_placements_this_turn:
      playerId !== null && playerId === actingPlayerId ? s.draft_placements_this_turn : undefined,
  });

  // No fog → everyone (players and spectators) sees full territory intel.
  // (Spectator card hands are still emptied by redactPlayersForViewer.)
  if (!fogOfWar) return attachSurrenderOffer(attachDraftCaps(attachEraPreview(stripSecretMissions(state))));

  // Fog is on. Compute which territories' exact intel the viewer may see.
  const visibleIds = playerId !== null ? fogVisibleTerritoryIds(state, playerId) : new Set<string>();
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

  return attachSurrenderOffer(attachDraftCaps(attachEraPreview(stripSecretMissions(filtered))));
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
      emitToPlayer(io, gameId, winnerId, 'game:campaign_advanced', {
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
  // An objective day won outright settles on the final board before the result
  // is persisted or read. Then who is credited with the win: the board's
  // winners, less a human who won the war and lost the daily challenge.
  // Everything below that pays for a win (XP, rank, rating, streak, gold,
  // achievements) reads these, not `winnerIds`.
  settleObjectiveAtConquest(state, getCachedRoom(gameId)?.map, winnerIds);
  // Every credited winner is paid as a winner: a side that wins together
  // (state/teams.ts), or both allies of an alliance mission.
  const creditedIds = creditedWinnerIds(state, winnerIds);

  // Idempotency guard: finalizeGame can be entered more than once on the same
  // game — e.g. a resign victory check racing with the turn-timer victory
  // check, or a daily puzzle objective resolving on the same turn as a
  // domination win. Without the guard, the second pass would run
  // `recordGameResults` a second time, doubling rating/XP deltas and writing
  // duplicate achievement rows.
  //
  // Gate on the `games.status` transition: the UPDATE only fires when the
  // game is not already finished — 'completed', or 'abandoned', which awards
  // nothing (MARK_GAME_COMPLETED_SQL). If rowCount is 0 we bail before any
  // downstream writes (ratings, achievements, campaign, notifications).
  let firstFinalize = false;
  // `games.winner_id` is a UUID referencing users. AI players use synthetic
  // string ids like "ai_1" that are not valid UUIDs, so we must persist NULL
  // for AI wins and keep the synthetic id only in the in-memory/broadcast state.
  // A side of AI and humans records its first human.
  const persistedWinnerId = winnerIds.find(
    (id) => state.players.find((p) => p.player_id === id)?.is_ai === false,
  ) ?? null;
  try {
    const res = await pgPool.query(MARK_GAME_COMPLETED_SQL, [persistedWinnerId, gameId]);
    firstFinalize = (res.rowCount ?? 0) > 0;
    if (!firstFinalize) {
      console.warn(`[Socket] finalizeGame called for already-finished game ${gameId}; skipping duplicate writes.`);
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
        const { won: entryWon } = settleDailyRun(state, humanPlayer.player_id, winnerIds);
        const mistakes = state.puzzle_feedback_mistakes ?? 0;
        // Daily v2 (docs/DAILY_PUZZLE_V2.md §4): the score is accuracy, not par.
        const v2Run = spec?.v2 ? summarizePuzzleRun(state, entryWon) : null;
        const puzzleScore = v2Run
          ? v2Run.score
          : computeDailyPuzzleScore({
            won: entryWon,
            turns: state.turn_number,
            par: spec?.par_turns,
            mistakes,
          });
        await query(
          `INSERT INTO daily_challenge_entries (
             challenge_date, user_id, won, turn_count, territory_count,
             puzzle_score, objective_met, archetype, move_feedback_mistakes,
             puzzle_version, accuracy, attempts, first_try, decisions_json
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
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
            v2Run ? 2 : 1,
            v2Run?.accuracy ?? null,
            v2Run?.attempts ?? null,
            v2Run?.first_try ?? null,
            v2Run ? JSON.stringify(v2Run.decisions) : null,
          ],
        );
        recordServerEvent('daily_challenge_settled', {
          game_id: gameId,
          challenge_date: dailyRow.daily_challenge_date,
          user_id: humanPlayer.player_id,
          won: entryWon,
          archetype: spec?.archetype ?? 'domination',
          puzzle_score: puzzleScore,
          puzzle_version: v2Run ? 2 : 1,
          accuracy: v2Run?.accuracy ?? null,
          star: v2Run?.star ?? null,
          crown: v2Run?.crown ?? null,
        });
        if (v2Run) {
          // The review panel's numbers, in the same breath as game over.
          io.to(gameId).emit('game:puzzle_review', {
            gameId,
            won: entryWon,
            theme: spec?.v2?.theme ?? null,
            ...v2Run,
          });
        }
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

  // Galactic Age report (admin-only, non-critical): the board this game dealt
  // and who won, kept after its snapshots are pruned. Any other game records
  // nothing and never reaches the database.
  try {
    await recordGalaxyGameResult(gameId, state, creditedIds);
  } catch (galaxyErr) {
    console.error('[Socket] Failed to record Galactic Age result:', galaxyErr);
  }

  // Post-game stats (non-critical — failures logged but game:over still sent)
  let resultCtx: Awaited<ReturnType<typeof recordGameResults>>;
  try {
    resultCtx = await recordGameResults(gameId, state, creditedIds);
  } catch (err) {
    console.error('[Socket] Failed to record game results:', err);
    resultCtx = { ratingDeltas: new Map(), ratingProvisional: new Map(), guestPlayerIds: new Set(), isRanked: false, xpEarnedByPlayer: {} };
  }

  const unlockedByPlayer: Record<string, string[]> = {};
  const humanPlayers = state.players.filter((p) => !p.is_ai);
  const ranks = computeRanks(state.players, creditedIds);

  // Per-human activation/retention signal: who finished a game, and the outcome.
  // (For human players, player_id is the user's UUID — see ranked insert below.)
  const finishedDurationMs = state.game_started_at ? Date.now() - state.game_started_at : null;
  for (const human of humanPlayers) {
    recordServerEvent(
      'game_finished',
      {
        game_id: gameId,
        won: creditedIds.includes(human.player_id),
        victory_type: state.victory_condition ?? null,
        duration_ms: finishedDurationMs,
        turn_count: state.turn_number,
        is_tutorial: !!state.settings.tutorial,
        // Lets the funnel segment guest activation (the cohort the signup nudge
        // targets) and measure guest finish → upgrade conversion.
        is_guest: resultCtx.guestPlayerIds.has(human.player_id),
        first_match: state.settings.first_match === true,
        // Which bots the game was against: 'turn_limit' in victory_type is a
        // game the round cap decided.
        ai_difficulty: gameAiDifficulty(state.players),
        ai_count: state.players.filter((p) => p.is_ai).length,
        max_turns: state.settings.max_turns ?? null,
      },
      human.player_id,
    );
    // First-session funnel: a dedicated, authoritative tutorial-completion
    // signal (reaching the end of the guided first match), distinct from the
    // general game_finished above so the funnel can key on it directly.
    if (state.settings.tutorial) {
      recordServerEvent(
        'tutorial_completed',
        {
          game_id: gameId,
          won: creditedIds.includes(human.player_id),
          lesson_module: state.settings.tutorial_lesson_module ?? 'core',
          is_guest: resultCtx.guestPlayerIds.has(human.player_id),
        },
        human.player_id,
      );
    }
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
    streak_freeze_used: boolean;
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
      const isWinner = creditedIds.includes(p.player_id);
      const client = await pgPool.connect();
      try {
        await client.query('BEGIN');

        // Win streak. The tutorial does not count — see `applyWinStreak`.
        const winStreak = await applyWinStreak(client, p.player_id, {
          won: isWinner,
          counts: !state.settings.tutorial,
        });

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
          streak_freeze_used: dailyResult.freeze_used,
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
        won: creditedIds.includes(p.player_id),
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
      if (creditedIds.includes(p.player_id)) {
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
  const highestAiDifficulty = gameAiDifficulty(state.players);

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
      settings: redactSettingsForClient(state.settings),
      human_player_ids: state.players
        .filter((p) => !p.is_ai && p.player_id !== winnerId)
        .map((p) => p.player_id),
    },
    combat_stats: Object.fromEntries(
      Array.from(gameCombatStats.get(gameId)?.entries() ?? []).map(([pid, s]) => [pid, s]),
    ),
    decision_summary: decisionSummary,
    // An objective day can end in the human's favour and still be a lost
    // challenge; the modal reads this rather than the game's winner.
    daily_result: humanForSummary && getDailyPuzzleSpec(state)
      ? settleDailyRun(state, humanForSummary.player_id, winnerIds)
      : undefined,
  };
  io.to(gameId).emit('game:over', stats);
  // Spectators run on the delayed feed; a slim end-signal lands when their
  // board reaches the final state (client only navigates to the replay on it).
  queueSpectatorEvent(gameId, 'game:over', {
    winner_ids: stats.winner_ids,
    victory_condition: stats.victory_condition,
    turn_count: stats.turn_count,
  });
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

/**
 * A Territory Draft pick was just made for a seat whose clock ran out, real
 * time or async: announce it, save, and drive whoever picks next (or, if that
 * pick ended the draft, whoever opens turn one).
 */
async function finishSelectionTimeout(io: Server, gameId: string, room: ActiveGameRoom): Promise<void> {
  const { state, map } = room;
  io.to(gameId).emit('game:turn_timeout', { phaseAdvanced: state.phase === 'draft' ? 'draft' : 'territory_select' });
  await saveGameState(gameId, state);
  broadcastState(io, gameId, state);
  const next = state.players[state.current_player_index];
  if (next.is_ai && state.phase === 'territory_select') {
    setTimeout(() => processAiTerritorySelect(io, gameId), 800);
  } else if (next.is_ai) {
    setTimeout(() => processAiTurn(io, gameId), 1500);
  } else {
    startTurnTimer(io, gameId, state, map);
  }
}

async function processAiTerritorySelect(io: Server, gameId: string): Promise<void> {
  try {
  await withLockedRoom(gameId, async (room) => {
  const { state, map } = room;

  if (state.phase !== 'territory_select') return;

  const currentPlayer = state.players[state.current_player_index];
  if (!currentPlayer.is_ai && !currentPlayer.is_away) return;

  // An away seat picks at the game's bot level (seatAiDifficulty).
  const difficulty = seatAiDifficulty(state.players, currentPlayer);
  const unclaimed = claimableTerritoryIds(state, map, currentPlayer.player_id);

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
  // How this level claims ground: random, or clustered (ai/aiProfiles.ts).
  const pick = aiProfile(difficulty).territoryPick;

  if (pick !== 'random') {
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
      if (pick === 'cluster_by_region') {
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

  const { completed: selectionDone } = claimSelectionTerritory(state, map, chosenId);

  broadcastState(io, gameId, state);
  void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));

  // Chain: next AI pick or transition to human/draft
  const nextPlayer = state.players[state.current_player_index];
  if (nextPlayer.is_ai && !selectionDone) {
    setTimeout(() => processAiTerritorySelect(io, gameId), 800);
  } else if (nextPlayer.is_ai) {
    setTimeout(() => processAiTurn(io, gameId), 1500);
  } else if (!nextPlayer.is_ai) {
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
 * The seat to move is a bot, or an away seat the AI covers, and its turn
 * opened on a choice card: take the first choice (the AI's pick) for that
 * seat, as a human answers the card before playing on. An async seat whose
 * day lapsed with the card still open gets the same answer.
 */
function resolveChoiceCardForAi(io: Server, gameId: string, state: GameState): void {
  const card = state.active_event;
  const choice = card?.choices?.[0];
  if (!card || !choice) return;
  const result = resolveEventChoice(state, card.card_id, choice.choice_id);
  if (result) {
    emitEventCardMapVisuals(io, gameId, { cardId: card.card_id, effect: choice.effect, result });
  }
  io.to(gameId).emit('game:event_card_resolved', { cardId: card.card_id });
  queueSpectatorEvent(gameId, 'game:event_card_resolved', { cardId: card.card_id });
  broadcastState(io, gameId, state);
}

async function processAiTurn(io: Server, gameId: string): Promise<void> {
  if (await isAiTurnInFlight(gameId)) return;
  if (!(await tryAcquireAiTurn(gameId))) return;
  try {
  await withLockedRoom(gameId, async (room) => {
  const { state, map } = room;

  // Every caller queues this turn 1–1.5s ahead; a resign or a win can end the
  // game in between, and the bot must not play on (and re-finalize) the final
  // board.
  if (state.phase === 'game_over') return;

  const currentPlayer = state.players[state.current_player_index];
  // Run for AI seats and for *away* human seats (the AI covers their turn).
  if (!currentPlayer.is_ai && !currentPlayer.is_away) return;

  // Answer the choice card this turn opened with before playing, as a human
  // must. Left pending, it outlived the turn and reached the next player.
  resolveChoiceCardForAi(io, gameId, state);

  // A bot plays its own level; an away human seat the game's bot level
  // (seatAiDifficulty), not medium whatever the table is.
  const difficulty = seatAiDifficulty(state.players, currentPlayer);
  // The style the bot's commander plays this game (ai/aiStyles.ts), stamped
  // when the game started; a human seat the AI covers plays none.
  const level = styledLevel(difficulty, currentPlayer.is_ai ? currentPlayer.ai_style : undefined);
  const aiFlags: AiTurnFlags = {
    captureOddsScoring: featureFlags.aiCaptureOddsEnabled,
    attackGrind: featureFlags.aiAttackGrindEnabled,
    decidedGamePress: featureFlags.aiDecidedGamePressEnabled,
    oddsPress: featureFlags.aiOddsPressEnabled,
    plannedDraft: featureFlags.aiPlannedReinforcementsEnabled,
    endingPlay: featureFlags.aiEndingPlayEnabled,
    resignation: featureFlags.aiResignationEnabled,
    intents: featureFlags.aiIntentsEnabled,
  };

  // A beaten bot resigns as its turn opens (ai/aiResign.ts), through the
  // same step as a player's resignation, and the turn passes on as at the
  // end of any turn. Never a human seat the AI covers.
  const resigned = resignIfBeaten(state, currentPlayer, difficulty, aiFlags.resignation);
  if (resigned) {
    io.to(gameId).emit('game:player_resigned', {
      playerId: currentPlayer.player_id,
      playerName: currentPlayer.username,
    });
    const victory = victoryAfterResignation(state, map);
    if (victory) {
      state.phase = 'game_over';
      state.winner_id = victory.winnerIds[0]!;
      state.winner_ids = victory.winnerIds;
      state.victory_condition = victory.condition;
      await finalizeGame(io, gameId, state, victory.winnerIds);
      broadcastState(io, gameId, state);
      return;
    }
  }

  // Fog-fair AI planning: when fog_of_war is on, humans see only their own
  // and adjacent territories' unit counts. Passing the raw authoritative
  // state to the AI lets it peek at unit counts everywhere on the map —
  // effectively giving every AI opponent a cheat against human players. We
  // build the same filtered view buildClientState produces for humans, so
  // the AI plans against the same information a human in its seat would.
  // When fog is off, the filter is a no-op (full state passed through).
  const aiPlan = resigned ? null : await planAiTurn(state, map, currentPlayer, level, aiFlags, {
    planningState: () => (state.settings.fog_of_war
      ? buildClientState(state, currentPlayer.player_id, true)
      : state),
    plan: runAiWithTimeout,
  });

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

  // Daily v2: the scripted opponent plays the set-piece's authored plan
  // (docs/DAILY_PUZZLE_V2.md §5.2) instead of the bot.
  const v2Puzzle = dailyV2Puzzle(room);
  if (v2Puzzle) {
    // The authored plan is the opponent's: never play it from the player's
    // own seat, which the run grades on the player's moves.
    if (!currentPlayer.is_ai) return;
    await runDailyV2OpponentTurn(io, gameId, room, currentPlayer, v2Puzzle, delay, doVictoryCheck);
    return;
  }

  // A player who dropped mid-turn left it half played. Their away-AI finishes
  // it from the phase they were in: replaying it from the draft gave the seat
  // a second draft and attack phase, and a fresh fortify allowance. A bot's
  // turn always starts from the draft.
  const resumeAt = currentPlayer.is_away && (state.phase === 'attack' || state.phase === 'fortify')
    ? state.phase
    : 'draft';

  // The digest of a bot's turn (ai/aiTurnDigest.ts) compares the board after
  // it with the board now. Bots only, with ai_intents_enabled, and never where
  // the game keeps today's bots.
  const digestFrom = aiPlan && aiFlags.intents && currentPlayer.is_ai && !keepsTodaysBots(state.settings)
    ? snapshotForDigest(state)
    : null;

  // The turn itself (game-engine/ai/runAiTurn.ts), shared with the harnesses.
  // Everything the live game does around the rules arrives as a hook.
  const outcome = aiPlan && await playAiTurn(state, map, currentPlayer, level, aiPlan, resumeAt, {
    delay,
    victoryCheck: doVictoryCheck,
    broadcast: () => broadcastState(io, gameId, state),
    persist: () => {
      void persistGameStateAfterMutation(gameId, state).catch((err) => console.error('[Redis] persist after mutation failed', gameId, err));
    },
    emit: (event, payload) => {
      io.to(gameId).emit(event, payload);
    },
    spectatorEvent: (event, payload) => queueSpectatorEvent(gameId, event, payload),
    visual: (event) => emitVisual(io, gameId, state, event),
    strikeVisuals: (payload) => emitAbilityStrikeVisuals(io, gameId, payload, { state, map }),
    launchPadLane: (territoryId) => announceLaunchPadLane(io, gameId, room, currentPlayer, territoryId),
    eraBoardChange: async (nextEraId) => {
      room.map = await applyEraBoardChange(io, gameId, state, map, nextEraId);
    },
    mapChanged: () => persistAndBroadcastMap(io, gameId, state, map),
    afterCapture: () => syncJumpGateLanesAfterCapture(io, gameId, state, map),
    surgeLanesClosed: () => syncSurgeProjectorAndBroadcastMap(io, gameId, state, map),
    recordCombat: (defenderId, result, options) =>
      recordCombatResult(gameId, currentPlayer.player_id, defenderId, result, options),
    recordElimination: () => recordElimination(gameId, currentPlayer.player_id),
  });
  if (outcome === 'over') return;
  // Before the hand-off's broadcast, so a client words the turn as it closes.
  if (digestFrom) {
    io.to(gameId).emit('game:ai_turn_digest', buildAiTurnDigest(digestFrom, state, map, currentPlayer, difficulty));
  }

  // ── End Turn ───────────────────────────────────────────────────────────
  advanceToNextPlayer(state, map);
  landPendingDropAssaults(io, gameId, state, map);
  await syncLaneWeatherAndBroadcastMap(io, gameId, room);
  broadcastTransitArrivals(io, gameId, state, map);
  broadcastEventCard(io, gameId, state, map); // before the save: see broadcastEventCard
  await saveGameState(gameId, state);
  broadcastState(io, gameId, state);
  maybeEmitCoachingTip(io, gameId, state, map);

  if (await doVictoryCheck()) return;

  // Chain if next player is also AI (it answers its own choice card as its
  // turn opens); otherwise start the human's clock (a timed clock pauses on a
  // choice card, an async day runs through it), or hand an away seat to the
  // away-AI.
  if (state.players[state.current_player_index].is_ai) {
    setTimeout(() => processAiTurn(io, gameId), 1000);
  } else {
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

/**
 * The AI's turn on a Daily v2 day: the set-piece's authored plan, played
 * through the real engine (runScriptedAiTurn) with the day's seeded dice, and
 * broadcast exchange by exchange as the bot's turn is. A daily has no events,
 * transit or lanes, so the end of the turn is the short form of the bot's.
 */
async function runDailyV2OpponentTurn(
  io: Server,
  gameId: string,
  room: { state: GameState; map: GameMap },
  currentPlayer: GameState['players'][number],
  puzzle: WarmedPuzzle,
  delay: () => Promise<void>,
  doVictoryCheck: () => Promise<boolean>,
): Promise<void> {
  const { state, map } = room;
  const human = state.players.find((p) => !p.is_ai);
  if (!human || !puzzle.spec.v2) return;
  const dieRoll = state.puzzle_dice_queue?.length ? createPuzzleDieRoll(state) : undefined;
  const isSeaEdge = (a: string, b: string): boolean =>
    map.connections.some((c) => ((c.from === a && c.to === b) || (c.from === b && c.to === a)) && c.type === 'sea');
  let ended = false;
  await runScriptedAiTurn(state, map, puzzle.ctx, puzzle.spec.v2.plan, human.player_id, currentPlayer.player_id, {
    dieRoll,
    onDraft: () => {
      syncTerritoryCounts(state);
      broadcastState(io, gameId, state);
    },
    onExchange: async (fromId, toId, outcome) => {
      const result = outcome.result;
      if (result.error) return false;
      syncTerritoryCounts(state);
      recordCombatResult(gameId, currentPlayer.player_id, human.player_id, result, { isSea: isSeaEdge(fromId, toId) });
      io.to(gameId).emit('game:combat_result', { fromId, toId, result });
      emitVisual(io, gameId, state, buildCombatMapVisual({
        fromId,
        toId,
        attackerId: currentPlayer.player_id,
        defenderId: human.player_id,
        attackerLosses: result.attacker_losses,
        defenderLosses: result.defender_losses,
        territoryCaptured: result.territory_captured,
        state,
      }));
      broadcastState(io, gameId, state);
      if (await doVictoryCheck()) {
        ended = true;
        return false;
      }
      await delay();
      return true;
    },
    onMarch: (fromId, toId, units) => {
      state.fortify_moves_used = (state.fortify_moves_used ?? 0) + 1;
      emitVisual(io, gameId, state, buildFortifyMapVisual({
        fromTerritoryId: fromId,
        toTerritoryId: toId,
        units,
        playerId: currentPlayer.player_id,
        state,
      }));
      broadcastState(io, gameId, state);
    },
  });
  if (ended) return;

  // ── End Turn ───────────────────────────────────────────────────────────
  state.fortify_moves_used = 0;
  advanceToNextPlayer(state, map);
  beginPuzzleHumanTurn(state);
  await saveGameState(gameId, state);
  broadcastState(io, gameId, state);
  if (await doVictoryCheck()) return;
  startTurnTimer(io, gameId, state, map);
}

/**
 * Arm the clock for the seat to move. `notify: false` arms an async deadline
 * without telling the player it is their turn, for a player already acting on
 * it (see game:event_choice).
 */
function startTurnTimer(
  io: Server,
  gameId: string,
  state: GameState,
  map: GameMap,
  opts: { notify?: boolean } = {},
): void {
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
  // timed and untimed games, so the table never stalls on an absent player (with
  // nobody else at the table, driveCurrentSeatIfAi leaves the seat to wait). This
  // is checked before the no-timer early-return below for exactly that reason.
  // (Async games never mark seats away; the async deadline handles absence.)
  if (currentPlayer.is_away && !currentPlayer.is_ai && !state.settings.async_mode) {
    scheduleAwayAiTurn(io, gameId, currentPlayer.away_since);
    return;
  }
  // A choice card pauses a present player's clock until they choose
  // (game:event_choice restarts it). Checked after the away branch, which is
  // why the turn hand-offs call this even with a choice pending: an away seat
  // has nobody to choose, and its away-AI answers the card (processAiTurn).
  // Not in an async game: there the day runs through the card, and the player
  // is told it is their turn now. Paused, a player who was not watching was
  // never told, and the game waited on them. A day that lapses with the card
  // open answers it for them (the deadline processor).
  if (state.active_event?.choices?.length && !state.settings.async_mode) {
    emitPhaseDeadline(io, gameId, state);
    persistArmedDeadline(gameId, state);
    return;
  }
  const seconds = state.settings.turn_timer_seconds;
  if (!seconds || seconds <= 0) return;
  if (currentPlayer.is_ai) return;

  // ── Async mode: use persistent BullMQ job instead of in-memory timer ──
  if (state.settings.async_mode) {
    const deadlineSec = state.settings.async_turn_deadline_seconds ?? seconds;
    const deadlineAt = Date.now() + deadlineSec * 1000;
    state.phase_deadline_at = deadlineAt;
    emitPhaseDeadline(io, gameId, state);
    persistArmedDeadline(gameId, state);
    // Write deadline to DB for querying
    query(
      'UPDATE games SET async_turn_deadline = NOW() + INTERVAL \'1 second\' * $1 WHERE game_id = $2',
      [deadlineSec, gameId],
    ).catch((err) => console.error('[Socket] Failed to write async deadline:', err));

    // Schedule BullMQ job
    scheduleAsyncDeadline(gameId, state.turn_number, state.current_player_index, deadlineAt)
      .catch((err) => console.error('[Socket] Failed to schedule async deadline:', err));

    // Notify the player it's their turn — in-app on every socket they have
    // open, then push/email. `io` is what makes the in-app channel possible.
    if (opts.notify !== false) {
      notifyTurnChange(gameId, currentPlayer.player_id, state, io)
        .catch((err) => console.error('[Socket] Failed to notify turn change:', err));
    }

    return;
  }

  // ── Real-time mode: BullMQ-backed turn timer (Phase 7) ──
  const deadlineAt = Date.now() + seconds * 1000;
  state.phase_deadline_at = deadlineAt;
  emitPhaseDeadline(io, gameId, state);
  persistArmedDeadline(gameId, state);
  scheduleTurnTimeout(gameId, deadlineAt).catch((err) => {
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

function clearTurnTimer(gameId: string, state: GameState): void {
  // Both kinds of job are named by the deadline they were armed for, so the
  // hand-offs cancel the outgoing seat's here, before it is cleared.
  cancelTurnTimeout(gameId, state.phase_deadline_at).catch(() => {});
  cancelAsyncDeadline(gameId, state.phase_deadline_at).catch(() => {});
  // No timer running means no deadline — otherwise AI turns and event
  // pauses keep broadcasting the previous human's expired clock and the
  // HUD counts down a dead timer to a frozen 0:00. Clearing it is also what
  // retires a job that could not be cancelled (isTurnTimerJobCurrent,
  // isAsyncDeadlineJobCurrent).
  state.phase_deadline_at = null;
}

/**
 * BFS over territories the player owns. `canTraverse` optionally rejects
 * individual connections: fortify passes a filter that refuses orbit lanes the
 * player cannot currently cross, so a multi-hop route cannot smuggle troops
 * across a lane whose two endpoints are not the fortify's own endpoints.
 */
function pathExists(
  fromId: string,
  toId: string,
  state: GameState,
  map: GameMap,
  ownerId: string,
  canTraverse?: (conn: MapConnection) => boolean
): boolean {
  const adj: Record<string, string[]> = {};
  for (const conn of map.connections) {
    if (!adj[conn.from]) adj[conn.from] = [];
    if (!adj[conn.to]) adj[conn.to] = [];
    if (canTraverse && !canTraverse(conn)) continue;
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
