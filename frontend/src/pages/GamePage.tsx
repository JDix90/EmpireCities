import React, { Suspense, useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Menu, X, CreditCard, RotateCcw, Users, Play, UserPlus, MessageSquare, Link2, Copy, Maximize2, Keyboard, Map as MapIcon, Globe as GlobeIcon } from 'lucide-react';
import { useGameStore, CombatResult, type GameState as ClientGameState } from '../store/gameStore';
import { useUiStore } from '../store/uiStore';
import { useAuthStore } from '../store/authStore';
import { hapticImpact, hapticNotification, ImpactStyle, NotificationType } from '../utils/haptics';
import { connectSocket, getSocket } from '../services/socket';
import { api } from '../services/api';
import GameMap from '../components/game/GameMap';
import { useMapVisualEvents } from '../hooks/useMapVisualEvents';
import { useGalaxyMapVisualPulse } from '../hooks/useGalaxyMapVisualPulse';
import type { MapVisualEvent } from '../utils/mapVisualEvents';
import {
  computeContestedBorders,
  phaseTintClass,
} from '../utils/mapAmbientEffects';
import GameHUD from '../components/game/GameHUD';
import GameChat from '../components/game/GameChat';
import MobileCardsTray from '../components/game/MobileCardsTray';
import MobileCombatBanner from '../components/game/MobileCombatBanner';
import TerritoryPanel from '../components/game/TerritoryPanel';
import TechTreeModal, { type TechNode } from '../components/game/TechTreeModal';
import BonusesModal from '../components/game/BonusesModal';
import AtomBombAnimation, { type StrikeAnimationVariant } from '../components/game/AtomBombAnimation';
import {
  getStrikeCombatLogLine,
  getStrikeToastMessage,
  type StrikeAnimationEvent,
} from '../utils/strikeAnimationMessages';
import EventCardModal, { type EventCard } from '../components/game/EventCardModal';
import ActionModal, { ActionNotification, ModalData, NotificationData, ReinforcementEntry, FortifyEntry, GameOverModalData, EliminationModalData, DraftSummaryModalData } from '../components/game/ActionModal';
import TutorialOverlay from '../components/game/TutorialOverlay';
import TutorialSettingsLab from '../components/game/TutorialSettingsLab';
import {
  getTutorialSteps,
  isTutorialStepCentered,
  markTutorialModuleComplete,
  shouldAdvanceTutorialOnState,
  type TutorialLessonModule,
} from '../tutorial';
import TutorialAccountPromptModal from '../components/game/TutorialAccountPromptModal';
import PostTutorialPromptModal from '../components/game/PostTutorialPromptModal';
import DailyChallengeIntroModal, { type DailyIntroSpec } from '../components/game/DailyChallengeIntroModal';
import CampaignIntroModal, { type CampaignIntroData } from '../components/game/CampaignIntroModal';
import InviteFriendsModal from '../components/game/InviteFriendsModal';
import GameShortcutsModal from '../components/game/GameShortcutsModal';
import LobbyProposals from '../components/game/LobbyProposals';
import FactionSelectionPanel from '../components/game/FactionSelectionPanel';
import { computeDraftPool } from '../utils/draftPool';
import { generateActionId } from '../utils/actionId';
import {
  getStrikeToastStyle,
  isMapStrikeAbility,
  type MapStrikeAbilityId,
  type MapStrikeFlashProps,
} from '../utils/mapStrikeEffects';
import { shouldShowFullScreenStrike } from '../utils/strikePresentation';
import {
  markEventCardVisualSeen,
  scheduleEventCardMapVisualBackup,
} from '../utils/eventCardMapVisual';
import { ERA_LABELS, formatLobbyMapLabel } from '../constants/gameLobbyLabels';
import { formatEraLabel } from '../utils/mapDisplayNames';
import BrandWordmark from '../components/ui/BrandWordmark';
import { AiBadge } from '../components/ui/AiBadge';
import type { GameLobbySnapshot, GameLobbyPlayerRow, GameLobbySettingsJson } from '../types/gameLobbyApi';
import { useRef as useReactRef } from 'react';
import toast from 'react-hot-toast';
import {
  getInitialMapView,
  persistMapView,
  prefersReducedMotion,
  isMobileViewport,
  getGlobeSpinPreference,
  persistGlobeSpinPreference,
  isLiteMode,
  persistLiteMode,
} from '../utils/device';
import { inferWorldId } from '@borderfall/shared';
import {
  getOrbitAccessResult,
  resolveOrbitAccessMode,
  territoryRequiresOrbitAccessForClaim,
  formatOrbitAccessError,
} from '../utils/orbitAccess';
import { getGalaxyWorldLore } from '../constants/galaxyLore';
import { resolveGalaxyDrillDownGlobeSkin } from '../utils/galaxyGlobeSkin';
import { GalaxyStrategicViewLazy, GlobeMapLazy, preloadGlobeChunks } from '../utils/globeLoader';
const FLOODED_NA_MAP_ID = 'community_flooded_north_america';
const FLOODED_NA_GLOBE_TEXTURE = '/globe/flooded-ocean.svg';

/** Win probability (0–1) below which we still offer replay after an abandoned game. */
const LOW_ODDS_ABANDON_REPLAY_THRESHOLD = 0.18;

interface MapData {
  map_id: string;
  name: string;
  canvas_width?: number;
  canvas_height?: number;
  projection_bounds?: {
    minLng: number;
    maxLng: number;
    minLat: number;
    maxLat: number;
  };
  globe_view?: {
    lock_rotation?: boolean;
    center_lat?: number;
    center_lng?: number;
    altitude?: number;
  };
  map_kind?: 'standard' | 'galaxy';
  worlds?: Array<{
    world_id: string;
    display_name: string;
    globe_image_url?: string;
    bump_image_url?: string;
    show_atmosphere?: boolean;
    atmosphere_color?: string;
    atmosphere_altitude?: number;
    background_color?: string;
    requires_orbit_access?: boolean;
  }>;
  territories: Array<{
    territory_id: string;
    name: string;
    polygon: number[][];
    center_point: [number, number];
    region_id: string;
    geo_polygon?: [number, number][];
    globe_id?: 'earth' | 'moon';
    world_id?: string;
    galaxy_position?: [number, number];
    globe_image_url?: string;
    bump_image_url?: string;
  }>;
  connections: Array<{ from: string; to: string; type: 'land' | 'sea' | 'orbit' }>;
  regions: Array<{ region_id: string; name: string; bonus: number }>;
}

const VICTORY_LABELS: Record<string, string> = {
  domination: 'Domination',
  secret_mission: 'Secret mission',
  capital: 'Capital',
  threshold: 'Threshold',
};

function formatVictorySummary(settings: GameLobbySettingsJson): string {
  const raw =
    Array.isArray(settings.allowed_victory_conditions) && settings.allowed_victory_conditions.length > 0
      ? settings.allowed_victory_conditions
      : typeof settings.victory_type === 'string'
        ? [settings.victory_type]
        : ['domination'];
  const parts = raw.map((k) => VICTORY_LABELS[k] ?? k);
  const th = settings.victory_threshold;
  const hasTh = raw.includes('threshold') && typeof th === 'number' && Number.isFinite(th);
  if (hasTh) {
    const idx = parts.findIndex((_, i) => raw[i] === 'threshold');
    if (idx >= 0) parts[idx] = `Threshold (${th}%)`;
  }
  return parts.join(', ');
}

function formatTurnTimer(seconds: unknown): string {
  const n = typeof seconds === 'number' ? seconds : Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return 'Off';
  const m = Math.floor(n / 60);
  const s = n % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function normalizeLobbySnapshot(data: unknown): GameLobbySnapshot | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (!d.game_id || !Array.isArray(d.players)) return null;
  let settings: GameLobbySettingsJson = {};
  const raw = d.settings_json;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    settings = raw as GameLobbySettingsJson;
  } else if (typeof raw === 'string') {
    try {
      settings = JSON.parse(raw) as GameLobbySettingsJson;
    } catch {
      settings = {};
    }
  }
  return {
    game_id: String(d.game_id),
    era_id: String(d.era_id ?? ''),
    map_id: String(d.map_id ?? ''),
    status: String(d.status ?? ''),
    join_code: (d.join_code as string | null | undefined) ?? null,
    settings_json: settings,
    players: d.players as GameLobbyPlayerRow[],
  };
}

function playerLobbyDisplayName(p: GameLobbyPlayerRow): string {
  if (p.username) return p.username;
  if (p.is_ai) return `AI Bot ${p.player_index}`;
  return 'Player';
}

function gradeFromDraftScore(score: number): string {
  if (score >= 92) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 78) return 'A-';
  if (score >= 71) return 'B+';
  if (score >= 64) return 'B';
  if (score >= 57) return 'C+';
  if (score >= 50) return 'C';
  if (score >= 43) return 'D';
  return 'F';
}

function buildDraftSummaryModal(state: ClientGameState, map: MapData): DraftSummaryModalData {
  const regionById = new Map(map.regions.map((r) => [r.region_id, r]));
  const territoryById = new Map(map.territories.map((t) => [t.territory_id, t]));

  const adjacency = new Map<string, string[]>();
  for (const c of map.connections) {
    adjacency.set(c.from, [...(adjacency.get(c.from) ?? []), c.to]);
    adjacency.set(c.to, [...(adjacency.get(c.to) ?? []), c.from]);
  }

  const ownedByPlayer = new Map<string, string[]>();
  for (const p of state.players) ownedByPlayer.set(p.player_id, []);
  for (const [tid, t] of Object.entries(state.territories)) {
    if (!t.owner_id) continue;
    ownedByPlayer.set(t.owner_id, [...(ownedByPlayer.get(t.owner_id) ?? []), tid]);
  }

  const regionSizes = new Map<string, number>();
  for (const t of map.territories) {
    regionSizes.set(t.region_id, (regionSizes.get(t.region_id) ?? 0) + 1);
  }

  const rawRows = state.players.map((p) => {
    const owned = ownedByPlayer.get(p.player_id) ?? [];
    const ownedSet = new Set(owned);

    const territories = owned.length;

    let regionLeverage = 0;
    const regionOwnedCounts = new Map<string, number>();
    for (const tid of owned) {
      const rid = territoryById.get(tid)?.region_id;
      if (!rid) continue;
      regionOwnedCounts.set(rid, (regionOwnedCounts.get(rid) ?? 0) + 1);
    }
    for (const [rid, ownedCount] of regionOwnedCounts.entries()) {
      const regionSize = regionSizes.get(rid) ?? 1;
      const bonus = regionById.get(rid)?.bonus ?? 0;
      const controlPct = ownedCount / regionSize;
      regionLeverage += controlPct * controlPct * bonus;
    }

    let largestComponent = 0;
    const visited = new Set<string>();
    for (const start of owned) {
      if (visited.has(start)) continue;
      let size = 0;
      const stack = [start];
      visited.add(start);
      while (stack.length > 0) {
        const cur = stack.pop()!;
        size++;
        for (const n of adjacency.get(cur) ?? []) {
          if (!ownedSet.has(n) || visited.has(n)) continue;
          visited.add(n);
          stack.push(n);
        }
      }
      largestComponent = Math.max(largestComponent, size);
    }
    const cohesionPct = territories > 0 ? (largestComponent / territories) * 100 : 0;

    let externalBorders = 0;
    let totalAdj = 0;
    for (const tid of owned) {
      const neighbors = adjacency.get(tid) ?? [];
      totalAdj += neighbors.length;
      for (const n of neighbors) {
        if (!ownedSet.has(n)) externalBorders++;
      }
    }
    const borderExposure = totalAdj > 0 ? externalBorders / totalAdj : 1;

    // Objective blend: region value + cohesion + footprint - vulnerability
    const raw =
      regionLeverage * 14 +
      cohesionPct * 0.4 +
      territories * 1.8 -
      borderExposure * 18;

    return {
      playerId: p.player_id,
      playerName: p.username,
      color: p.color,
      territories,
      cohesionPct,
      regionLeverage,
      raw,
    };
  });

  const rawScores = rawRows.map((r) => r.raw);
  const minRaw = Math.min(...rawScores);
  const maxRaw = Math.max(...rawScores);
  const range = Math.max(1e-6, maxRaw - minRaw);

  const ratings = rawRows
    .map((r) => {
      const normalized = maxRaw === minRaw ? 75 : 40 + ((r.raw - minRaw) / range) * 58;
      const score = Math.max(0, Math.min(100, normalized));
      return {
        playerId: r.playerId,
        playerName: r.playerName,
        color: r.color,
        score,
        grade: gradeFromDraftScore(score),
        territories: r.territories,
        cohesionPct: r.cohesionPct,
        regionLeverage: r.regionLeverage,
      };
    })
    .sort((a, b) => b.score - a.score);

  return {
    type: 'draft_summary',
    turnNumber: state.turn_number,
    ratings,
  };
}

