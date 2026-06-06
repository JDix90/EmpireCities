import { useEffect, useState, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, Users } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useGameStore } from '../store/gameStore';
import { connectSocket, getSocket } from '../services/socket';
import { api } from '../services/api';
import GameMap from '../components/game/GameMap';
import { useMapVisualEvents } from '../hooks/useMapVisualEvents';
import type { MapVisualEvent } from '../utils/mapVisualEvents';
import GameChat from '../components/game/GameChat';
import { AiBadge } from '../components/ui/AiBadge';
import AtomBombAnimation, { type StrikeAnimationVariant } from '../components/game/AtomBombAnimation';
import {
  getStrikeToastMessage,
  type StrikeAnimationEvent,
} from '../utils/strikeAnimationMessages';
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
import type { EventCard } from '../components/game/EventCardModal';
import toast from 'react-hot-toast';
import type { GameState } from '../store/gameStore';
import { prefersReducedMotion } from '../utils/device';
import {
  computeContestedBorders,
  phaseTintClass,
} from '../utils/mapAmbientEffects';

interface MapData {
  canvas_width?: number;
  canvas_height?: number;
  territories: Array<{
    territory_id: string;
    name: string;
    polygon: number[][];
    center_point: [number, number];
    region_id: string;
  }>;
  connections: Array<{ from: string; to: string; type: 'land' | 'sea' | 'orbit' }>;
}

