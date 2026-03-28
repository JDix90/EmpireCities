import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/gameStore';
import { useAuthStore } from '../store/authStore';
import { connectSocket, getSocket, disconnectSocket } from '../services/socket';
import { api } from '../services/api';
import GameMap from '../components/game/GameMap';
import GlobeMap from '../components/game/GlobeMap';
import GameHUD from '../components/game/GameHUD';
import TerritoryPanel from '../components/game/TerritoryPanel';
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
      const myPlayer = state.players.find((p: { player_id: string }) => p.player_id === user?.user_id);
      if (myPlayer && state.phase === 'draft' && state.players[state.current_player_index]?.player_id === user?.user_id) {
        // Calculate reinforcements to display
        const continentBonus = 0; // Simplified — server handles actual calculation
        const base = Math.max(3, Math.floor(myPlayer.territory_count / 3));
        setDraftUnitsRemaining(base + continentBonus);
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

      setLastCombatResult({
        ...data.result,
        fromName,
        toName,
        attackerName,
        defenderName,
      });

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

    // Fortify: if we have a source selected and click an owned territory
    if (gameState.phase === 'fortify' && attackSource && tState?.owner_id === user?.user_id && attackSource !== territoryId) {
      const fromState = gameState.territories[attackSource];
      const units = Math.max(1, Math.floor((fromState?.unit_count ?? 2) / 2));
      socket.emit('game:fortify', { gameId, fromId: attackSource, toId: territoryId, units });
      setAttackSource(null);
      setSelectedTerritory(null);
      return;
    }

    setSelectedTerritory(territoryId);
  }, [gameState, attackSource, user, gameId]);

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
    setDraftUnitsRemaining(Math.max(0, curr - units));
    setSelectedTerritory(null);
  };

  const handleFortify = (fromId: string, toId: string, units: number) => {
    getSocket().emit('game:fortify', { gameId, fromId, toId, units });
    setSelectedTerritory(null);
    setAttackSource(null);
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
    </div>
  );
}
