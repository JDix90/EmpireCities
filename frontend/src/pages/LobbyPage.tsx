// Faction info for selection
interface FactionInfo {
  faction_id: string;
  name: string;
  description: string;
  lore?: string;
  flavor_quote?: string;
  passive_attack_bonus?: number;
  passive_defense_bonus?: number;
  reinforce_bonus?: number;
  home_region_ids?: string[];
}
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import {
  Plus, LogOut, User, Map, Globe, Play, Clock, Trash2, Shield, Zap, Timer, GraduationCap, Bot,
  Home, FileText, PenSquare, Users, Link2, Info, Calendar, ShoppingBag, Sword, Trophy, Eye, HelpCircle,
} from 'lucide-react';
import axios from 'axios';
import { getSocketUrl } from '../config/env';
import { io as ioClient, Socket as IOSocket } from 'socket.io-client';
import { COMMUNITY_MAP_TITLES, ERA_LABELS } from '../constants/gameLobbyLabels';
import OnboardingBanner from '../components/ui/OnboardingBanner';
import StreakBadge from '../components/ui/StreakBadge';
import SeasonBanner from '../components/ui/SeasonBanner';
import MonthlyChallenges from '../components/ui/MonthlyChallenges';
import DailyLoginCalendar from '../components/ui/DailyLoginCalendar';
import ActivityFeed from '../components/ui/ActivityFeed';
import LeaderboardWidget from '../components/lobby/LeaderboardWidget';
import MobileTabBar from '../components/ui/MobileTabBar';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import Modal from '../components/ui/Modal';