export default function SpectatorPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const accessToken = useAuthStore((s) => s.accessToken);
  const { gameState, setGameState, clearGame } = useGameStore();
  const [mapData, setMapData] = useState<MapData | null>(null);
  const [spectatorCount, setSpectatorCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [emotes, setEmotes] = useState<Array<{ id: number; emote: string; username: string }>>([]);
  const [strikeAnim, setStrikeAnim] = useState<{
    abilityId: StrikeAnimationVariant;
    targetName: string;
    unitReduction?: number;
    key: number;
  } | null>(null);
  const [mapStrikeFlash, setMapStrikeFlash] = useState<MapStrikeFlashProps | null>(null);
  const mapStrikeFlashKeyRef = useRef(0);
  const mapDataRef = useRef<MapData | null>(null);
  const cleanedUp = useRef(false);
  const {
    mapVisualEvents,
    handleMapVisualEvent,
    pushMapVisualLocal,
    onMapVisualDone,
  } = useMapVisualEvents();
  const eventCardVisualSeenRef = useRef(new Set<string>());
  const mapVisualEventsRef = useRef(mapVisualEvents);
  mapVisualEventsRef.current = mapVisualEvents;

  useEffect(() => {
    if (!gameId || !accessToken) return;

    connectSocket();
    const socket = getSocket();

    socket.emit('game:spectate_join', { gameId });

    socket.on('game:state', (state: GameState) => {
      setGameState(state);
      setConnected(true);
      // Load map data from the state's map_id
      if (state.map_id && !mapData) {
        api.get(`/maps/${state.map_id}`).then((res) => {
          mapDataRef.current = res.data.map;
          setMapData(res.data.map);
        }).catch(() => {});
      }
    });

    socket.on('game:spectate_joined', () => {
      setConnected(true);
    });

    socket.on('game:spectator_count', ({ count }: { count: number }) => {
      setSpectatorCount(count);
    });

    socket.on('game:over', () => {
      navigate(`/replay/${gameId}`, { replace: true });
    });

    socket.on('game:spectator_emote', ({ emote, username }: { emote: string; username: string }) => {
      const id = Date.now() + Math.random();
      setEmotes((prev) => [...prev, { id, emote, username }]);
      window.setTimeout(() => {
        setEmotes((prev) => prev.filter((item) => item.id !== id));
      }, 1800);
    });

    const handleStrikeAnimationEvent = (event: StrikeAnimationEvent) => {
      if (!isMapStrikeAbility(event.abilityId)) return;

      const abilityId = event.abilityId as MapStrikeAbilityId;
      const tName = mapDataRef.current?.territories.find((t) => t.territory_id === event.territoryId)?.name
        ?? event.territoryId;

      if (shouldShowFullScreenStrike({
        abilityId,
        prefersReducedMotion: prefersReducedMotion(),
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

      toast(getStrikeToastMessage(event, tName, {}), {
        duration: 6000,
        style: getStrikeToastStyle(abilityId),
      });
    };

    socket.on('game:strike_animation', handleStrikeAnimationEvent);

    socket.on('game:map_visual', (payload: MapVisualEvent) => {
      markEventCardVisualSeen(payload, eventCardVisualSeenRef.current);
      handleMapVisualEvent(payload);
    });

    socket.on('game:event_card', (card: EventCard) => {
      scheduleEventCardMapVisualBackup(
        card,
        (cardId) => mapVisualEventsRef.current.some((e) => e.kind === 'event' && e.cardId === cardId),
        pushMapVisualLocal,
        eventCardVisualSeenRef.current,
      );
    });

    socket.on('game:naval_combat_result', ({ fromId, toId, result }: {
      fromId: string; toId: string;
      result: { attacker_won: boolean; attacker_losses: number; defender_losses: number };
    }) => {
      const fromName = mapDataRef.current?.territories.find((t) => t.territory_id === fromId)?.name ?? fromId;
      const toName = mapDataRef.current?.territories.find((t) => t.territory_id === toId)?.name ?? toId;
      const outcome = result.attacker_won
        ? `Fleet victory — ${fromName} → ${toName}`
        : `Fleet repelled at ${toName}`;
      toast(outcome, { icon: '⚓', duration: 3000 });
    });

    socket.on('game:influence_result', ({ success, targetId, variant }: {
      success: boolean;
      targetId?: string;
      variant?: 'seize' | 'garibaldi' | 'detente';
    }) => {
      if (!success || !targetId) return;
      const targetName = mapDataRef.current?.territories.find((t) => t.territory_id === targetId)?.name ?? targetId;
      const label = variant === 'garibaldi' ? "Garibaldi's Redshirts"
        : variant === 'detente' ? 'Détente'
          : 'Influence';
      toast(`📡 ${label} — ${targetName} seized`, { duration: 3000 });
    });

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

    socket.on('error', ({ message }: { message: string }) => {
      setError(message);
    });

    return () => {
      if (!cleanedUp.current) {
        cleanedUp.current = true;
        socket.emit('game:spectate_leave', { gameId });
        socket.off('game:state');
        socket.off('game:spectate_joined');
        socket.off('game:spectator_count');
        socket.off('game:over');
        socket.off('game:spectator_emote');
        socket.off('game:strike_animation');
        socket.off('game:atom_bomb');
        socket.off('game:map_visual');
        socket.off('game:event_card');
        socket.off('game:naval_combat_result');
        socket.off('game:influence_result');
        socket.off('error');
        clearGame();
      }
    };
  }, [gameId, accessToken]);

  if (error) {
    return (
      <div className="min-h-screen bg-bf-dark flex flex-col items-center justify-center gap-4">
        <p className="text-red-400 text-lg">{error}</p>
        <Link to="/live-games" className="text-bf-gold hover:text-white transition-colors text-sm">
          ← Browse Live Games
        </Link>
      </div>
    );
  }

  if (!connected || !gameState || !mapData) {
    return (
      <div className="min-h-screen bg-bf-dark flex flex-col items-center justify-center gap-4">
        <div className="animate-pulse text-bf-muted">Connecting to game…</div>
      </div>
    );
  }

  const currentPlayer = gameState.players[gameState.current_player_index];
  const spectatorAmbientEnabled = gameState.phase !== 'game_over' && !prefersReducedMotion();
  const contestedBorders = computeContestedBorders(
    gameState.territories,
    mapData.connections,
    currentPlayer?.player_id,
    gameState.phase,
  );
  const phaseTint = phaseTintClass(gameState.phase, spectatorAmbientEnabled);

  return (
    <div className="min-h-screen bg-bf-dark flex flex-col">
      {/* Spectator top bar */}
      <div className="border-b border-bf-border px-4 py-3 flex items-center justify-between bg-bf-surface/50">
        <Link to="/live-games" className="flex items-center gap-2 text-bf-muted hover:text-bf-text text-sm transition-colors">
          <ArrowLeft className="w-4 h-4" /> Leave
        </Link>

        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium animate-pulse">
            <Eye className="w-3 h-3" /> SPECTATING
          </span>

          {currentPlayer && (
            <span className="text-sm text-bf-text flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: currentPlayer.color }} />
              {currentPlayer.username}'s turn
            </span>
          )}

          <span className="text-xs text-bf-muted">Turn {gameState.turn_number}</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-bf-muted flex items-center gap-1">
            <Eye className="w-3 h-3" /> {spectatorCount} watching
          </span>
          <span className="text-xs text-bf-muted flex items-center gap-1">
            <Users className="w-3 h-3" /> {gameState.players.filter(p => !p.is_eliminated).length} alive
          </span>
        </div>
      </div>

      {/* Player bar */}
      <div className="border-b border-bf-border px-4 py-2 flex flex-wrap gap-2 bg-bf-dark/50">
        {gameState.players.map((p) => (
          <span
            key={p.player_id}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
              p.is_eliminated ? 'opacity-30 line-through' : ''
            } ${p.player_index === gameState.current_player_index ? 'bg-white/10 border border-white/20' : ''}`}
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-bf-text">{p.username}</span>
            <span className="text-bf-muted">{p.territory_count}T</span>
            {p.is_ai && <AiBadge difficulty={p.ai_difficulty} size="xs" showLabel={false} />}
          </span>
        ))}
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        <div className={`flex-1 relative min-h-[50vh]${phaseTint ? ` ${phaseTint}` : ''}`}>
          <GameMap
            mapData={mapData}
            onTerritoryClick={() => {}}
            width={window.innerWidth}
            height={window.innerHeight - 130}
            strikeFlash={mapStrikeFlash}
            mapVisualEvents={mapVisualEvents}
            onMapVisualDone={onMapVisualDone}
            ambientEnabled={spectatorAmbientEnabled}
            turnHolderPlayerId={currentPlayer?.player_id ?? null}
            turnHolderColor={currentPlayer?.color}
            contestedBorders={contestedBorders}
          />

          {emotes.length > 0 && (
            <div className="pointer-events-none absolute inset-x-0 top-6 flex justify-center">
              <div className="space-y-2">
                {emotes.map((item) => (
                  <div key={item.id} className="animate-bounce rounded-full bg-black/55 px-3 py-1 text-sm text-white shadow-lg backdrop-blur-sm">
                    <span className="mr-2">{item.emote}</span>
                    <span className="text-white/70">{item.username}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <aside className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l border-bf-border bg-bf-surface/70 p-4 flex flex-col gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-bf-gold mb-2">Spectator Chat</p>
            <GameChat gameId={gameId!} embedded spectatorMode />
          </div>
          <div>
            <p className="text-xs uppercase tracking-widest text-bf-gold mb-2">Reactions</p>
            <div className="grid grid-cols-4 gap-2">
              {['👏', '⚔️', '💀', '🏆'].map((emote) => (
                <button
                  key={emote}
                  type="button"
                  onClick={() => getSocket().emit('game:spectator_emote', { gameId: gameId!, emote })}
                  className="rounded-lg border border-bf-border bg-bf-dark/60 py-2 text-lg hover:border-bf-gold/30 transition-colors"
                >
                  {emote}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>

      {strikeAnim && (
        <AtomBombAnimation
          key={strikeAnim.key}
          abilityId={strikeAnim.abilityId}
          targetName={strikeAnim.targetName}
          unitReduction={strikeAnim.unitReduction}
          onDone={() => setStrikeAnim(null)}
        />
      )}
    </div>
  );
}
