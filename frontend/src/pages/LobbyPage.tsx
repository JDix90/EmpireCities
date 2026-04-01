import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import { Plus, LogOut, User, Map, Globe, Play, Clock, Trash2 } from 'lucide-react';
import axios from 'axios';

const ERAS = [
  { id: 'ancient',   label: 'Ancient World'   },
  { id: 'medieval',  label: 'Medieval Era'    },
  { id: 'discovery', label: 'Age of Discovery'},
  { id: 'ww2',       label: 'World War II'    },
  { id: 'coldwar',   label: 'Cold War'        },
  { id: 'modern',    label: 'The Modern Day'  },
];

const ERA_MAP_IDS: Record<string, string> = {
  ancient:   'era_ancient',
  medieval:  'era_medieval',
  discovery: 'era_discovery',
  ww2:       'era_ww2',
  coldwar:   'era_coldwar',
  modern:    'era_modern',
};

interface PublicGame {
  game_id: string;
  era_id: string;
  map_id: string;
  status: string;
  player_count: number;
  created_at: string;
}

interface ActiveGame {
  game_id: string;
  era_id: string;
  game_type: string;
  created_at: string;
  started_at: string | null;
  turn_number: number | null;
  saved_at: string | null;
}

const GAME_TYPE_LABELS: Record<string, string> = {
  solo: 'Solo',
  multiplayer: 'Multiplayer',
  hybrid: 'Hybrid',
};