// ── Small tooltip component used in the game-creation form ─────────────────
function FeatureTooltip({ text }: { text: string }) {
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  const [show, setShow] = React.useState(false);
  const [mobileLayout, setMobileLayout] = React.useState(false);
  const [popoverStyle, setPopoverStyle] = React.useState<React.CSSProperties>({});

  const updatePosition = React.useCallback(() => {
    if (typeof window === 'undefined' || !buttonRef.current) return;

    const rect = buttonRef.current.getBoundingClientRect();
    const isMobileViewport = window.innerWidth < 640 || window.matchMedia('(hover: none), (pointer: coarse)').matches;
    setMobileLayout(isMobileViewport);

    if (isMobileViewport) {
      setPopoverStyle({
        left: '1rem',
        right: '1rem',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)',
        width: 'auto',
        maxWidth: 'min(26rem, calc(100vw - 2rem))',
      });
      return;
    }

    const width = Math.min(320, window.innerWidth - 32);
    const preferredLeft = rect.right + 10;
    const fallbackLeft = rect.left - width - 10;
    const left = preferredLeft + width <= window.innerWidth - 16
      ? preferredLeft
      : Math.max(16, Math.min(fallbackLeft, window.innerWidth - width - 16));

    const top = Math.max(16, Math.min(rect.top + rect.height / 2, window.innerHeight - 16));

    setPopoverStyle({
      left,
      top,
      width,
      transform: 'translateY(-50%)',
    });
  }, []);

  React.useEffect(() => {
    if (!show) return;

    updatePosition();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShow(false);
    };

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setShow(false);
    };

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [show, updatePosition]);

  const tooltipNode = show && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={popoverRef}
          className={mobileLayout
            ? 'fixed z-[80] rounded-xl bg-cc-dark border border-cc-border px-4 py-3 text-xs text-cc-text leading-relaxed shadow-2xl'
            : 'fixed z-[80] rounded-lg bg-cc-dark border border-cc-border px-3 py-2 text-xs text-cc-text leading-relaxed shadow-xl pointer-events-none'}
          style={popoverStyle}
          role="tooltip"
        >
          {text}
        </div>,
        document.body,
      )
    : null;

  return (
    <>
    <span className="inline-flex items-baseline align-baseline gap-x-1.5" style={{ verticalAlign: 'baseline' }}>
      <button
        ref={buttonRef}
        type="button"
        onMouseEnter={() => {
          if (typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches) {
            setShow(true);
          }
        }}
        onMouseLeave={() => {
          if (typeof window !== 'undefined' && window.matchMedia('(hover: hover)').matches) {
            setShow(false);
          }
        }}
        onFocus={() => setShow(true)}
        onBlur={() => setShow(false)}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setShow((current) => !current);
        }}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onTouchStart={(event) => {
          event.stopPropagation();
        }}
        className="text-cc-muted hover:text-cc-gold transition-colors focus:outline-none p-0 m-0 align-baseline"
        aria-label="More info"
        aria-expanded={show}
        tabIndex={0}
        style={{ lineHeight: 1, verticalAlign: 'baseline' }}
      >
        <Info className="w-3.5 h-3.5 align-baseline" />
      </button>
    </span>
    {tooltipNode}
    </>
  );
}

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
  async_mode?: boolean;
  async_turn_deadline?: string | null;
  current_player_id?: string | null;
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

  const { refreshing, pullDistance, handlers: pullHandlers } = usePullToRefresh({
    onRefresh: async () => { await Promise.all([fetchPublicGames(), fetchActiveGames()]); },
  });

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
  type VictoryMode = 'domination' | 'threshold' | 'capital' | 'secret_mission';
  const [victoryModes, setVictoryModes] = useState<Set<VictoryMode>>(
    () => new Set<VictoryMode>(['domination']),
  );
  const [victoryThresholdPct, setVictoryThresholdPct] = useState(65);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [joiningByCode, setJoiningByCode] = useState(false);
  const [factionsEnabled, setFactionsEnabled] = useState(false);
  const [economyEnabled, setEconomyEnabled] = useState(false);
  const [techTreesEnabled, setTechTreesEnabled] = useState(false);
  const [eventsEnabled, setEventsEnabled] = useState(false);
  const [navalEnabled, setNavalEnabled] = useState(false);
  const [stabilityEnabled, setStabilityEnabled] = useState(false);
  const [territorySelection, setTerritorySelection] = useState(false);
  const [activeSeasonal, setActiveSeasonal] = useState<Array<{ era_id: string; name: string }>>([]);
  // Factions selection state
  const [availableFactions, setAvailableFactions] = useState<FactionInfo[]>([]);
  const [selectedFactionId, setSelectedFactionId] = useState<string>('random');
  const [factionsLoading, setFactionsLoading] = useState(false);
  const [topLiveGameId, setTopLiveGameId] = useState<string | null>(null);
  const joinFromUrlHandled = useRef(false);


  const searchParamBootstrapDone = useRef(false);

  // Fetch available factions when enabled/era changes
  useEffect(() => {
    if (!factionsEnabled || !selectedEra) {
      setAvailableFactions([]);
      setSelectedFactionId('random');
      return;
    }
    setFactionsLoading(true);
    api.get(`/eras/${selectedEra}/factions`).then(res => {
      setAvailableFactions(res.data.factions ?? []);
    }).catch(() => setAvailableFactions([])).finally(() => setFactionsLoading(false));
  }, [factionsEnabled, selectedEra]);

  // Bootstrap search params for era/map
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
    // Fetch active seasonal events (best-effort, no auth needed)
    api.get('/lobby/seasonal').then((res: { data: Array<{ era_id: string; name: string }> }) => {
      if (Array.isArray(res.data)) setActiveSeasonal(res.data);
    }).catch(() => {/* ignore */});
    api.get<Array<{ game_id: string }>>('/games/live', { params: { limit: 1 } }).then((res) => {
      setTopLiveGameId(res.data[0]?.game_id ?? null);
    }).catch(() => {});
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

  const handleCancelGame = async (gameId: string) => {
    try {
      await api.delete(`/games/${gameId}/cancel`);
      toast.success('Game canceled successfully.');
      navigate('/lobby');
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        toast.error(err.response?.data?.error || 'Failed to cancel game');
      }
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const toggleVictoryMode = (mode: VictoryMode) => {
    setVictoryModes((prev) => {
      const next = new Set(prev);
      if (next.has(mode)) next.delete(mode);
      else next.add(mode);
      if (next.size === 0) next.add('domination');
      return next;
    });
  };

  const handleCreateGame = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const mapId = selectedCommunityMapId ?? ERA_MAP_IDS[selectedEra];
      const eraId = selectedCommunityMapId ? 'custom' : selectedEra;
      const allowed = Array.from(victoryModes) as VictoryMode[];
      const settings: Record<string, unknown> = {
        fog_of_war: fogOfWar,
        allowed_victory_conditions: allowed,
        turn_timer_seconds: turnTimer,
        initial_unit_count: 3,
        card_set_escalating: true,
        diplomacy_enabled: true,
        factions_enabled: factionsEnabled || undefined,
        economy_enabled: economyEnabled || undefined,
        tech_trees_enabled: techTreesEnabled || undefined,
        events_enabled: eventsEnabled || undefined,
        naval_enabled: navalEnabled || undefined,
        stability_enabled: stabilityEnabled || undefined,
        territory_selection: territorySelection || undefined,
        async_mode: turnTimer >= 43200 || undefined,
        async_turn_deadline_seconds: turnTimer >= 43200 ? turnTimer : undefined,
        faction_id: factionsEnabled ? (selectedFactionId === 'random' ? null : selectedFactionId) : null,
      };
      if (allowed.includes('threshold')) {
        settings.victory_threshold = victoryThresholdPct;
      }
      const res = await api.post('/games', {
        era_id: eraId,
        map_id: mapId,
        max_players: 8,
        ai_count: aiCount,
        ai_difficulty: aiDifficulty,
        settings,
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
    <div className="min-h-screen bg-cc-dark" {...pullHandlers}>
      {/* Pull-to-refresh indicator */}
      {(pullDistance > 0 || refreshing) && (
        <div
          className="flex justify-center items-center transition-all text-cc-muted text-xs"
          style={{ height: refreshing ? 32 : pullDistance * 0.4 }}
        >
          {refreshing ? 'Refreshing…' : pullDistance >= 80 ? 'Release to refresh' : '↓ Pull to refresh'}
        </div>
      )}
      {/* Top Bar */}
      <nav className="border-b border-cc-border px-4 sm:px-6 py-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pt-safe px-safe">
        <Link to="/lobby" className="font-display text-xl text-cc-gold tracking-widest hover:text-white transition-colors shrink-0">
          ERAS OF EMPIRE
        </Link>
        <div className="hidden md:flex flex-wrap items-center gap-x-4 gap-y-2 justify-end">
          <Link to="/how-to-play" className="flex items-center gap-1.5 text-cc-muted hover:text-cc-text text-sm transition-colors">
            <HelpCircle className="w-4 h-4 shrink-0" /> How to Play
          </Link>
          <Link to="/maps" className="flex items-center gap-1.5 text-cc-muted hover:text-cc-text text-sm transition-colors">
            <Map className="w-4 h-4 shrink-0" /> Map Hub
          </Link>
          {!user?.is_guest && (
            <Link to="/daily" className="flex items-center gap-1.5 text-cc-gold/80 hover:text-cc-gold text-sm transition-colors font-medium">
              <Calendar className="w-4 h-4 shrink-0" /> Daily
            </Link>
          )}
          {!user?.is_guest && (
            <Link to="/store" className="flex items-center gap-1.5 text-cc-muted hover:text-cc-text text-sm transition-colors">
              <ShoppingBag className="w-4 h-4 shrink-0" /> Store
            </Link>
          )}
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
          <Link to="/leaderboards" className="flex items-center gap-1.5 text-cc-muted hover:text-cc-text text-sm transition-colors">
            <Trophy className="w-4 h-4 shrink-0" /> Leaderboards
          </Link>
          <Link to="/live-games" className="flex items-center gap-1.5 text-cc-muted hover:text-cc-text text-sm transition-colors">
            <Eye className="w-4 h-4 shrink-0" /> Live
          </Link>
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

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-20 md:pb-8">
        {/* Onboarding Quest Banner */}
        {user && user.onboarding_stage != null && (
          <OnboardingBanner
            stage={user.onboarding_stage}
            onSkip={async () => {
              try {
                await api.post('/progression/onboarding/skip');
                useAuthStore.getState().setUser({ ...user, onboarding_stage: null });
              } catch {}
            }}
            className="mb-4"
          />
        )}

        {/* Welcome Banner */}
        <div className="card mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="font-display text-xl sm:text-2xl text-cc-gold">Welcome, {user?.username}</h2>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-cc-muted text-sm">Level {user?.level} · Ranked {(user as any)?.ratings?.ranked?.display ?? user?.mmr ?? '—'} · {user?.xp} XP</p>
              {(user?.win_streak ?? 0) > 0 && <StreakBadge type="win" count={user!.win_streak!} />}
              {(user?.daily_streak ?? 0) > 0 && <StreakBadge type="daily" count={user!.daily_streak!} />}
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowCreate(true)}
              className="btn-primary flex items-center gap-2 flex-1 sm:flex-none justify-center"
              aria-haspopup="dialog"
              aria-controls="create-game-modal"
            >
              <Plus className="w-4 h-4" /> New Game
            </button>
            <button
              onClick={() => navigate(topLiveGameId ? `/spectate/${topLiveGameId}` : '/live-games')}
              className="btn-secondary flex items-center gap-2 flex-1 sm:flex-none justify-center"
            >
              <Eye className="w-4 h-4" /> Watch a Game
            </button>
            {!user?.is_guest && (
              <Link to="/editor" className="btn-secondary flex items-center gap-2 flex-1 sm:flex-none justify-center">
                <Map className="w-4 h-4" /> Map Editor
              </Link>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
          <div className="min-w-0">
            {/* Active / Saved Games — surfaced first so players can immediately resume */}
            {activeGames.length > 0 && (
              <div className="card mb-6 animate-fade-in">
                <h3 className="font-display text-xl text-cc-gold mb-6 flex items-center gap-2">
                  <Play className="w-5 h-5" /> Your Active Games
                </h3>
                <div className="space-y-3">
                  {activeGames.map((game) => (
                    <div
                      key={game.game_id}
                      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-cc-dark rounded-lg border border-cc-border hover:border-cc-gold transition-colors"
                    >
                      <div className="flex flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-cc-text">{ERA_LABELS[game.era_id] ?? game.era_id}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-cc-gold/15 text-cc-gold border border-cc-gold/30">
                            {GAME_TYPE_LABELS[game.game_type] ?? game.game_type}
                          </span>
                          {game.saved_at && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-900/30 text-amber-400 border border-amber-700/40">
                              Saved
                            </span>
                          )}
                          {game.async_mode && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-900/30 text-indigo-400 border border-indigo-700/40">
                              Async
                            </span>
                          )}
                          {game.async_mode && game.current_player_id === user?.user_id && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/40 text-green-400 border border-green-700/40 animate-pulse">
                              Your turn!
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 text-cc-muted text-sm">
                          {game.turn_number != null && <span>Turn {game.turn_number}</span>}
                          {game.async_mode && game.async_turn_deadline && (() => {
                            const deadline = new Date(game.async_turn_deadline);
                            const now = Date.now();
                            const remainMs = deadline.getTime() - now;
                            if (remainMs <= 0) return <span className="text-red-400">Deadline passed</span>;
                            const hours = Math.floor(remainMs / 3600000);
                            const mins = Math.floor((remainMs % 3600000) / 60000);
                            const totalSec = remainMs / 1000;
                            const ratio = totalSec / 86400;
                            const urgencyColor = ratio > 0.5 ? 'text-green-400' : ratio > 0.25 ? 'text-yellow-400' : 'text-red-400';
                            return (
                              <span className={`flex items-center gap-1 ${urgencyColor}`}>
                                <Clock className="w-3.5 h-3.5" />
                                {hours > 0 ? `${hours}h ${mins}m` : `${mins}m`} left
                              </span>
                            );
                          })()}
                          {game.saved_at && !game.async_mode && (
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
                          <Play className="w-3.5 h-3.5" /> {game.saved_at ? 'Resume' : 'Continue'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                    onClick={() => navigate('/daily')}
                    className="p-4 rounded-lg bg-cc-dark border border-cc-border hover:border-cc-gold
                               transition-colors text-left group"
                  >
                    <Calendar className="w-6 h-6 text-cc-gold mb-2" />
                    <p className="font-display text-cc-gold group-hover:text-white transition-colors">Daily Challenge</p>
                    <p className="text-cc-muted text-xs mt-1">One game per day, same map for everyone. Climb the leaderboard!</p>
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

            {/* WW2 Advanced Tutorial — shown after completing the basic tutorial */}
            {user && user.has_completed_tutorial && !user.is_guest && lobbyTab === 'casual' && (
              <div className="card mb-6 animate-fade-in border-amber-700/30">
                <h3 className="font-display text-lg text-amber-400 mb-4 flex items-center gap-2">
                  <Sword className="w-5 h-5" /> Next Steps
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    onClick={async () => {
                      try {
                        const res = await api.post('/games/tutorial/start', { era: 'ww2' });
                        navigate(`/game/${res.data.game_id}`);
                      } catch { toast.error('Failed to start tutorial'); }
                    }}
                    className="p-4 rounded-lg bg-cc-dark border border-amber-700/30 hover:border-amber-500
                               transition-colors text-left group"
                  >
                    <Sword className="w-6 h-6 text-amber-400 mb-2" />
                    <p className="font-display text-amber-400 group-hover:text-white transition-colors">WW2 Theatre</p>
                    <p className="text-cc-muted text-xs mt-1">Apply your skills in the World War II era with tanks, bombers, and atom bombs.</p>
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
                  <p className="text-cc-muted text-xs">
                    {{ blitz_120: 'Blitz 2m', standard_300: 'Standard 5m', long_1200: 'Long 20m',
                       async_43200: 'Async 12h', async_86400: 'Async 24h', async_259200: 'Async 3d',
                    }[rankedBucket] ?? rankedBucket.replace('_', ' ')} &middot; {queueElapsed}s elapsed
                  </p>
                </div>
                <button onClick={leaveRankedQueue} className="btn-secondary text-sm py-1.5 px-4">Cancel</button>
              </div>
            ) : (
              <div>
                <p className="text-cc-muted text-xs mb-2 uppercase tracking-wider font-medium">Real-Time</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
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
                <p className="text-cc-muted text-xs mb-2 uppercase tracking-wider font-medium">Async</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {([
                    { bucket: 'async_43200',  label: '12 Hours', desc: '12h per turn', icon: Clock },
                    { bucket: 'async_86400',  label: '24 Hours', desc: '1 day per turn', icon: Calendar },
                    { bucket: 'async_259200', label: '3 Days',   desc: '3 days per turn', icon: Calendar },
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
                <p className="text-cc-muted text-xs mt-3 italic">
                  Async matches notify you when it&apos;s your turn — play on your own schedule.
                </p>
              </div>
            )}
          </div>
        )}

            {/* Create Game Modal */}
            <Modal
              open={lobbyTab === 'casual' && showCreate}
              onClose={() => { setShowCreate(false); setSelectedCommunityMapId(null); }}
              title="Configure New Game"
              className="max-w-2xl w-full"
              showCloseButton
            >
              <form onSubmit={handleCreateGame} className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
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
                      <label className="label">
                        Historical Era
                        {activeSeasonal.some((s) => s.era_id === selectedEra) && (
                          <span className="ml-2 text-xs bg-amber-500 text-black px-1.5 py-0.5 rounded font-bold">
                            🎯 Seasonal
                          </span>
                        )}
                      </label>
                      <select
                        className="input"
                        value={selectedEra}
                        onChange={(e) => {
                          setSelectedEra(e.target.value);
                          setSelectedCommunityMapId(null);
                        }}
                      >
                        {ERAS.map((era) => (
                          <option key={era.id} value={era.id}>
                            {era.label}{activeSeasonal.some((s) => s.era_id === era.id) ? ' 🎯' : ''}
                          </option>
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
                      <option value={43200}>12 Hours (Async)</option>
                      <option value={86400}>24 Hours (Async)</option>
                      <option value={259200}>3 Days (Async)</option>
                    </select>
                    {turnTimer >= 43200 && (
                      <p className="text-xs text-cc-gold mt-1">Players will be notified when it's their turn.</p>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:col-span-2">
                    <label className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 text-sm text-cc-text cursor-pointer">
                      <FeatureTooltip text="All territories start neutral. Players take turns selecting which territories they want instead of random assignment. Incompatible with Asymmetric Factions." />
                      <input
                        type="checkbox"
                        id="territory-draft-top"
                        checked={territorySelection}
                        onChange={(e) => { setTerritorySelection(e.target.checked); if (e.target.checked) setFactionsEnabled(false); }}
                        disabled={factionsEnabled}
                        className="w-4 h-4 mt-0.5 accent-cc-gold"
                      />
                      <span className="leading-snug min-w-0">Territory Draft</span>
                    </label>
                    <label className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 text-sm text-cc-text cursor-pointer">
                      <FeatureTooltip text="Each player or faction starts with a unique bonus — extra units, defensive perks, or special abilities tied to the era's major powers. Incompatible with Territory Draft." />
                      <input
                        type="checkbox"
                        id="asymmetric-factions-top"
                        checked={factionsEnabled}
                        onChange={(e) => {
                          setFactionsEnabled(e.target.checked);
                          if (e.target.checked) setTerritorySelection(false);
                        }}
                        disabled={territorySelection}
                        className="w-4 h-4 mt-0.5 accent-cc-gold"
                      />
                      <span className="leading-snug min-w-0">Asymmetric Factions</span>
                    </label>
                  </div>
                  <div className="md:col-span-2 border-t border-cc-border pt-4 mt-2">
                    <label className="label mb-2">Advanced Features</label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <label className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 text-sm text-cc-text cursor-pointer">
                        <FeatureTooltip text="Territories generate Production Points each turn. Spend them to construct buildings (farms, forts, ports, labs) that boost income, defense, research, or naval power." />
                        <input type="checkbox" checked={economyEnabled} onChange={(e) => setEconomyEnabled(e.target.checked)} className="w-4 h-4 mt-0.5 accent-cc-gold" />
                        <span className="leading-snug min-w-0">Economy &amp; Buildings</span>
                      </label>
                      <label className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 text-sm text-cc-text cursor-pointer">
                        <FeatureTooltip text="Earn Tech Points and research upgrades — improved combat dice, faster production, naval range, or era-specific breakthroughs — that compound advantages over time." />
                        <input type="checkbox" checked={techTreesEnabled} onChange={(e) => setTechTreesEnabled(e.target.checked)} className="w-4 h-4 mt-0.5 accent-cc-gold" />
                        <span className="leading-snug min-w-0">Technology Trees</span>
                      </label>
                      <label className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 text-sm text-cc-text cursor-pointer">
                        <FeatureTooltip text="Era-specific event cards are drawn each turn — plagues, rebellions, trade booms, or political crises. Some affect all players; others let you choose a strategic response." />
                        <input type="checkbox" checked={eventsEnabled} onChange={(e) => setEventsEnabled(e.target.checked)} className="w-4 h-4 mt-0.5 accent-cc-gold" />
                        <span className="leading-snug min-w-0">Historical Events</span>
                      </label>
                      <label className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 text-sm text-cc-text cursor-pointer">
                        <FeatureTooltip text="Coastal territories can build and station fleets. Move fleets across sea connections to project power, blockade enemies, or launch amphibious attacks on distant shores." />
                        <input type="checkbox" checked={navalEnabled} onChange={(e) => setNavalEnabled(e.target.checked)} className="w-4 h-4 mt-0.5 accent-cc-gold" />
                        <span className="leading-snug min-w-0">Naval Warfare</span>
                      </label>
                      <label className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 text-sm text-cc-text cursor-pointer">
                        <FeatureTooltip text="Each territory tracks stability (0–100%). Low stability reduces income and unit placement. Captured territories start unstable; neglected ones may rebel and lose units automatically." />
                        <input type="checkbox" checked={stabilityEnabled} onChange={(e) => setStabilityEnabled(e.target.checked)} className="w-4 h-4 mt-0.5 accent-cc-gold" />
                        <span className="leading-snug min-w-0">Population &amp; Stability</span>
                      </label>
                      <label className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 text-sm text-cc-text cursor-pointer">
                        <FeatureTooltip text="Players can only see territories they own and neighboring enemy positions. Hidden territories conceal unit counts, making scouting and border control more important." />
                        <input type="checkbox" checked={fogOfWar} onChange={(e) => setFogOfWar(e.target.checked)} className="w-4 h-4 mt-0.5 accent-cc-gold" />
                        <span className="leading-snug min-w-0">Fog of War</span>
                      </label>
                    </div>
                  </div>
                  <div className="md:col-span-2">
                    <label className="label">Victory conditions</label>
                    <p className="text-xs text-cc-muted mb-2">A player wins if they meet any checked condition (last player standing always wins).</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {([
                        ['domination', 'Domination — control every territory', 'Own every single territory on the map simultaneously. A difficult but decisive conquest victory.'],
                        ['threshold', 'Territory threshold', 'Win by controlling a set percentage of territories (configurable below). Rewards sustained expansion over total domination.'],
                        ['capital', 'Capital — occupy all opponents\' capitals', 'Each player has a home capital. Capture every rival capital to win — even if they still hold other territories.'],
                        ['secret_mission', 'Secret mission', 'Each player is secretly assigned a unique objective (e.g. control two specific regions, or eliminate a target player). Completing yours wins the game.'],
                      ] as const).map(([id, label, tip]) => (
                        <label key={id} className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 text-sm text-cc-text cursor-pointer">
                          <FeatureTooltip text={tip} />
                          <input
                            type="checkbox"
                            className="w-4 h-4 mt-0.5 accent-cc-gold shrink-0"
                            checked={victoryModes.has(id)}
                            onChange={() => toggleVictoryMode(id)}
                          />
                          <span className="leading-snug min-w-0">{label}</span>
                        </label>
                      ))}
                    </div>
                    {victoryModes.has('threshold') && (
                      <div className="mt-3 flex items-center gap-3">
                        <label htmlFor="vthr" className="text-sm text-cc-muted whitespace-nowrap">Threshold %</label>
                        <input
                          id="vthr"
                          type="number"
                          min={1}
                          max={99}
                          className="input w-24 py-1.5"
                          value={victoryThresholdPct}
                          onChange={(e) => setVictoryThresholdPct(Number(e.target.value) || 65)}
                        />
                      </div>
                    )}
                  </div>
                  <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 border-t border-cc-border bg-cc-surface/95 backdrop-blur md:col-span-2">
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-end">
                      <button
                        type="button"
                        className="btn-secondary w-full sm:w-auto"
                        onClick={() => { setShowCreate(false); setSelectedCommunityMapId(null); }}
                      >
                        Cancel
                      </button>
                      <button type="submit" className="btn-primary w-full sm:flex-1" disabled={creating}>
                      {creating ? 'Creating...' : 'Create & Enter Lobby'}
                      </button>
                    </div>
                  </div>
                </form>
            </Modal>

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

            {user && !user.is_guest && <ActivityFeed className="mt-6" />}
          </div>

          <aside className="space-y-4 xl:sticky xl:top-24">
            {user && !user.is_guest ? (
              <>
                <LeaderboardWidget />
                <DailyLoginCalendar />
                <MonthlyChallenges />
                <SeasonBanner />
              </>
            ) : (
              <LeaderboardWidget />
            )}
          </aside>
        </div>
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

      {/* Mobile Tab Bar */}
      <MobileTabBar
        isGuest={user?.is_guest}
        onCreateGame={() => setShowCreate(true)}
        onLogout={handleLogout}
      />
    </div>
  );
}
