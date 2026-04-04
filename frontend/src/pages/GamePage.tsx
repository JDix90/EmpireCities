import React, { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useGameStore, CombatResult } from '../store/gameStore';
import { useUiStore } from '../store/uiStore';
import { useAuthStore } from '../store/authStore';
import { connectSocket, getSocket } from '../services/socket';
import { api } from '../services/api';
import GameMap from '../components/game/GameMap';
import GlobeMap, { type GlobeEvent } from '../components/game/GlobeMap';
import GameHUD from '../components/game/GameHUD';
import TerritoryPanel from '../components/game/TerritoryPanel';
import ActionModal, { ActionNotification, ModalData, NotificationData, ReinforcementEntry, FortifyEntry, GameOverModalData, EliminationModalData } from '../components/game/ActionModal';
import TutorialOverlay, { TUTORIAL_STEPS } from '../components/game/TutorialOverlay';
import { computeDraftPool } from '../utils/draftPool';
import toast from 'react-hot-toast';
import {
  getInitialMapView,
  persistMapView,
  prefersReducedMotion,
  isMobileViewport,
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

export default function GamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const {
    gameState, setGameState, setLastCombatResult,
    draftUnitsRemaining, setDraftUnitsRemaining, clearGame,
  } = useGameStore();
  const {
    selectedTerritory,
    attackSource,
    setSelectedTerritory,
    setAttackSource,
    setFortifyUnits,
  } = useUiStore();

  const [mapData, setMapData] = useState<MapData | null>(null);
  const [combatLog, setCombatLog] = useState<string[]>([]);
  const [gameStarted, setGameStarted] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [mapView, setMapView] = useState<'2d' | 'globe'>(getInitialMapView);
  const mapDataRef = useRef<MapData | null>(null);
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
  }, [gameId]);

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

    socket.on('game:state', (state) => {
      // Reconnecting players only receive game:state, not game:started — keep UI in sync
      setGameStarted(true);
      setGameState(state);
      const myId = userRef.current?.user_id;
      const prevDraft = useGameStore.getState().draftUnitsRemaining;
      setDraftUnitsRemaining(computeDraftPool(state, myId, prevDraft));

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
        const isMyDraftTurn =
          state.phase === 'draft' &&
          !!myId &&
          state.players[state.current_player_index]?.player_id === myId;
        const draftLeft = isMyDraftTurn
          ? computeDraftPool(state, myId, state.draft_units_remaining ?? 0)
          : -1;

        setTutorialStep((cur) => {
          const step = TUTORIAL_STEPS[cur];
          if (!step) return cur;
          // Opponent finished → your turn again (watch AI / other players)
          if (
            step.requireAction === 'my_turn' &&
            playerChanged &&
            prevIndex !== null &&
            myId
          ) {
            const prevPid = state.players[prevIndex]?.player_id;
            const nowPid = state.players[newIndex]?.player_id;
            if (prevPid !== myId && nowPid === myId) {
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
      winner_name: string;
      turn_count: number;
      players: Array<{ player_id: string; username: string; color: string; territory_count: number; is_eliminated: boolean; is_ai: boolean }>;
      win_probability_history?: Array<{ step: number; turn: number; probabilities: Record<string, number> }>;
      rating_deltas?: Record<string, number>;
      is_ranked?: boolean;
      achievements_unlocked?: Record<string, string[]>;
      xp_earned_by_player?: Record<string, number>;
    }) => {
      const myId = userRef.current?.user_id;
      const xpEarned =
        myId && stats.xp_earned_by_player ? stats.xp_earned_by_player[myId] : undefined;
      const gameOverData: GameOverModalData = {
        type: 'game_over',
        isWinner: stats.winner_id === myId,
        winnerName: stats.winner_name,
        winnerColor: stats.players.find(p => p.player_id === stats.winner_id)?.color ?? '#fff',
        turnCount: stats.turn_count,
        players: stats.players,
        win_probability_history: stats.win_probability_history,
        rating_change: myId && stats.rating_deltas ? stats.rating_deltas[myId] : undefined,
        is_ranked: stats.is_ranked,
        achievements_unlocked: myId && stats.achievements_unlocked ? stats.achievements_unlocked[myId] : undefined,
        xpEarned,
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

    socket.on('error', ({ message }: { message: string }) => {
      toast.error(message);
    });

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      socket.off('game:joined');
      socket.off('game:state');
      socket.off('game:started');
      socket.off('game:combat_result');
      socket.off('game:cards_redeemed');
      socket.off('game:over');
      socket.off('game:chat_message');
      socket.off('game:player_eliminated');
      socket.off('game:player_resigned');
      socket.off('error');
      // Notify server we left so it can schedule eviction / save state
      socket.emit('game:leave', { gameId });
      clearGame();
    };
  }, [gameId]);

  // When auth hydrates after the first game:state, recompute draft so Place controls appear
  useEffect(() => {
    const gs = useGameStore.getState().gameState;
    const uid = user?.user_id;
    if (!gs || !uid) return;
    const prev = useGameStore.getState().draftUnitsRemaining;
    setDraftUnitsRemaining(computeDraftPool(gs, uid, prev));
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

    const draftLeft = computeDraftPool(gameState, myId, draftUnitsRemaining);
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
    const isMyTurn = gameState.players[gameState.current_player_index]?.player_id === user?.user_id;
    const tState = gameState.territories[territoryId];

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
      setSelectedTerritory(null);
      return;
    }

    setSelectedTerritory(territoryId);
  }, [gameState, attackSource, user, gameId, showNotification, setFortifyUnits]);

  const handleAdvancePhase = () => {
    getSocket().emit('game:advance_phase', { gameId });
    setSelectedTerritory(null);
    setAttackSource(null);
    setFortifyUnits(1);
  };

  const handleAttack = (fromId: string, toId: string) => {
    getSocket().emit('game:attack', { gameId, fromId, toId });
    setAttackSource(null);
    setFortifyUnits(1);
    setSelectedTerritory(null);
  };

  const handleDraft = (territoryId: string, units: number) => {
    getSocket().emit('game:draft', { gameId, territoryId, units });
    const gs = useGameStore.getState().gameState;
    const uid = useAuthStore.getState().user?.user_id;
    const curr = computeDraftPool(gs, uid, useGameStore.getState().draftUnitsRemaining);
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

  // ── Waiting lobby ─────────────────────────────────────────────────────────
  if (!gameStarted || !gameState) {
    return (
      <div className="min-h-screen bg-cc-dark flex items-center justify-center">
        <div className="card text-center max-w-md w-full">
          <h2 className="font-display text-2xl text-cc-gold mb-4">Game Lobby</h2>
          <p className="text-cc-muted mb-6">Waiting for players to join...</p>
          {isHost && (
            <button onClick={handleStartGame} className="btn-primary w-full text-lg py-3">
              Start Game
            </button>
          )}
          {!isHost && (
            <p className="text-cc-muted text-sm">Waiting for the host to start the game.</p>
          )}
        </div>
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
              />
            ) : (
              <GameMap
                mapData={mapData}
                onTerritoryClick={handleTerritoryClick}
                width={mapCanvasSize.w}
                height={mapCanvasSize.h}
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
              onClose={() => {
                setSelectedTerritory(null);
                setAttackSource(null);
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
          lastCombatLog={combatLog}
          gameId={gameStarted && gameId ? gameId : undefined}
        />
      </div>

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
        />
      )}

    </div>
  );
}