const ERA_LABELS: Record<string, string> = {
  ancient: 'Ancient World',
  medieval: 'Medieval Era',
  discovery: 'Age of Discovery',
  ww2: 'World War II',
  coldwar: 'Cold War',
  modern: 'Modern Day',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function LobbyPage() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [publicGames, setPublicGames] = useState<PublicGame[]>([]);
  const [activeGames, setActiveGames] = useState<ActiveGame[]>([]);
  const [creating, setCreating] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState<string | null>(null);

  const presetEra = searchParams.get('era');
  const presetMap = searchParams.get('map');
  const eraFromMap = presetMap ? Object.entries(ERA_MAP_IDS).find(([, v]) => v === presetMap)?.[0] : undefined;
  const resolvedEra = presetEra ?? eraFromMap ?? null;
  const validEra = ERAS.some((e) => e.id === resolvedEra) ? resolvedEra! : null;
  const [showCreate, setShowCreate] = useState(!!validEra || !!presetMap);

  // Create game form state
  const [selectedEra, setSelectedEra] = useState(validEra ?? 'ww2');
  const [aiCount, setAiCount] = useState(3);
  const [aiDifficulty, setAiDifficulty] = useState('medium');
  const [fogOfWar, setFogOfWar] = useState(false);
  const [turnTimer, setTurnTimer] = useState(300);

  useEffect(() => {
    if (searchParams.has('era') || searchParams.has('map')) {
      setSearchParams({}, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchPublicGames();
    fetchActiveGames();
    const interval = setInterval(fetchPublicGames, 10000);
    return () => clearInterval(interval);
  }, []);

  const fetchPublicGames = async () => {
    try {
      const res = await api.get('/games/public');
      setPublicGames(res.data);
    } catch {
      // Silently fail
    }
  };

  const fetchActiveGames = async () => {
    try {
      const res = await api.get('/users/me/active-games');
      setActiveGames(res.data);
    } catch {
      // Silently fail
    }
  };

  const handleAbandonGame = async (gameId: string) => {
    try {
      await api.delete(`/games/${gameId}/abandon`);
      setActiveGames((prev) => prev.filter((g) => g.game_id !== gameId));
      setConfirmAbandon(null);
      toast.success('Game removed');
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        toast.error(err.response?.data?.error || 'Failed to abandon game');
      }
      setConfirmAbandon(null);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const handleCreateGame = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await api.post('/games', {
        era_id: selectedEra,
        map_id: ERA_MAP_IDS[selectedEra],
        max_players: 8,
        ai_count: aiCount,
        ai_difficulty: aiDifficulty,
        settings: {
          fog_of_war: fogOfWar,
          victory_type: 'domination',
          turn_timer_seconds: turnTimer,
          initial_unit_count: 3,
          card_set_escalating: true,
          diplomacy_enabled: true,
        },
      });
      toast.success('Game created!');
      navigate(`/game/${res.data.game_id}`);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        toast.error(err.response?.data?.error || 'Failed to create game');
      }
    } finally {
      setCreating(false);
    }
  };

  const handleJoinGame = async (gameId: string) => {
    try {
      await api.post(`/games/${gameId}/join`);
      navigate(`/game/${gameId}`);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        toast.error(err.response?.data?.error || 'Failed to join game');
      }
    }
  };

  return (
    <div className="min-h-screen bg-cc-dark">
      {/* Top Bar */}
      <nav className="border-b border-cc-border px-6 py-4 flex items-center justify-between pt-safe px-safe">
        <Link to="/lobby" className="font-display text-xl text-cc-gold tracking-widest hover:text-white transition-colors">CHRONOCONQUEST</Link>
        <div className="flex items-center gap-4">
          <Link to="/maps" className="flex items-center gap-1.5 text-cc-muted hover:text-cc-text text-sm transition-colors">
            <Map className="w-4 h-4" /> Map Hub
          </Link>
          <Link to="/profile" className="flex items-center gap-1.5 text-cc-muted hover:text-cc-text text-sm transition-colors">
            <User className="w-4 h-4" /> {user?.username}
          </Link>
          <button onClick={handleLogout} className="flex items-center gap-1.5 text-cc-muted hover:text-red-400 text-sm transition-colors">
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Welcome Banner */}
        <div className="card mb-8 flex items-center justify-between">
          <div>
            <h2 className="font-display text-2xl text-cc-gold">Welcome, {user?.username}</h2>
            <p className="text-cc-muted text-sm mt-1">Level {user?.level} · MMR {user?.mmr} · {user?.xp} XP</p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setShowCreate(!showCreate)} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" /> New Game
            </button>
            <Link to="/editor" className="btn-secondary flex items-center gap-2">
              <Map className="w-4 h-4" /> Map Editor
            </Link>
          </div>
        </div>

        {/* Create Game Form */}
        {showCreate && (
          <div className="card mb-8 animate-fade-in">
            <h3 className="font-display text-xl text-cc-gold mb-6">Configure New Game</h3>
            <form onSubmit={handleCreateGame} className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="label">Historical Era</label>
                <select className="input" value={selectedEra} onChange={(e) => setSelectedEra(e.target.value)}>
                  {ERAS.map((era) => (
                    <option key={era.id} value={era.id}>{era.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">AI Opponents</label>
                <select className="input" value={aiCount} onChange={(e) => setAiCount(Number(e.target.value))}>
                  {[0,1,2,3,4,5,6,7].map((n) => (
                    <option key={n} value={n}>{n} AI Bot{n !== 1 ? 's' : ''}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">AI Difficulty</label>
                <select className="input" value={aiDifficulty} onChange={(e) => setAiDifficulty(e.target.value)}>
                  <option value="easy">Easy</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard</option>
                  <option value="expert">Expert</option>
                </select>
              </div>
              <div>
                <label className="label">Turn Timer</label>
                <select className="input" value={turnTimer} onChange={(e) => setTurnTimer(Number(e.target.value))}>
                  <option value={0}>No Timer</option>
                  <option value={180}>3 Minutes</option>
                  <option value={300}>5 Minutes</option>
                  <option value={600}>10 Minutes</option>
                  <option value={86400}>24 Hours (Async)</option>
                </select>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="fog"
                  checked={fogOfWar}
                  onChange={(e) => setFogOfWar(e.target.checked)}
                  className="w-4 h-4 accent-cc-gold"
                />
                <label htmlFor="fog" className="text-cc-text text-sm cursor-pointer">Enable Fog of War</label>
              </div>
              <div className="flex gap-3 items-end">
                <button type="submit" className="btn-primary flex-1" disabled={creating}>
                  {creating ? 'Creating...' : 'Create & Enter Lobby'}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
              </div>
            </form>
          </div>
        )}

        {/* Active Games */}
        {activeGames.length > 0 && (
          <div className="card mb-8 animate-fade-in">
            <h3 className="font-display text-xl text-cc-gold mb-6 flex items-center gap-2">
              <Play className="w-5 h-5" /> Your Active Games
            </h3>
            <div className="space-y-3">
              {activeGames.map((game) => (
                <div
                  key={game.game_id}
                  className="flex items-center justify-between p-4 bg-cc-dark rounded-lg border border-cc-border hover:border-cc-gold transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div>
                      <span className="font-medium text-cc-text">{ERA_LABELS[game.era_id] ?? game.era_id}</span>
                      <span className="ml-3 text-xs px-2 py-0.5 rounded-full bg-cc-gold/15 text-cc-gold border border-cc-gold/30">
                        {GAME_TYPE_LABELS[game.game_type] ?? game.game_type}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-cc-muted text-sm">
                      {game.turn_number != null && <span>Turn {game.turn_number}</span>}
                      {game.saved_at && (
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" /> {timeAgo(game.saved_at)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {confirmAbandon === game.game_id ? (
                      <>
                        <span className="text-xs text-cc-muted mr-1">Delete?</span>
                        <button
                          onClick={() => handleAbandonGame(game.game_id)}
                          className="text-xs py-1.5 px-3 rounded border border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setConfirmAbandon(null)}
                          className="text-xs py-1.5 px-3 rounded border border-cc-border text-cc-muted hover:text-cc-text transition-colors"
                        >
                          No
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => setConfirmAbandon(game.game_id)}
                        className="p-1.5 rounded text-cc-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Delete game"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => navigate(`/game/${game.game_id}`)}
                      className="btn-primary text-sm py-1.5 px-4 flex items-center gap-1.5"
                    >
                      <Play className="w-3.5 h-3.5" /> Continue
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Public Games */}
        <div className="card">
          <h3 className="font-display text-xl text-cc-gold mb-6 flex items-center gap-2">
            <Globe className="w-5 h-5" /> Open Games
          </h3>
          {publicGames.length === 0 ? (
            <p className="text-cc-muted text-center py-8">No open games. Create one to get started!</p>
          ) : (
            <div className="space-y-3">
              {publicGames.map((game) => (
                <div key={game.game_id} className="flex items-center justify-between p-4 bg-cc-dark rounded-lg border border-cc-border hover:border-cc-gold transition-colors">
                  <div>
                    <span className="font-medium text-cc-text capitalize">{game.era_id.replace('ww2', 'World War II').replace('coldwar', 'Cold War').replace('modern', 'Modern Day')}</span>
                    <span className="text-cc-muted text-sm ml-3">{game.player_count} / 8 players</span>
                  </div>
                  <button onClick={() => handleJoinGame(game.game_id)} className="btn-primary text-sm py-1.5 px-4">
                    Join
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
