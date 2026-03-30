import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGameStore, CombatResult } from '../store/gameStore';
import { useAuthStore } from '../store/authStore';
import { connectSocket, getSocket, disconnectSocket } from '../services/socket';
import { api } from '../services/api';
import GameMap from '../components/game/GameMap';
import GlobeMap, { type GlobeEvent } from '../components/game/GlobeMap';
import GameHUD from '../components/game/GameHUD';
import TerritoryPanel from '../components/game/TerritoryPanel';
import ActionModal, { ActionNotification, ModalData, NotificationData, ReinforcementEntry, FortifyEntry } from '../components/game/ActionModal';
import toast from 'react-hot-toast';

interface MapData {
  map_id: string;
  name: string;
  canvas_width?: number;
  canvas_height?: number;
  territories: Array<{
    territory_id: string;
    name: string;
    polygon: number[][];
    center_point: [number, number];
    region_id: string;
  }>;
  connections: Array<{ from: string; to: string; type: 'land' | 'sea' }>;
  regions: Array<{ region_id: string; name: string; bonus: number }>;
}

export default function GamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const {
    gameState, setGameState, setSelectedTerritory, setLastCombatResult,
    selectedTerritory, attackSource, setAttackSource, draftUnitsRemaining,
    setDraftUnitsRemaining, clearGame,
  } = useGameStore();

  const [mapData, setMapData] = useState<MapData | null>(null);
  const [combatLog, setCombatLog] = useState<string[]>([]);
  const [gameStarted, setGameStarted] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [mapView, setMapView] = useState<'2d' | 'globe'>('globe');
  const fortifySourceRef = useRef<string | null>(null);
  const mapDataRef = useRef<MapData | null>(null);

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

    socket.emit('game:join', { gameId });

    socket.on('game:joined', ({ playerIndex }: { playerIndex: number }) => {
      setIsHost(playerIndex === 0);
    });

    socket.on('game:state', (state) => {
      setGameState(state);
      const myId = user?.user_id;

      // Read authoritative draft count from server; fallback to local calc for older saves
      let draftCount = state.draft_units_remaining;
      if ((draftCount === undefined || draftCount === null) && state.phase === 'draft') {
        const me = state.players.find((p: { player_id: string }) => p.player_id === myId);
        if (me && state.players[state.current_player_index]?.player_id === myId) {
          draftCount = Math.max(3, Math.floor(me.territory_count / 3));
        }
      }
      setDraftUnitsRemaining(draftCount ?? 0);

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

      const isMyAttack = attackerOwner === user?.user_id;
      const isMyDefense = defenderOwner === user?.user_id;

      if (isMyAttack) {
        setModalQueue(q => [...q, { type: 'combat' as const, result: enriched, perspective: 'attacker' as const }]);
        ownTurnCombatsRef.current.push(enriched);
      } else if (isMyDefense) {
        setModalQueue(q => [...q, { type: 'combat' as const, result: enriched, perspective: 'defender' as const }]);
        otherTurnCombatsRef.current.push(enriched);
      } else {
        otherTurnCombatsRef.current.push(enriched);
      }

      // Always append to combat log sidebar
      const { attacker_losses, defender_losses, territory_captured } = data.result;
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

    socket.on('game:over', ({ winner_id }: { winner_id: string }) => {
      const winner = gameState?.players.find((p) => p.player_id === winner_id);
      if (winner_id === user?.user_id) {
        toast.success('🏆 Victory! You have conquered the world!', { duration: 6000 });
      } else {
        toast.error(`Defeat. ${winner?.username ?? 'Unknown'} has won.`, { duration: 6000 });
      }
      setTimeout(() => navigate('/lobby'), 5000);
    });

    socket.on('error', ({ message }: { message: string }) => {
      toast.error(message);
    });

    return () => {
      socket.off('game:joined');
      socket.off('game:state');
      socket.off('game:started');
      socket.off('game:combat_result');
      socket.off('game:cards_redeemed');
      socket.off('game:over');
      socket.off('error');
      clearGame();
    };
  }, [gameId]);

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
      const units = Math.max(1, Math.floor((fromState?.unit_count ?? 2) / 2));
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
      setSelectedTerritory(null);
      return;
    }

    setSelectedTerritory(territoryId);
  }, [gameState, attackSource, user, gameId, showNotification]);

  const handleAdvancePhase = () => {
    getSocket().emit('game:advance_phase', { gameId });
    setSelectedTerritory(null);
    setAttackSource(null);
  };

  const handleAttack = (fromId: string, toId: string) => {
    getSocket().emit('game:attack', { gameId, fromId, toId });
    setAttackSource(null);
    setSelectedTerritory(null);
  };

  const handleDraft = (territoryId: string, units: number) => {
    getSocket().emit('game:draft', { gameId, territoryId, units });
    const curr = useGameStore.getState().draftUnitsRemaining;
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

  return (
    <div className="h-screen bg-cc-dark flex flex-col overflow-hidden">
      {/* Top Bar */}
      <div className="h-10 bg-cc-surface border-b border-cc-border flex items-center px-4 gap-4 shrink-0">
        <span className="font-display text-cc-gold text-sm tracking-widest">CHRONOCONQUEST</span>
        <span className="text-cc-muted text-xs">·</span>
        <span className="text-cc-muted text-xs capitalize">{gameState.era} Era</span>
        <span className="text-cc-muted text-xs">·</span>
        <span className="text-cc-muted text-xs">Turn {gameState.turn_number}</span>
        <div className="flex-1" />
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setMapView('globe')}
            className={`px-2 py-1 text-xs rounded ${mapView === 'globe' ? 'bg-cc-gold/20 text-cc-gold' : 'text-cc-muted hover:text-cc-text'}`}
          >
            Globe
          </button>
          <button
            type="button"
            onClick={() => setMapView('2d')}
            className={`px-2 py-1 text-xs rounded ${mapView === '2d' ? 'bg-cc-gold/20 text-cc-gold' : 'text-cc-muted hover:text-cc-text'}`}
          >
            2D Map
          </button>
        </div>
      </div>

      {/* Main Game Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Map Canvas */}
        <div className="flex-1 relative overflow-hidden">
          {mapData ? (
            mapView === 'globe' ? (
              <GlobeMap
                mapData={mapData}
                onTerritoryClick={handleTerritoryClick}
                width={window.innerWidth - 288}
                height={window.innerHeight - 40}
                events={globeEvents}
                onEventDone={handleGlobeEventDone}
              />
            ) : (
              <GameMap
                mapData={mapData}
                onTerritoryClick={handleTerritoryClick}
                width={window.innerWidth - 288}
                height={window.innerHeight - 40}
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
              onClose={() => { setSelectedTerritory(null); setAttackSource(null); }}
            />
          )}

          {/* Game Over Overlay */}
          {gameState.phase === 'game_over' && (
            <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
              <div className="card text-center">
                <h2 className="font-display text-4xl text-cc-gold mb-4">
                  {gameState.winner_id === user?.user_id ? '🏆 Victory!' : 'Defeat'}
                </h2>
                <p className="text-cc-muted mb-6">Returning to lobby...</p>
              </div>
            </div>
          )}
        </div>

        {/* HUD Sidebar */}
        <GameHUD
          onAdvancePhase={handleAdvancePhase}
          onRedeemCards={handleRedeemCards}
          lastCombatLog={combatLog}
        />
      </div>

      {/* Action Modal (blocking — combat results & turn summaries) */}
      <ActionModal data={modalQueue[0] ?? null} onDismiss={dismissModal} />

      {/* Action Notification (auto-dismiss — reinforcements, fortify, phase changes) */}
      <ActionNotification key={notifState?.key} data={notifState?.data ?? null} />
    </div>
  );
}
