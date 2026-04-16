import { useEffect, useState, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, Users } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useGameStore } from '../store/gameStore';
import { connectSocket, getSocket } from '../services/socket';
import { api } from '../services/api';
import GameMap from '../components/game/GameMap';
import GameChat from '../components/game/GameChat';
import type { GameState } from '../store/gameStore';

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
  connections: Array<{ from: string; to: string; type: 'land' | 'sea' }>;
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
  const cleanedUp = useRef(false);

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
        socket.off('error');
        clearGame();
      }
    };
  }, [gameId, accessToken]);

  if (error) {
    return (
      <div className="min-h-screen bg-cc-dark flex flex-col items-center justify-center gap-4">
        <p className="text-red-400 text-lg">{error}</p>
        <Link to="/live-games" className="text-cc-gold hover:text-white transition-colors text-sm">
          ← Browse Live Games
        </Link>
      </div>
    );
  }

  if (!connected || !gameState || !mapData) {
    return (
      <div className="min-h-screen bg-cc-dark flex flex-col items-center justify-center gap-4">
        <div className="animate-pulse text-cc-muted">Connecting to game…</div>
      </div>
    );
  }

  const currentPlayer = gameState.players[gameState.current_player_index];

  return (
    <div className="min-h-screen bg-cc-dark flex flex-col">
      {/* Spectator top bar */}
      <div className="border-b border-cc-border px-4 py-3 flex items-center justify-between bg-cc-surface/50">
        <Link to="/live-games" className="flex items-center gap-2 text-cc-muted hover:text-cc-text text-sm transition-colors">
          <ArrowLeft className="w-4 h-4" /> Leave
        </Link>

        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium animate-pulse">
            <Eye className="w-3 h-3" /> SPECTATING
          </span>

          {currentPlayer && (
            <span className="text-sm text-cc-text flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: currentPlayer.color }} />
              {currentPlayer.username}'s turn
            </span>
          )}

          <span className="text-xs text-cc-muted">Turn {gameState.turn_number}</span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-cc-muted flex items-center gap-1">
            <Eye className="w-3 h-3" /> {spectatorCount} watching
          </span>
          <span className="text-xs text-cc-muted flex items-center gap-1">
            <Users className="w-3 h-3" /> {gameState.players.filter(p => !p.is_eliminated).length} alive
          </span>
        </div>
      </div>

      {/* Player bar */}
      <div className="border-b border-cc-border px-4 py-2 flex flex-wrap gap-2 bg-cc-dark/50">
        {gameState.players.map((p) => (
          <span
            key={p.player_id}
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
              p.is_eliminated ? 'opacity-30 line-through' : ''
            } ${p.player_index === gameState.current_player_index ? 'bg-white/10 border border-white/20' : ''}`}
          >
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-cc-text">{p.username}</span>
            <span className="text-cc-muted">{p.territory_count}T</span>
            {p.is_ai && <span className="text-cc-muted/50">(AI)</span>}
          </span>
        ))}
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        <div className="flex-1 relative min-h-[50vh]">
          <GameMap
            mapData={mapData}
            onTerritoryClick={() => {}}
            width={window.innerWidth}
            height={window.innerHeight - 130}
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

        <aside className="w-full lg:w-80 border-t lg:border-t-0 lg:border-l border-cc-border bg-cc-surface/70 p-4 flex flex-col gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-cc-gold mb-2">Spectator Chat</p>
            <GameChat gameId={gameId!} embedded spectatorMode />
          </div>
          <div>
            <p className="text-xs uppercase tracking-widest text-cc-gold mb-2">Reactions</p>
            <div className="grid grid-cols-4 gap-2">
              {['👏', '⚔️', '💀', '🏆'].map((emote) => (
                <button
                  key={emote}
                  type="button"
                  onClick={() => getSocket().emit('game:spectator_emote', { gameId: gameId!, emote })}
                  className="rounded-lg border border-cc-border bg-cc-dark/60 py-2 text-lg hover:border-cc-gold/30 transition-colors"
                >
                  {emote}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
