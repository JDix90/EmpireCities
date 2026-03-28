import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import { Plus, LogOut, User, Map, Trophy, Globe } from 'lucide-react';
import axios from 'axios';

const ERAS = [
  { id: 'ancient',   label: 'Ancient World'   },
  { id: 'medieval',  label: 'Medieval Era'    },
  { id: 'discovery', label: 'Age of Discovery'},
  { id: 'ww2',       label: 'World War II'    },
  { id: 'coldwar',   label: 'Cold War'        },
];

const ERA_MAP_IDS: Record<string, string> = {
  ancient:   'era_ancient',
  medieval:  'era_medieval',
  discovery: 'era_discovery',
  ww2:       'era_ww2',
  coldwar:   'era_coldwar',
};

interface PublicGame {
  game_id: string;
  era_id: string;
  map_id: string;
  status: string;
  player_count: number;
  created_at: string;
}

export default function LobbyPage() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const [publicGames, setPublicGames] = useState<PublicGame[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  // Create game form state
  const [selectedEra, setSelectedEra] = useState('ww2');
  const [aiCount, setAiCount] = useState(3);
  const [aiDifficulty, setAiDifficulty] = useState('medium');
  const [fogOfWar, setFogOfWar] = useState(false);
  const [turnTimer, setTurnTimer] = useState(300);

  useEffect(() => {
    fetchPublicGames();
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
      <nav className="border-b border-cc-border px-6 py-4 flex items-center justify-between">
        <h1 className="font-display text-xl text-cc-gold tracking-widest">CHRONOCONQUEST</h1>
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
                    <span className="font-medium text-cc-text capitalize">{game.era_id.replace('ww2', 'World War II').replace('coldwar', 'Cold War')}</span>
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
