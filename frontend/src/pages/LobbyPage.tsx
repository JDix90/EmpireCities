import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import {
  Plus, LogOut, User, Map, Globe, Play, Clock, Trash2, Shield, Zap, Timer, GraduationCap, Bot,
  Home, FileText, PenSquare, Users, Link2,
} from 'lucide-react';
import axios from 'axios';
import { getSocketUrl } from '../config/env';
import { io as ioClient, Socket as IOSocket } from 'socket.io-client';
import { COMMUNITY_MAP_TITLES, ERA_LABELS } from '../constants/gameLobbyLabels';

const ERAS = [
  { id: 'ancient',   label: 'Ancient World'   },
  { id: 'medieval',  label: 'Medieval Era'    },
  { id: 'discovery', label: 'Age of Discovery'},
  { id: 'ww2',       label: 'World War II'    },
  { id: 'coldwar',   label: 'Cold War'        },
  { id: 'modern',    label: 'The Modern Day'  },
  { id: 'acw',       label: 'American Civil War' },
  { id: 'risorgimento', label: 'Italian Unification' },
];

const ERA_MAP_IDS: Record<string, string> = {
  ancient:   'era_ancient',
  medieval:  'era_medieval',
  discovery: 'era_discovery',
  ww2:       'era_ww2',
  coldwar:   'era_coldwar',
  modern:    'era_modern',
  acw:       'era_acw',
  risorgimento: 'era_risorgimento',
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
  const { user, logout, accessToken } = useAuthStore();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [publicGames, setPublicGames] = useState<PublicGame[]>([]);
  const [activeGames, setActiveGames] = useState<ActiveGame[]>([]);
  const [creating, setCreating] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState<string | null>(null);

  const presetEra = searchParams.get('era');
  const presetMap = searchParams.get('map');
  const eraFromMap = presetMap ? Object.entries(ERA_MAP_IDS).find(([, v]) => v === presetMap)?.[0] : undefined;
  const isCommunityMap = !!(presetMap && !Object.values(ERA_MAP_IDS).includes(presetMap));
  const resolvedEra = isCommunityMap ? null : (presetEra ?? eraFromMap ?? null);
  const validEra = resolvedEra && ERAS.some((e) => e.id === resolvedEra) ? resolvedEra : null;
  const [showCreate, setShowCreate] = useState(!!validEra || !!presetMap);
  const [lobbyTab, setLobbyTab] = useState<'casual' | 'ranked'>('casual');

  // Ranked matchmaking state
  const [rankedQueued, setRankedQueued] = useState(false);
  const [rankedBucket, setRankedBucket] = useState('');
  const [rankedEra, setRankedEra] = useState('ancient');
  const [queueElapsed, setQueueElapsed] = useState(0);

  // Create game form state
  const [selectedEra, setSelectedEra] = useState(validEra ?? 'ww2');
  const [selectedCommunityMapId, setSelectedCommunityMapId] = useState<string | null>(
    isCommunityMap && presetMap ? presetMap : null,
  );
  const [aiCount, setAiCount] = useState(3);
  const [aiDifficulty, setAiDifficulty] = useState('medium');
  const [fogOfWar, setFogOfWar] = useState(false);
  const [turnTimer, setTurnTimer] = useState(300);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joiningByCode, setJoiningByCode] = useState(false);
  const joinFromUrlHandled = useRef(false);

  const searchParamBootstrapDone = useRef(false);
  useEffect(() => {
    if (searchParamBootstrapDone.current) return;
    searchParamBootstrapDone.current = true;
    const era = searchParams.get('era');
    const map = searchParams.get('map');
    if (map) {
      if (Object.values(ERA_MAP_IDS).includes(map)) {
        const fromMap = Object.entries(ERA_MAP_IDS).find(([, v]) => v === map)?.[0];
        if (fromMap) {
          setSelectedEra(fromMap);
          setSelectedCommunityMapId(null);
        }
      } else {
        setSelectedCommunityMapId(map);
      }
      setShowCreate(true);
    } else if (era && ERAS.some((e) => e.id === era)) {
      setSelectedEra(era);
      setSelectedCommunityMapId(null);
      setShowCreate(true);
    }
    if (searchParams.has('era') || searchParams.has('map')) {
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (searchParams.get('quickstart') !== 'true') return;
    setShowCreate(true);
    setAiCount(3);
    setSelectedEra('ancient');
    setSelectedCommunityMapId(null);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('quickstart');
      return next;
    }, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    fetchPublicGames();
    fetchActiveGames();
    const interval = setInterval(fetchPublicGames, 10000);
    return () => clearInterval(interval);
  }, []);

  // Ranked matchmaking socket + queue timer
  useEffect(() => {
    if (lobbyTab !== 'ranked') return;
    const token = accessToken ?? useAuthStore.getState().accessToken;
    if (!token) return;

    const socketUrl = getSocketUrl();
    const sock: IOSocket = socketUrl
      ? ioClient(socketUrl, { auth: { token }, transports: ['websocket'] })
      : ioClient({ auth: { token }, transports: ['websocket'] });

    sock.on('matchmaking:found', ({ game_id }: { game_id: string }) => {
      setRankedQueued(false);
      toast.success('Match found!');
      navigate(`/game/${game_id}`);
    });

    return () => { sock.disconnect(); };
  }, [lobbyTab, accessToken, navigate]);

  useEffect(() => {
    if (!rankedQueued) { setQueueElapsed(0); return; }
    const t = setInterval(() => setQueueElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [rankedQueued]);

  const joinRankedQueue = async (bucket: string) => {
    try {
      await api.post('/matchmaking/join', { era_id: rankedEra, bucket });
      setRankedQueued(true);
      setRankedBucket(bucket);
      setQueueElapsed(0);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) toast.error(err.response?.data?.error || 'Failed to join queue');
    }
  };

  const leaveRankedQueue = async () => {
    try {
      await api.delete('/matchmaking/leave');
    } finally {
      setRankedQueued(false);
    }
  };

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
      const mapId = selectedCommunityMapId ?? ERA_MAP_IDS[selectedEra];
      const eraId = selectedCommunityMapId ? 'custom' : selectedEra;
      const res = await api.post('/games', {
        era_id: eraId,
        map_id: mapId,
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

  const handleJoinByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = joinCodeInput.trim();
    if (!raw) return;
    setJoiningByCode(true);
    try {
      const { data } = await api.get<{ game_id: string; status: string }>('/games/lookup', {
        params: { code: raw },
      });
      if (data.status !== 'waiting') {
        toast.error('That game is not open for joining');
        return;
      }
      await api.post(`/games/${data.game_id}/join`);
      toast.success('Joined!');
      navigate(`/game/${data.game_id}`);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        toast.error(err.response?.data?.error || 'Could not join — check the code or link');
      }
    } finally {
      setJoiningByCode(false);
    }
  };

  const joinGameFromInvite = useCallback(async (gid: string, toastId?: string) => {
    try {
      await api.post(`/games/${gid}/join`);
      if (toastId) toast.dismiss(toastId);
      toast.success('Joined!');
      navigate(`/game/${gid}`);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        toast.error(err.response?.data?.error || 'Failed to join');
      }
    }
  }, [navigate]);

  useEffect(() => {
    const j = searchParams.get('join');
    if (!j || joinFromUrlHandled.current) return;
    joinFromUrlHandled.current = true;
    setJoinCodeInput(j);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('join');
        return next;
      },
      { replace: true },
    );
    void (async () => {
      try {
        const { data } = await api.get<{ game_id: string; status: string }>('/games/lookup', {
          params: { code: j },
        });
        if (data.status !== 'waiting') {
          toast.error('That game is not open for joining');
          return;
        }
        await api.post(`/games/${data.game_id}/join`);
        toast.success('Joined!');
        navigate(`/game/${data.game_id}`);
      } catch {
        toast.error('Could not join from link. Try pasting the code in Join with code.');
      }
    })();
  }, [searchParams, navigate, setSearchParams]);

  useEffect(() => {
    if (lobbyTab !== 'casual') return;
    const token = accessToken ?? useAuthStore.getState().accessToken;
    if (!token || user?.is_guest) return;

    const socketUrl = getSocketUrl();
    const sock: IOSocket = socketUrl
      ? ioClient(socketUrl, { auth: { token }, transports: ['websocket'] })
      : ioClient({ auth: { token }, transports: ['websocket'] });

    sock.on(
      'lobby:game_invite',
      (data: { game_id: string; inviter_username: string; join_code?: string | null }) => {
        toast(
          (t) => (
            <div className="flex flex-col gap-2 text-sm">
              <p>
                <span className="font-medium text-cc-text">{data.inviter_username}</span> invited you to a game
                {data.join_code ? (
                  <span className="text-cc-muted"> (code {data.join_code})</span>
                ) : null}
                .
              </p>
              <button
                type="button"
                className="btn-primary text-sm py-1.5"
                onClick={() => void joinGameFromInvite(data.game_id, t.id)}
              >
                Join game
              </button>
            </div>
          ),
          { duration: 25_000 },
        );
      },
    );

    return () => {
      sock.disconnect();
    };
  }, [lobbyTab, accessToken, user?.is_guest, joinGameFromInvite]);

  const shownInvitePollIds = useRef(new Set<string>());
  useEffect(() => {
    if (user?.is_guest) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const { data } = await api.get<
          Array<{ id: string; game_id: string; inviter_username: string }>
        >('/users/me/game-invites');
        if (cancelled) return;
        for (const inv of data) {
          if (shownInvitePollIds.current.has(inv.id)) continue;
          shownInvitePollIds.current.add(inv.id);
          toast(
            (t) => (
              <div className="flex flex-col gap-2 text-sm">
                <p>
                  <span className="font-medium text-cc-text">{inv.inviter_username}</span> invited you to a game.
                </p>
                <button
                  type="button"
                  className="btn-primary text-sm py-1.5"
                  onClick={() => void joinGameFromInvite(inv.game_id, t.id)}
                >
                  Join game
                </button>
              </div>
            ),
            { duration: 20_000 },
          );
        }
      } catch {
        /* ignore */
      }
    };
    void poll();
    const id = setInterval(poll, 25_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [user?.is_guest, joinGameFromInvite]);

  return (
    <div className="min-h-screen bg-cc-dark">
      {/* Top Bar */}
      <nav className="border-b border-cc-border px-4 sm:px-6 py-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pt-safe px-safe">
        <Link to="/lobby" className="font-display text-xl text-cc-gold tracking-widest hover:text-white transition-colors shrink-0">
          ERAS OF EMPIRE
        </Link>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 justify-end">
          <Link to="/maps" className="flex items-center gap-1.5 text-cc-muted hover:text-cc-text text-sm transition-colors">
            <Map className="w-4 h-4 shrink-0" /> Map Hub
          </Link>
          {!user?.is_guest && (
            <Link to="/editor" className="flex items-center gap-1.5 text-cc-muted hover:text-cc-text text-sm transition-colors">
              <PenSquare className="w-4 h-4 shrink-0" /> Map Editor
            </Link>
          )}
          {!user?.is_guest && (
            <Link to="/friends" className="flex items-center gap-1.5 text-cc-muted hover:text-cc-text text-sm transition-colors">
              <Users className="w-4 h-4 shrink-0" /> Friends
            </Link>
          )}
          <Link to="/profile" className="flex items-center gap-1.5 text-cc-muted hover:text-cc-text text-sm transition-colors">
            <User className="w-4 h-4 shrink-0" /> {user?.username ?? 'Profile'}
          </Link>
          <Link to="/privacy" className="flex items-center gap-1.5 text-cc-muted hover:text-cc-text text-sm transition-colors">
            <FileText className="w-4 h-4 shrink-0" /> Privacy
          </Link>
          <Link to="/" className="flex items-center gap-1.5 text-cc-muted hover:text-cc-text text-sm transition-colors">
            <Home className="w-4 h-4 shrink-0" /> Home
          </Link>
          <button type="button" onClick={handleLogout} className="flex items-center gap-1.5 text-cc-muted hover:text-red-400 text-sm transition-colors">
            <LogOut className="w-4 h-4 shrink-0" /> Logout
          </button>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Welcome Banner */}
        <div className="card mb-8 flex items-center justify-between">
          <div>
            <h2 className="font-display text-2xl text-cc-gold">Welcome, {user?.username}</h2>
            <p className="text-cc-muted text-sm mt-1">Level {user?.level} · Ranked {(user as any)?.ratings?.ranked?.display ?? user?.mmr ?? '—'} · {user?.xp} XP</p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setShowCreate(!showCreate)} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" /> New Game
            </button>
            {!user?.is_guest && (
              <Link to="/editor" className="btn-secondary flex items-center gap-2">
                <Map className="w-4 h-4" /> Map Editor
              </Link>
            )}
          </div>
        </div>

        {/* Quick-start cards for new users */}
        {user && user.xp === 0 && lobbyTab === 'casual' && (
          <div className="card mb-6 animate-fade-in border-cc-gold/20">
            <h3 className="font-display text-lg text-cc-gold mb-4 flex items-center gap-2">
              <GraduationCap className="w-5 h-5" /> Getting Started
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={async () => {
                  try {
                    const res = await api.post('/games/tutorial/start');
                    navigate(`/game/${res.data.game_id}`);
                  } catch { toast.error('Failed to start tutorial'); }
                }}
                className="p-4 rounded-lg bg-cc-dark border border-cc-gold/20 hover:border-cc-gold
                           transition-colors text-left group"
              >
                <GraduationCap className="w-6 h-6 text-cc-gold mb-2" />
                <p className="font-display text-cc-gold group-hover:text-white transition-colors">Learn the Basics</p>
                <p className="text-cc-muted text-xs mt-1">Interactive tutorial match against a scripted AI.</p>
              </button>
              <button
                onClick={() => { setShowCreate(true); setAiCount(3); setSelectedEra('ancient'); }}
                className="p-4 rounded-lg bg-cc-dark border border-cc-border hover:border-cc-gold
                           transition-colors text-left group"
              >
                <Bot className="w-6 h-6 text-cc-gold mb-2" />
                <p className="font-display text-cc-gold group-hover:text-white transition-colors">Quick Solo Match</p>
                <p className="text-cc-muted text-xs mt-1">1v3 AI in the Ancient World — a 20-min game.</p>
              </button>
            </div>
          </div>
        )}

        {/* Casual / Ranked Tab Strip */}
        <div className="flex gap-1 mb-6 p-1 bg-cc-dark rounded-lg w-fit border border-cc-border">
          {(['casual', 'ranked'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => { setLobbyTab(tab); if (tab === 'casual' && rankedQueued) leaveRankedQueue(); }}
              className={`flex items-center gap-1.5 px-5 py-2 rounded-md text-sm font-medium transition-all ${
                lobbyTab === tab
                  ? 'bg-cc-gold/15 text-cc-gold border border-cc-gold/30'
                  : 'text-cc-muted hover:text-cc-text border border-transparent'
              }`}
            >
              {tab === 'casual' ? <Globe className="w-4 h-4" /> : <Shield className="w-4 h-4" />}
              {tab === 'casual' ? 'Casual' : 'Ranked'}
            </button>
          ))}
        </div>

        {/* Ranked Matchmaking Panel */}
        {lobbyTab === 'ranked' && (
          <div className="card mb-8 animate-fade-in">
            <h3 className="font-display text-xl text-cc-gold mb-2 flex items-center gap-2">
              <Shield className="w-5 h-5" /> Ranked 1v1 Matchmaking
            </h3>
            <p className="text-cc-muted text-sm mb-6">
              1v1 domination. No AI. No fog of war. Rating changes apply.
            </p>

            <div className="mb-4">
              <label className="label">Era</label>
              <select className="input max-w-xs" value={rankedEra} onChange={(e) => setRankedEra(e.target.value)} disabled={rankedQueued}>
                {ERAS.map((era) => (
                  <option key={era.id} value={era.id}>{era.label}</option>
                ))}
              </select>
            </div>

            {rankedQueued ? (
              <div className="flex items-center gap-4 p-4 bg-cc-dark rounded-lg border border-cc-gold/20">
                <div className="animate-pulse text-cc-gold">
                  <Timer className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <p className="text-cc-text text-sm font-medium">Searching for opponent...</p>
                  <p className="text-cc-muted text-xs">{rankedBucket.replace('_', ' ')} &middot; {queueElapsed}s elapsed</p>
                </div>
                <button onClick={leaveRankedQueue} className="btn-secondary text-sm py-1.5 px-4">Cancel</button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {([
                  { bucket: 'blitz_120',    label: 'Blitz',    desc: '2 min per turn', icon: Zap },
                  { bucket: 'standard_300', label: 'Standard', desc: '5 min per turn', icon: Clock },
                  { bucket: 'long_1200',    label: 'Long',     desc: '20 min per turn', icon: Timer },
                ] as const).map(({ bucket, label, desc, icon: Icon }) => (
                  <button
                    key={bucket}
                    onClick={() => joinRankedQueue(bucket)}
                    className="p-4 rounded-lg bg-cc-dark border border-cc-border hover:border-cc-gold
                               transition-colors text-left group"
                  >
                    <Icon className="w-5 h-5 text-cc-gold mb-2" />
                    <p className="font-display text-cc-gold group-hover:text-white transition-colors">{label}</p>
                    <p className="text-cc-muted text-xs mt-1">{desc}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Create Game Form */}
        {lobbyTab === 'casual' && showCreate && (
          <div className="card mb-8 animate-fade-in">
            <h3 className="font-display text-xl text-cc-gold mb-6">Configure New Game</h3>
            <form onSubmit={handleCreateGame} className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {selectedCommunityMapId ? (
                <div className="md:col-span-2">
                  <label className="label">Map</label>
                  <p className="input bg-cc-dark/50 border-cc-border text-cc-text cursor-default">
                    {COMMUNITY_MAP_TITLES[selectedCommunityMapId] ?? selectedCommunityMapId}
                    <span className="text-cc-muted text-sm ml-2">(community)</span>
                  </p>
                </div>
              ) : (
                <div>
                  <label className="label">Historical Era</label>
                  <select
                    className="input"
                    value={selectedEra}
                    onChange={(e) => {
                      setSelectedEra(e.target.value);
                      setSelectedCommunityMapId(null);
                    }}
                  >
                    {ERAS.map((era) => (
                      <option key={era.id} value={era.id}>{era.label}</option>
                    ))}
                  </select>
                </div>
              )}
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
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => { setShowCreate(false); setSelectedCommunityMapId(null); }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Join with code / link */}
        {lobbyTab === 'casual' && (
          <div className="card mb-8 animate-fade-in">
            <h3 className="font-display text-xl text-cc-gold mb-2 flex items-center gap-2">
              <Link2 className="w-5 h-5" /> Join with code
            </h3>
            <p className="text-cc-muted text-sm mb-4">
              Paste the short join code, or the full game ID from your host. You can also use a lobby link with <code className="text-cc-gold/90">?join=</code>.
            </p>
            <form onSubmit={handleJoinByCode} className="flex flex-col sm:flex-row gap-2 max-w-xl">
              <input
                className="input flex-1 font-mono text-sm"
                placeholder="e.g. ABC123 or paste game UUID"
                value={joinCodeInput}
                onChange={(e) => setJoinCodeInput(e.target.value)}
                autoComplete="off"
              />
              <button type="submit" className="btn-primary shrink-0" disabled={joiningByCode || !joinCodeInput.trim()}>
                {joiningByCode ? 'Joining…' : 'Join game'}
              </button>
            </form>
          </div>
        )}

        {/* Active Games */}
        {lobbyTab === 'casual' && activeGames.length > 0 && (
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
        {lobbyTab === 'casual' && <div className="card">
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
                    <span className="font-medium text-cc-text">{ERA_LABELS[game.era_id] ?? game.era_id}</span>
                    <span className="text-cc-muted text-sm ml-3">{game.player_count} / 8 players</span>
                  </div>
                  <button onClick={() => handleJoinGame(game.game_id)} className="btn-primary text-sm py-1.5 px-4">
                    Join
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>}
      </div>

      <footer className="border-t border-cc-border mt-12 py-8 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
          <p className="font-display text-cc-gold/90 text-sm tracking-wide">Dashboard</p>
          <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-cc-muted justify-center sm:justify-end" aria-label="Site">
            <Link to="/lobby" className="hover:text-cc-gold transition-colors">Lobby</Link>
            <Link to="/maps" className="hover:text-cc-gold transition-colors">Map Hub</Link>
            {!user?.is_guest && (
              <Link to="/editor" className="hover:text-cc-gold transition-colors">Map Editor</Link>
            )}
            <Link to="/friends" className="hover:text-cc-gold transition-colors">Friends</Link>
            <Link to="/profile" className="hover:text-cc-gold transition-colors">Profile</Link>
            <Link to="/privacy" className="hover:text-cc-gold transition-colors">Privacy Policy</Link>
            <Link to="/" className="hover:text-cc-gold transition-colors">Marketing Home</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
