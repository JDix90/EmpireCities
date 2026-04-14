import React, { useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Menu, X, CreditCard, RotateCcw } from 'lucide-react';
import { useGameStore, CombatResult, type GameState as ClientGameState } from '../store/gameStore';
import { useUiStore } from '../store/uiStore';
import { useAuthStore } from '../store/authStore';
import { connectSocket, getSocket } from '../services/socket';
import { api } from '../services/api';
import GameMap from '../components/game/GameMap';
import GlobeMap, { type GlobeEvent } from '../components/game/GlobeMap';
import GameHUD from '../components/game/GameHUD';
import MobileCardsTray from '../components/game/MobileCardsTray';
import MobileCombatBanner from '../components/game/MobileCombatBanner';
import TerritoryPanel from '../components/game/TerritoryPanel';
import TechTreeModal, { type TechNode } from '../components/game/TechTreeModal';
import BonusesModal from '../components/game/BonusesModal';
import AtomBombAnimation from '../components/game/AtomBombAnimation';
import EventCardModal, { type EventCard } from '../components/game/EventCardModal';
import ActionModal, { ActionNotification, ModalData, NotificationData, ReinforcementEntry, FortifyEntry, GameOverModalData, EliminationModalData, DraftSummaryModalData } from '../components/game/ActionModal';
import TutorialOverlay, { TUTORIAL_STEPS } from '../components/game/TutorialOverlay';
import InviteFriendsModal from '../components/game/InviteFriendsModal';
import { computeDraftPool } from '../utils/draftPool';
import { ERA_LABELS, formatLobbyMapLabel } from '../constants/gameLobbyLabels';
import type { GameLobbySnapshot, GameLobbyPlayerRow, GameLobbySettingsJson } from '../types/gameLobbyApi';
import toast from 'react-hot-toast';
import {
  getInitialMapView,
  persistMapView,
  prefersReducedMotion,
  isMobileViewport,
  getGlobeSpinPreference,
  persistGlobeSpinPreference,
} from '../utils/device';

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
  territories: Array<{
    territory_id: string;
    name: string;
    polygon: number[][];
    center_point: [number, number];
    region_id: string;
    geo_polygon?: [number, number][];
  }>;
  connections: Array<{ from: string; to: string; type: 'land' | 'sea' }>;
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
  const [isHost, setIsHost] = useState(false);
  const [mapView, setMapView] = useState<'2d' | 'globe'>(getInitialMapView);
  const [globeSpinEnabled, setGlobeSpinEnabled] = useState(getGlobeSpinPreference);
  const [mobileHudOpen, setMobileHudOpen] = useState(false);
  const [mobileCardsTrayOpen, setMobileCardsTrayOpen] = useState(false);
  const mapDataRef = useRef<MapData | null>(null);

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

  /** Once per game session: open tutorial island on 2D (readable Risk-style board); globe stays available. */
  const tutorialSessionDefault2dRef = useRef(false);
  /** Once per game session: non-tutorial-island games open in globe (overrides stale localStorage from tutorial). */
  const nonTutorialIslandGlobeAppliedRef = useRef(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const isTutorial = gameState?.settings?.tutorial === true;

  // Keep a ref to the current user so socket handlers never close over a stale value
  const userRef = useRef(user);
  userRef.current = user;

  // ── Globe animation events ───────────────────────────────────────────────
  const [globeEvents, setGlobeEvents] = useState<GlobeEvent[]>([]);
  const globeEventCounter = useRef(0);
  const pushGlobeEvent = useCallback((event: Omit<GlobeEvent, 'id'>) => {
    const id = `ge-${++globeEventCounter.current}-${Date.now()}`;
    setGlobeEvents(prev => [...prev, { ...event, id }]);
  }, []);
  const handleGlobeEventDone = useCallback((eventId: string) => {
    setGlobeEvents(prev => prev.filter(e => e.id !== eventId));
  }, []);

  // ── Action Modal state ──────────────────────────────────────────────────
  const [modalQueue, setModalQueue] = useState<ModalData[]>([]);
  const [notifState, setNotifState] = useState<{ data: NotificationData; key: number } | null>(null);
  const notifCounter = useRef(0);
  const prevPlayerIndexRef = useRef<number | null>(null);
  const prevPhaseRef = useRef<string | null>(null);
  const draftSummaryShownRef = useRef(false);
  const pendingDraftSummaryRef = useRef<ClientGameState | null>(null);
  const otherTurnCombatsRef = useRef<CombatResult[]>([]);
  const ownTurnCombatsRef = useRef<CombatResult[]>([]);
  const ownTurnReinforcementsRef = useRef<ReinforcementEntry[]>([]);
  const ownTurnFortificationsRef = useRef<FortifyEntry[]>([]);
  /** Prevent duplicate socket emits while waiting for game:state after auto phase advance */
  const tutorialDraftToAttackPendingRef = useRef(false);
  const tutorialAttackToFortifyPendingRef = useRef(false);
  /** attack_do: only auto-emit attack→fortify once */
  const tutorialAttackPhaseAutoEmittedRef = useRef(false);
  /** fortify_explain: auto end turn once */
  const tutorialFortifyEndEmittedRef = useRef(false);
  const tutorialFortifyScheduleStartedRef = useRef(false);
  const tutorialStepRef = useRef(tutorialStep);
  tutorialStepRef.current = tutorialStep;
  /** Increments when player completes an attack during attack_do — triggers auto phase advance */
  const [tutorialAttackAutoTick, setTutorialAttackAutoTick] = useState(0);
  const [socketConnection, setSocketConnection] = useState<'connected' | 'disconnected' | 'reconnecting'>('connected');
  const [lobbySnapshot, setLobbySnapshot] = useState<GameLobbySnapshot | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showTechTree, setShowTechTree] = useState(false);
  const [techTree, setTechTree] = useState<TechNode[]>([]);
  const [showBonuses, setShowBonuses] = useState(false);
  const [atomBombAnim, setAtomBombAnim] = useState<{ targetName: string; key: number } | null>(null);
  const [activeEventCard, setActiveEventCard] = useState<EventCard | null>(null);
  const [truceProposal, setTruceProposal] = useState<{
    gameId: string;
    proposerId: string;
    proposerName: string;
    proposerColor: string;
  } | null>(null);

  const [wonderNotif, setWonderNotif] = useState<{
    wonderId: string;
    builderName: string;
    builderColor: string;
    territoryId: string;
  } | null>(null);
  const wonderNotifTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    tutorialSessionDefault2dRef.current = false;
    nonTutorialIslandGlobeAppliedRef.current = false;
    draftSummaryShownRef.current = false;
    pendingDraftSummaryRef.current = null;
  }, [gameId]);

  useEffect(() => {
    if (draftSummaryShownRef.current) return;
    if (!mapData) return;
    if (!pendingDraftSummaryRef.current) return;
    setModalQueue((prev) => [...prev, buildDraftSummaryModal(pendingDraftSummaryRef.current!, mapData)]);
    pendingDraftSummaryRef.current = null;
    draftSummaryShownRef.current = true;
  }, [mapData]);

  /** Learn the Basics (tutorial island only): default 2D. Uses gameState.map_id so we do not wait for map HTTP. */
  const tutorialIsland =
    isTutorial && gameState?.map_id === 'tutorial';

  useEffect(() => {
    if (!tutorialIsland || !gameStarted) return;
    if (tutorialSessionDefault2dRef.current) return;
    tutorialSessionDefault2dRef.current = true;
    setMapView('2d');
  }, [tutorialIsland, gameStarted]);

  /** All other games: default globe so era maps show as intended (not a stale 2D preference from tutorial). */
  useEffect(() => {
    if (!gameStarted || !gameState) return;
    if (tutorialIsland) return;
    if (nonTutorialIslandGlobeAppliedRef.current) return;
    nonTutorialIslandGlobeAppliedRef.current = true;
    setMapView('globe');
    persistMapView('globe');
  }, [gameStarted, gameState, tutorialIsland]);

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
      socket.emit('game:join', { gameId });
    };

    joinGame();

    const onConnect = () => {
      setSocketConnection('connected');
      joinGame();
    };
    const onDisconnect = () => setSocketConnection('disconnected');
    const onReconnectAttempt = () => setSocketConnection('reconnecting');

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.io.on('reconnect_attempt', onReconnectAttempt);
    if (socket.connected) {
      setSocketConnection('connected');
    }

    socket.on('game:joined', ({ playerIndex }: { playerIndex: number }) => {
      setIsHost(playerIndex === 0);
    });

    socket.on('game:lobby_updated', (payload: unknown) => {
      const next = normalizeLobbySnapshot(payload);
      if (next) setLobbySnapshot(next);
    });

    socket.on('game:state', (state: ClientGameState) => {
      // Reconnecting players only receive game:state, not game:started — keep UI in sync
      setGameStarted(true);
      setGameState(state);
      const myId = userRef.current?.user_id;
      const myName = userRef.current?.username;
      const prevDraft = useGameStore.getState().draftUnitsRemaining;
      setDraftUnitsRemaining(computeDraftPool(state, myId, myName, prevDraft));

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
        const draftLeft = isMyDraftTurn
          ? computeDraftPool(state, myId, myName, state.draft_units_remaining ?? 0)
          : -1;

        setTutorialStep((cur) => {
          const step = TUTORIAL_STEPS[cur];
          if (!step) return cur;
          // Opponent finished → your turn again (watch AI / other players)
          if (
            step.requireAction === 'my_turn' &&
            playerChanged &&
            prevIndex !== null &&
            me
          ) {
            const prevPid = state.players[prevIndex]?.player_id;
            const nowPid = state.players[newIndex]?.player_id;
            if (prevPid !== me.player_id && nowPid === me.player_id) {
              return cur + 1;
            }
          }
          // Advance after last reinforcement is placed (still in draft) or when attack phase begins
          if (
            step.requireAction === 'draft' &&
            (state.phase === 'attack' || (isMyDraftTurn && draftLeft === 0))
          ) {
            return cur + 1;
          }
          if (step.requireAction === 'end_phase' && prevPhase && prevPhase !== state.phase) return cur + 1;
          return cur;
        });
      }
    });

    socket.on('game:started', () => {
      setGameStarted(true);
      toast.success('Game started! Good luck, Commander!');
    });

    socket.on('game:combat_result', (data: {
      fromId: string; toId: string;
      result: { attacker_rolls: number[]; defender_rolls: number[]; attacker_losses: number; defender_losses: number; territory_captured: boolean };
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
        attackerName,
        defenderName,
      };

      setLastCombatResult(enriched);

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
        if (state?.settings?.tutorial && state.phase === 'attack') {
          const stepId = TUTORIAL_STEPS[tutorialStepRef.current]?.id;
          if (stepId === 'attack_do') {
            setTutorialAttackAutoTick((n) => n + 1);
          }
        }
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

      const atkPlayerColor = state?.players.find(p => p.player_id === attackerOwner)?.color;
      const defPlayerColor = state?.players.find(p => p.player_id === defenderOwner)?.color;
      pushGlobeEvent({
        type: 'combat',
        territoryId: data.toId,
        fromTerritoryId: data.fromId,
        attackerLosses: attacker_losses,
        defenderLosses: defender_losses,
        captured: territory_captured,
        attackerColor: atkPlayerColor,
        defenderColor: defPlayerColor,
      });
    });

    socket.on('game:cards_redeemed', ({ bonus }: { bonus: number }) => {
      toast.success(`Card set redeemed! +${bonus} bonus units`);
      const curr = useGameStore.getState().draftUnitsRemaining;
      setDraftUnitsRemaining(curr + bonus);
    });

    socket.on('game:over', (stats: {
      winner_id: string;
      winner_ids?: string[];
      winner_name: string;
      turn_count: number;
      players: Array<{ player_id: string; username: string; color: string; territory_count: number; is_eliminated: boolean; is_ai: boolean }>;
      win_probability_history?: Array<{ step: number; turn: number; probabilities: Record<string, number> }>;
      rating_deltas?: Record<string, number>;
      is_ranked?: boolean;
      achievements_unlocked?: Record<string, string[]>;
      xp_earned_by_player?: Record<string, number>;
      victory_condition?: 'domination' | 'last_standing' | 'threshold' | 'capital' | 'secret_mission' | 'alliance_victory';
    }) => {
      const myId = userRef.current?.user_id;
      const xpEarned =
        myId && stats.xp_earned_by_player ? stats.xp_earned_by_player[myId] : undefined;
      const currentEra = useGameStore.getState().gameState?.era;
      const winnerIds = stats.winner_ids ?? [stats.winner_id];
      const gameOverData: GameOverModalData = {
        type: 'game_over',
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
      };
      setModalQueue(q => [...q, gameOverData]);
    });

    socket.on('game:player_eliminated', ({ playerId, eliminatorName, eliminatedName }: {
      playerId: string; eliminatorId: string; eliminatorName: string; eliminatedName: string;
    }) => {
      const isSelf = playerId === userRef.current?.user_id;
      const elData: EliminationModalData = {
        type: 'elimination',
        eliminatedName,
        eliminatorName,
        isSelf,
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

    socket.on('game:research_result', ({ success, error, node }: { success: boolean; error?: string; node?: TechNode }) => {
      if (!success) toast.error(error ?? 'Research failed');
      else toast.success(`Researched: ${node?.name ?? 'technology'}`, { icon: '🔬', duration: 3000 });
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
    });

    socket.on('game:influence_result', ({ success, targetId, error }: { success: boolean; targetId?: string; error?: string }) => {
      const mapData = mapDataRef.current;
      const targetName = targetId ? (mapData?.territories.find((t) => t.territory_id === targetId)?.name ?? targetId) : 'territory';
      if (success) {
        toast.success(`📡 Influence succeeded — ${targetName} seized!`, { duration: 3000 });
        setCombatLog((prev) => [...prev, `Influence: ${targetName} seized via influence spread`]);
      } else {
        toast.error(error ?? 'Influence failed');
      }
    });

    socket.on('game:event_card', (card: EventCard) => {
      setActiveEventCard(card);
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
      if (result.pending) {
        toast(`Truce proposal sent to ${result.targetName ?? 'player'}`, { icon: '🤝', duration: 3000 });
      } else if (result.accepted) {
        toast.success(`Truce accepted with ${result.targetName ?? result.proposerName ?? 'player'}!`, { duration: 4000 });
      } else {
        toast(`Truce declined by ${result.targetName ?? result.proposerName ?? 'player'}`, { icon: '❌', duration: 3000 });
      }
    });

    socket.on('error', ({ message }: { message: string }) => {
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

    socket.on('game:atom_bomb', ({ attackerName, attackerColor, territoryId }: {
      attackerId: string;
      attackerName: string;
      attackerColor: string;
      territoryId: string;
    }) => {
      const tName = mapDataRef.current?.territories.find((t) => t.territory_id === territoryId)?.name ?? territoryId;
      setAtomBombAnim((prev) => ({ targetName: tName, key: (prev?.key ?? 0) + 1 }));
      const isMe = attackerName === user?.username;
      toast(
        isMe
          ? `☢️ You dropped the Atom Bomb on ${tName}!`
          : `☢️ ${attackerName} dropped the Atom Bomb on ${tName}!`,
        {
          duration: 6000,
          style: { background: '#1a0000', border: '1px solid #7f1d1d', color: '#fca5a5' },
        },
      );
      setCombatLog((prev) => [...prev, `☢️ ${attackerName} atom-bombed ${tName} — all units eliminated`]);
      pushGlobeEvent({
        type: 'combat',
        territoryId,
        attackerLosses: 0,
        defenderLosses: 99,
        captured: false,
        attackerColor,
      });
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
      socket.off('game:chat_message');
      socket.off('game:player_eliminated');
      socket.off('game:player_resigned');
      socket.off('game:build_result');
      socket.off('game:research_result');
      socket.off('game:naval_combat_result');
      socket.off('game:influence_result');
      socket.off('game:event_card');
      socket.off('game:event_card_resolved');
      socket.off('game:truce_proposal');
      socket.off('game:truce_result');
      socket.off('error');
      socket.off('game:wonder_built');
      socket.off('game:atom_bomb');
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
    if (!gs || (!uid && !uname)) return;
    const prev = useGameStore.getState().draftUnitsRemaining;
    setDraftUnitsRemaining(computeDraftPool(gs, uid, uname, prev));
  }, [user?.user_id, gameState?.draft_units_remaining, gameState?.phase, gameState?.current_player_index, gameState?.turn_number]);

  // Tutorial: keep server phase aligned with the current card (draft→attack, attack→fortify)
  useEffect(() => {
    if (!isTutorial || !gameId || !gameState || !user?.user_id) return;
    const myId = user.user_id;
    const isMyTurn = gameState.players[gameState.current_player_index]?.player_id === myId;
    if (!isMyTurn) return;

    if (gameState.phase === 'attack') tutorialDraftToAttackPendingRef.current = false;
    if (gameState.phase === 'fortify') tutorialAttackToFortifyPendingRef.current = false;

    const sid = TUTORIAL_STEPS[tutorialStep]?.id;
    if (!sid) return;

    const draftLeft = computeDraftPool(gameState, myId, user?.username, draftUnitsRemaining);
    const socket = getSocket();

    if ((sid === 'attack_explain' || sid === 'attack_do') && gameState.phase === 'draft' && draftLeft === 0) {
      if (tutorialDraftToAttackPendingRef.current) return;
      tutorialDraftToAttackPendingRef.current = true;
      socket.emit('game:advance_phase', { gameId });
      return;
    }

    if (sid === 'fortify_explain' && gameState.phase === 'attack') {
      if (tutorialAttackToFortifyPendingRef.current) return;
      tutorialAttackToFortifyPendingRef.current = true;
      socket.emit('game:advance_phase', { gameId });
    }
  }, [
    isTutorial,
    gameId,
    gameState,
    tutorialStep,
    user?.user_id,
    draftUnitsRemaining,
  ]);

  useEffect(() => {
    tutorialAttackPhaseAutoEmittedRef.current = false;
    tutorialFortifyEndEmittedRef.current = false;
    tutorialFortifyScheduleStartedRef.current = false;
  }, [tutorialStep]);

  // Tutorial attack_do: auto advance attack → fortify shortly after the player's first attack
  useEffect(() => {
    if (!isTutorial || !gameId || !user?.user_id) return;
    if (tutorialAttackAutoTick === 0) return;
    const gs = useGameStore.getState().gameState;
    if (!gs || TUTORIAL_STEPS[tutorialStep]?.id !== 'attack_do') return;
    if (gs.phase !== 'attack') return;
    if (gs.players[gs.current_player_index]?.player_id !== user.user_id) return;
    if (tutorialAttackPhaseAutoEmittedRef.current) return;

    const t = window.setTimeout(() => {
      const live = useGameStore.getState().gameState;
      if (live?.phase !== 'attack') return;
      if (tutorialAttackPhaseAutoEmittedRef.current) return;
      tutorialAttackPhaseAutoEmittedRef.current = true;
      getSocket().emit('game:advance_phase', { gameId });
    }, 900);
    return () => window.clearTimeout(t);
  }, [tutorialAttackAutoTick, isTutorial, gameId, tutorialStep, user?.user_id]);

  // If the player never attacks, still leave attack phase after 18s (deps avoid resetting on every game:state tick)
  useEffect(() => {
    if (!isTutorial || !gameId || !gameState || !user?.user_id) return;
    if (TUTORIAL_STEPS[tutorialStep]?.id !== 'attack_do') return;
    if (gameState.phase !== 'attack') return;
    if (gameState.players[gameState.current_player_index]?.player_id !== user.user_id) return;

    const t = window.setTimeout(() => {
      if (tutorialAttackPhaseAutoEmittedRef.current) return;
      tutorialAttackPhaseAutoEmittedRef.current = true;
      getSocket().emit('game:advance_phase', { gameId });
    }, 18000);
    return () => window.clearTimeout(t);
  }, [isTutorial, gameId, tutorialStep, gameState?.phase, user?.user_id]);

  // Tutorial fortify_explain: auto end turn (fortify → next) so user is not stuck on "End Turn"
  useEffect(() => {
    if (!isTutorial || !gameId || !gameState || !user?.user_id) return;
    if (TUTORIAL_STEPS[tutorialStep]?.id !== 'fortify_explain') return;
    if (gameState.phase !== 'fortify') return;
    if (gameState.players[gameState.current_player_index]?.player_id !== user.user_id) return;
    if (tutorialFortifyScheduleStartedRef.current) return;
    tutorialFortifyScheduleStartedRef.current = true;

    const t = window.setTimeout(() => {
      if (tutorialFortifyEndEmittedRef.current) return;
      tutorialFortifyEndEmittedRef.current = true;
      getSocket().emit('game:advance_phase', { gameId });
    }, 2200);
    return () => window.clearTimeout(t);
  }, [isTutorial, gameId, tutorialStep, gameState?.phase, user?.user_id]);

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
    const sid = TUTORIAL_STEPS[tutorialStep]?.id;
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
  }, [isTutorial, gameState, user?.user_id, tutorialStep]);

  useEffect(() => {
    loadLobby();
  }, [loadLobby]);

  // ── Load map data ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!gameState?.map_id) return;
    api.get(`/maps/${gameState.map_id}`)
      .then((res) => {
        setMapData(res.data.map);
        mapDataRef.current = res.data.map;
      })
      .catch(() => toast.error('Failed to load map data'));
  }, [gameState?.map_id]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleStartGame = () => {
    getSocket().emit('game:start', { gameId });
  };

  const handleTerritoryClick = useCallback((territoryId: string) => {
    if (!gameState) return;
    const socket = getSocket();
    const currentTurnPlayer = gameState.players[gameState.current_player_index];
    const isMyTurn =
      currentTurnPlayer?.player_id === user?.user_id ||
      (!!user?.username && currentTurnPlayer?.username === user.username);
    const tState = gameState.territories[territoryId];

    // Territory draft: attempt claim directly on click. Server remains authoritative
    // and will reject if it's not actually this player's turn.
    if (gameState.phase === 'territory_select') {
      const isUnowned = tState && (tState.owner_id == null || tState.owner_id === '' || tState.owner_id === 'neutral');
      if (isUnowned) {
        socket.emit('game:select_territory', { gameId, territoryId });
        setSelectedTerritory(null);
        return;
      }
    }

    if (!isMyTurn) {
      setSelectedTerritory(territoryId);
      return;
    }

    if (gameState.phase === 'fortify' && attackSource && tState?.owner_id === user?.user_id && attackSource !== territoryId) {
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

      const myColor = gameState.players.find(p => p.player_id === user?.user_id)?.color;
      pushGlobeEvent({
        type: 'fortify',
        territoryId,
        fromTerritoryId: attackSource,
        units,
        playerColor: myColor,
      });

      setAttackSource(null);
      setFortifyUnits(1);
      setNavalSource(null);
      setSelectedTerritory(null);
      return;
    }

    setSelectedTerritory(territoryId);
  }, [gameState, attackSource, user, gameId, showNotification, setFortifyUnits, setNavalSource]);

  const handleClaimTerritory = (territoryId: string) => {
    getSocket().emit('game:select_territory', { gameId, territoryId });
    setSelectedTerritory(null);
  };

  const handleAdvancePhase = () => {
    getSocket().emit('game:advance_phase', { gameId });
    setSelectedTerritory(null);
    setAttackSource(null);
    setNavalSource(null);
    setFortifyUnits(1);
  };

  const handleAttack = (fromId: string, toId: string) => {
    getSocket().emit('game:attack', { gameId, fromId, toId });
    setAttackSource(null);
    setNavalSource(null);
    setFortifyUnits(1);
    setSelectedTerritory(null);
  };

  const handleDraft = (territoryId: string, units: number) => {
    getSocket().emit('game:draft', { gameId, territoryId, units });
    const gs = useGameStore.getState().gameState;
    const uid = useAuthStore.getState().user?.user_id;
    const uname = useAuthStore.getState().user?.username;
    const curr = computeDraftPool(gs, uid, uname, useGameStore.getState().draftUnitsRemaining);
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

    const tState = gameState?.territories[territoryId];
    const myColor = gameState?.players.find(p => p.player_id === user?.user_id)?.color;
    pushGlobeEvent({
      type: 'reinforce',
      territoryId,
      units,
      totalAfter: (tState?.unit_count ?? 0) + units,
      playerColor: myColor,
    });
  };

  const handleFortify = (fromId: string, toId: string, units: number) => {
    getSocket().emit('game:fortify', { gameId, fromId, toId, units });
    setSelectedTerritory(null);
    setAttackSource(null);
    setNavalSource(null);

    const fromName = mapDataRef.current?.territories.find(t => t.territory_id === fromId)?.name ?? fromId;
    const toName = mapDataRef.current?.territories.find(t => t.territory_id === toId)?.name ?? toId;
    ownTurnFortificationsRef.current.push({ fromName, toName, units });
    showNotification({
      type: 'fortify',
      text: `Moved ${units} troops: ${fromName} → ${toName}`,
      icon: 'arrow',
      accentBg: 'bg-sky-500/20',
      accentBorder: 'border-sky-500/30',
      accentText: 'text-sky-400',
    });

    const myColor = gameState?.players.find(p => p.player_id === user?.user_id)?.color;
    pushGlobeEvent({
      type: 'fortify',
      territoryId: toId,
      fromTerritoryId: fromId,
      units,
      playerColor: myColor,
    });
  };

  const handleRedeemCards = (cardIds: string[]) => {
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
  }, [gameState?.era, techTree.length]);

  const handleOpenBonuses = useCallback(() => {
    // Pre-load tech tree so BonusesModal can show full tech descriptions
    if (gameState?.era && gameState.settings.tech_trees_enabled && techTree.length === 0) {
      api.get(`/eras/${gameState.era}/tech-tree`)
        .then((res) => setTechTree(res.data.techTree ?? []))
        .catch(() => {});
    }
    setShowBonuses(true);
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

  const handleAtomBomb = useCallback((targetId: string) => {
    getSocket().emit('game:use_ability', { gameId, abilityId: 'atom_bomb', params: { territoryId: targetId } });
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
    navigate('/lobby');
  };

  const handleTutorialContinuePlaying = useCallback(() => {
    setTutorialStep(TUTORIAL_STEPS.length);
  }, []);

  const handleTutorialReturnToLobby = useCallback(async () => {
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

  // ── Auto-start tutorial if host and not started ──
  // Note: isTutorial requires gameState which isn't set yet in the lobby phase;
  // use lobbySnapshot.settings_json.tutorial which is available from game:lobby_updated.
  useEffect(() => {
    if (
      lobbySnapshot?.settings_json?.tutorial === true &&
      isHost &&
      lobbySnapshot?.status === 'waiting' &&
      !gameStarted
    ) {
      handleStartGame();
    }
  }, [isHost, lobbySnapshot, gameStarted]);

  // Hoisted for use in mobile bottom bar, cards tray, and combat banner
  const mobileMyPlayer = gameState?.players.find((p) => p.player_id === user?.user_id);
  const mobileIsMyTurn = gameState?.players[gameState.current_player_index]?.player_id === user?.user_id;

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

  // ── Waiting lobby ─────────────────────────────────────────────────────────
  if (!gameStarted || !gameState) {
    const shareUrl = gameId ? `${window.location.origin}/game/${gameId}` : '';
    const lobby = lobbySnapshot;
    const settings = lobby?.settings_json ?? {};
    const maxPlayers =
      typeof settings.max_players === 'number' ? settings.max_players : 8;
    const roster = lobby ? [...lobby.players].sort((a, b) => a.player_index - b.player_index) : [];
    const aiCount = roster.filter((p) => p.is_ai).length;
    const firstAi = roster.find((p) => p.is_ai);
    const eraLabel = ERA_LABELS[lobby?.era_id ?? ''] ?? lobby?.era_id ?? '—';
    const mapLabel =
      lobby?.map_id && lobby?.era_id
        ? formatLobbyMapLabel(lobby.map_id, lobby.era_id)
        : '—';
    const victorySummary = formatVictorySummary(settings);

    return (
      <div className="min-h-screen bg-cc-dark flex items-center justify-center p-4">
        <div className="card text-center max-w-xl w-full">
          <h2 className="font-display text-2xl text-cc-gold mb-2">Game Lobby</h2>
          <p className="text-cc-muted text-sm mb-6">
            {!lobby
              ? 'Loading lobby…'
              : lobby.status === 'waiting'
                ? 'Waiting for the host to start, or for more players to join.'
                : 'Preparing game…'}
          </p>

          {lobby && (
            <div className="text-left space-y-4 mb-6">
              <div className="p-4 bg-cc-dark rounded-lg border border-cc-border">
                <p className="text-xs text-cc-muted uppercase tracking-wide mb-3">Game settings</p>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div>
                    <dt className="text-cc-muted text-xs">Era</dt>
                    <dd className="text-cc-text">{eraLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-cc-muted text-xs">Map</dt>
                    <dd className="text-cc-text">{mapLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-cc-muted text-xs">Players</dt>
                    <dd className="text-cc-text">
                      {roster.length} / {maxPlayers}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-cc-muted text-xs">Fog of war</dt>
                    <dd className="text-cc-text">{settings.fog_of_war ? 'On' : 'Off'}</dd>
                  </div>
                  <div>
                    <dt className="text-cc-muted text-xs">Turn timer</dt>
                    <dd className="text-cc-text">{formatTurnTimer(settings.turn_timer_seconds)}</dd>
                  </div>
                  <div>
                    <dt className="text-cc-muted text-xs">Victory</dt>
                    <dd className="text-cc-text">{victorySummary}</dd>
                  </div>
                  <div>
                    <dt className="text-cc-muted text-xs">Starting units</dt>
                    <dd className="text-cc-text">
                      {typeof settings.initial_unit_count === 'number' ? settings.initial_unit_count : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-cc-muted text-xs">Diplomacy</dt>
                    <dd className="text-cc-text">{settings.diplomacy_enabled ? 'On' : 'Off'}</dd>
                  </div>
                  {aiCount > 0 && (
                    <div className="sm:col-span-2">
                      <dt className="text-cc-muted text-xs">AI opponents</dt>
                      <dd className="text-cc-text">
                        {aiCount} · {firstAi?.ai_difficulty ? `${firstAi.ai_difficulty.charAt(0).toUpperCase()}${firstAi.ai_difficulty.slice(1)}` : 'Medium'}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>

              <div className="p-4 bg-cc-dark rounded-lg border border-cc-border">
                <p className="text-xs text-cc-muted uppercase tracking-wide mb-3">Players</p>
                <ul className="space-y-2 max-h-56 overflow-y-auto text-left">
                  {roster.map((p) => {
                    const isYou = p.user_id && user?.user_id && p.user_id === user.user_id;
                    return (
                      <li
                        key={p.player_index}
                        className="flex items-center gap-3 py-1.5 border-b border-cc-border/60 last:border-0"
                      >
                        <span
                          className="w-3 h-3 rounded-full shrink-0 border border-white/20"
                          style={{ backgroundColor: p.player_color }}
                          title="Color"
                        />
                        <span className="flex-1 text-cc-text text-sm truncate">
                          {playerLobbyDisplayName(p)}
                          {isYou && (
                            <span className="text-cc-muted text-xs ml-1">(you)</span>
                          )}
                        </span>
                        {p.player_index === 0 && (
                          <span className="text-xs px-2 py-0.5 rounded bg-cc-gold/15 text-cc-gold border border-cc-gold/30">
                            Host
                          </span>
                        )}
                        {p.is_ai && (
                          <span className="text-xs px-2 py-0.5 rounded bg-cc-surface text-cc-muted border border-cc-border">
                            AI
                            {p.ai_difficulty
                              ? ` · ${p.ai_difficulty.charAt(0).toUpperCase()}${p.ai_difficulty.slice(1)}`
                              : ''}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}

          {gameId && (
            <div className="text-left space-y-3 mb-6 p-4 bg-cc-dark rounded-lg border border-cc-border">
              <p className="text-xs text-cc-muted uppercase tracking-wide">Share this game</p>
              {lobbySnapshot?.join_code && (
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-cc-gold font-mono text-lg tracking-wider">{lobbySnapshot.join_code}</span>
                  <button type="button" onClick={copyJoinCode} className="btn-secondary text-sm py-1 px-3">
                    Copy code
                  </button>
                </div>
              )}
              <p className="text-xs text-cc-muted break-all">{shareUrl}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={copyGameUrl} className="btn-secondary text-sm py-1.5 px-3">
                  Copy link
                </button>
                <button type="button" onClick={copyGameId} className="btn-secondary text-sm py-1.5 px-3">
                  Copy game ID
                </button>
              </div>
            </div>
          )}

          {isHost && (
            <div className="space-y-3">
              <button onClick={handleStartGame} className="btn-primary w-full text-lg py-3">
                Start Game
              </button>
              {!user?.is_guest && gameId && (
                <button
                  type="button"
                  onClick={() => setShowInviteModal(true)}
                  className="btn-secondary w-full text-lg py-3"
                >
                  Invite friends
                </button>
              )}
            </div>
          )}
          {!isHost && (
            <p className="text-cc-muted text-sm">Waiting for the host to start the game.</p>
          )}
        </div>
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
    prefersReducedMotion() || (isMobileViewport() && mapView === 'globe');

  return (
    <div className="h-screen bg-cc-dark flex flex-col overflow-hidden">
      {/* Top Bar */}
      <div className="min-h-10 pt-safe bg-cc-surface border-b border-cc-border flex items-center px-4 gap-4 shrink-0 py-1">
        <Link to="/lobby" className="font-display text-cc-gold text-sm tracking-widest hover:text-white transition-colors">ERAS OF EMPIRE</Link>
        <span className="text-cc-muted text-xs">·</span>
        <span className="text-cc-muted text-xs capitalize">
          {gameState.era === 'custom' ? 'Community map' : `${gameState.era} Era`}
        </span>
        <span className="text-cc-muted text-xs">·</span>
        <span className="text-cc-muted text-xs">Turn {gameState.turn_number}</span>
        <div className="flex-1" />
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => {
              setMapView('globe');
              persistMapView('globe');
            }}
            className={`min-h-[40px] min-w-[40px] px-2 py-1 text-xs rounded ${mapView === 'globe' ? 'bg-cc-gold/20 text-cc-gold' : 'text-cc-muted hover:text-cc-text'}`}
          >
            Globe
          </button>
          <button
            type="button"
            onClick={() => {
              setMapView('2d');
              persistMapView('2d');
            }}
            className={`min-h-[40px] min-w-[40px] px-2 py-1 text-xs rounded ${mapView === '2d' ? 'bg-cc-gold/20 text-cc-gold' : 'text-cc-muted hover:text-cc-text'}`}
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
              className={`min-h-[40px] min-w-[40px] px-2 py-1 text-xs rounded flex items-center gap-1 ${globeSpinEnabled ? 'bg-cc-gold/20 text-cc-gold' : 'text-cc-muted hover:text-cc-text'}`}
              aria-label="Toggle globe spin"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Spin</span>
            </button>
          )}
        </div>
      </div>

      {socketConnection !== 'connected' && (
        <div
          role="status"
          className={`shrink-0 px-4 py-2 text-center text-sm ${
            socketConnection === 'reconnecting'
              ? 'bg-amber-900/40 text-amber-200 border-b border-amber-700/50'
              : 'bg-red-900/40 text-red-200 border-b border-red-700/50'
          }`}
        >
          {socketConnection === 'reconnecting'
            ? 'Reconnecting to game server…'
            : 'Disconnected from game server. Attempting to reconnect…'}
        </div>
      )}

      {/* Main Game Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Map Canvas */}
        <div
          ref={mapAreaRef}
          className="flex-1 relative overflow-hidden min-h-0 min-w-0"
        >
          {mapData ? (
            mapView === 'globe' ? (
              <GlobeMap
                mapData={mapData}
                onTerritoryClick={handleTerritoryClick}
                width={mapCanvasSize.w}
                height={mapCanvasSize.h}
                events={globeEvents}
                onEventDone={handleGlobeEventDone}
                reducedEffects={reducedGlobe}
                autoSpin={globeSpinEnabled}
                highlightTerritoryId={tutorialHighlightId}
              />
            ) : (
              <GameMap
                mapData={mapData}
                onTerritoryClick={handleTerritoryClick}
                width={mapCanvasSize.w}
                height={mapCanvasSize.h}
                highlightTerritoryId={tutorialHighlightId}
              />
            )
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-cc-muted">Loading map...</p>
            </div>
          )}

          {/* Territory Info Panel */}
          {selectedTerritory && mapData && (
            <TerritoryPanel
              mapTerritories={mapData.territories}
              onAttack={handleAttack}
              onDraft={handleDraft}
              onFortify={handleFortify}
              onBuild={gameState?.settings.economy_enabled ? handleBuild : undefined}
              onNavalMove={gameState?.settings.naval_enabled ? handleNavalMove : undefined}
              onNavalAttack={gameState?.settings.naval_enabled ? handleNavalAttack : undefined}
              onInfluence={
                (gameState?.era_modifiers?.influence_spread || gameState?.era_modifiers?.carbonari_network)
                  ? handleInfluence
                  : undefined
              }
              onProposeTruce={gameState?.settings.diplomacy_enabled ? handleProposeTruce : undefined}
              onAtomBomb={gameState?.players.find(p => p.player_id === user?.user_id)?.unlocked_techs?.includes('ww2_atom_bomb') ? handleAtomBomb : undefined}
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
          onResign={handleResignRequest}
          onSaveAndLeave={handleSaveAndLeave}
          onOpenTechTree={gameState?.settings.tech_trees_enabled ? handleOpenTechTree : undefined}
          onOpenBonuses={handleOpenBonuses}
          lastCombatLog={combatLog}
          gameId={gameStarted && gameId ? gameId : undefined}
          activeInteractionLabel={activeInteractionLabel}
        />
      </div>

      {/* ── Mobile Bottom Bar ──────────────────────────────────────────────── */}
      {gameState && (() => {
        const cp = gameState.players[gameState.current_player_index];
        const me = gameState.players.find(
          (p) => p.player_id === user?.user_id || (!!user?.username && p.username === user.username),
        );
        const myTurn = !!cp && !!me && cp.player_id === me.player_id;
        const phaseLabel: Record<string, string> = {
          territory_select: 'Territory Draft', draft: 'Reinforcement', attack: 'Attack', fortify: 'Fortify', game_over: 'Game Over',
        };
        const mobileDraftPool = myTurn && gameState.phase === 'draft'
          ? computeDraftPool(gameState, user?.user_id, user?.username, draftUnitsRemaining)
          : 0;
        return (
          <div className="flex md:hidden items-center gap-3 px-4 shrink-0 bg-cc-surface border-t border-cc-border pb-safe min-h-[56px]">
            {/* Player + phase info */}
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {cp && (
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cp.color }} />
              )}
              <div className="min-w-0">
                <div className="text-xs font-display text-cc-gold truncate">
                  {phaseLabel[gameState.phase] ?? gameState.phase}
                  {mobileDraftPool > 0 && (
                    <span className="ml-1.5 text-cc-text font-mono font-normal">
                      · {mobileDraftPool} units
                    </span>
                  )}
                </div>
                <div className="text-xs text-cc-muted truncate">
                  {myTurn ? 'Your turn' : cp?.username ?? '—'}
                  {gameState.settings.async_mode && (() => {
                    const dSec = gameState.settings.async_turn_deadline_seconds ?? 86400;
                    const elapsed = (Date.now() - gameState.turn_started_at) / 1000;
                    const rem = Math.max(0, dSec - elapsed);
                    const h = Math.floor(rem / 3600);
                    const m = Math.floor((rem % 3600) / 60);
                    return (
                      <span className="ml-1 text-cc-muted">
                        · {h > 0 ? `${h}h ${m}m` : `${m}m`}
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
                className="relative w-10 h-10 flex items-center justify-center rounded-lg bg-cc-dark border border-cc-border text-cc-muted hover:text-cc-text shrink-0"
                aria-label="Show cards"
              >
                <CreditCard className="w-5 h-5" />
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-cc-gold text-cc-dark text-[10px] font-bold rounded-full flex items-center justify-center">
                  {mobileMyPlayer.cards.length}
                </span>
              </button>
            )}
            {/* HUD drawer toggle */}
            <button
              type="button"
              onClick={() => setMobileHudOpen(true)}
              className="relative w-10 h-10 flex items-center justify-center rounded-lg bg-cc-dark border border-cc-border text-cc-muted hover:text-cc-text shrink-0"
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
          <div className="fixed inset-y-0 right-0 w-80 max-w-[85vw] z-50 flex flex-col bg-cc-surface">
            {/* Drawer header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-cc-border pt-safe shrink-0">
              <span className="font-display text-sm text-cc-gold">Game Info</span>
              <button
                type="button"
                onClick={() => setMobileHudOpen(false)}
                className="w-9 h-9 flex items-center justify-center rounded-lg bg-cc-dark text-cc-muted hover:text-cc-text"
                aria-label="Close menu"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <GameHUD
              mobile
              onAdvancePhase={() => { handleAdvancePhase(); setMobileHudOpen(false); }}
              onRedeemCards={(ids) => { handleRedeemCards(ids); setMobileHudOpen(false); }}
              onResign={handleResignRequest}
              onSaveAndLeave={handleSaveAndLeave}
              onOpenTechTree={gameState?.settings.tech_trees_enabled ? () => { handleOpenTechTree(); setMobileHudOpen(false); } : undefined}
              onOpenBonuses={() => { handleOpenBonuses(); setMobileHudOpen(false); }}
              lastCombatLog={combatLog}
              gameId={gameStarted && gameId ? gameId : undefined}
              activeInteractionLabel={activeInteractionLabel}
            />
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

      {atomBombAnim && (
        <AtomBombAnimation
          key={atomBombAnim.key}
          targetName={atomBombAnim.targetName}
          onDone={() => setAtomBombAnim(null)}
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
              wants to call a truce with you for 3 turns.
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

      {/* Action Modal (blocking — combat results, turn summaries, game over, resign) */}
      <ActionModal
        data={modalQueue[0] ?? null}
        onDismiss={modalQueue[0]?.type === 'game_over' ? handleGameOverDismiss : dismissModal}
        onResignConfirm={handleResignConfirm}
        onRepeatCombat={handleAttack}
      />

      {/* Action Notification (auto-dismiss — reinforcements, fortify, phase changes) */}
      <ActionNotification key={notifState?.key} data={notifState?.data ?? null} />

      {/* Tutorial Overlay */}
      {isTutorial && tutorialStep < TUTORIAL_STEPS.length && (
        <TutorialOverlay
          stepIndex={tutorialStep}
          onAdvance={() => setTutorialStep((s) => Math.min(s + 1, TUTORIAL_STEPS.length))}
          onContinuePlaying={handleTutorialContinuePlaying}
          onReturnToLobby={handleTutorialReturnToLobby}
          centered={
            TUTORIAL_STEPS[tutorialStep]?.id === 'welcome' ||
            TUTORIAL_STEPS[tutorialStep]?.id === 'draft_explain' ||
            TUTORIAL_STEPS[tutorialStep]?.variant === 'wrapup'
          }
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