export default function GamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const {
    gameState, setGameState, lastCombatResult, setLastCombatResult,
    draftUnitsRemaining, setDraftUnitsRemaining, clearGame,
  } = useGameStore();
  const {
    selectedTerritory,
    attackSource,
    navalSource,
    setSelectedTerritory,
    setAttackSource,
    setFortifyUnits,
    setNavalSource,
  } = useUiStore();

  const [mapData, setMapData] = useState<MapData | null>(null);
  const [combatLog, setCombatLog] = useState<string[]>([]);
  const [gameStarted, setGameStarted] = useState(false);
  const [isStartingGame, setIsStartingGame] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [mapView, setMapView] = useState<'2d' | 'globe'>(getInitialMapView);
  const [galaxyOverviewMode, setGalaxyOverviewMode] = useState(true);
  /** Socket `game:joined` seat — resolves viewer player_id before auth.user hydrates */
  const [joinPlayerIndex, setJoinPlayerIndex] = useState<number | null>(null);
  const joinPlayerIndexRef = useRef<number | null>(null);
  const [focusedWorldId, setFocusedWorldId] = useState<string>('earth');
  /** Brief lore header when drilling into a galaxy world (or switching world tabs). */
  const [galaxyWorldBanner, setGalaxyWorldBanner] = useState<{
    display_name: string;
    tagline: string;
  } | null>(null);
  const [globeSpinEnabled, setGlobeSpinEnabled] = useState(getGlobeSpinPreference);
  const [mobileHudOpen, setMobileHudOpen] = useState(false);
  const [liteModeEnabled, setLiteModeEnabled] = useState(() => isLiteMode());
  const [mobileCardsTrayOpen, setMobileCardsTrayOpen] = useState(false);
  const mapDataRef = useRef<MapData | null>(null);
  const resetViewRef = useRef<(() => void) | null>(null);

  // Active interaction HUD pill
  const activeInteractionLabel = useMemo(() => {
    if (navalSource) {
      const name = mapDataRef.current?.territories.find(t => t.territory_id === navalSource)?.name ?? navalSource;
      return `🚢 Fleet source: ${name}`;
    }
    if (attackSource && gameState) {
      const name = mapDataRef.current?.territories.find(t => t.territory_id === attackSource)?.name ?? attackSource;
      if (gameState.phase === 'fortify') return `→ Fortifying from: ${name}`;
      return `⚔ Attacking from: ${name}`;
    }
    return null;
  }, [navalSource, attackSource, gameState]);

  /** Once per game session: default globe, overriding any stale 2D localStorage preference. */
  const globeDefaultAppliedRef = useRef(false);

  /** Prefetch globe vendor chunks when the user prefers globe or may switch soon. */
  useEffect(() => {
    if (!gameStarted || !gameState) return;
    if (mapView !== 'globe') return;
    preloadGlobeChunks();
  }, [gameStarted, gameState, mapView]);

  const switchToGlobeView = useCallback(() => {
    preloadGlobeChunks();
    setMapView('globe');
    persistMapView('globe');
  }, []);
  const [tutorialStep, setTutorialStep] = useState(0);
  const isTutorial = gameState?.settings?.tutorial === true;
  const tutorialLessonModule = (gameState?.settings?.tutorial_lesson_module ?? 'core') as TutorialLessonModule;
  const tutorialSteps = useMemo(
    () => getTutorialSteps(tutorialLessonModule),
    [tutorialLessonModule],
  );

  // Keep a ref to the current user so socket handlers never close over a stale value
  const userRef = useRef(user);
  userRef.current = user;
  const resolvedViewerPlayerIdRef = useRef<string | null>(null);

  useEffect(() => {
    setJoinPlayerIndex(null);
    joinPlayerIndexRef.current = null;
  }, [gameId]);

  useEffect(() => {
    if (isTutorial) setTutorialStep(0);
    setTutorialAppliedSettings([]);
  }, [gameId]);

  const resolvedViewerPlayerId = useMemo(() => {
    if (!gameState || joinPlayerIndex == null) return null;
    return gameState.players[joinPlayerIndex]?.player_id ?? null;
  }, [gameState, joinPlayerIndex]);
  resolvedViewerPlayerIdRef.current = resolvedViewerPlayerId;

  // When the server emits `game:campaign_advanced`, we stash the campaign_id so
  // that dismissing the game-over modal routes back to the right campaign detail.
  // (Also set on loss via looking at game settings — see handleGameOverDismiss.)
  const campaignAdvancedRef = useRef<{ campaign_id: string; next_era: string } | null>(null);

  // ── Map visual events (globe + 2D) — server-authoritative ─────────────────
  const {
    mapVisualEvents,
    globeEvents,
    handleMapVisualEvent,
    pushMapVisualLocal,
    onMapVisualDone,
  } = useMapVisualEvents();
  const eventCardVisualSeenRef = useRef(new Set<string>());
  const mapVisualEventsRef = useRef(mapVisualEvents);
  mapVisualEventsRef.current = mapVisualEvents;

  const mapAmbientEnabled = useMemo(() => {
    if (!gameState || gameState.phase === 'game_over') return false;
    return !prefersReducedMotion() && !liteModeEnabled;
  }, [gameState, liteModeEnabled]);

  const galaxyPulse = useGalaxyMapVisualPulse(mapVisualEvents, mapData, mapAmbientEnabled);

  const turnHolderPlayer = gameState?.players[gameState.current_player_index ?? 0];

  const contestedBorders = useMemo(() => {
    if (!gameState || !mapData || !mapAmbientEnabled) return [];
    return computeContestedBorders(
      gameState.territories,
      mapData.connections,
      turnHolderPlayer?.player_id,
      gameState.phase,
    );
  }, [gameState, mapData, mapAmbientEnabled, turnHolderPlayer?.player_id]);

  // ── Action Modal state ──────────────────────────────────────────────────
  const [modalQueue, setModalQueue] = useState<ModalData[]>([]);
  const [notifState, setNotifState] = useState<{ data: NotificationData; key: number } | null>(null);
  const notifCounter = useRef(0);
  const [coachingTip, setCoachingTip] = useState<{
    turn: number;
    category: string;
    title: string;
    body: string;
  } | null>(null);
  const prevPlayerIndexRef = useRef<number | null>(null);
  const prevPhaseRef = useRef<string | null>(null);
  const draftSummaryShownRef = useRef(false);
  const pendingDraftSummaryRef = useRef<ClientGameState | null>(null);
  const otherTurnCombatsRef = useRef<CombatResult[]>([]);
  const ownTurnCombatsRef = useRef<CombatResult[]>([]);
  const ownTurnReinforcementsRef = useRef<ReinforcementEntry[]>([]);
  const ownTurnFortificationsRef = useRef<FortifyEntry[]>([]);
  const tutorialStepRef = useRef(tutorialStep);
  tutorialStepRef.current = tutorialStep;
  const tutorialStepsRef = useRef(tutorialSteps);
  tutorialStepsRef.current = tutorialSteps;
  const [socketConnection, setSocketConnection] = useState<'connected' | 'disconnected' | 'reconnecting'>('connected');
  // Track the last disconnect reason so we can show different banner copy for
  // "your network dropped" (transient) vs "the server forced us off" (likely
  // permanent without a manual refresh). Socket.io's `disconnect` callback
  // emits a small set of canonical reasons — see https://socket.io/docs/v4/client-api/#event-disconnect
  const [disconnectReason, setDisconnectReason] = useState<string | null>(null);
  const [lobbySnapshot, setLobbySnapshot] = useState<GameLobbySnapshot | null>(null);
  const [lobbyLoadError, setLobbyLoadError] = useState<string | null>(null);
  const lobbyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track the user's requested faction from lobby selection
  const requestedFactionRef = useReactRef<string | null>(null);
  // Track if notification has been shown for faction assignment
  const factionNotifShownRef = useReactRef(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showTechTree, setShowTechTree] = useState(false);
  const [techTree, setTechTree] = useState<TechNode[]>([]);
  const [showBonuses, setShowBonuses] = useState(false);
  const [showSettingsLab, setShowSettingsLab] = useState(false);
  const [tutorialAppliedSettings, setTutorialAppliedSettings] = useState<string[]>([]);
  const [strikeAnim, setStrikeAnim] = useState<{
    abilityId: StrikeAnimationVariant;
    targetName: string;
    unitReduction?: number;
    key: number;
  } | null>(null);
  const [mapStrikeFlash, setMapStrikeFlash] = useState<MapStrikeFlashProps | null>(null);
  const mapStrikeFlashKeyRef = useRef(0);
  const [activeEventCard, setActiveEventCard] = useState<EventCard | null>(null);
  const [truceProposal, setTruceProposal] = useState<{
    gameId: string;
    proposerId: string;
    proposerName: string;
    proposerColor: string;
  } | null>(null);

  const [truceBreakerConfirm, setTruceBreakerConfirm] = useState<{
    fromId: string;
    toId: string;
    defenderName: string;
    defenderColor: string;
  } | null>(null);

  const [wonderNotif, setWonderNotif] = useState<{
    wonderId: string;
    builderName: string;
    builderColor: string;
    territoryId: string;
  } | null>(null);
  const wonderNotifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Prevents double-submission during territory draft (rapid double-click or both
  // click-direct and panel-button firing before the server state update arrives).
  const territorySelectPendingRef = useRef(false);

  const [puzzleFeedback, setPuzzleFeedback] = useState<{ tier: string; message: string } | null>(null);
  const puzzleFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Tutorial-end account prompt state. We capture the next action (lobby vs.
   * stay) so the modal's "Maybe later" path can complete the user's original
   * intent without losing their place in the flow.
   */
  const [tutorialAccountPrompt, setTutorialAccountPrompt] = useState<null | {
    onContinue: () => void;
    outcomeLabel?: string;
  }>(null);
  const [postTutorialPrompt, setPostTutorialPrompt] = useState(false);
  const [postTutorialStarting, setPostTutorialStarting] = useState(false);

  /**
   * Daily challenge / campaign intro modals — shown once per game (gated on
   * sessionStorage). For daily we pull the spec out of the lobby snapshot or
   * game state once it lands.
   */
  const [showDailyIntro, setShowDailyIntro] = useState(false);
  const dailyIntroSeenRef = useRef(false);
  const [showCampaignIntro, setShowCampaignIntro] = useState(false);
  const campaignIntroSeenRef = useRef(false);

  /** Map area is flex-sized; measure it so Globe/PIXI get real pixels when the viewport changes (devtools, rotate, resize). */
  const mapAreaRef = useRef<HTMLDivElement>(null);
  const [mapCanvasSize, setMapCanvasSize] = useState(() => {
    if (typeof window === 'undefined') return { w: 900, h: 600 };
    const hud =
      window.innerWidth < 768
        ? Math.min(260, Math.floor(window.innerWidth * 0.36))
        : 288;
    return {
      w: Math.max(120, window.innerWidth - hud),
      h: Math.max(200, window.innerHeight - 40),
    };
  });

  useLayoutEffect(() => {
    if (!gameStarted || !gameState) return;
    const el = mapAreaRef.current;
    if (!el) return;

    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      const w = Math.max(120, Math.floor(width));
      const h = Math.max(200, Math.floor(height));
      setMapCanvasSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };

    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [gameStarted, gameState]);

  useEffect(() => {
    globeDefaultAppliedRef.current = false;
    draftSummaryShownRef.current = false;
    pendingDraftSummaryRef.current = null;
  }, [gameId]);

  /** Default every game to globe on first load, clearing any stale 2D localStorage preference. */
  useEffect(() => {
    if (!gameStarted || !gameState) return;
    if (globeDefaultAppliedRef.current) return;
    globeDefaultAppliedRef.current = true;
    setMapView('globe');
    persistMapView('globe');
    preloadGlobeChunks();
  }, [gameStarted, gameState]);

  // Global keyboard shortcuts while in-game
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Don't fire while typing in an input or textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === '?') setShowShortcuts((s) => !s);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (draftSummaryShownRef.current) return;
    if (!mapData) return;
    if (!pendingDraftSummaryRef.current) return;
    setModalQueue((prev) => [...prev, buildDraftSummaryModal(pendingDraftSummaryRef.current!, mapData)]);
    pendingDraftSummaryRef.current = null;
    draftSummaryShownRef.current = true;
  }, [mapData]);

  const pushModal = useCallback((data: ModalData) => {
    setModalQueue(prev => [...prev, data]);
  }, []);

  const dismissModal = useCallback(() => {
    setModalQueue(prev => prev.slice(1));
  }, []);

  const showNotification = useCallback((data: NotificationData) => {
    notifCounter.current++;
    setNotifState({ data, key: notifCounter.current });
  }, []);

  // ── Socket setup ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!gameId) return;

    connectSocket();
    const socket = getSocket();

    const joinGame = () => {
      setLobbyLoadError(null);
      socket.emit('game:join', { gameId });
      // Start a 15-second timeout so the user gets an escape hatch if the
      // server never sends game:lobby_updated (e.g. 500 on join, bad gameId).
      if (lobbyTimeoutRef.current) clearTimeout(lobbyTimeoutRef.current);
      lobbyTimeoutRef.current = setTimeout(() => {
        setLobbyLoadError('Could not reach the game server. The game may no longer exist.');
      }, 15_000);
    };

    joinGame();

    const onConnect = () => {
      setSocketConnection('connected');
      setDisconnectReason(null);
      joinGame();
    };
    const onDisconnect = (reason: string) => {
      setSocketConnection('disconnected');
      setDisconnectReason(reason);
    };
    const onReconnectAttempt = () => setSocketConnection('reconnecting');

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.io.on('reconnect_attempt', onReconnectAttempt);
    if (socket.connected) {
      setSocketConnection('connected');
    }

    socket.on('game:joined', ({ playerIndex }: { playerIndex: number }) => {
      setIsHost(playerIndex === 0);
      setJoinPlayerIndex(playerIndex);
      joinPlayerIndexRef.current = playerIndex;
    });

    // The server embeds the resolved map in the game-join handshake and again
    // on game:start so private/pending custom maps don't need to be fetched
    // via the public REST endpoint (which now requires public+approved or
    // creator-owned access).
    socket.on('game:map', (payload: { mapId: string; map: MapData }) => {
      if (!payload?.map) return;
      setMapData(payload.map);
      mapDataRef.current = payload.map;
    });

    socket.on('game:lobby_updated', (payload: unknown) => {
      const next = normalizeLobbySnapshot(payload);
      if (next) {
        setLobbySnapshot(next);
        setLobbyLoadError(null);
        if (lobbyTimeoutRef.current) {
          clearTimeout(lobbyTimeoutRef.current);
          lobbyTimeoutRef.current = null;
        }
      }
    });

    socket.on('game:state', (state: ClientGameState) => {
      // Guard against cross-game state bleed: the socket is a singleton, so a
      // stale room subscription from a previously-open game can deliver that
      // game's broadcasts here. Ignore any state that isn't for this route's
      // game so the view doesn't flicker between two games.
      if (state.game_id && state.game_id !== gameId) return;
      // Reconnecting players only receive game:state, not game:started — keep UI in sync
      if (lobbyTimeoutRef.current) {
        clearTimeout(lobbyTimeoutRef.current);
        lobbyTimeoutRef.current = null;
      }
      setLobbyLoadError(null);
      setGameStarted(true);
      setGameState(state);
      // Clear territory-select pending flag so the next player's turn is interactive.
      territorySelectPendingRef.current = false;
      const myId = userRef.current?.user_id;
      const myName = userRef.current?.username;
      const prevDraft = useGameStore.getState().draftUnitsRemaining;
      const seatPid =
        joinPlayerIndexRef.current != null
          ? state.players[joinPlayerIndexRef.current]?.player_id ?? null
          : null;
      setDraftUnitsRemaining(computeDraftPool(state, myId, myName, prevDraft, seatPid));

      // ── Turn change detection ────────────────────────────────────────
      const newIndex = state.current_player_index;
      const prevIndex = prevPlayerIndexRef.current;
      const playerChanged = prevIndex !== null && prevIndex !== newIndex;

      if (playerChanged) {
        const prevPlayer = state.players[prevIndex];
        if (prevPlayer && prevPlayer.player_id === myId) {
          const myPlayerData = state.players.find((p: { player_id: string }) => p.player_id === myId);
          const combats = [...ownTurnCombatsRef.current];
          const reinforcements = [...ownTurnReinforcementsRef.current];
          const fortifications = [...ownTurnFortificationsRef.current];
          if (combats.length > 0 || reinforcements.length > 0 || fortifications.length > 0) {
            setModalQueue(q => [...q, {
              type: 'turn_summary' as const,
              playerName: myPlayerData?.username ?? prevPlayer.username,
              playerColor: myPlayerData?.color ?? prevPlayer.color,
              turnNumber: state.turn_number,
              combats,
              isOwnTurn: true,
              reinforcements,
              fortifications,
            }]);
          }
          ownTurnCombatsRef.current = [];
          ownTurnReinforcementsRef.current = [];
          ownTurnFortificationsRef.current = [];
        } else if (prevPlayer && !prevPlayer.is_eliminated) {
          const combats = [...otherTurnCombatsRef.current];
          setModalQueue(q => [...q, {
            type: 'turn_summary' as const,
            playerName: prevPlayer.username,
            playerColor: prevPlayer.color,
            turnNumber: state.turn_number,
            combats,
          }]);
        }
        otherTurnCombatsRef.current = [];
      }

      // ── Phase change notification (own turn only, mid-turn) ──────────
      const isMyTurn = state.players[newIndex]?.player_id === myId;
      const prevPhase = prevPhaseRef.current;

      if (
        !draftSummaryShownRef.current &&
        prevPhase === 'territory_select' &&
        state.phase === 'draft' &&
        state.turn_number === 1
      ) {
        if (mapDataRef.current) {
          pushModal(buildDraftSummaryModal(state, mapDataRef.current));
          draftSummaryShownRef.current = true;
        } else {
          pendingDraftSummaryRef.current = state;
        }
      }

      if (!playerChanged && prevPhase && prevPhase !== state.phase && isMyTurn) {
        const labels: Record<string, string> = {
          attack: 'ATTACK PHASE',
          fortify: 'FORTIFY PHASE',
        };
        if (labels[state.phase]) {
          notifCounter.current++;
          setNotifState({
            data: {
              type: 'phase_change',
              text: labels[state.phase],
              icon: state.phase === 'attack' ? 'sword' : 'arrow',
              accentBg: 'bg-amber-500/20',
              accentBorder: 'border-amber-500/30',
              accentText: 'text-amber-400',
            },
            key: notifCounter.current,
          });
        }
      }

      // Clear stale attack/fleet selection so a leftover source territory can't
      // drive a wrong fortify emit or a misleading HUD pill after the turn moves
      // on (reconnect, opponent's turn ends) or the phase changes underneath us.
      // attackSource doubles as the fortify source, so any phase/turn shift that
      // invalidates the current selection should reset it.
      const phaseChanged = !!prevPhase && prevPhase !== state.phase;
      if (playerChanged || (phaseChanged && !isMyTurn) || (phaseChanged && state.phase === 'fortify')) {
        useUiStore.getState().reset();
        // The truce-break confirm modal lives in local state (not uiStore); clear
        // it too so it can't submit an attack with stale from/to after the turn moves on.
        setTruceBreakerConfirm(null);
      }

      prevPlayerIndexRef.current = newIndex;
      prevPhaseRef.current = state.phase;

      // Auto-advance tutorial steps on phase changes and draft completion
      if (state.settings?.tutorial) {
        const myId = userRef.current?.user_id;
        const myName = userRef.current?.username;
        const me = state.players.find(
          (p) => p.player_id === myId || (!!myName && p.username === myName),
        );
        const isMyDraftTurn =
          state.phase === 'draft' &&
          !!me &&
          state.players[state.current_player_index]?.player_id === me.player_id;
        const seatPidTut =
          joinPlayerIndexRef.current != null
            ? state.players[joinPlayerIndexRef.current]?.player_id ?? null
            : null;
        const draftLeft = isMyDraftTurn
          ? computeDraftPool(state, myId, myName, state.draft_units_remaining ?? 0, seatPidTut)
          : -1;

        setTutorialStep((cur) => {
          const step = tutorialStepsRef.current[cur];
          if (!step) return cur;
          const shouldAdvance = shouldAdvanceTutorialOnState({
            step,
            prevPhase,
            nextPhase: state.phase,
            playerChanged,
            prevPlayerIndex: prevIndex,
            newPlayerIndex: newIndex,
            myPlayerId: me?.player_id ?? null,
            players: state.players,
            isMyDraftTurn,
            draftLeft,
          });
          return shouldAdvance ? cur + 1 : cur;
        });
      }
    });

    socket.on('game:started', () => {
      setIsStartingGame(false);
      setGameStarted(true);
      toast.success('Game started! Good luck, Commander!');
    });

    socket.on('game:puzzle_feedback', (payload: { gameId?: string; tier: string; message: string }) => {
      if (payload.gameId && gameId && payload.gameId !== gameId) return;
      setPuzzleFeedback({ tier: payload.tier, message: payload.message });
      if (puzzleFeedbackTimerRef.current) clearTimeout(puzzleFeedbackTimerRef.current);
      puzzleFeedbackTimerRef.current = setTimeout(() => setPuzzleFeedback(null), 8000);
    });

    socket.on('game:combat_result', (data: {
      fromId: string; toId: string;
      result: {
        attacker_rolls: number[];
        defender_rolls: number[];
        attacker_losses: number;
        defender_losses: number;
        territory_captured: boolean;
        attacker_bonus_breakdown?: { tech?: number; faction?: number; event?: number; total?: number };
        defender_bonus_breakdown?: { building?: number; tech?: number; faction?: number; event?: number; wonder?: number; sea?: number; total?: number };
      };
    }) => {
      const currentMap = mapDataRef.current;
      const state = useGameStore.getState().gameState;

      const fromName = currentMap?.territories.find(t => t.territory_id === data.fromId)?.name ?? data.fromId;
      const toName = currentMap?.territories.find(t => t.territory_id === data.toId)?.name ?? data.toId;
      const attackerOwner = state?.territories[data.fromId]?.owner_id;
      const defenderOwner = state?.territories[data.toId]?.owner_id;
      const attackerName = state?.players.find(p => p.player_id === attackerOwner)?.username ?? 'Unknown';
      const defenderName = state?.players.find(p => p.player_id === defenderOwner)?.username ?? 'Unknown';

      const enriched: CombatResult = {
        ...data.result,
        fromName,
        toName,
        attackerId: attackerOwner ?? null,
        defenderId: defenderOwner ?? null,
        attackerName,
        defenderName,
      };

      setLastCombatResult(enriched);
      hapticImpact(ImpactStyle.Heavy);

      const isMyAttack = attackerOwner === userRef.current?.user_id;
      const isMyDefense = defenderOwner === userRef.current?.user_id;

      const { attacker_losses, defender_losses, territory_captured } = data.result;
      const preFromUnits = state?.territories[data.fromId]?.unit_count ?? 0;
      const unitsAfterOnSource = preFromUnits - attacker_losses;
      const canRepeatAttack =
        isMyAttack &&
        !territory_captured &&
        unitsAfterOnSource >= 2;

      if (isMyAttack) {
        setModalQueue(q => [
          ...q,
          {
            type: 'combat' as const,
            result: enriched,
            perspective: 'attacker' as const,
            ...(canRepeatAttack ? { repeatAttack: { fromId: data.fromId, toId: data.toId } } : {}),
          },
        ]);
        ownTurnCombatsRef.current.push(enriched);
      } else if (isMyDefense) {
        setModalQueue(q => [...q, { type: 'combat' as const, result: enriched, perspective: 'defender' as const }]);
        otherTurnCombatsRef.current.push(enriched);
      } else {
        otherTurnCombatsRef.current.push(enriched);
      }

      // Always append to combat log sidebar
      let logEntry = `${attackerName} attacked ${toName} from ${fromName}`;
      if (attacker_losses > 0 && defender_losses > 0) {
        logEntry += ` — both sides lost ${attacker_losses === defender_losses ? `${attacker_losses}` : `${attacker_losses} and ${defender_losses}`} troops`;
      } else if (attacker_losses > 0) {
        logEntry += ` — lost ${attacker_losses} troop${attacker_losses > 1 ? 's' : ''}`;
      } else if (defender_losses > 0) {
        logEntry += ` — destroyed ${defender_losses} defender${defender_losses > 1 ? 's' : ''}`;
      }
      if (territory_captured) {
        logEntry += ` and captured ${toName}!`;
      }
      setCombatLog((prev) => [...prev, logEntry]);

      // Map visuals arrive via game:map_visual from the server (all clients).
    });

    socket.on('game:map_visual', (payload: MapVisualEvent) => {
      markEventCardVisualSeen(payload, eventCardVisualSeenRef.current);
      handleMapVisualEvent(payload);
    });

    socket.on('game:cards_redeemed', ({ bonus }: { bonus: number }) => {
      hapticNotification(NotificationType.Success);
      toast.success(`Card set redeemed! +${bonus} bonus units`);
      const curr = useGameStore.getState().draftUnitsRemaining;
      setDraftUnitsRemaining(curr + bonus);
    });

    socket.on('game:over', (stats: {
      winner_id: string;
      winner_ids?: string[];
      winner_name: string;
      turn_count: number;
      duration_ms?: number | null;
      ai_difficulty?: 'easy' | 'medium' | 'hard' | 'expert' | 'tutorial' | null;
      players: Array<{
        player_id: string; username: string; color: string;
        territory_count: number;
        peak_territory_count?: number;
        cards_redeemed_count?: number;
        card_set_bonus_units?: number;
        unlocked_techs_count?: number;
        buildings_built_count?: number;
        is_eliminated: boolean; is_ai: boolean;
      }>;
      win_probability_history?: Array<{ step: number; turn: number; probabilities: Record<string, number> }>;
      rating_deltas?: Record<string, number>;
      is_ranked?: boolean;
      achievements_unlocked?: Record<string, string[]>;
      xp_earned_by_player?: Record<string, number>;
      victory_condition?: 'domination' | 'last_standing' | 'threshold' | 'capital' | 'secret_mission' | 'alliance_victory' | 'abandoned';
      progression?: Record<string, { win_streak: number; daily_streak: number; daily_streak_milestone: number | null; gold_awarded: number; gold_multiplier: number; level_cosmetic: string | null; friend_streak_bonus?: number }>;
      rematch_config?: { era_id: string; map_id: string; settings: Record<string, unknown>; human_player_ids: string[] };
      combat_stats?: Record<string, {
        attacks: number; attack_wins: number; defenses: number; defense_wins: number;
        territories_captured: number;
        units_lost?: number; units_destroyed?: number; sea_attacks?: number; eliminations_dealt?: number;
      }>;
      decision_summary?: GameOverModalData['decision_summary'];
    }) => {
      const myId = userRef.current?.user_id;
      const xpEarned =
        myId && stats.xp_earned_by_player ? stats.xp_earned_by_player[myId] : undefined;
      const currentEra = useGameStore.getState().gameState?.era;
      const winnerIds = stats.winner_ids ?? [stats.winner_id];
      const myProgression = myId && stats.progression ? stats.progression[myId] : undefined;
      const vc = stats.victory_condition;
      const probHistory = stats.win_probability_history ?? [];
      const lastProbSnap = probHistory.length > 0 ? probHistory[probHistory.length - 1] : null;
      const myLastWinProb =
        myId && lastProbSnap ? (lastProbSnap.probabilities[myId] ?? 1) : 1;
      const mySeat = myId ? stats.players.find((p) => p.player_id === myId) : undefined;
      const allowReplayDespiteAbandon =
        vc === 'abandoned' &&
        !!mySeat &&
        !mySeat.is_ai &&
        myLastWinProb < LOW_ODDS_ABANDON_REPLAY_THRESHOLD;
      const gameOverData: GameOverModalData = {
        type: 'game_over',
        gameId: gameId as string,
        isWinner: !!myId && winnerIds.includes(myId),
        winnerName: stats.winner_name,
        winnerColor: stats.players.find(p => p.player_id === stats.winner_id)?.color ?? '#fff',
        turnCount: stats.turn_count,
        players: stats.players,
        win_probability_history: stats.win_probability_history,
        rating_change: myId && stats.rating_deltas ? stats.rating_deltas[myId] : undefined,
        is_ranked: stats.is_ranked,
        achievements_unlocked: myId && stats.achievements_unlocked ? stats.achievements_unlocked[myId] : undefined,
        xpEarned,
        victory_condition: stats.victory_condition,
        eraName: currentEra ? (ERA_LABELS[currentEra] ?? currentEra) : undefined,
        winnerIds,
        progression: myProgression,
        rematchConfig: stats.rematch_config,
        combat_stats: stats.combat_stats,
        xp_earned_by_player: stats.xp_earned_by_player,
        rating_deltas: stats.rating_deltas,
        duration_ms: stats.duration_ms ?? null,
        ai_difficulty: stats.ai_difficulty ?? null,
        decision_summary: stats.decision_summary,
        allowReplayDespiteAbandon,
      };
      if (gameId) {
        api
          .get<{ insights: Array<{ turn: number; title: string; impact: 'high' | 'medium'; explanation: string; alternative: string }> }>(
            `/enhancements/matches/${gameId}/insights`,
          )
          .then((res) => {
            setModalQueue((q) => [...q, { ...gameOverData, insights: res.data.insights }]);
          })
          .catch(() => {
            setModalQueue((q) => [...q, gameOverData]);
          });
        return;
      }
      setModalQueue(q => [...q, gameOverData]);
    });

    socket.on('game:player_eliminated', ({ playerId, eliminatorName, eliminatedName, secretMission }: {
      playerId: string; eliminatorId: string; eliminatorName: string; eliminatedName: string;
      secretMission?: any;
    }) => {
      const isSelf = playerId === userRef.current?.user_id;
      const elData: EliminationModalData = {
        type: 'elimination',
        eliminatedName,
        eliminatorName,
        isSelf,
        secretMission: secretMission ?? null,
      };
      setModalQueue(q => [...q, elData]);
    });

    socket.on('game:player_resigned', ({ playerName }: { playerId: string; playerName: string }) => {
      toast(`${playerName} has surrendered!`, { icon: '🏳️', duration: 4000 });
    });

    socket.on('game:build_result', ({ success, error }: { success: boolean; error?: string }) => {
      if (!success) toast.error(error ?? 'Build failed');
      else toast.success('Building constructed!', { duration: 2000 });
    });

    socket.on('game:tutorial_settings_applied', ({ applied }: { applied: string[] }) => {
      if (applied.length > 0) {
        setTutorialAppliedSettings(applied);
        toast.success(`Settings active: ${applied.join(', ')}`, { icon: '⚙️', duration: 4500 });
      }
    });

    socket.on('game:research_result', ({ success, error, node }: { success: boolean; error?: string; node?: TechNode }) => {
      if (!success) toast.error(error ?? 'Research failed');
      else {
        toast.success(`Researched: ${node?.name ?? 'technology'}`, { icon: '🔬', duration: 3000 });
        const gs = useGameStore.getState().gameState;
        if (gs?.settings?.tutorial) {
          const step = tutorialStepsRef.current[tutorialStepRef.current];
          if (step?.requireAction === 'tech_researched') {
            setTutorialStep((s) => s + 1);
          }
        }
      }
    });

    socket.on('game:naval_combat_result', ({ fromId, toId, result }: {
      fromId: string; toId: string;
      result: { attacker_won: boolean; attacker_losses: number; defender_losses: number };
    }) => {
      const mapData = mapDataRef.current;
      const fromName = mapData?.territories.find((t) => t.territory_id === fromId)?.name ?? fromId;
      const toName = mapData?.territories.find((t) => t.territory_id === toId)?.name ?? toId;
      const outcome = result.attacker_won
        ? `Fleet victory — ${fromName} broke through to ${toName}`
        : `Fleet repelled — defenders held ${toName}`;
      toast(outcome, { icon: '⚓', duration: 3000 });
      setCombatLog((prev) => [
        ...prev,
        `Naval: ${fromName} → ${toName}: ${result.attacker_won ? 'attacker won' : 'defender held'} (−${result.attacker_losses} / −${result.defender_losses} fleets)`,
      ]);
      // Map animation via game:map_visual (all clients).
    });

    socket.on('game:influence_result', ({ success, targetId, error, variant }: {
      success: boolean;
      targetId?: string;
      error?: string;
      variant?: 'seize' | 'garibaldi' | 'detente';
    }) => {
      const mapData = mapDataRef.current;
      const targetName = targetId ? (mapData?.territories.find((t) => t.territory_id === targetId)?.name ?? targetId) : 'territory';
      if (success) {
        const label = variant === 'garibaldi' ? "Garibaldi's Redshirts"
          : variant === 'detente' ? 'Détente influence'
            : 'Influence';
        toast.success(`📡 ${label} — ${targetName} seized!`, { duration: 3000 });
        setCombatLog((prev) => [...prev, `Influence: ${targetName} seized via ${label.toLowerCase()}`]);
      } else {
        toast.error(error ?? 'Influence failed');
      }
    });

    socket.on('game:event_card', (card: EventCard) => {
      setActiveEventCard(card);
      scheduleEventCardMapVisualBackup(
        card,
        (cardId) => mapVisualEventsRef.current.some((e) => e.kind === 'event' && e.cardId === cardId),
        pushMapVisualLocal,
        eventCardVisualSeenRef.current,
      );
    });

    socket.on('game:ability_result', (result: {
      abilityId?: string;
      success?: boolean;
      effect?: string;
      territoryId?: string;
    }) => {
      if (result.effect === 'pre_attack_damage_ready' && result.abilityId === 'air_strike') {
        toast('✈️ Air Strike armed — your next attack deals +1 damage before combat', {
          duration: 4500,
          style: { background: '#0f172a', border: '1px solid #64748b', color: '#cbd5e1' },
        });
      }

      if (result.abilityId === 'guerrilla_warfare' && result.success !== false) {
        const tName = result.territoryId
          ? (mapDataRef.current?.territories.find(t => t.territory_id === result.territoryId)?.name ?? 'territory')
          : 'territory';
        showNotification({
          type: 'reinforce',
          text: `🌿 Guerrilla Warfare — +1 free unit on ${tName}`,
          subtext: 'China\'s ability recharges each turn',
          icon: 'shield',
          accentBg: 'bg-emerald-500/20',
          accentBorder: 'border-emerald-500/30',
          accentText: 'text-emerald-400',
        });
      }

      const gs = useGameStore.getState().gameState;
      if (gs?.settings?.tutorial && result.success !== false) {
        const step = tutorialStepsRef.current[tutorialStepRef.current];
        if (step?.requireAction === 'ability_used') {
          // Delay advancing so the player can see the result notification and
          // the updated unit count on the globe before the overlay switches.
          setTimeout(() => {
            setTutorialStep((s) => s + 1);
          }, 1500);
        }
      }
    });

    socket.on('game:event_card_resolved', () => {
      setActiveEventCard(null);
    });

    socket.on('game:truce_proposal', (proposal: {
      gameId: string;
      proposerId: string;
      proposerName: string;
      proposerColor: string;
    }) => {
      setTruceProposal(proposal);
    });

    socket.on('game:truce_result', (result: {
      accepted?: boolean;
      pending?: boolean;
      targetName?: string;
      proposerName?: string;
      proposerId?: string;
      targetId?: string;
    }) => {
      const myId = useAuthStore.getState().user?.user_id;
      if (result.pending) {
        toast(`Truce proposal sent to ${result.targetName ?? 'player'}`, { icon: '🤝', duration: 3000 });
      } else if (result.accepted) {
        // result.targetId is the responder; if I'm the responder, show the proposer's name instead
        const iAmResponder = result.targetId === myId;
        const otherName = iAmResponder
          ? (result.proposerName ?? 'player')
          : (result.targetName ?? result.proposerName ?? 'player');
        toast.success(`Truce accepted with ${otherName}!`, { duration: 4000 });
      } else {
        // result.targetId is the responder (who declined); if I'm the proposer, show targetName
        const iAmProposer = result.proposerId === myId;
        const declinerName = iAmProposer
          ? (result.targetName ?? 'player')
          : (result.proposerName ?? 'player');
        toast(`Truce declined by ${declinerName}`, { icon: '❌', duration: 3000 });
      }
    });

    socket.on('game:truce_broken', (payload: {
      breakerName: string;
      breakerColor: string;
      breakerId: string;
    }) => {
      toast(`${payload.breakerName} broke your truce! You have +1 attack die against them.`, {
        icon: '⚔️',
        duration: 6000,
        style: { borderLeft: `3px solid ${payload.breakerColor}` },
      });
    });

    socket.on('error', ({ message }: { message: string }) => {
      if (
        message === 'Failed to start game' ||
        message === 'Game not found' ||
        message === 'Game cannot be started' ||
        message === 'Map not found'
      ) {
        setIsStartingGame(false);
      }
      // Many gameplay errors (invalid attack target, not enough units,
      // territory not adjacent, build prereqs not met, etc.) come back here
      // *after* the user already optimistically selected a territory in the
      // UI. Leaving the selection highlighted made the next click feel like
      // it had been queued up against the previous (now invalid) selection.
      // Clearing it forces a clean re-pick.
      setSelectedTerritory(null);
      // Also drop transient targeting/confirmation state that could otherwise
      // mis-fire after a rejected action: a stale fleet source would drive the
      // next naval submit, and the truce-break confirm modal auto-submits an
      // attack with its captured from/to when confirmed.
      setNavalSource(null);
      setTruceBreakerConfirm(null);
      // A territory-select pick can be rejected (e.g. not your pick) without a
      // following game:state. Release the in-flight lock here so the player isn't
      // soft-locked out of selecting again.
      territorySelectPendingRef.current = false;
      const gs = useGameStore.getState().gameState;
      const uid = userRef.current?.user_id;
      const uname = userRef.current?.username;
      const seatPid =
        joinPlayerIndexRef.current != null && gs
          ? gs.players[joinPlayerIndexRef.current]?.player_id ?? null
          : null;
      if (gs?.phase === 'draft') {
        setDraftUnitsRemaining(computeDraftPool(gs, uid, uname, 0, seatPid));
        ownTurnReinforcementsRef.current.pop();
      }
      toast.error(message);
    });

    socket.on('game:wonder_built', (payload: {
      wonderId: string;
      builderName: string;
      builderColor: string;
      territoryId: string;
    }) => {
      if (wonderNotifTimerRef.current) clearTimeout(wonderNotifTimerRef.current);
      setWonderNotif(payload);
      wonderNotifTimerRef.current = setTimeout(() => setWonderNotif(null), 4000);
    });

    socket.on('game:space_station_launched', ({ playerName, launchTerritoryId }: {
      playerId: string;
      playerName: string;
      playerColor: string;
      launchTerritoryId: string;
    }) => {
      const tName = mapDataRef.current?.territories.find((t) => t.territory_id === launchTerritoryId)?.name ?? launchTerritoryId;
      const isMe = playerName === user?.username;
      toast(
        isMe
          ? `🚀 You launched a Space Station from ${tName}! Moon access unlocked.`
          : `🚀 ${playerName} launched a Space Station from ${tName}.`,
        {
          duration: 6000,
          style: { background: '#0a0d1f', border: '1px solid #8E9AF2', color: '#c7ceff' },
        },
      );
      setCombatLog((prev) => [...prev, `🚀 ${playerName} launched a Space Station from ${tName}`]);
    });

    const handleStrikeAnimationEvent = (event: StrikeAnimationEvent) => {
      if (!isMapStrikeAbility(event.abilityId)) return;

      const abilityId = event.abilityId as MapStrikeAbilityId;
      const tName = mapDataRef.current?.territories.find((t) => t.territory_id === event.territoryId)?.name
        ?? event.territoryId;

      if (shouldShowFullScreenStrike({
        abilityId,
        prefersReducedMotion: prefersReducedMotion(),
        liteMode: isLiteMode(),
      })) {
        setStrikeAnim((prev) => ({
          abilityId: abilityId as StrikeAnimationVariant,
          targetName: tName,
          unitReduction: event.unitReduction,
          key: (prev?.key ?? 0) + 1,
        }));
      }

      mapStrikeFlashKeyRef.current += 1;
      setMapStrikeFlash({
        territoryId: event.territoryId,
        abilityId,
        key: mapStrikeFlashKeyRef.current,
      });

      const viewer = userRef.current;
      toast(getStrikeToastMessage(event, tName, {
        userId: viewer?.user_id,
        username: viewer?.username,
        resolvedPlayerId: resolvedViewerPlayerIdRef.current,
      }), {
        duration: 6000,
        style: getStrikeToastStyle(abilityId),
      });

      setCombatLog((prev) => [...prev, getStrikeCombatLogLine(event, tName)]);

      // Globe + 2D strike visuals arrive via game:map_visual from emitStrikeAnimation.
    };

    socket.on('game:strike_animation', handleStrikeAnimationEvent);

    // Legacy event — kept so older server builds still trigger visuals during rollout
    socket.on('game:atom_bomb', ({ attackerName, attackerColor, territoryId, attackerId, targetOwnerId, targetOwnerName }: {
      attackerId?: string;
      attackerName: string;
      attackerColor: string;
      territoryId: string;
      targetOwnerId?: string | null;
      targetOwnerName?: string | null;
    }) => {
      handleStrikeAnimationEvent({
        abilityId: 'atom_bomb',
        attackerId: attackerId ?? '',
        attackerName,
        attackerColor,
        territoryId,
        targetOwnerId: targetOwnerId ?? null,
        targetOwnerName: targetOwnerName ?? null,
      });
    });

    socket.on('game:campaign_advanced', ({ campaign_id, next_era }: {
      campaign_id: string;
      next_era: string;
      path_carry?: Record<string, number>;
    }) => {
      campaignAdvancedRef.current = { campaign_id, next_era };
      const nextLabel = ERA_LABELS[next_era] ?? next_era;
      toast.success(`Era cleared — next: ${nextLabel}`, { duration: 4000 });
    });

    socket.on('game:coaching_tip', (tip: { turn: number; category: string; title: string; body: string }) => {
      setCoachingTip(tip);
    });

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      socket.off('game:joined');
      socket.off('game:lobby_updated');
      socket.off('game:state');
      socket.off('game:started');
      socket.off('game:combat_result');
      socket.off('game:cards_redeemed');
      socket.off('game:over');
      socket.off('game:campaign_advanced');
      socket.off('game:coaching_tip');
      socket.off('game:chat_message');
      socket.off('game:player_eliminated');
      socket.off('game:player_resigned');
      socket.off('game:build_result');
      socket.off('game:tutorial_settings_applied');
      socket.off('game:research_result');
      socket.off('game:naval_combat_result');
      socket.off('game:influence_result');
      socket.off('game:event_card');
      socket.off('game:ability_result');
      socket.off('game:event_card_resolved');
      socket.off('game:truce_proposal');
      socket.off('game:truce_result');
      socket.off('game:truce_broken');
      socket.off('error');
      socket.off('game:wonder_built');
      socket.off('game:strike_animation');
      socket.off('game:atom_bomb');
      socket.off('game:map_visual');
      socket.off('game:space_station_launched');
      socket.off('game:puzzle_feedback');
      if (lobbyTimeoutRef.current) {
        clearTimeout(lobbyTimeoutRef.current);
        lobbyTimeoutRef.current = null;
      }
      // Notify server we left so it can schedule eviction / save state
      socket.emit('game:leave', { gameId });
      clearGame();
    };
  }, [gameId]);

  // When auth hydrates after the first game:state, recompute draft so Place controls appear
  useEffect(() => {
    const gs = useGameStore.getState().gameState;
    const uid = user?.user_id;
    const uname = user?.username;
    const seatPid =
      joinPlayerIndex != null ? gs?.players[joinPlayerIndex]?.player_id ?? null : null;
    if (!gs || (!uid && !uname && !seatPid)) return;
    const prev = useGameStore.getState().draftUnitsRemaining;
    setDraftUnitsRemaining(computeDraftPool(gs, uid, uname, prev, seatPid));
  }, [
    user?.user_id,
    user?.username,
    joinPlayerIndex,
    gameState?.draft_units_remaining,
    gameState?.phase,
    gameState?.current_player_index,
    gameState?.turn_number,
  ]);

  // (Tutorial auto-phase-advance effects removed — the player now drives all phase
  //  transitions by clicking Begin Attack Phase / Begin Fortify Phase / End Turn in the HUD.
  //  The advance_draft step uses requireAction:'end_phase' to detect the Draft→Attack click.
  //  The attack_do and fortify_explain steps do the same for subsequent transitions.)

  useEffect(() => {
    if (!isStartingGame) return;
    const timeout = window.setTimeout(() => setIsStartingGame(false), 10_000);
    return () => window.clearTimeout(timeout);
  }, [isStartingGame]);

  const loadLobby = useCallback(() => {
    if (!gameId) return;
    api
      .get(`/games/${gameId}`)
      .then((res) => {
        const next = normalizeLobbySnapshot(res.data);
        if (next) setLobbySnapshot(next);
      })
      .catch(() => setLobbySnapshot(null));
  }, [gameId]);

  // ── Tutorial territory highlight ─────────────────────────────────────────
  const tutorialHighlightId = useMemo<string | undefined>(() => {
    if (!isTutorial || !gameState || !user?.user_id) return undefined;
    const sid = tutorialSteps[tutorialStep]?.id;
    if (!sid) return undefined;
    const myId = user.user_id;
    const isMyTurn = gameState.players[gameState.current_player_index]?.player_id === myId;
    if (!isMyTurn) return undefined;

    if (sid === 'draft_do' && gameState.phase === 'draft') {
      // Highlight the owned territory with the most units (best draft target).
      const owned = Object.entries(gameState.territories)
        .filter(([, t]) => t.owner_id === myId)
        .sort(([, a], [, b]) => b.unit_count - a.unit_count);
      return owned[0]?.[0];
    }
    if (sid === 'attack_do' && gameState.phase === 'attack') {
      // Highlight the owned territory with the most units (best attack source).
      const owned = Object.entries(gameState.territories)
        .filter(([, t]) => t.owner_id === myId && t.unit_count >= 2)
        .sort(([, a], [, b]) => b.unit_count - a.unit_count);
      return owned[0]?.[0];
    }
    return undefined;
  }, [isTutorial, gameState, user?.user_id, tutorialStep, tutorialSteps]);

  useEffect(() => {
    loadLobby();
  }, [loadLobby]);

  // Store the requested faction from lobby selection (if available)
  useEffect(() => {
    if (!lobbySnapshot || !user?.user_id) return;
    const me = lobbySnapshot.players.find(p => p.user_id === user.user_id);
    if (me) {
      requestedFactionRef.current = me.faction_id || null;
    }
  }, [lobbySnapshot, user?.user_id]);

  // Notify if assigned faction differs from requested (dice roll resolution)
  useEffect(() => {
    if (!gameStarted || !gameState || !user?.user_id) return;
    if (factionNotifShownRef.current) return;
    if (!gameState.settings?.factions_enabled) return;
    const me = gameState.players.find(p => p.player_id === user.user_id);
    if (!me) return;
    const assignedFaction = (me as any).faction_id || null;
    const requestedFaction = requestedFactionRef.current;
    if (requestedFaction && assignedFaction && requestedFaction !== assignedFaction) {
      toast(
        `Multiple players requested the same faction. A dice roll assigned you: ${assignedFaction}`,
        { icon: '🎲', duration: 7000 }
      );
      factionNotifShownRef.current = true;
    }
  }, [gameStarted, gameState, user?.user_id]);

  // ── Load map data ─────────────────────────────────────────────────────────
  // Primary delivery path is the `game:map` socket event. This effect is a
  // fallback that only triggers if (a) we have a map id but (b) the server
  // hasn't pushed map data yet — most commonly the lobby preview before
  // game:start fires. For private/pending custom maps owned by another
  // player, this REST call will 404 (correct behaviour) and the user sees
  // the lobby until the host starts the game and the map is broadcast.
  useEffect(() => {
    if (!gameState?.map_id) return;
    if (mapDataRef.current?.map_id === gameState.map_id) return;
    api.get(`/maps/${gameState.map_id}`)
      .then((res) => {
        if (mapDataRef.current?.map_id === gameState.map_id) return;
        setMapData(res.data.map);
        mapDataRef.current = res.data.map;
      })
      .catch(() => {
        // Non-fatal: the server will deliver the map via `game:map` once
        // the player is fully joined to the room. Stay quiet rather than
        // toasting on every lobby preview for a private map.
      });
  }, [gameState?.map_id]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleStartGame = () => {
    if (!gameId || isStartingGame) return;
    setIsStartingGame(true);
    getSocket().emit('game:start', { gameId });
  };

  const handleCancelGame = async () => {
    if (!gameId) return;
    try {
      await api.delete(`/games/${gameId}/cancel`);
      toast.success('Game cancelled.');
      navigate('/lobby');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to cancel game');
    }
  };

  const handleLeaveGame = () => {
    navigate('/lobby');
  };

  const handleTerritoryClick = useCallback((territoryId: string) => {
    if (!gameState) return;
    const socket = getSocket();
    const currentTurnPlayer = gameState.players[gameState.current_player_index];
    const myPid =
      resolvedViewerPlayerId ??
      gameState.players.find(
        (p) =>
          p.player_id === user?.user_id ||
          (!!user?.username && p.username === user.username),
      )?.player_id ??
      null;
    const isMyTurn = !!myPid && currentTurnPlayer?.player_id === myPid;
    const tState = gameState.territories[territoryId];

    // Territory draft: attempt claim directly on click. Server remains authoritative
    // and will reject if it's not actually this player's turn.
    if (gameState.phase === 'territory_select') {
      const isUnowned = tState && (tState.owner_id == null || tState.owner_id === '' || tState.owner_id === 'neutral');
      if (isUnowned) {
        if (territorySelectPendingRef.current) return;
        territorySelectPendingRef.current = true;
        socket.emit('game:select_territory', { gameId, territoryId, action_id: generateActionId() });
        setSelectedTerritory(null);
        return;
      }
    }

    if (!isMyTurn) {
      setSelectedTerritory(territoryId);
      return;
    }

    if (gameState.phase === 'fortify' && attackSource && myPid && tState?.owner_id === myPid && attackSource !== territoryId) {
      const fromState = gameState.territories[attackSource];
      const maxMove = Math.max(0, (fromState?.unit_count ?? 1) - 1);
      const requested = useUiStore.getState().fortifyUnits;
      const units = Math.max(1, Math.min(requested, maxMove));
      socket.emit('game:fortify', { gameId, fromId: attackSource, toId: territoryId, units });

      const fromName = mapDataRef.current?.territories.find(t => t.territory_id === attackSource)?.name ?? attackSource;
      const toName = mapDataRef.current?.territories.find(t => t.territory_id === territoryId)?.name ?? territoryId;
      ownTurnFortificationsRef.current.push({ fromName, toName, units });
      showNotification({
        type: 'fortify',
        text: `Moved ${units} troops: ${fromName} → ${toName}`,
        icon: 'arrow',
        accentBg: 'bg-sky-500/20',
        accentBorder: 'border-sky-500/30',
        accentText: 'text-sky-400',
      });

      // Map visual emitted by server on game:fortify success.

      setAttackSource(null);
      setFortifyUnits(1);
      setNavalSource(null);
      setSelectedTerritory(null);
      return;
    }

    setSelectedTerritory(territoryId);
  }, [
    gameState,
    attackSource,
    user?.user_id,
    user?.username,
    resolvedViewerPlayerId,
    gameId,
    showNotification,
    setFortifyUnits,
    setNavalSource,
  ]);

  const handleGalaxyStrategicTerritoryClick = useCallback(
    (territoryId: string) => {
      const md = mapDataRef.current;
      if (md?.map_kind === 'galaxy') {
        const t = md.territories.find((x) => x.territory_id === territoryId);
        if (t) {
          setFocusedWorldId(inferWorldId(t));
          // Stay in galaxy chart: selection + reinforcement use the side panel.
          // Drill into the world globe only when the player picks a world tab (or 2D map).
        }
      }
      handleTerritoryClick(territoryId);
    },
    [handleTerritoryClick],
  );

  const handleGalaxyStrategicTerritoryDoubleClick = useCallback(
    (territoryId: string) => {
      const md = mapDataRef.current;
      if (md?.map_kind === 'galaxy') {
        const t = md.territories.find((x) => x.territory_id === territoryId);
        if (t) {
          setFocusedWorldId(inferWorldId(t));
          setGalaxyOverviewMode(false);
        }
      }
      handleTerritoryClick(territoryId);
    },
    [handleTerritoryClick],
  );

  const focusedWorldSkin = useMemo(() => {
    if (!mapData?.worlds) return null;
    return mapData.worlds.find((w) => w.world_id === focusedWorldId) ?? null;
  }, [mapData?.worlds, focusedWorldId]);

  /** Per-territory globe diffuse/bump when a galaxy node/territory is selected (Option A). */
  const galaxyDrillGlobeSkin = useMemo(() => {
    if (mapData?.map_kind !== 'galaxy') return null;
    return resolveGalaxyDrillDownGlobeSkin({
      worlds: mapData.worlds,
      territories: mapData.territories,
      focusedWorldId,
      selectedTerritoryId: selectedTerritory,
    });
  }, [mapData?.map_kind, mapData?.worlds, mapData?.territories, focusedWorldId, selectedTerritory]);

  useEffect(() => {
    if (mapData?.map_kind !== 'galaxy') {
      setGalaxyWorldBanner(null);
      return;
    }
    if (galaxyOverviewMode) {
      setGalaxyWorldBanner(null);
      return;
    }
    const lore = getGalaxyWorldLore(focusedWorldId);
    if (!lore) return;
    setGalaxyWorldBanner({ display_name: lore.display_name, tagline: lore.tagline });
    const t = window.setTimeout(() => setGalaxyWorldBanner(null), 1500);
    return () => window.clearTimeout(t);
  }, [mapData?.map_kind, galaxyOverviewMode, focusedWorldId]);

  /**
   * Player-facing orbit-access summary. Backend stays authoritative; this is
   * advisory copy so the TerritoryPanel and the GalaxyStrategicView lane color
   * can pre-warn when an action would be blocked by the moon / hyperspace gate.
   */
  const orbitAccess = useMemo(
    () => getOrbitAccessResult(mapData ?? null, gameState, user?.user_id ?? null, gameState?.era ?? ''),
    [mapData, gameState, user?.user_id],
  );

  const orbitAccessHint = useMemo(() => {
    if (!mapData || !selectedTerritory) return null;
    if (!territoryRequiresOrbitAccessForClaim(mapData, selectedTerritory)) return null;
    if (orbitAccess.allowed) return null;
    const mode = resolveOrbitAccessMode(mapData, gameState?.era ?? '');
    return formatOrbitAccessError(orbitAccess, mode);
  }, [mapData, selectedTerritory, orbitAccess, gameState?.era]);

  const handleClaimTerritory = (territoryId: string) => {
    if (territorySelectPendingRef.current) return;
    territorySelectPendingRef.current = true;
    getSocket().emit('game:select_territory', { gameId, territoryId, action_id: generateActionId() });
    setSelectedTerritory(null);
  };

  const handleAdvancePhase = () => {
    hapticImpact(ImpactStyle.Medium);
    getSocket().emit('game:advance_phase', { gameId });
    setSelectedTerritory(null);
    setAttackSource(null);
    setNavalSource(null);
    setFortifyUnits(1);
  };

  const handleAttack = (fromId: string, toId: string) => {
    // If the target territory is owned by a player we have an active truce with, ask before breaking it
    if (gameState && user?.user_id) {
      const targetOwnerId = gameState.territories[toId]?.owner_id;
      if (targetOwnerId) {
        const myPlayer = gameState.players.find((p) => p.player_id === user.user_id);
        const targetOwner = gameState.players.find((p) => p.player_id === targetOwnerId);
        if (myPlayer && targetOwner) {
          const truceEntry = gameState.diplomacy?.find(
            (e) =>
              (e.player_index_a === myPlayer.player_index && e.player_index_b === targetOwner.player_index) ||
              (e.player_index_a === targetOwner.player_index && e.player_index_b === myPlayer.player_index),
          );
          if (truceEntry?.status === 'truce' && (truceEntry.truce_turns_remaining ?? 0) > 0) {
            setTruceBreakerConfirm({
              fromId,
              toId,
              defenderName: targetOwner.username,
              defenderColor: targetOwner.color,
            });
            return;
          }
        }
      }
    }

    getSocket().emit('game:attack', { gameId, fromId, toId });
    setAttackSource(null);
    setNavalSource(null);
    setFortifyUnits(1);
    setSelectedTerritory(null);
  };

  const handleDraft = (territoryId: string, units: number) => {
    if (!gameId) {
      toast.error('Game session not ready — try reloading');
      return;
    }
    const socket = getSocket();
    if (!socket.connected) {
      toast.error('Not connected to the game server');
      return;
    }

    socket.emit('game:draft', {
      gameId,
      territoryId,
      units,
      action_id: generateActionId(),
    });
    const gs = useGameStore.getState().gameState;
    const uid = useAuthStore.getState().user?.user_id;
    const uname = useAuthStore.getState().user?.username;
    const seatPid =
      joinPlayerIndexRef.current != null && gs
        ? gs.players[joinPlayerIndexRef.current]?.player_id ?? null
        : null;
    const curr = computeDraftPool(
      gs,
      uid,
      uname,
      useGameStore.getState().draftUnitsRemaining,
      seatPid,
    );
    const remaining = Math.max(0, curr - units);
    setDraftUnitsRemaining(remaining);
    setSelectedTerritory(null);

    const tName = mapDataRef.current?.territories.find(t => t.territory_id === territoryId)?.name ?? territoryId;
    ownTurnReinforcementsRef.current.push({ territoryName: tName, units });
    showNotification({
      type: 'reinforce',
      text: `+${units} troops deployed to ${tName}`,
      subtext: remaining > 0 ? `${remaining} remaining` : 'All reinforcements placed',
      icon: 'shield',
      accentBg: 'bg-emerald-500/20',
      accentBorder: 'border-emerald-500/30',
      accentText: 'text-emerald-400',
    });

    // Map visual emitted by server on game:draft success.
  };

  const handleRedeemCards = (cardIds: string[]) => {
    hapticNotification(NotificationType.Success);
    getSocket().emit('game:redeem_cards', { gameId, cardIds });
  };

  const handleBuild = useCallback((buildingType: string) => {
    if (!selectedTerritory) return;
    getSocket().emit('game:build', { gameId, territoryId: selectedTerritory, buildingType });
  }, [gameId, selectedTerritory]);

  const handleResearchTech = useCallback((techId: string) => {
    getSocket().emit('game:research_tech', { gameId, techId });
  }, [gameId]);

  const handleOpenTechTree = useCallback(async () => {
    if (!gameState?.era) return;
    if (techTree.length === 0) {
      try {
        const res = await api.get(`/eras/${gameState.era}/tech-tree`);
        setTechTree(res.data.techTree ?? []);
      } catch {
        toast.error('Could not load tech tree');
        return;
      }
    }
    setShowTechTree(true);
    const gs = useGameStore.getState().gameState;
    if (gs?.settings?.tutorial) {
      const step = tutorialStepsRef.current[tutorialStepRef.current];
      if (step?.requireAction === 'tech_tree_opened') {
        setTutorialStep((s) => Math.min(s + 1, tutorialStepsRef.current.length));
      }
    }
  }, [gameState?.era, techTree.length]);

  const handleOpenBonuses = useCallback(() => {
    // Pre-load tech tree so BonusesModal can show full tech descriptions
    if (gameState?.era && gameState.settings.tech_trees_enabled && techTree.length === 0) {
      api.get(`/eras/${gameState.era}/tech-tree`)
        .then((res) => setTechTree(res.data.techTree ?? []))
        .catch(() => {});
    }
    setShowBonuses(true);
    const gs = useGameStore.getState().gameState;
    if (gs?.settings?.tutorial) {
      const step = tutorialStepsRef.current[tutorialStepRef.current];
      if (step?.requireAction === 'bonuses_opened') {
        setTutorialStep((s) => Math.min(s + 1, tutorialStepsRef.current.length));
      }
    }
  }, [gameState?.era, gameState?.settings.tech_trees_enabled, techTree.length]);

  // Pre-load tech tree so territory-panel ability buttons resolve unlocked abilities.
  useEffect(() => {
    if (!gameState?.era || !gameState.settings.tech_trees_enabled || techTree.length > 0) return;
    api.get(`/eras/${gameState.era}/tech-tree`)
      .then((res) => setTechTree(res.data.techTree ?? []))
      .catch(() => {});
  }, [gameState?.era, gameState?.settings.tech_trees_enabled, techTree.length]);

  const handleNavalMove = useCallback((fromId: string, toId: string, count: number) => {
    getSocket().emit('game:naval_move', { gameId, fromId, toId, count });
  }, [gameId]);

  const handleNavalAttack = useCallback((fromId: string, toId: string) => {
    getSocket().emit('game:naval_attack', { gameId, fromId, toId });
  }, [gameId]);

  const handleInfluence = useCallback((targetId: string) => {
    getSocket().emit('game:influence', { gameId, targetId });
  }, [gameId]);

  const handleUseAbility = useCallback((abilityId: string, targetId?: string) => {
    getSocket().emit('game:use_ability', {
      gameId,
      abilityId,
      params: targetId ? { territoryId: targetId } : undefined,
    });
  }, [gameId]);

  const handleProposeTruce = useCallback((targetPlayerId: string) => {
    getSocket().emit('game:propose_truce', { gameId, targetPlayerId });
  }, [gameId]);

  const handleResignRequest = () => {
    pushModal({ type: 'resign_confirm' });
  };

  const handleResignConfirm = () => {
    getSocket().emit('game:resign', { gameId });
  };

  const handleSaveAndLeave = () => {
    getSocket().emit('game:leave', { gameId });
    toast.success('Game saved! You can resume later from the lobby.');
    navigate('/lobby');
  };

  const handleGameOverDismiss = () => {
    dismissModal();
    const settings = useGameStore.getState().gameState?.settings;
    // Campaign games route back to the campaign detail page so the player can
    // continue to the next era (or retry a loss) without a trip through /lobby.
    const isCampaign = settings?.is_campaign === true;
    if (isCampaign) {
      const advanced = campaignAdvancedRef.current;
      if (advanced) {
        navigate(`/campaign?campaign_id=${advanced.campaign_id}`);
      } else {
        // Lost (or draw) — return to the campaign list; the page will refresh
        // state and surface the "try again" affordance for this era.
        navigate('/campaign');
      }
      return;
    }
    // Tutorial games end → guests see the account-creation prompt before
    // they're routed to /lobby so the call to action survives a natural finish
    // (not just the wrap-up card). Registered players are actively routed into
    // their first real match instead of being dropped back on the lobby.
    if (settings?.tutorial === true) {
      if (user?.is_guest) {
        maybePromptTutorialAccount(
          () => navigate('/lobby'),
          'Great work, Commander. Lock in your hard-earned XP by creating a free account.',
        );
      } else {
        setPostTutorialPrompt(true);
      }
      return;
    }
    navigate('/lobby');
  };

  // Post-tutorial activation: spin up an instant solo match vs AI.
  const startSoloFromTutorial = useCallback(async () => {
    setPostTutorialStarting(true);
    try {
      const res = await api.post<{ game_id: string }>('/games', {
        era_id: 'ancient',
        map_id: 'era_ancient',
        max_players: 8,
        ai_count: 3,
        ai_difficulty: 'medium',
        settings: {
          turn_timer_seconds: 300,
          allowed_victory_conditions: ['domination'],
          initial_unit_count: 3,
          card_set_escalating: true,
          diplomacy_enabled: true,
        },
      });
      setPostTutorialPrompt(false);
      navigate(`/game/${res.data.game_id}`);
    } catch {
      toast.error('Could not start a solo game. Returning to lobby.');
      setPostTutorialStarting(false);
      setPostTutorialPrompt(false);
      navigate('/lobby');
    }
  }, [navigate]);

  /**
   * Navigate to the post-match replay. Wired to the "Watch Replay" CTA on
   * GameOverView so winners and losers alike can review their match. The
   * `source=match` query param tells ReplayPage to render a "Back to Lobby"
   * header and use sensible defaults (2D map, 1x speed) instead of the daily
   * challenge's globe + 4x time-lapse.
   */
  const handleWatchReplay = useCallback(
    (id: string) => {
      navigate(`/replay/${id}?source=match`);
    },
    [navigate],
  );

  const handleRematch = useCallback(async (cfg: NonNullable<GameOverModalData['rematchConfig']>) => {
    try {
      const res = await api.post<{ game_id: string }>('/games', {
        era_id: cfg.era_id,
        map_id: cfg.map_id,
        settings: cfg.settings,
        ai_count: 0,
        max_players: 8,
      });
      const newGameId = res.data.game_id;
      for (const pid of cfg.human_player_ids) {
        await api.post(`/games/${newGameId}/invite`, { friend_user_id: pid }).catch(() => {});
      }
      dismissModal();
      navigate(`/game/${newGameId}`);
    } catch {
      toast.error('Could not create rematch');
    }
  }, [navigate, dismissModal]);

  /**
   * Trigger the tutorial-end account prompt for guests. We only nag once per
   * tab via sessionStorage so a guest who chose "Maybe later" can finish or
   * replay the tutorial without seeing the modal a second time.
   */
  const maybePromptTutorialAccount = useCallback(
    (onContinue: () => void, outcomeLabel?: string) => {
      if (!user?.is_guest) {
        onContinue();
        return;
      }
      try {
        if (sessionStorage.getItem('cc-tutorial-prompt-shown') === '1') {
          onContinue();
          return;
        }
        sessionStorage.setItem('cc-tutorial-prompt-shown', '1');
      } catch {
        /* sessionStorage unavailable — still show the prompt once */
      }
      setTutorialAccountPrompt({ onContinue, outcomeLabel });
    },
    [user?.is_guest],
  );

  const handleTutorialMarkModuleComplete = useCallback(() => {
    markTutorialModuleComplete(tutorialLessonModule);
  }, [tutorialLessonModule]);

  const handleLaunchTutorialModule = useCallback(
    async (module: TutorialLessonModule) => {
      // Mark core complete before leaving if launching a deep-dive.
      if (tutorialLessonModule === 'core' && module !== 'core') {
        markTutorialModuleComplete('core');
      }

      // Abandon the current game best-effort so it does not linger as 'waiting'.
      if (gameId) {
        try {
          await api.delete(`/games/${gameId}/abandon`);
        } catch {
          /* best effort — do not block navigation */
        }
        getSocket().emit('game:leave', { gameId });
      }

      // Navigate to TutorialPage with the module param instead of creating the game
      // inline. This causes a full component unmount/remount which resets all local
      // React state (gameStarted, isHost, lobbySnapshot, etc.).  Doing the game
      // creation here and navigating directly to /game/:id keeps stale state from
      // the previous game, causing the auto-start effect to bail out because
      // gameStarted === true and the new game never calls handleStartGame().
      navigate(`/tutorial?module=${module}&start=1`, { replace: true });
    },
    [gameId, navigate, tutorialLessonModule],
  );

  /**
   * Called when the player reaches the wrapup card and chooses "Continue playing."
   * Marks the module complete (they earned it) and dismisses the overlay.
   */
  const handleTutorialContinuePlaying = useCallback(() => {
    const continueInTutorial = () => {
      markTutorialModuleComplete(tutorialLessonModule);
      setTutorialStep(tutorialSteps.length);
    };
    maybePromptTutorialAccount(
      continueInTutorial,
      'Save your progress before you keep playing — create a free account so the next match counts.',
    );
  }, [maybePromptTutorialAccount, tutorialLessonModule, tutorialSteps.length]);

  /**
   * Abandon the current tutorial game and return to the lobby.
   * `promptAccount` controls whether guests see the account-conversion prompt:
   * we only show it on genuine *completion* paths (wrap-up / module complete),
   * not when the player taps "Exit Tutorial" mid-lesson — showing a
   * "Tutorial Complete!" modal on an early exit would be misleading.
   */
  const abandonTutorialToLobby = useCallback(async () => {
    if (!gameId) return;
    try {
      await api.delete(`/games/${gameId}/abandon`);
      toast.success('Tutorial ended. Welcome back to the lobby.');
    } catch {
      toast.error('Could not end the tutorial game. You can remove it from the lobby if it appears.');
    }
    getSocket().emit('game:leave', { gameId });
    clearGame();
    navigate('/lobby');
  }, [gameId, navigate, clearGame]);

  /** Completion path (wrap-up / module complete): offer the account prompt to guests first. */
  const handleTutorialReturnToLobby = useCallback(() => {
    if (!gameId) return;
    maybePromptTutorialAccount(() => {
      void abandonTutorialToLobby();
    });
  }, [gameId, maybePromptTutorialAccount, abandonTutorialToLobby]);

  /** Exit path (mid-lesson "Exit Tutorial"): leave immediately, no completion prompt. */
  const handleTutorialExit = useCallback(() => {
    void abandonTutorialToLobby();
  }, [abandonTutorialToLobby]);

  const copyGameUrl = () => {
    if (!gameId) return;
    const url = `${window.location.origin}/game/${gameId}`;
    void navigator.clipboard.writeText(url);
    toast.success('Game link copied');
  };

  const copyGameId = () => {
    if (!gameId) return;
    void navigator.clipboard.writeText(gameId);
    toast.success('Game ID copied');
  };

  const copyJoinCode = () => {
    const c = lobbySnapshot?.join_code;
    if (!c) return;
    void navigator.clipboard.writeText(c);
    toast.success('Join code copied');
  };

  // ── Auto-start solo single-player flows (tutorial / daily / campaign) ──
  // gameState isn't set yet in the lobby phase; we read settings off the
  // lobby snapshot, which arrives from `game:lobby_updated` right after join.
  useEffect(() => {
    if (!lobbySnapshot || !isHost || gameStarted) return;
    if (lobbySnapshot.status !== 'waiting') return;
    const s = lobbySnapshot.settings_json ?? {};
    const isDaily = typeof s.daily_challenge_date === 'string' && s.daily_challenge_date.length > 0;
    const isSoloAutoStart = s.tutorial === true || isDaily || s.is_campaign === true;
    if (isSoloAutoStart) {
      handleStartGame();
    }
  }, [isHost, lobbySnapshot, gameStarted]);

  // ── Daily challenge intro modal ─────────────────────────────────────────
  // Show once per game_id (per tab), as soon as we have the spec from either
  // the lobby snapshot or the live game state. "Begin Challenge" stamps a
  // sessionStorage flag so reloading mid-game doesn't reopen the modal.
  useEffect(() => {
    if (!gameId || dailyIntroSeenRef.current) return;
    const lobbySpec = lobbySnapshot?.settings_json?.daily_challenge_spec as
      | DailyIntroSpec
      | undefined;
    const stateSpec = gameState?.settings?.daily_challenge_spec as
      | DailyIntroSpec
      | undefined;
    const spec = stateSpec ?? lobbySpec;
    if (!spec) return;
    try {
      if (sessionStorage.getItem(`cc-daily-intro-${gameId}`) === '1') {
        dailyIntroSeenRef.current = true;
        return;
      }
    } catch {
      /* sessionStorage unavailable — show once anyway */
    }
    dailyIntroSeenRef.current = true;
    setShowDailyIntro(true);
  }, [gameId, lobbySnapshot, gameState]);

  // ── Campaign intro modal ────────────────────────────────────────────────
  useEffect(() => {
    if (!gameId || campaignIntroSeenRef.current) return;
    const lobbyIsCampaign = lobbySnapshot?.settings_json?.is_campaign === true;
    const stateIsCampaign = gameState?.settings?.is_campaign === true;
    if (!lobbyIsCampaign && !stateIsCampaign) return;
    try {
      if (sessionStorage.getItem(`cc-campaign-intro-${gameId}`) === '1') {
        campaignIntroSeenRef.current = true;
        return;
      }
    } catch {
      /* sessionStorage unavailable — show once anyway */
    }
    campaignIntroSeenRef.current = true;
    setShowCampaignIntro(true);
  }, [gameId, lobbySnapshot, gameState]);

  // Hoisted for use in mobile bottom bar, cards tray, and combat banner
  const mobileMyPlayer =
    resolvedViewerPlayerId != null
      ? gameState?.players.find((p) => p.player_id === resolvedViewerPlayerId)
      : gameState?.players.find(
          (p) =>
            p.player_id === user?.user_id ||
            (!!user?.username && p.username === user.username),
        );
  const mobileIsMyTurn =
    !!mobileMyPlayer &&
    gameState?.players[gameState.current_player_index]?.player_id === mobileMyPlayer.player_id;

  // Auto-open cards tray when forced redemption (5+ cards)
  useEffect(() => {
    if (
      isMobileViewport() &&
      mobileMyPlayer &&
      mobileMyPlayer.cards.length >= 5 &&
      mobileIsMyTurn &&
      gameState?.phase === 'draft'
    ) {
      setMobileCardsTrayOpen(true);
    }
  }, [mobileMyPlayer?.cards.length, mobileIsMyTurn, gameState?.phase]);

  // Auto-close mobile overlays when territory is selected (TerritoryPanel opens)
  useEffect(() => {
    if (selectedTerritory) {
      setMobileCardsTrayOpen(false);
      setMobileHudOpen(false);
    }
  }, [selectedTerritory]);

  const hasMoonTerritories = useMemo(
    () =>
      mapData?.map_kind !== 'galaxy' &&
      !!mapData?.territories.some(
        (t) =>
          t.globe_id === 'moon' ||
          t.region_id === 'lunar_surface' ||
          t.territory_id.startsWith('moon_'),
      ),
    [mapData],
  );

  useEffect(() => {
    const md = mapData;
    if (!md) return;
    if (md.map_kind === 'galaxy') {
      setGalaxyOverviewMode(true);
      const wid =
        md.worlds?.[0]?.world_id ??
        inferWorldId(md.territories[0] ?? { territory_id: '', region_id: '' });
      setFocusedWorldId(wid);
    } else {
      setGalaxyOverviewMode(false);
      setFocusedWorldId('earth');
    }
  }, [mapData?.map_id]);

  /**
   * Build the campaign intro modal payload from whichever source has loaded
   * first (live game state preferred, lobby snapshot as fallback). Returns
   * null when this is not a campaign game.
   */
  const campaignIntroData = useMemo<CampaignIntroData | null>(() => {
    const lobbySettings = lobbySnapshot?.settings_json;
    const stateSettings = gameState?.settings as Record<string, unknown> | undefined;
    const isCampaign =
      lobbySettings?.is_campaign === true || (stateSettings && stateSettings.is_campaign === true);
    if (!isCampaign) return null;

    const get = <T,>(key: string): T | undefined => {
      const fromState = stateSettings?.[key] as T | undefined;
      if (fromState !== undefined) return fromState;
      const fromLobby = (lobbySettings as Record<string, unknown> | undefined)?.[key] as T | undefined;
      return fromLobby;
    };

    const eraIdFromSettings =
      (stateSettings?.era as string | undefined)
      ?? get<string>('era')
      ?? lobbySnapshot?.era_id
      ?? gameState?.era
      ?? '';
    const eraLabel = ERA_LABELS[eraIdFromSettings] ?? eraIdFromSettings;

    const lockedFaction = get<string>('campaign_locked_faction') ?? null;
    const aiDifficulty = (() => {
      const ai = lobbySnapshot?.players?.find((p) => p.is_ai);
      return ai?.ai_difficulty ?? null;
    })();
    const aiCount = lobbySnapshot?.players?.filter((p) => p.is_ai).length ?? null;
    const carry = get<{ survivor_bonus?: number; revolutionary_spirit?: number }>('campaign_carry');
    const prestigeBonus = get<number>('campaign_prestige_bonus') ?? null;

    return {
      pathName: get<string>('campaign_path_name'),
      pathTagline: get<string>('campaign_path_tagline'),
      signatureCarryLabel: get<string>('campaign_signature_carry_label'),
      eraIndex: get<number>('campaign_era_index'),
      eraCount: get<number>('campaign_era_count'),
      eraLabel,
      introText: get<string>('campaign_intro_text'),
      lockedFaction,
      aiDifficulty,
      aiCount,
      prestigeBonus,
      carry,
    };
  }, [lobbySnapshot, gameState]);

  const dismissCampaignIntro = useCallback(() => {
    setShowCampaignIntro(false);
    if (gameId) {
      try { sessionStorage.setItem(`cc-campaign-intro-${gameId}`, '1'); } catch { /* ignore */ }
    }
  }, [gameId]);

  const dismissDailyIntro = useCallback(() => {
    setShowDailyIntro(false);
    if (gameId) {
      try { sessionStorage.setItem(`cc-daily-intro-${gameId}`, '1'); } catch { /* ignore */ }
    }
  }, [gameId]);
  const customGlobeSkin = useMemo(() => {
    if (!mapData) return null;
    if (mapData.map_id !== FLOODED_NA_MAP_ID) return null;
    return {
      globeImageUrl: FLOODED_NA_GLOBE_TEXTURE,
      bumpImageUrl: undefined as string | undefined,
      showAtmosphere: false,
      backgroundColor: 'rgba(6, 16, 34, 1)',
    };
  }, [mapData]);

  // ── Waiting lobby ─────────────────────────────────────────────────────────
  if (!gameStarted || !gameState) {
    if (lobbyLoadError) {
      return (
        <div className="min-h-screen bg-bf-dark flex items-center justify-center px-4 pt-safe pb-safe">
          <div className="max-w-sm w-full text-center space-y-4">
            <p className="text-2xl">⚠️</p>
            <h2 className="font-display text-xl text-bf-gold">Game unavailable</h2>
            <p className="text-bf-muted text-sm">{lobbyLoadError}</p>
            <div className="flex flex-col gap-3 mt-6">
              <button
                className="btn-primary w-full"
                onClick={() => {
                  if (!gameId) return;
                  setLobbyLoadError(null);
                  const socket = getSocket();
                  socket.emit('game:join', { gameId });
                  if (lobbyTimeoutRef.current) clearTimeout(lobbyTimeoutRef.current);
                  lobbyTimeoutRef.current = setTimeout(() => {
                    setLobbyLoadError('Could not reach the game server. The game may no longer exist.');
                  }, 15_000);
                }}
              >
                Try again
              </button>
              <button
                className="btn-secondary w-full"
                onClick={() => navigate('/lobby')}
              >
                Back to lobby
              </button>
            </div>
          </div>
        </div>
      );
    }

    const shareUrl = gameId ? `${window.location.origin}/game/${gameId}` : '';
    const lobby = lobbySnapshot;
    const settings = lobby?.settings_json ?? {};
    const maxPlayers =
      typeof settings.max_players === 'number' ? settings.max_players : 8;
    const roster = lobby ? [...lobby.players].sort((a, b) => a.player_index - b.player_index) : [];
    const aiCount = roster.filter((p) => p.is_ai).length;
    const firstAi = roster.find((p) => p.is_ai);
    const hostPlayer = roster.find((p) => p.player_index === 0) ?? null;
    const eraLabel = ERA_LABELS[lobby?.era_id ?? ''] ?? lobby?.era_id ?? '—';
    const mapLabel =
      lobby?.map_id && lobby?.era_id
        ? formatLobbyMapLabel(lobby.map_id, lobby.era_id)
        : '—';
    const victorySummary = formatVictorySummary(settings);
    const seatsRemaining = Math.max(0, maxPlayers - roster.length);

    // Solo single-player flows (tutorial / daily / campaign) auto-start in
    // a separate effect above. We hide the multiplayer-style lobby chrome for
    // these so the user briefly sees a clean "preparing…" screen before the
    // map (with its own intro modal) appears.
    const isSoloPrep =
      settings.tutorial === true ||
      (typeof settings.daily_challenge_date === 'string' && settings.daily_challenge_date.length > 0) ||
      settings.is_campaign === true;
    if (isSoloPrep) {
      const dailySpec = settings.daily_challenge_spec as DailyIntroSpec | undefined;
      let prepLabel = 'Preparing your game…';
      if (settings.tutorial === true) prepLabel = 'Starting tutorial…';
      else if (dailySpec) prepLabel = 'Preparing today\u2019s challenge…';
      else if (settings.is_campaign === true) prepLabel = 'Preparing the next era…';
      return (
        <div className="min-h-screen bg-bf-dark flex flex-col">
          <nav className="border-b border-bf-border px-6 py-3 flex justify-between items-center">
            <BrandWordmark
              to={settings.is_campaign ? '/campaign' : (dailySpec ? '/daily' : '/lobby')}
              className="text-sm"
            />
            <button
              type="button"
              onClick={handleCancelGame}
              className="text-bf-muted text-sm hover:text-bf-gold transition-colors"
            >
              Cancel
            </button>
          </nav>
          <div className="flex-1 flex items-center justify-center px-4">
            <p className="text-bf-muted text-sm animate-pulse">{prepLabel}</p>
          </div>
          {showDailyIntro && dailySpec && (
            <DailyChallengeIntroModal
              spec={dailySpec}
              challengeDate={typeof settings.daily_challenge_date === 'string' ? settings.daily_challenge_date : undefined}
              eraLabel={eraLabel}
              onBegin={dismissDailyIntro}
            />
          )}
          {showCampaignIntro && campaignIntroData && (
            <CampaignIntroModal data={campaignIntroData} onBegin={dismissCampaignIntro} />
          )}
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-bf-dark px-4 py-6 sm:px-6 lg:py-8">
        <div className="max-w-6xl mx-auto">
          <div className="card mb-6 overflow-hidden border-bf-gold/10 bg-gradient-to-br from-bf-surface to-bf-dark/90">
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
              <div>
                <p className="text-[11px] uppercase tracking-[0.28em] text-bf-gold/70 mb-2">Pre-Game Room</p>
                <h2 className="font-display text-3xl text-bf-gold mb-2">Game Lobby</h2>
                <p className="text-bf-muted text-sm max-w-2xl">
                  {!lobby
                    ? 'Loading lobby…'
                    : lobby.status === 'waiting'
                      ? 'Waiting for the host to start, or for more players to join. Chat, vote on rule changes, and share the room from here.'
                      : 'Preparing game…'}
                </p>
              </div>

              {lobby && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 min-w-0 lg:min-w-[420px]">
                  <div className="rounded-xl border border-bf-border bg-black/20 px-3 py-3">
                    <p className="text-[10px] uppercase tracking-wider text-bf-muted mb-1">Era</p>
                    <p className="text-sm text-bf-text font-medium truncate">{eraLabel}</p>
                  </div>
                  <div className="rounded-xl border border-bf-border bg-black/20 px-3 py-3">
                    <p className="text-[10px] uppercase tracking-wider text-bf-muted mb-1">Seats</p>
                    <p className="text-sm text-bf-text font-medium">{roster.length} / {maxPlayers}</p>
                  </div>
                  <div className="rounded-xl border border-bf-border bg-black/20 px-3 py-3">
                    <p className="text-[10px] uppercase tracking-wider text-bf-muted mb-1">Host</p>
                    <p className="text-sm text-bf-text font-medium truncate">{hostPlayer ? playerLobbyDisplayName(hostPlayer) : '—'}</p>
                  </div>
                  <div className="rounded-xl border border-bf-border bg-black/20 px-3 py-3">
                    <p className="text-[10px] uppercase tracking-wider text-bf-muted mb-1">Status</p>
                    <p className="text-sm font-medium text-bf-gold">{lobby.status === 'waiting' ? `${seatsRemaining} open` : 'Starting'}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {lobby && (
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
              <div className="space-y-6 min-w-0">
                <div className="card">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.24em] text-bf-muted mb-1">Configuration</p>
                      <h3 className="font-display text-xl text-bf-gold">Game Settings</h3>
                    </div>
                    <span className="text-xs px-2.5 py-1 rounded-full border border-bf-gold/20 bg-bf-gold/10 text-bf-gold">
                      {mapLabel}
                    </span>
                  </div>

                  <dl className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 text-sm">
                    <div className="rounded-lg border border-bf-border bg-bf-dark/60 p-3">
                      <dt className="text-[10px] uppercase tracking-wider text-bf-muted mb-1">Era</dt>
                      <dd className="text-bf-text font-medium">{eraLabel}</dd>
                    </div>
                    <div className="rounded-lg border border-bf-border bg-bf-dark/60 p-3">
                      <dt className="text-[10px] uppercase tracking-wider text-bf-muted mb-1">Map</dt>
                      <dd className="text-bf-text font-medium">{mapLabel}</dd>
                    </div>
                    <div className="rounded-lg border border-bf-border bg-bf-dark/60 p-3">
                      <dt className="text-[10px] uppercase tracking-wider text-bf-muted mb-1">Players</dt>
                      <dd className="text-bf-text font-medium">{roster.length} / {maxPlayers}</dd>
                    </div>
                    <div className="rounded-lg border border-bf-border bg-bf-dark/60 p-3">
                      <dt className="text-[10px] uppercase tracking-wider text-bf-muted mb-1">Turn Timer</dt>
                      <dd className="text-bf-text font-medium">{formatTurnTimer(settings.turn_timer_seconds)}</dd>
                    </div>
                    <div className="rounded-lg border border-bf-border bg-bf-dark/60 p-3">
                      <dt className="text-[10px] uppercase tracking-wider text-bf-muted mb-1">Fog of War</dt>
                      <dd className="text-bf-text font-medium">{settings.fog_of_war ? 'On' : 'Off'}</dd>
                    </div>
                    <div className="rounded-lg border border-bf-border bg-bf-dark/60 p-3">
                      <dt className="text-[10px] uppercase tracking-wider text-bf-muted mb-1">Diplomacy</dt>
                      <dd className="text-bf-text font-medium">{settings.diplomacy_enabled ? 'On' : 'Off'}</dd>
                    </div>
                    <div className="rounded-lg border border-bf-border bg-bf-dark/60 p-3 sm:col-span-2 xl:col-span-1">
                      <dt className="text-[10px] uppercase tracking-wider text-bf-muted mb-1">Victory</dt>
                      <dd className="text-bf-text font-medium">{victorySummary}</dd>
                    </div>
                    <div className="rounded-lg border border-bf-border bg-bf-dark/60 p-3">
                      <dt className="text-[10px] uppercase tracking-wider text-bf-muted mb-1">Starting Units</dt>
                      <dd className="text-bf-text font-medium">
                        {typeof settings.initial_unit_count === 'number' ? settings.initial_unit_count : '—'}
                      </dd>
                    </div>
                    {aiCount > 0 && (
                      <div className="rounded-lg border border-bf-border bg-bf-dark/60 p-3">
                        <dt className="text-[10px] uppercase tracking-wider text-bf-muted mb-1">AI Opponents</dt>
                        <dd className="text-bf-text font-medium">
                          {aiCount} · {firstAi?.ai_difficulty ? `${firstAi.ai_difficulty.charAt(0).toUpperCase()}${firstAi.ai_difficulty.slice(1)}` : 'Medium'}
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>

                {gameId && (
                  <div className="card">
                    <div className="flex items-center gap-2 mb-4">
                      <MessageSquare className="w-4 h-4 text-bf-gold" />
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.24em] text-bf-muted mb-1">Coordination</p>
                        <h3 className="font-display text-lg text-bf-gold">Lobby Chat</h3>
                      </div>
                    </div>
                    <GameChat gameId={gameId} embedded defaultOpen lobbyMode />
                  </div>
                )}

                {gameId && (
                  <div className="card">
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div>
                        <p className="text-[10px] uppercase tracking-[0.24em] text-bf-muted mb-1">Consensus</p>
                        <h3 className="font-display text-lg text-bf-gold">Vote on Settings</h3>
                      </div>
                      <span className="text-xs text-bf-muted">Majority approval required</span>
                    </div>
                    <LobbyProposals gameId={gameId} currentSettings={lobby.settings_json ?? null} />
                  </div>
                )}

                {lobby.settings_json?.factions_enabled && lobby.era_id && (
                  <FactionSelectionPanel lobby={lobby} eraId={lobby.era_id} />
                )}

                <div className="card">
                  <div className="flex items-center justify-between gap-3 mb-4">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.24em] text-bf-muted mb-1">Roster</p>
                      <h3 className="font-display text-xl text-bf-gold">Players</h3>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-sm text-bf-muted">
                      <Users className="w-4 h-4" /> {roster.length} connected seats
                    </span>
                  </div>

                  <ul className="space-y-2 text-left">
                    {roster.map((p) => {
                      const isYou = p.user_id && user?.user_id && p.user_id === user.user_id;
                      // Show assigned faction if present
                      const assignedFaction = (p as any).faction_id || null;
                      return (
                        <li
                          key={p.player_index}
                          className="flex items-center gap-3 rounded-lg border border-bf-border bg-bf-dark/55 px-3 py-3"
                        >
                          <span
                            className="w-3 h-3 rounded-full shrink-0 border border-white/20"
                            style={{ backgroundColor: p.player_color }}
                            title="Color"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-bf-text text-sm font-medium truncate">
                              {playerLobbyDisplayName(p)}
                              {isYou && <span className="text-bf-muted text-xs ml-1">(you)</span>}
                              {assignedFaction && (
                                <span className="ml-2 text-xs px-2 py-0.5 rounded bg-bf-gold/10 text-bf-gold border border-bf-gold/20">
                                  Faction: {assignedFaction}
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-bf-muted mt-0.5">
                              {p.is_ai
                                ? 'Ready to play — no waiting'
                                : p.player_index === 0
                                  ? 'Lobby host'
                                  : 'Player slot'}
                            </p>
                          </div>
                          {p.player_index === 0 && (
                            <span className="text-xs px-2 py-0.5 rounded bg-bf-gold/15 text-bf-gold border border-bf-gold/30">
                              Host
                            </span>
                          )}
                          {p.is_ai && <AiBadge difficulty={p.ai_difficulty} />}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>

              <aside className="space-y-6 xl:sticky xl:top-6">
                <div className="card">
                  <div className="flex items-center gap-2 mb-4">
                    <Play className="w-4 h-4 text-bf-gold" />
                    <h3 className="font-display text-lg text-bf-gold">Ready Room</h3>
                  </div>

                  {isHost ? (
                    <div className="space-y-3">
                      <button
                        onClick={handleStartGame}
                        disabled={isStartingGame}
                        className="btn-primary w-full text-base min-h-[48px] py-3 touch-manipulation disabled:opacity-70 disabled:cursor-not-allowed"
                      >
                        {isStartingGame ? 'Starting...' : 'Start Game'}
                      </button>
                      {!user?.is_guest && gameId && (
                        <button
                          type="button"
                          onClick={() => setShowInviteModal(true)}
                          className="btn-secondary w-full text-base min-h-[48px] py-3 flex items-center justify-center gap-2 touch-manipulation"
                        >
                          <UserPlus className="w-4 h-4" /> Invite Friends
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleCancelGame}
                        className="w-full text-sm min-h-[44px] py-2.5 rounded border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors touch-manipulation"
                      >
                        Cancel Game
                      </button>
                      <p className="text-xs leading-relaxed text-bf-muted">
                        Start immediately, or wait for more players to join and vote on any rule changes first.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-bf-muted leading-relaxed">
                        Waiting for {hostPlayer ? playerLobbyDisplayName(hostPlayer) : 'the host'} to start the game.
                      </p>
                      <button
                        type="button"
                        onClick={handleLeaveGame}
                        className="w-full text-sm min-h-[44px] py-2.5 rounded border border-bf-border text-bf-muted hover:text-bf-text hover:border-bf-muted transition-colors touch-manipulation"
                      >
                        Leave Game
                      </button>
                    </div>
                  )}
                </div>

                {gameId && (
                  <div className="card">
                    <div className="flex items-center gap-2 mb-4">
                      <Link2 className="w-4 h-4 text-bf-gold" />
                      <h3 className="font-display text-lg text-bf-gold">Share This Game</h3>
                    </div>

                    {lobbySnapshot?.join_code && (
                      <div className="rounded-lg border border-bf-gold/20 bg-bf-gold/5 px-3 py-3 mb-3">
                        <p className="text-[10px] uppercase tracking-wider text-bf-muted mb-1">Join Code</p>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-bf-gold font-mono text-2xl tracking-[0.18em]">{lobbySnapshot.join_code}</span>
                          <button type="button" onClick={copyJoinCode} className="btn-secondary text-sm py-1.5 px-3 flex items-center gap-1.5">
                            <Copy className="w-3.5 h-3.5" /> Copy
                          </button>
                        </div>
                      </div>
                    )}

                    <p className="text-xs text-bf-muted break-all mb-3">{shareUrl}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-2">
                      <button type="button" onClick={copyGameUrl} className="btn-secondary text-sm py-2 px-3 flex items-center justify-center gap-1.5">
                        <Copy className="w-3.5 h-3.5" /> Copy link
                      </button>
                      <button type="button" onClick={copyGameId} className="btn-secondary text-sm py-2 px-3 flex items-center justify-center gap-1.5">
                        <Copy className="w-3.5 h-3.5" /> Copy game ID
                      </button>
                    </div>
                  </div>
                )}
              </aside>
            </div>
          )}
        </div>
        {showShortcuts && <GameShortcutsModal onClose={() => setShowShortcuts(false)} />}
        {showInviteModal && gameId && (
          <InviteFriendsModal
            gameId={gameId}
            joinCode={lobbySnapshot?.join_code ?? null}
            onClose={() => setShowInviteModal(false)}
          />
        )}
      </div>
    );
  }

  const reducedGlobe =
    prefersReducedMotion() || isLiteMode() || (isMobileViewport() && mapView === 'globe');
  const mapPhaseTintClass = phaseTintClass(gameState.phase, mapAmbientEnabled && !reducedGlobe);

  return (
    <div className="h-screen bg-bf-dark flex flex-col overflow-hidden">
      {/* Top Bar */}
      <div className="min-h-10 pt-safe bg-bf-surface border-b border-bf-border flex items-center px-4 gap-4 shrink-0 py-1">
        <BrandWordmark to="/lobby" className="text-sm" />
        <span className="text-bf-muted text-xs">·</span>
        <span className="text-bf-muted text-xs capitalize">
          {formatEraLabel(gameState.era)}
        </span>
        <span className="text-bf-muted text-xs">·</span>
        <span className="text-bf-muted text-xs">Turn {gameState.turn_number}</span>
        <div className="flex-1" />
        {/* Globe/2D toggle — full buttons on desktop, icon-only on mobile */}
        <div className="flex gap-1">
          {/* Mobile: compact icon-only toggle */}
          <button
            type="button"
            onMouseEnter={preloadGlobeChunks}
            onFocus={preloadGlobeChunks}
            onClick={() => {
              const next = mapView === 'globe' ? '2d' : 'globe';
              if (next === 'globe') preloadGlobeChunks();
              setMapView(next);
              persistMapView(next);
            }}
            className="md:hidden min-h-[40px] min-w-[40px] px-2 py-1 text-xs rounded text-bf-muted hover:text-bf-text flex items-center gap-1"
            aria-label={mapView === 'globe' ? 'Switch to 2D map' : 'Switch to globe'}
          >
            {mapView === 'globe' ? <MapIcon className="w-4 h-4" /> : <GlobeIcon className="w-4 h-4" />}
          </button>
          {/* Desktop: full labeled buttons */}
          <button
            type="button"
            onMouseEnter={preloadGlobeChunks}
            onFocus={preloadGlobeChunks}
            onClick={switchToGlobeView}
            className={`hidden md:inline-flex min-h-[40px] min-w-[40px] px-2 py-1 text-xs rounded ${mapView === 'globe' ? 'bg-bf-gold/20 text-bf-gold' : 'text-bf-muted hover:text-bf-text'}`}
          >
            Globe
          </button>
          <button
            type="button"
            onClick={() => {
              setMapView('2d');
              persistMapView('2d');
            }}
            className={`hidden md:inline-flex min-h-[40px] min-w-[40px] px-2 py-1 text-xs rounded ${mapView === '2d' ? 'bg-bf-gold/20 text-bf-gold' : 'text-bf-muted hover:text-bf-text'}`}
          >
            2D Map
          </button>
          {mapView === 'globe' && (
            <button
              type="button"
              onClick={() => {
                const next = !globeSpinEnabled;
                setGlobeSpinEnabled(next);
                persistGlobeSpinPreference(next);
              }}
              className={`hidden md:inline-flex min-h-[40px] min-w-[40px] px-2 py-1 text-xs rounded items-center gap-1 ${globeSpinEnabled ? 'bg-bf-gold/20 text-bf-gold' : 'text-bf-muted hover:text-bf-text'}`}
              aria-label="Toggle globe spin"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Spin</span>
            </button>
          )}
          {mapView === 'globe' && hasMoonTerritories && (
            <span className="hidden md:inline-flex min-h-[40px] px-2 py-1 text-xs rounded text-bf-gold/90 bg-bf-gold/10 border border-bf-gold/25 items-center">
              Earth + Moon
            </span>
          )}
          {mapView === 'globe' && mapData?.map_kind === 'galaxy' && (
            <>
              <button
                type="button"
                onClick={() => setGalaxyOverviewMode(true)}
                className={`hidden md:inline-flex min-h-[40px] px-2 py-1 text-xs rounded ${galaxyOverviewMode ? 'bg-bf-gold/20 text-bf-gold' : 'text-bf-muted hover:text-bf-text'}`}
              >
                Galaxy chart
              </button>
              <div className="hidden md:flex flex-wrap gap-1 max-w-[min(420px,40vw)] justify-end">
                {(mapData.worlds ?? []).map((w) => (
                  <button
                    key={w.world_id}
                    type="button"
                    onClick={() => {
                      setFocusedWorldId(w.world_id);
                      setGalaxyOverviewMode(false);
                    }}
                    className={`min-h-[36px] px-2.5 py-1.5 text-[11px] rounded border ${focusedWorldId === w.world_id && !galaxyOverviewMode ? 'border-bf-gold text-bf-gold bg-bf-gold/10' : 'border-bf-border text-bf-muted hover:text-bf-text'}`}
                  >
                    {w.display_name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {socketConnection !== 'connected' && (() => {
        // Translate the raw socket.io disconnect reason into something a
        // player can act on. We deliberately use plain language and avoid
        // jargon like "transport close" — when the connection is fine to
        // them ("my wifi works") but the server-side push was the cause,
        // the previous generic copy implied a bug on the user's end.
        let message: string;
        const isServerInitiated =
          disconnectReason === 'io server disconnect' ||
          disconnectReason === 'server namespace disconnect';
        if (socketConnection === 'reconnecting') {
          message = 'Reconnecting to game server…';
        } else if (isServerInitiated) {
          message = 'The server ended the connection. Reload to rejoin the game.';
        } else if (disconnectReason === 'transport close' || disconnectReason === 'ping timeout') {
          message = 'Connection lost. Reconnecting…';
        } else if (disconnectReason === 'io client disconnect') {
          message = 'Disconnected.';
        } else {
          message = 'Disconnected from game server. Attempting to reconnect…';
        }
        return (
          <div
            role="status"
            className={`shrink-0 px-4 py-2 text-center text-sm ${
              socketConnection === 'reconnecting'
                ? 'bg-amber-900/40 text-amber-200 border-b border-amber-700/50'
                : 'bg-red-900/40 text-red-200 border-b border-red-700/50'
            }`}
          >
            {message}
            {isServerInitiated && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="ml-3 underline hover:no-underline"
              >
                Reload
              </button>
            )}
          </div>
        );
      })()}

      {gameState?.settings?.daily_challenge_spec?.title && (
        <div className="shrink-0 px-4 py-2 bg-amber-950/25 border-b border-amber-700/35 text-sm">
          <span className="text-amber-400/90 font-display text-xs tracking-wide">Daily challenge</span>
          <p className="text-bf-text mt-0.5 font-medium">{gameState.settings.daily_challenge_spec.title}</p>
          {gameState.settings.daily_challenge_spec.archetype !== 'domination' &&
            gameState.settings.daily_challenge_spec.goal && (
              <p className="text-bf-muted text-xs mt-1 leading-snug">{gameState.settings.daily_challenge_spec.goal}</p>
            )}
        </div>
      )}

      {puzzleFeedback && (
        <div
          className={`shrink-0 px-4 py-2 text-sm border-b ${
            puzzleFeedback.tier === 'strong'
              ? 'bg-emerald-950/35 border-emerald-700/45 text-emerald-100'
              : puzzleFeedback.tier === 'risky'
                ? 'bg-red-950/35 border-red-700/40 text-red-100'
                : 'bg-bf-dark border-bf-border text-bf-text'
          }`}
        >
          {puzzleFeedback.message}
        </div>
      )}

      {/* Main Game Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Map Canvas */}
        <div
          ref={mapAreaRef}
          className={`flex-1 relative overflow-hidden min-h-0 min-w-0${mapPhaseTintClass ? ` ${mapPhaseTintClass}` : ''}`}
        >
          {mapData ? (
            mapView === 'globe' ? (
              <Suspense fallback={<div className="flex items-center justify-center h-full"><p className="text-bf-muted animate-pulse">Loading globe…</p></div>}>
                <div className="relative w-full h-full">
                  {mapData.map_kind === 'galaxy' && galaxyOverviewMode ? (
                    <GalaxyStrategicViewLazy
                      mapData={mapData}
                      gameState={gameState}
                      selectedTerritoryId={selectedTerritory}
                      onTerritoryClick={handleGalaxyStrategicTerritoryClick}
                      onTerritoryDoubleClick={handleGalaxyStrategicTerritoryDoubleClick}
                      width={mapCanvasSize.w}
                      height={mapCanvasSize.h}
                      orbitAccessAllowed={orbitAccess.allowed}
                      pulseWorldId={galaxyPulse?.worldId ?? null}
                      pulseKey={galaxyPulse?.key ?? 0}
                      pulseLabel={galaxyPulse?.label ?? null}
                    />
                  ) : (
                    <>
                      {galaxyWorldBanner && (
                        <div
                          className="absolute top-4 left-1/2 z-20 -translate-x-1/2 pointer-events-none max-w-md px-4 py-2 rounded-lg border border-bf-border bg-black/60 text-center shadow-lg"
                          role="status"
                          aria-live="polite"
                        >
                          <div className="font-display text-bf-gold text-sm sm:text-base">
                            {galaxyWorldBanner.display_name}
                          </div>
                          <div className="text-[11px] sm:text-xs text-bf-muted mt-0.5">
                            {galaxyWorldBanner.tagline}
                          </div>
                        </div>
                      )}
                      <GlobeMapLazy
                        mapData={mapData}
                        onTerritoryClick={handleTerritoryClick}
                        width={mapCanvasSize.w}
                        height={mapCanvasSize.h}
                        events={globeEvents}
                        onEventDone={onMapVisualDone}
                        reducedEffects={reducedGlobe}
                        autoSpin={globeSpinEnabled}
                        highlightTerritoryId={tutorialHighlightId}
                        ambientEnabled={mapAmbientEnabled && !reducedGlobe}
                        turnHolderPlayerId={turnHolderPlayer?.player_id ?? null}
                        contestedBorders={contestedBorders}
                        activeWorldId={mapData.map_kind === 'galaxy' ? focusedWorldId : 'earth'}
                        globeImageUrl={
                          mapData.map_kind === 'galaxy'
                            ? (galaxyDrillGlobeSkin?.globeImageUrl ??
                                focusedWorldSkin?.globe_image_url ??
                                customGlobeSkin?.globeImageUrl)
                            : customGlobeSkin?.globeImageUrl
                        }
                        bumpImageUrl={
                          mapData.map_kind === 'galaxy'
                            ? (galaxyDrillGlobeSkin?.bumpImageUrl !== undefined
                                ? galaxyDrillGlobeSkin.bumpImageUrl
                                : focusedWorldSkin?.bump_image_url !== undefined
                                  ? focusedWorldSkin.bump_image_url
                                  : customGlobeSkin?.bumpImageUrl)
                            : customGlobeSkin?.bumpImageUrl
                        }
                        showAtmosphere={
                          mapData.map_kind === 'galaxy'
                            ? (galaxyDrillGlobeSkin?.showAtmosphere ??
                                focusedWorldSkin?.show_atmosphere ??
                                true)
                            : (customGlobeSkin?.showAtmosphere ?? true)
                        }
                        {...(mapData.map_kind === 'galaxy'
                          ? {
                              atmosphereColor:
                                galaxyDrillGlobeSkin?.atmosphereColor ??
                                focusedWorldSkin?.atmosphere_color ??
                                'lightskyblue',
                              atmosphereAltitude:
                                galaxyDrillGlobeSkin?.atmosphereAltitude ??
                                focusedWorldSkin?.atmosphere_altitude ??
                                0.15,
                            }
                          : {})}
                        backgroundColor={
                          mapData.map_kind === 'galaxy'
                            ? (galaxyDrillGlobeSkin?.backgroundColor ??
                                focusedWorldSkin?.background_color ??
                                customGlobeSkin?.backgroundColor)
                            : customGlobeSkin?.backgroundColor
                        }
                      />
                      {hasMoonTerritories && (
                        <div className="absolute bottom-3 right-3 z-20 w-[34%] h-[34%] min-w-[240px] min-h-[200px] max-w-[400px] max-h-[320px] rounded-xl border border-bf-border bg-[rgb(20,22,32)] shadow-2xl overflow-hidden">
                          <div className="absolute top-2 left-2 z-10 text-[11px] px-2 py-1 rounded bg-black/55 border border-bf-border/70 text-bf-gold pointer-events-none">
                            Moon
                          </div>
                          <GlobeMapLazy
                            mapData={mapData}
                            onTerritoryClick={handleTerritoryClick}
                            width={Math.max(240, Math.floor(mapCanvasSize.w * 0.34))}
                            height={Math.max(200, Math.floor(mapCanvasSize.h * 0.34))}
                            events={[]}
                            reducedEffects={true}
                            autoSpin={false}
                            activeWorldId="moon"
                            globeImageUrl="https://cdn.jsdelivr.net/gh/mrdoob/three.js@master/examples/textures/planets/moon_1024.jpg"
                            bumpImageUrl=""
                            showAtmosphere={false}
                            backgroundColor="rgb(20, 22, 32)"
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              </Suspense>
            ) : (
              <GameMap
                mapData={mapData}
                onTerritoryClick={handleTerritoryClick}
                width={mapCanvasSize.w}
                height={mapCanvasSize.h}
                highlightTerritoryId={tutorialHighlightId}
                strikeFlash={mapStrikeFlash}
                mapVisualEvents={mapVisualEvents}
                onMapVisualDone={onMapVisualDone}
                reducedEffects={reducedGlobe}
                ambientEnabled={mapAmbientEnabled && !reducedGlobe}
                turnHolderPlayerId={turnHolderPlayer?.player_id ?? null}
                turnHolderColor={turnHolderPlayer?.color}
                contestedBorders={contestedBorders}
                resetViewRef={resetViewRef}
              />
            )
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-bf-muted">Loading map...</p>
            </div>
          )}

          {/* Reset View button (mobile) + Shortcuts button (desktop) */}
          {mapView === '2d' && (
            <>
              <button
                type="button"
                onClick={() => resetViewRef.current?.()}
                className="md:hidden absolute bottom-20 right-3 z-20 w-9 h-9 flex items-center justify-center rounded-lg bg-bf-surface/80 border border-bf-border text-bf-muted hover:text-bf-text backdrop-blur-sm"
                aria-label="Reset map view"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setShowShortcuts(true)}
                className="hidden md:flex absolute bottom-3 right-3 z-20 w-9 h-9 items-center justify-center rounded-lg bg-bf-surface/80 border border-bf-border text-bf-muted hover:text-bf-text backdrop-blur-sm"
                aria-label="Keyboard shortcuts (?)"
                title="Keyboard shortcuts (?)"
              >
                <Keyboard className="w-4 h-4" />
              </button>
            </>
          )}

          {/* Territory Info Panel */}
          {selectedTerritory && mapData && (
            <TerritoryPanel
              mapTerritories={mapData.territories}
              mapRegions={mapData.regions}
              onAttack={handleAttack}
              onDraft={handleDraft}
              onBuild={gameState?.settings.economy_enabled ? handleBuild : undefined}
              onNavalMove={gameState?.settings.naval_enabled ? handleNavalMove : undefined}
              onNavalAttack={gameState?.settings.naval_enabled ? handleNavalAttack : undefined}
              onInfluence={
                (gameState?.era_modifiers?.influence_spread || gameState?.era_modifiers?.carbonari_network)
                  ? handleInfluence
                  : undefined
              }
              onProposeTruce={gameState?.settings.diplomacy_enabled ? handleProposeTruce : undefined}
              onUseAbility={
                (gameState?.settings.tech_trees_enabled || gameState?.settings.factions_enabled)
                  ? handleUseAbility
                  : undefined
              }
              techTree={techTree}
              orbitAccessHint={orbitAccessHint}
              resolvedViewerPlayerId={resolvedViewerPlayerId}
              onClaimTerritory={gameState?.phase === 'territory_select' ? handleClaimTerritory : undefined}
              onClose={() => {
                setSelectedTerritory(null);
                setAttackSource(null);
                setNavalSource(null);
                setFortifyUnits(1);
              }}
            />
          )}

          {/* (Game over handled via modal) */}
        </div>

        {/* HUD Sidebar */}
        <GameHUD
          onAdvancePhase={handleAdvancePhase}
          onRedeemCards={handleRedeemCards}
          onResign={isTutorial ? undefined : handleResignRequest}
          onSaveAndLeave={isTutorial ? undefined : handleSaveAndLeave}
          isTutorial={isTutorial}
          onExitTutorial={isTutorial ? handleTutorialExit : undefined}
          onOpenTechTree={gameState?.settings.tech_trees_enabled ? handleOpenTechTree : undefined}
          onOpenBonuses={handleOpenBonuses}
          onUseAbility={gameState?.settings.factions_enabled ? handleUseAbility : undefined}
          lastCombatLog={combatLog}
          gameId={gameStarted && gameId ? gameId : undefined}
          activeInteractionLabel={activeInteractionLabel}
          resolvedViewerPlayerId={resolvedViewerPlayerId}
          tutorialActiveSettings={
            tutorialLessonModule === 'advanced_settings' ? tutorialAppliedSettings : undefined
          }
          mapNameLookup={mapData}
        />
      </div>

      {/* ── Mobile Bottom Bar ──────────────────────────────────────────────── */}
      {gameState && (() => {
        const cp = gameState.players[gameState.current_player_index];
        const me = resolvedViewerPlayerId
          ? gameState.players.find((p) => p.player_id === resolvedViewerPlayerId)
          : gameState.players.find(
              (p) => p.player_id === user?.user_id || (!!user?.username && p.username === user.username),
            );
        const myTurn = !!cp && !!me && cp.player_id === me.player_id;
        const phaseLabel: Record<string, string> = {
          territory_select: 'Territory Draft', draft: 'Reinforcement', attack: 'Attack', fortify: 'Fortify', game_over: 'Game Over',
        };
        const mobileDraftPool = myTurn && gameState.phase === 'draft'
          ? computeDraftPool(
              gameState,
              user?.user_id,
              user?.username,
              draftUnitsRemaining,
              resolvedViewerPlayerId,
            )
          : 0;
        return (
          <div className="flex md:hidden items-center gap-3 px-4 shrink-0 bg-bf-surface border-t border-bf-border pb-safe min-h-[56px]">
            {/* Player + phase info */}
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {cp && (
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cp.color }} />
              )}
              <div className="min-w-0">
                <div className="text-xs font-display text-bf-gold truncate">
                  {phaseLabel[gameState.phase] ?? gameState.phase}
                  {mobileDraftPool > 0 && (
                    <span className="ml-1.5 text-bf-text font-mono font-normal">
                      · {mobileDraftPool} units
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-bf-muted truncate flex-wrap">
                  <span className="truncate">{myTurn ? 'Your turn' : cp?.username ?? '—'}</span>
                  {gameState.settings.async_mode && (() => {
                    const dSec = gameState.settings.async_turn_deadline_seconds ?? 86400;
                    const elapsed = (Date.now() - gameState.turn_started_at) / 1000;
                    const rem = Math.max(0, dSec - elapsed);
                    const h = Math.floor(rem / 3600);
                    const m = Math.floor((rem % 3600) / 60);
                    const ratio = rem / dSec;
                    const chipColor = ratio > 0.5
                      ? 'text-green-400 border-green-700/40 bg-green-900/20'
                      : ratio > 0.25
                        ? 'text-yellow-400 border-yellow-700/40 bg-yellow-900/20'
                        : 'text-red-400 border-red-700/40 bg-red-900/20 animate-pulse';
                    return (
                      <span className={`inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded border font-mono ${chipColor}`}>
                        ⏱ {h > 0 ? `${h}h ${m}m` : `${m}m`}
                      </span>
                    );
                  })()}
                </div>
              </div>
            </div>
            {/* End-phase button */}
            {myTurn && gameState.phase !== 'game_over' && gameState.phase !== 'territory_select' && (
              <button
                onClick={handleAdvancePhase}
                className="btn-primary text-xs px-3 py-2 min-h-[40px]"
              >
                {gameState.phase === 'draft' ? 'End Draft' : gameState.phase === 'attack' ? 'End Attack' : 'End Turn'}
              </button>
            )}
            {/* Cards badge */}
            {mobileMyPlayer && mobileMyPlayer.cards.length > 0 && (
              <button
                type="button"
                onClick={() => setMobileCardsTrayOpen((o) => !o)}
                className="relative w-10 h-10 flex items-center justify-center rounded-lg bg-bf-dark border border-bf-border text-bf-muted hover:text-bf-text shrink-0"
                aria-label="Show cards"
              >
                <CreditCard className="w-5 h-5" />
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-bf-gold text-bf-dark text-[10px] font-bold rounded-full flex items-center justify-center">
                  {mobileMyPlayer.cards.length}
                </span>
              </button>
            )}
            {/* HUD drawer toggle */}
            <button
              type="button"
              onClick={() => setMobileHudOpen(true)}
              className="relative w-10 h-10 flex items-center justify-center rounded-lg bg-bf-dark border border-bf-border text-bf-muted hover:text-bf-text shrink-0"
              aria-label="Open game menu"
            >
              <Menu className="w-5 h-5" />
            </button>
          </div>
        );
      })()}

      {/* ── Mobile Cards Tray ─────────────────────────────────────────────── */}
      {mobileCardsTrayOpen && mobileMyPlayer && mobileMyPlayer.cards.length > 0 && (
        <div className="md:hidden">
          <MobileCardsTray
            cards={mobileMyPlayer.cards}
            isMyTurn={!!mobileIsMyTurn}
            isDraftPhase={gameState?.phase === 'draft'}
            onRedeemCards={handleRedeemCards}
            onClose={() => setMobileCardsTrayOpen(false)}
          />
        </div>
      )}

      {/* ── Mobile Combat Banner ──────────────────────────────────────────── */}
      <MobileCombatBanner
        lastCombatResult={lastCombatResult}
        onOpenFullLog={() => setMobileHudOpen(true)}
      />

      {/* ── Mobile HUD Drawer ─────────────────────────────────────────────── */}
      {mobileHudOpen && (
        <div className="md:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 z-40"
            onClick={() => setMobileHudOpen(false)}
          />
          {/* Drawer panel */}
          <div className="fixed inset-y-0 right-0 w-80 max-w-[85vw] z-50 flex flex-col bg-bf-surface">
            {/* Drawer header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-bf-border pt-safe shrink-0">
              <span className="font-display text-sm text-bf-gold">Game Info</span>
              <button
                type="button"
                onClick={() => setMobileHudOpen(false)}
                className="w-9 h-9 flex items-center justify-center rounded-lg bg-bf-dark text-bf-muted hover:text-bf-text"
                aria-label="Close menu"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <GameHUD
              mobile
              onAdvancePhase={() => { handleAdvancePhase(); setMobileHudOpen(false); }}
              onRedeemCards={(ids) => { handleRedeemCards(ids); setMobileHudOpen(false); }}
              onResign={isTutorial ? undefined : handleResignRequest}
              onSaveAndLeave={isTutorial ? undefined : handleSaveAndLeave}
              isTutorial={isTutorial}
              onExitTutorial={isTutorial ? handleTutorialExit : undefined}
              onOpenTechTree={gameState?.settings.tech_trees_enabled ? () => { handleOpenTechTree(); setMobileHudOpen(false); } : undefined}
              onOpenBonuses={() => { handleOpenBonuses(); setMobileHudOpen(false); }}
              onUseAbility={gameState?.settings.factions_enabled ? (abilityId, targetId) => { handleUseAbility(abilityId, targetId); setMobileHudOpen(false); } : undefined}
              lastCombatLog={combatLog}
              gameId={gameStarted && gameId ? gameId : undefined}
              activeInteractionLabel={activeInteractionLabel}
              resolvedViewerPlayerId={resolvedViewerPlayerId}
              tutorialActiveSettings={
                tutorialLessonModule === 'advanced_settings' ? tutorialAppliedSettings : undefined
              }
              mapNameLookup={mapData}
            />
            <div className="px-4 py-3 border-t border-bf-border shrink-0 space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-bf-muted mb-2">Map View</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={switchToGlobeView}
                  className={`flex-1 py-2 text-xs rounded border ${mapView === 'globe' ? 'bg-bf-gold/20 text-bf-gold border-bf-gold/40' : 'border-bf-border text-bf-muted'}`}
                >
                  Globe
                </button>
                <button
                  type="button"
                  onClick={() => { setMapView('2d'); persistMapView('2d'); }}
                  className={`flex-1 py-2 text-xs rounded border ${mapView === '2d' ? 'bg-bf-gold/20 text-bf-gold border-bf-gold/40' : 'border-bf-border text-bf-muted'}`}
                >
                  2D Map
                </button>
              </div>
              {mapView === 'globe' && (
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={globeSpinEnabled}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setGlobeSpinEnabled(next);
                      persistGlobeSpinPreference(next);
                    }}
                    className="w-4 h-4 accent-bf-gold"
                  />
                  <span className="text-sm text-bf-muted">Auto-spin globe</span>
                </label>
              )}
            </div>
            {/* Lite-mode toggle — visible only in the mobile drawer */}
            <div className="px-4 py-3 border-t border-bf-border shrink-0">
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={liteModeEnabled}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setLiteModeEnabled(next);
                    persistLiteMode(next);
                  }}
                  className="w-4 h-4 accent-bf-gold"
                />
                <span className="text-sm text-bf-muted">
                  Lite mode <span className="text-xs">(fewer animations)</span>
                </span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Action Modal (blocking — combat results, turn summaries, game over, resign) */}
      {showTechTree && user && gameState && (
        <TechTreeModal
          gameState={gameState}
          currentPlayerId={user.user_id}
          techTree={techTree}
          onResearch={(techId) => { handleResearchTech(techId); }}
          onClose={() => setShowTechTree(false)}
        />
      )}

      {showBonuses && (
        <BonusesModal
          techTree={techTree}
          onClose={() => setShowBonuses(false)}
        />
      )}

      {strikeAnim && (
        <AtomBombAnimation
          key={strikeAnim.key}
          abilityId={strikeAnim.abilityId}
          targetName={strikeAnim.targetName}
          unitReduction={strikeAnim.unitReduction}
          onDone={() => setStrikeAnim(null)}
        />
      )}

      {activeEventCard && gameState && user && (
        <EventCardModal
          card={activeEventCard}
          isMyTurn={gameState.players[gameState.current_player_index]?.player_id === user.user_id}
          onChoice={(choiceId) => {
            getSocket().emit('game:event_choice', { gameId, choiceId });
          }}
          onDismiss={() => setActiveEventCard(null)}
        />
      )}

      {/* Truce Proposal Modal */}
      {truceProposal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
             style={{ backdropFilter: 'blur(4px)' }}>
          <div className="bg-[#1e2332] border border-white/10 rounded-2xl p-6 max-w-sm w-full shadow-2xl text-center">
            <div className="text-4xl mb-3">🤝</div>
            <h3 className="font-display text-lg text-white mb-1">Truce Proposal</h3>
            <p className="text-white/50 text-sm mb-5">
              <span className="font-medium" style={{ color: truceProposal.proposerColor }}>
                {truceProposal.proposerName}
              </span>{' '}
              wants to call a truce with you for 3 rounds.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  getSocket().emit('game:truce_response', {
                    gameId: truceProposal.gameId,
                    proposerId: truceProposal.proposerId,
                    accepted: false,
                  });
                  setTruceProposal(null);
                }}
                className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10
                           text-white/60 font-medium text-sm transition-all"
              >
                Decline
              </button>
              <button
                onClick={() => {
                  getSocket().emit('game:truce_response', {
                    gameId: truceProposal.gameId,
                    proposerId: truceProposal.proposerId,
                    accepted: true,
                  });
                  setTruceProposal(null);
                }}
                className="flex-1 py-2.5 rounded-xl bg-green-500/20 hover:bg-green-500/30 border border-green-500/30
                           text-green-300 font-medium text-sm transition-all"
              >
                Accept
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Break Truce Confirmation Modal */}
      {truceBreakerConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
             style={{ backdropFilter: 'blur(4px)' }}>
          <div className="bg-[#1e2332] border border-amber-500/30 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <div className="text-3xl mb-3 text-center">⚠️</div>
            <h3 className="font-display text-lg text-amber-400 text-center mb-1">Break Active Truce?</h3>
            <p className="text-white/60 text-sm text-center mb-4">
              You have an active truce with{' '}
              <span className="font-semibold" style={{ color: truceBreakerConfirm.defenderColor }}>
                {truceBreakerConfirm.defenderName}
              </span>. Breaking it carries consequences:
            </p>
            <ul className="text-xs text-white/60 space-y-2 mb-5 pl-1">
              <li className="flex items-start gap-2">
                <span className="text-base mt-0.5">🛡</span>
                <span>
                  <span className="text-white/90 font-medium">{truceBreakerConfirm.defenderName}</span>{' '}
                  gets <span className="text-amber-300 font-semibold">+1 defense die</span> for this attack
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-base mt-0.5">⚔️</span>
                <span>
                  <span className="text-white/90 font-medium">{truceBreakerConfirm.defenderName}</span>{' '}
                  earns <span className="text-red-300 font-semibold">+1 attack die</span> for their next attack against you
                </span>
              </li>
            </ul>
            <div className="flex gap-3">
              <button
                onClick={() => setTruceBreakerConfirm(null)}
                className="flex-1 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10
                           text-white/60 font-medium text-sm transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  getSocket().emit('game:attack', {
                    gameId,
                    fromId: truceBreakerConfirm.fromId,
                    toId: truceBreakerConfirm.toId,
                    breakTruce: true,
                  });
                  setAttackSource(null);
                  setNavalSource(null);
                  setFortifyUnits(1);
                  setSelectedTerritory(null);
                  setTruceBreakerConfirm(null);
                }}
                className="flex-1 py-2.5 rounded-xl bg-amber-600/25 hover:bg-amber-600/35
                           border border-amber-500/40 text-amber-300 font-medium text-sm transition-all"
              >
                ⚔️ Break Truce &amp; Attack
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action Modal (blocking — combat results, turn summaries, game over, resign) */}
      <ActionModal
        data={modalQueue[0] ?? null}
        onDismiss={modalQueue[0]?.type === 'game_over' ? handleGameOverDismiss : dismissModal}
        onResignConfirm={handleResignConfirm}
        onRepeatCombat={handleAttack}
        onRematch={handleRematch}
        onWatchReplay={handleWatchReplay}
        onChallengeFriend={user?.is_guest ? undefined : () => navigate('/lobby?challenge=1')}
        mapNameLookup={mapData}
        players={gameState?.players}
      />

      {/* Action Notification (auto-dismiss — reinforcements, fortify, phase changes) */}
      <ActionNotification key={notifState?.key} data={notifState?.data ?? null} />

      {/* Coaching Tip — solo-vs-AI only, dismissible per turn */}
      {coachingTip && coachingTip.turn === gameState?.turn_number && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-40 max-w-md px-3">
          <div className="bg-amber-500/10 border border-amber-500/40 rounded-lg p-3 shadow-lg backdrop-blur-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-amber-200 text-xs font-semibold uppercase tracking-wider">Coaching</p>
                <p className="text-sm text-white/90 font-medium mt-1">{coachingTip.title}</p>
                <p className="text-xs text-white/70 mt-1">{coachingTip.body}</p>
              </div>
              <button
                onClick={() => setCoachingTip(null)}
                className="text-white/40 hover:text-white/80 text-lg leading-none px-1 -mt-1"
                aria-label="Dismiss coaching tip"
              >
                ×
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Daily challenge mission briefing (also visible over the live map for resumes). */}
      {showDailyIntro && (gameState?.settings?.daily_challenge_spec || lobbySnapshot?.settings_json?.daily_challenge_spec) && (
        <DailyChallengeIntroModal
          spec={(gameState?.settings?.daily_challenge_spec ?? lobbySnapshot?.settings_json?.daily_challenge_spec) as DailyIntroSpec}
          challengeDate={
            typeof gameState?.settings?.daily_challenge_date === 'string'
              ? gameState.settings.daily_challenge_date
              : typeof lobbySnapshot?.settings_json?.daily_challenge_date === 'string'
                ? lobbySnapshot.settings_json.daily_challenge_date
                : undefined
          }
          eraLabel={ERA_LABELS[gameState?.era ?? lobbySnapshot?.era_id ?? ''] ?? undefined}
          onBegin={dismissDailyIntro}
        />
      )}

      {/* Campaign era briefing (also visible over the live map for resumes). */}
      {showCampaignIntro && campaignIntroData && (
        <CampaignIntroModal data={campaignIntroData} onBegin={dismissCampaignIntro} />
      )}

      {/* Tutorial-end account creation prompt (guests only) */}
      {tutorialAccountPrompt && (
        <TutorialAccountPromptModal
          outcomeLabel={tutorialAccountPrompt.outcomeLabel}
          onCreateAccount={() => {
            const next = tutorialAccountPrompt;
            setTutorialAccountPrompt(null);
            navigate('/register?redirect=/lobby');
            // Also run the original continuation so any cleanup
            // (game abandon, socket leave) still happens.
            try { next?.onContinue(); } catch { /* navigate already replaced */ }
          }}
          onSignIn={() => {
            const next = tutorialAccountPrompt;
            setTutorialAccountPrompt(null);
            navigate('/login?redirect=/lobby');
            try { next?.onContinue(); } catch { /* ignore */ }
          }}
          onSkip={() => {
            const next = tutorialAccountPrompt;
            setTutorialAccountPrompt(null);
            try { next?.onContinue(); } catch { /* ignore */ }
          }}
        />
      )}

      {/* Post-tutorial routing: offer a first real match (registered players) */}
      {postTutorialPrompt && (
        <PostTutorialPromptModal
          loading={postTutorialStarting}
          onStartSolo={() => void startSoloFromTutorial()}
          onBackToLobby={() => { setPostTutorialPrompt(false); navigate('/lobby'); }}
        />
      )}

      {/* Tutorial Overlay */}
      {isTutorial && tutorialStep < tutorialSteps.length && (
        <TutorialOverlay
          steps={tutorialSteps}
          lessonModule={tutorialLessonModule}
          stepIndex={tutorialStep}
          onAdvance={() => setTutorialStep((s) => Math.min(s + 1, tutorialSteps.length))}
          onContinuePlaying={handleTutorialContinuePlaying}
          onReturnToLobby={handleTutorialReturnToLobby}
          onExitTutorial={handleTutorialExit}
          onLaunchModule={handleLaunchTutorialModule}
          onOpenTechTree={handleOpenTechTree}
          onOpenBonuses={handleOpenBonuses}
          onOpenSettingsLab={() => setShowSettingsLab(true)}
          onMarkModuleComplete={handleTutorialMarkModuleComplete}
          centered={isTutorialStepCentered(tutorialSteps[tutorialStep])}
        />
      )}

      {/* Tutorial Settings Lab — advanced settings lesson interactive beat */}
      {showSettingsLab && (
        <TutorialSettingsLab
          onSettingsExplored={(values) => {
            const currentStep = tutorialStepsRef.current[tutorialStepRef.current];
            if (gameId) {
              getSocket().emit('game:tutorial_apply_settings', { gameId, settings: values });
            }
            if (currentStep?.requireAction === 'settings_explored') {
              setTutorialStep((s) => Math.min(s + 1, tutorialStepsRef.current.length));
            }
          }}
          onClose={() => setShowSettingsLab(false)}
        />
      )}

      {/* Wonder built notification */}
      {wonderNotif && (
        <div className="fixed inset-0 pointer-events-none flex items-center justify-center z-50">
          <div
            className="bg-yellow-900/90 border-2 border-yellow-500 rounded-xl px-8 py-5 text-center shadow-2xl animate-fade-in"
            style={{ borderColor: wonderNotif.builderColor }}
          >
            <div className="text-3xl mb-1">🏛</div>
            <p className="text-yellow-300 font-bold text-lg">Wonder Built!</p>
            <p className="text-white text-sm mt-1">
              <span style={{ color: wonderNotif.builderColor }} className="font-semibold">
                {wonderNotif.builderName}
              </span>{' '}
              constructed a wonder in their territory.
            </p>
          </div>
        </div>
      )}

    </div>
  );
}
