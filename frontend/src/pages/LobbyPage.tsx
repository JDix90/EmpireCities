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
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useEraAdvancementLobbyEnabled, useMapEditorEnabled } from '../store/featureFlagsStore';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import {
  Trash2, Timer, GraduationCap, Bot, Info, Calendar, Sword, Trophy,
} from 'lucide-react';
import TopNavBar from '../components/ui/TopNavBar';
import axios from 'axios';
import { getSocketUrl } from '../config/env';
import { io as ioClient, Socket as IOSocket } from 'socket.io-client';
import { ERA_LABELS, formatLobbyPairingLabel, formatWeeklyScoring } from '../constants/gameLobbyLabels';
import { isCommunityTheaterMap, pickQuickMatchEra } from '../constants/lobbyMapOptions';
import {
  LOBBY_THEATER_OPTIONS,
  buildMapMetaFromGameMap,
  evaluateEraMapCompatibility,
  recommendedRulesEraForTheater,
} from '../utils/lobbyEraMapCompatibility';
import { fetchMapById, type GameMap } from '../services/mapService';
import LobbyEraMapWarnings from '../components/lobby/LobbyEraMapWarnings';
import { advancedFeatureTooltip, getCustomMapImmersion } from '../data/customMapImmersion';
import OnboardingBanner from '../components/ui/OnboardingBanner';
import StreakBadge from '../components/ui/StreakBadge';
import SeasonBanner from '../components/ui/SeasonBanner';
import MonthlyChallenges from '../components/ui/MonthlyChallenges';
import DailyLoginCalendar from '../components/ui/DailyLoginCalendar';
import ActivityFeed from '../components/ui/ActivityFeed';
import LeaderboardWidget from '../components/lobby/LeaderboardWidget';
import ChallengeFriendModal from '../components/lobby/ChallengeFriendModal';
import MobileTabBar from '../components/ui/MobileTabBar';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import Modal from '../components/ui/Modal';
import {
  canAccessGalacticAge,
  GALACTIC_AGE_ERA_ID,
} from '../constants/galacticAgeAccess';
import NewUserWelcomeModal, { hasSeenWelcome, markWelcomeSeen } from '../components/ui/NewUserWelcomeModal';
import { TUTORIAL_MODULES, TUTORIAL_V2_ENABLED, getCompletedTutorialModules } from '../tutorial';
import { Settings2, FlaskConical, Radio, Activity, Eye, Swords } from 'lucide-react';

interface LiveGameSummary {
  game_id: string;
  era_id: string;
  player_count: string | number;
  human_count: string | number;
  turn_count: number;
  spectator_count?: number;
}

interface ActivityStats {
  games_in_progress: number;
  games_today: number;
  games_total: number;
}

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
            ? 'fixed z-[80] rounded-xl bg-bf-dark border border-bf-border px-4 py-3 text-xs text-bf-text leading-relaxed shadow-2xl'
            : 'fixed z-[80] rounded-lg bg-bf-dark border border-bf-border px-3 py-2 text-xs text-bf-text leading-relaxed shadow-xl pointer-events-none'}
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
        className="text-bf-muted hover:text-bf-gold transition-colors focus:outline-none p-0 m-0 align-baseline"
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
  { id: 'space_age', label: 'Space Age' },
  { id: 'galaxy_age', label: 'Galactic Age — Coming Soon' },
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
  space_age: 'era_space_age',
  galaxy_age: 'era_galaxy',
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

interface WeeklyChallengeSummary {
  challenge_id: string;
  week_start_date: string;
  seed: number;
  rules_json: {
    objective?: string;
    turn_limit?: number;
    scoring?: string;
  };
}

interface RankedQueueIntegrity {
  smurf_risk_score: number;
  smurf_risk_tier: 'low' | 'medium' | 'high';
  stall_penalties: number;
  provisional?: boolean;
}

/** Subset of GET /campaign/me for lobby CTA */
interface LobbyCampaignMe {
  campaign_id: string;
  status: 'active' | 'completed';
  current_era: string | null;
  current_era_index: number;
  prestige_points: number;
  path_id: string | null;
  path_config: { name: string; signature_carry_key: string; signature_carry_label?: string } | null;
  path_carry: Record<string, number>;
  eras: Array<{ era_id: string; game_id: string | null }>;
}

const GAME_TYPE_LABELS: Record<string, string> = {
  solo: 'vs AI',
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
  const { user, logout, accessToken, refreshUser } = useAuthStore();
  const mapEditorEnabled = useMapEditorEnabled();
  const eraAdvancementLobbyEnabled = useEraAdvancementLobbyEnabled();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [publicGames, setPublicGames] = useState<PublicGame[]>([]);
  const [activeGames, setActiveGames] = useState<ActiveGame[]>([]);
  const [creating, setCreating] = useState(false);
  const [quickSoloLoading, setQuickSoloLoading] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState<string | null>(null);

  const presetEra = searchParams.get('era');
  const presetMap = searchParams.get('map');
  const eraFromMap = presetMap ? Object.entries(ERA_MAP_IDS).find(([, v]) => v === presetMap)?.[0] : undefined;
  const isCommunityMap = !!(presetMap && !Object.values(ERA_MAP_IDS).includes(presetMap));
  const resolvedEra = isCommunityMap ? null : (presetEra ?? eraFromMap ?? null);
  const validEra = resolvedEra && ERAS.some((e) => e.id === resolvedEra) ? resolvedEra : null;
  const [showCreate, setShowCreate] = useState(!!validEra || !!presetMap);
  const [lobbyTab, setLobbyTab] = useState<'casual' | 'ranked'>('casual');

  const [campaignMe, setCampaignMe] = useState<LobbyCampaignMe | null>(null);
  const [campaignMeReady, setCampaignMeReady] = useState(false);

  const fetchCampaignMe = useCallback(async () => {
    if (!user || user.is_guest) {
      setCampaignMe(null);
      setCampaignMeReady(true);
      return;
    }
    setCampaignMeReady(false);
    try {
      const res = await api.get<LobbyCampaignMe>('/campaign/me');
      setCampaignMe(res.data);
    } catch (e) {
      if (axios.isAxiosError(e) && e.response?.status === 404) {
        setCampaignMe(null);
      } else {
        setCampaignMe(null);
      }
    } finally {
      setCampaignMeReady(true);
    }
  }, [user]);

  useEffect(() => {
    void fetchCampaignMe();
  }, [fetchCampaignMe]);

  // Onboarding stage derived from real quest completion (/progression/quests),
  // NOT users.onboarding_stage — that counter is gated on tutorial completion
  // and doesn't reflect quests actually completed (first_win, etc.). null = hide.
  const [questStage, setQuestStage] = useState<number | null>(null);

  // Re-fetch the user's profile whenever the lobby mounts (e.g. returning from a
  // finished game) so level/XP/gold reflect the latest server state rather than
  // the value cached at login. Without this, stats only update on a full reload.
  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  // Load real onboarding-quest progress and derive the banner stage as the count
  // of completed quests (= index of the next incomplete one). All done → hide.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await api.get<{ quests: { completed_at: string | null }[] }>('/progression/quests');
        const quests = res.data?.quests ?? [];
        const completedCount = quests.filter((q) => q.completed_at).length;
        if (!cancelled) {
          setQuestStage(completedCount >= quests.length ? null : completedCount);
        }
      } catch {
        if (!cancelled) setQuestStage(null); // on failure, just hide the banner
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resumeCampaignFromLobby = useCallback(() => {
    if (!campaignMe || campaignMe.status !== 'active') {
      navigate('/campaign');
      return;
    }
    const entry = campaignMe.eras.find((e) => e.era_id === campaignMe.current_era && e.game_id);
    if (entry?.game_id) navigate(`/game/${entry.game_id}`);
    else navigate('/campaign');
  }, [campaignMe, navigate]);

  const { refreshing, pullDistance, handlers: pullHandlers } = usePullToRefresh({
    onRefresh: async () => {
      await Promise.all([fetchPublicGames(), fetchActiveGames(), fetchCampaignMe()]);
    },
  });

  // Ranked matchmaking state
  const [rankedQueued, setRankedQueued] = useState(false);
  const [rankedBucket, setRankedBucket] = useState('');
  const [rankedEra, setRankedEra] = useState('ancient');
  const [queueElapsed, setQueueElapsed] = useState(0);
  const [rankedIntegrity, setRankedIntegrity] = useState<RankedQueueIntegrity | null>(null);
  const [weeklyChallenge, setWeeklyChallenge] = useState<WeeklyChallengeSummary | null>(null);
  const [weeklyPreviewLeaderboard, setWeeklyPreviewLeaderboard] = useState<Array<{ username: string; score: number }>>([]);

  // Create game form state
  const [selectedEra, setSelectedEra] = useState(validEra ?? 'ww2');
  const [selectedTheaterMapId, setSelectedTheaterMapId] = useState(
    isCommunityMap && presetMap ? presetMap : ERA_MAP_IDS[validEra ?? 'ww2'],
  );
  const [customPairingEnabled, setCustomPairingEnabled] = useState(isCommunityMap);
  const [theaterMapDoc, setTheaterMapDoc] = useState<GameMap | null>(null);
  const [aiCount, setAiCount] = useState(3);
  const [aiDifficulty, setAiDifficulty] = useState('medium');
  const [fogOfWar, setFogOfWar] = useState(false);
  const [diplomacyEnabled, setDiplomacyEnabled] = useState(true);
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
  const [coachingEnabled, setCoachingEnabled] = useState(false);
  const [eraAdvancementEnabled, setEraAdvancementEnabled] = useState(false);
  const [eraAdvancementPreset, setEraAdvancementPreset] = useState<'skirmish' | 'standard' | 'epic'>('standard');

  useEffect(() => {
    if (selectedEra !== 'ancient') setEraAdvancementEnabled(false);
  }, [selectedEra]);
  const [activeSeasonal, setActiveSeasonal] = useState<Array<{ era_id: string; name: string }>>([]);
  // Factions selection state
  const [_availableFactions, setAvailableFactions] = useState<FactionInfo[]>([]);
  const [selectedFactionId, setSelectedFactionId] = useState<string>('random');
  const [_factionsLoading, setFactionsLoading] = useState(false);
  const [topLiveGameId, setTopLiveGameId] = useState<string | null>(null);
  const [topLiveGame, setTopLiveGame] = useState<LiveGameSummary | null>(null);
  const [showChallenge, setShowChallenge] = useState(false);
  const [dailySummary, setDailySummary] = useState<{ era_id: string; attempts_today: number; completed: boolean } | null>(null);
  const [activityStats, setActivityStats] = useState<ActivityStats | null>(null);
  const joinFromUrlHandled = useRef(false);

  // New-user welcome modal — shown once for users with no XP
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [completedModules, setCompletedModules] = useState<string[]>([]);

  useEffect(() => {
    setCompletedModules(getCompletedTutorialModules());
    if (user && (user.xp ?? 0) === 0 && !hasSeenWelcome()) {
      setShowWelcomeModal(true);
    }
  }, [user?.user_id]);

  const mapImmersion = React.useMemo(
    () => (isCommunityTheaterMap(selectedTheaterMapId) ? getCustomMapImmersion(selectedTheaterMapId) : null),
    [selectedTheaterMapId],
  );

  useEffect(() => {
    if (!customPairingEnabled) {
      setSelectedTheaterMapId(ERA_MAP_IDS[selectedEra] ?? selectedTheaterMapId);
    }
  }, [selectedEra, customPairingEnabled]);

  useEffect(() => {
    if (!customPairingEnabled || !isCommunityTheaterMap(selectedTheaterMapId)) return;
    const imm = getCustomMapImmersion(selectedTheaterMapId);
    if (imm) setSelectedEra(imm.recommended_rules_era);
  }, [selectedTheaterMapId, customPairingEnabled]);

  useEffect(() => {
    if (!selectedTheaterMapId) return;
    let cancelled = false;
    fetchMapById(selectedTheaterMapId)
      .then((map) => { if (!cancelled) setTheaterMapDoc(map); })
      .catch(() => { if (!cancelled) setTheaterMapDoc(null); });
    return () => { cancelled = true; };
  }, [selectedTheaterMapId]);

  const createPairingCompatibility = React.useMemo(() => {
    const settings: Record<string, unknown> = {
      fog_of_war: fogOfWar,
      diplomacy_enabled: diplomacyEnabled,
      factions_enabled: factionsEnabled || undefined,
      economy_enabled: economyEnabled || undefined,
      tech_trees_enabled: techTreesEnabled || undefined,
      events_enabled: eventsEnabled || undefined,
      naval_enabled: navalEnabled || undefined,
      stability_enabled: stabilityEnabled || undefined,
      era_advancement_enabled:
        eraAdvancementLobbyEnabled && eraAdvancementEnabled && selectedEra === 'ancient' ? true : undefined,
    };
    return evaluateEraMapCompatibility({
      era_id: selectedEra,
      map_id: selectedTheaterMapId,
      settings,
      is_admin: user?.is_admin === true,
      player_count: 1 + aiCount,
      map_meta: theaterMapDoc ? buildMapMetaFromGameMap(theaterMapDoc) : null,
    });
  }, [
    selectedEra,
    selectedTheaterMapId,
    fogOfWar,
    diplomacyEnabled,
    factionsEnabled,
    economyEnabled,
    techTreesEnabled,
    eventsEnabled,
    navalEnabled,
    stabilityEnabled,
    eraAdvancementLobbyEnabled,
    eraAdvancementEnabled,
    user?.is_admin,
    aiCount,
    theaterMapDoc,
  ]);

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

  useEffect(() => {
    if (selectedEra !== GALACTIC_AGE_ERA_ID) return;
    if (canAccessGalacticAge(user)) return;
    setSelectedEra('ww2');
  }, [user, selectedEra]);

  useEffect(() => {
    if (rankedEra !== GALACTIC_AGE_ERA_ID) return;
    if (canAccessGalacticAge(user)) return;
    setRankedEra('ww2');
  }, [user, rankedEra]);

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
          setSelectedTheaterMapId(map);
          setCustomPairingEnabled(false);
        }
      } else {
        setSelectedTheaterMapId(map);
        setCustomPairingEnabled(true);
      }
      setShowCreate(true);
    } else if (era && ERAS.some((e) => e.id === era)) {
      setSelectedEra(era);
      setSelectedTheaterMapId(ERA_MAP_IDS[era] ?? ERA_MAP_IDS.ww2);
      setCustomPairingEnabled(false);
      setShowCreate(true);
    }
    if (searchParams.has('era') || searchParams.has('map')) {
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const weekly = searchParams.get('weekly');
    if (weekly === '1') {
      setLobbyTab('ranked');
    }
  }, [searchParams]);

  // (The old ?quickstart=true handler lived here. It auto-opened the
  // Configure New Game form for fresh guests — stacked on top of the welcome
  // modal, which now owns first-visit triage. Era/map deep links (?era=,
  // ?map=) still pre-open the form above; that path is an explicit choice.)

  useEffect(() => {
    fetchPublicGames();
    fetchActiveGames();
    const interval = setInterval(fetchPublicGames, 10000);
    // Fetch active seasonal events (best-effort, no auth needed)
    api.get('/lobby/seasonal').then((res: { data: Array<{ era_id: string; name: string }> }) => {
      if (Array.isArray(res.data)) setActiveSeasonal(res.data);
    }).catch(() => {/* ignore */});
    api.get<LiveGameSummary[]>('/games/live', { params: { limit: 1 } }).then((res) => {
      setTopLiveGameId(res.data[0]?.game_id ?? null);
      setTopLiveGame(res.data[0] ?? null);
    }).catch(() => {});
    api.get<{ challenge: { era_id: string }; attempts_today?: number; my_entry: unknown | null }>('/daily/today').then((res) => {
      setDailySummary({
        era_id: res.data.challenge.era_id,
        attempts_today: res.data.attempts_today ?? 0,
        completed: res.data.my_entry != null,
      });
    }).catch(() => {});
    api.get<ActivityStats>('/games/stats/activity').then((res) => {
      setActivityStats(res.data);
    }).catch(() => {});
    api.get<{ challenge: WeeklyChallengeSummary }>('/enhancements/weekly/current')
      .then(async (res) => {
        setWeeklyChallenge(res.data.challenge);
        try {
          const lb = await api.get<{ leaderboard: Array<{ username: string; score: number }> }>(
            `/enhancements/weekly/${res.data.challenge.challenge_id}/leaderboard`,
          );
          setWeeklyPreviewLeaderboard(lb.data.leaderboard.slice(0, 5));
        } catch {
          setWeeklyPreviewLeaderboard([]);
        }
      })
      .catch(() => {
        setWeeklyChallenge(null);
        setWeeklyPreviewLeaderboard([]);
      });
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
      const res = await api.post<{
        queued: boolean;
        integrity?: RankedQueueIntegrity;
      }>('/matchmaking/join', { era_id: rankedEra, bucket });
      setRankedQueued(true);
      setRankedBucket(bucket);
      setQueueElapsed(0);
      setRankedIntegrity(res.data.integrity ?? null);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) toast.error(err.response?.data?.error || 'Failed to join queue');
    }
  };

  const leaveRankedQueue = async () => {
    try {
      await api.delete('/matchmaking/leave');
    } finally {
      setRankedQueued(false);
      setRankedIntegrity(null);
    }
  };

  useEffect(() => {
    if (lobbyTab !== 'ranked') return;
    let cancelled = false;
    api.get<{
      queued: boolean;
      bucket?: string;
      era_id?: string;
      enqueued_at?: string;
      integrity?: RankedQueueIntegrity;
    }>('/matchmaking/status')
      .then((res) => {
        if (cancelled) return;
        if (res.data.queued) {
          setRankedQueued(true);
          if (res.data.bucket) setRankedBucket(res.data.bucket);
          if (res.data.era_id) setRankedEra(res.data.era_id);
        }
        setRankedIntegrity(res.data.integrity ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [lobbyTab]);

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

  const _handleCancelGame = async (gameId: string) => {
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
    if (selectedEra === GALACTIC_AGE_ERA_ID && !canAccessGalacticAge(user)) {
      toast.error('Galactic Age is coming soon.');
      return;
    }
    setCreating(true);
    try {
      if (createPairingCompatibility.hardBlock) {
        toast.error(createPairingCompatibility.hardBlock);
        setCreating(false);
        return;
      }

      const mapId = selectedTheaterMapId;
      const eraId = selectedEra;
      const allowed = Array.from(victoryModes) as VictoryMode[];
      const settings: Record<string, unknown> = {
        fog_of_war: fogOfWar,
        allowed_victory_conditions: allowed,
        turn_timer_seconds: turnTimer,
        initial_unit_count: 3,
        card_set_escalating: true,
        diplomacy_enabled: diplomacyEnabled,
        factions_enabled: factionsEnabled || undefined,
        economy_enabled: economyEnabled || undefined,
        tech_trees_enabled: techTreesEnabled || undefined,
        events_enabled: eventsEnabled || undefined,
        naval_enabled: navalEnabled || undefined,
        stability_enabled: stabilityEnabled || undefined,
        territory_selection: territorySelection || undefined,
        coaching_enabled: coachingEnabled || undefined,
        era_advancement_enabled:
          eraAdvancementLobbyEnabled && eraAdvancementEnabled && selectedEra === 'ancient' ? true : undefined,
        era_advancement_preset:
          eraAdvancementLobbyEnabled && eraAdvancementEnabled && selectedEra === 'ancient' ? eraAdvancementPreset : undefined,
        async_mode: turnTimer >= 43200 || undefined,
        async_turn_deadline_seconds: turnTimer >= 43200 ? turnTimer : undefined,
        faction_id: factionsEnabled ? (selectedFactionId === 'random' ? null : selectedFactionId) : null,
      };
      if (eraAdvancementLobbyEnabled && eraAdvancementEnabled && selectedEra === 'ancient') {
        settings.economy_enabled = true;
        settings.tech_trees_enabled = true;
        settings.stability_enabled = true;
      }
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

  // Deep link from post-game "Challenge a friend" → open the challenge modal.
  useEffect(() => {
    if (searchParams.get('challenge') === '1') {
      setShowChallenge(true);
      const next = new URLSearchParams(searchParams);
      next.delete('challenge');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

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
                <span className="font-medium text-bf-text">{data.inviter_username}</span> invited you to a game
                {data.join_code ? (
                  <span className="text-bf-muted"> (code {data.join_code})</span>
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
                  <span className="font-medium text-bf-text">{inv.inviter_username}</span> invited you to a game.
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

  const handleWelcomeTutorial = async () => {
    markWelcomeSeen();
    setShowWelcomeModal(false);
    try {
      const res = await api.post<{ game_id: string }>('/games/tutorial/start', { lesson_module: 'core' });
      navigate(`/game/${res.data.game_id}`);
    } catch {
      toast.error('Could not start tutorial. Try again from the lobby.');
      navigate('/tutorial');
    }
  };

  // Shared "play now" path: instant solo game vs AI with sensible defaults — no lobby wait.
  const startQuickMatch = async () => {
    if (quickSoloLoading) return;
    setQuickSoloLoading(true);
    try {
      // Random era each match — always-Ancient got repetitive (player
      // feedback). Pool: the seven global world maps; see QUICK_MATCH_ERAS.
      const era = pickQuickMatchEra();
      const res = await api.post('/games', {
        era_id: era,
        map_id: ERA_MAP_IDS[era],
        max_players: 4,
        ai_count: 3,
        ai_difficulty: 'medium',
        // "Quick" means quick: the server starts the match before responding,
        // so the player lands directly in turn 1 instead of a pre-game room.
        auto_start: true,
        settings: {
          turn_timer_seconds: 300,
          allowed_victory_conditions: ['domination'],
          initial_unit_count: 3,
          card_set_escalating: true,
          diplomacy_enabled: true,
          // Stalemate guard: most territories wins at the cap, so a solo
          // match can't grind on for hundreds of turns.
          max_turns: 150,
        },
      });
      navigate(`/game/${res.data.game_id}`);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        toast.error(err.response?.data?.error || 'Failed to start game');
      }
      setQuickSoloLoading(false);
    }
  };

  const handleWelcomeQuickSolo = async () => {
    markWelcomeSeen();
    setShowWelcomeModal(false);
    await startQuickMatch();
  };

  // New players (or anyone yet to score XP) get a solo-first layout: play now, no empty lobby.
  const isNewUser = !!user && ((user.xp ?? 0) === 0 || user.onboarding_stage != null);

  return (
    <div className="min-h-screen bg-bf-dark" {...pullHandlers}>
      {showWelcomeModal && (
        <NewUserWelcomeModal
          onStartTutorial={() => void handleWelcomeTutorial()}
          onJumpIn={() => void handleWelcomeQuickSolo()}
          onDismiss={() => { markWelcomeSeen(); setShowWelcomeModal(false); }}
        />
      )}
      <ChallengeFriendModal open={showChallenge} onClose={() => setShowChallenge(false)} />
      {/* Pull-to-refresh indicator */}
      {(pullDistance > 0 || refreshing) && (
        <div
          className="flex justify-center items-center transition-all text-bf-muted text-xs"
          style={{ height: refreshing ? 32 : pullDistance * 0.4 }}
        >
          {refreshing ? 'Refreshing…' : pullDistance >= 80 ? 'Release to refresh' : '↓ Pull to refresh'}
        </div>
      )}
      {/* Top Bar — desktop only; phones use MobileTabBar at the bottom */}
      <div className="hidden md:block">
        <TopNavBar user={user} onLogout={handleLogout} />
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-20 md:pb-8">
        {/* Onboarding Quest Banner — driven by real quest completion (questStage),
            derived from /progression/quests, not the gated users.onboarding_stage. */}
        {questStage != null && (
          <OnboardingBanner
            stage={questStage}
            onSkip={async () => {
              try {
                await api.post('/progression/onboarding/skip');
              } catch {
                // ignore skip failures; user can keep playing
              }
              setQuestStage(null);
            }}
            className="mb-4"
          />
        )}

        {/* Welcome Banner */}
        <div className="card mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="font-display text-xl sm:text-2xl text-bf-gold">Welcome, {user?.username}</h2>
            <div className="flex items-center gap-2 mt-1">
              {user?.is_guest ? (
                <p className="text-bf-muted text-sm">
                  Level {user?.level} · {user?.xp} XP · Guest{' '}
                  <Link to="/upgrade" className="text-bf-gold hover:underline">— create an account to keep it</Link>
                </p>
              ) : (
                <p className="text-bf-muted text-sm">Level {user?.level} · Solo {user?.ratings?.solo?.display ?? '—'} · Ranked {user?.ratings?.ranked?.display ?? '—'} · {user?.xp} XP</p>
              )}
              {(user?.win_streak ?? 0) > 0 && <StreakBadge type="win" count={user!.win_streak!} />}
              {(user?.daily_streak ?? 0) > 0 && <StreakBadge type="daily" count={user!.daily_streak!} />}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3">
            <button
              onClick={() => void startQuickMatch()}
              disabled={quickSoloLoading}
              className="btn-primary flex items-center gap-2 justify-center sm:flex-none disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Bot className="w-4 h-4" aria-hidden />
              {quickSoloLoading ? 'Starting…' : 'Quick Match'}
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="btn-secondary flex items-center gap-2 justify-center sm:flex-none"
              aria-haspopup="dialog"
              aria-controls="create-game-modal"
            >
              New Game
            </button>
            {!user?.is_guest && (
              <button
                onClick={() => setShowChallenge(true)}
                className="btn-secondary flex items-center gap-2 justify-center sm:flex-none"
              >
                <Swords className="w-4 h-4" aria-hidden /> Challenge a friend
              </button>
            )}
            <button
              onClick={() => navigate(topLiveGameId ? `/spectate/${topLiveGameId}` : '/live-games')}
              className="btn-secondary flex items-center gap-2 justify-center sm:flex-none"
            >
              Watch
            </button>
            {!user?.is_guest && (
              <Link to="/war-room" className="btn-secondary flex items-center gap-2 justify-center sm:flex-none">
                War Room
              </Link>
            )}
            {!user?.is_guest && mapEditorEnabled && (
              <Link to="/editor" className="btn-secondary items-center gap-2 hidden lg:flex">
                Map Editor
              </Link>
            )}
          </div>
        </div>

        {/* Honest activity signals — real counts, truthful even when small */}
        {activityStats && (activityStats.games_in_progress > 0 || activityStats.games_total > 0) && (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mb-6 text-sm text-bf-muted">
            {activityStats.games_in_progress > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-green-400" aria-hidden />
                <span className="text-bf-text font-medium">{activityStats.games_in_progress}</span>
                {activityStats.games_in_progress === 1 ? 'game being played right now' : 'games being played right now'}
              </span>
            )}
            {activityStats.games_total > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-bf-gold" aria-hidden />
                <span className="text-bf-text font-medium">{activityStats.games_total.toLocaleString()}</span>
                games played all-time
              </span>
            )}
          </div>
        )}

        {/* Solo campaign — lobby CTA (context-aware) */}
        {user?.is_guest ? (
          <div className="card mb-6 border border-bf-border/80 bg-bf-surface/40">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <Sword className="w-6 h-6 text-bf-gold shrink-0 mt-0.5" aria-hidden />
                <div>
                  <h3 className="font-display text-lg text-bf-gold">Solo campaign</h3>
                  <p className="text-bf-muted text-sm mt-1">
                    Play the six-era narrative — create a free account to save progress and unlock paths.
                  </p>
                </div>
              </div>
              <Link
                to="/upgrade"
                className="btn-secondary self-start sm:self-center shrink-0 min-h-[44px] inline-flex items-center justify-center px-4 touch-manipulation"
              >
                Create account
              </Link>
            </div>
          </div>
        ) : !campaignMeReady ? (
          <div
            className="card mb-6 h-[108px] animate-pulse bg-bf-surface/40 border border-bf-border/60 rounded-xl"
            aria-hidden
          />
        ) : !campaignMe ? (
          <div className="card mb-6 border border-bf-gold/25 bg-gradient-to-br from-bf-gold/[0.07] to-transparent">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
              <div className="flex items-start gap-3 min-w-0">
                <Sword className="w-7 h-7 text-bf-gold shrink-0" aria-hidden />
                <div>
                  <h3 className="font-display text-lg text-bf-gold">Campaign</h3>
                  <p className="text-bf-muted text-sm mt-1 max-w-xl">
                    Six linked eras, narrative paths, and carry bonuses — open HQ to start a run or choose your path.
                  </p>
                </div>
              </div>
              <Link
                to="/campaign"
                className="btn-primary min-h-[44px] inline-flex items-center justify-center px-6 touch-manipulation shrink-0"
              >
                Open campaign HQ
              </Link>
            </div>
          </div>
        ) : campaignMe.status === 'completed' ? (
          <div className="card mb-6 border border-green-700/35 bg-green-950/20">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="min-w-0">
                <h3 className="font-display text-lg text-green-300">Campaign conquered</h3>
                <p className="text-bf-muted text-sm mt-1">
                  Prestige {campaignMe.prestige_points} · Start a fresh run with a new path anytime.
                </p>
              </div>
              <Link
                to="/campaign"
                className="btn-primary min-h-[44px] inline-flex items-center justify-center px-5 touch-manipulation shrink-0 self-start sm:self-center"
              >
                Start a new run
              </Link>
            </div>
          </div>
        ) : (
          <div className="card mb-6 border border-bf-gold/25 bg-gradient-to-br from-bf-gold/[0.07] to-transparent">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <Sword className="w-7 h-7 text-bf-gold shrink-0" aria-hidden />
                <div className="space-y-2 min-w-0">
                  <div>
                    <h3 className="font-display text-lg text-bf-gold">
                      {campaignMe.path_config?.name ?? 'Solo campaign'}
                    </h3>
                    <p className="text-bf-muted text-sm mt-1">
                      Era {Math.min(campaignMe.current_era_index + 1, 6)} of 6
                      {campaignMe.current_era != null && (
                        <>
                          {' '}
                          · {ERA_LABELS[campaignMe.current_era] ?? campaignMe.current_era}
                        </>
                      )}
                      {' · '}
                      Prestige {campaignMe.prestige_points}
                    </p>
                  </div>
                  {campaignMe.path_config &&
                    (campaignMe.path_carry[campaignMe.path_config.signature_carry_key] ?? 0) > 0 && (
                      <p className="text-xs text-bf-gold/90 inline-flex items-center gap-1.5 rounded-md border border-bf-gold/25 bg-bf-gold/5 px-2.5 py-1 w-fit">
                        <Trophy className="w-3.5 h-3.5 shrink-0" aria-hidden />
                        <span>
                          {campaignMe.path_config.signature_carry_label ?? 'Path bonus'}:{' '}
                          {campaignMe.path_carry[campaignMe.path_config.signature_carry_key] ?? 0}
                        </span>
                      </p>
                    )}
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 shrink-0 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={resumeCampaignFromLobby}
                  className="btn-primary min-h-[44px] inline-flex items-center justify-center px-5 touch-manipulation w-full sm:w-auto"
                >
                  Continue campaign
                </button>
                <Link
                  to="/campaign"
                  className="btn-secondary min-h-[44px] inline-flex items-center justify-center px-5 touch-manipulation w-full sm:w-auto text-center"
                >
                  Campaign HQ
                </Link>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
          <div className="min-w-0">
            {/* Active / Saved Games — surfaced first so players can immediately resume */}
            {activeGames.length > 0 && (
              <div className="card mb-6 animate-fade-in">
                <h3 className="font-display text-xl text-bf-gold mb-6 flex items-center gap-2">
                  Your Active Games
                </h3>
                <div className="space-y-3">
                  {activeGames.map((game) => (
                    <div
                      key={game.game_id}
                      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 bg-bf-dark rounded-lg border border-bf-border hover:border-bf-gold transition-colors"
                    >
                      <div className="flex flex-col gap-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-bf-text">{ERA_LABELS[game.era_id] ?? game.era_id}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-bf-gold/15 text-bf-gold border border-bf-gold/30">
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
                        <div className="flex items-center gap-3 text-bf-muted text-sm">
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
                                <Timer className="w-3.5 h-3.5" />
                                {hours > 0 ? `${hours}h ${mins}m` : `${mins}m`} left
                              </span>
                            );
                          })()}
                          {game.saved_at && !game.async_mode && (
                            <span className="flex items-center gap-1">
                              {timeAgo(game.saved_at)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {confirmAbandon === game.game_id ? (
                          <>
                            <span className="text-xs text-bf-muted mr-1">Delete?</span>
                            <button
                              onClick={() => handleAbandonGame(game.game_id)}
                              className="text-xs py-1.5 px-3 rounded border border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                            >
                              Yes
                            </button>
                            <button
                              onClick={() => setConfirmAbandon(null)}
                              className="text-xs py-1.5 px-3 rounded border border-bf-border text-bf-muted hover:text-bf-text transition-colors"
                            >
                              No
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setConfirmAbandon(game.game_id)}
                            className="p-1.5 rounded text-bf-muted hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Delete game"
                            aria-label="Delete game"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => navigate(`/game/${game.game_id}`)}
                          className="btn-primary text-sm py-1.5 px-4 flex items-center gap-1.5"
                        >
                          {game.saved_at ? 'Resume' : 'Continue'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick-start cards for new users */}
            {isNewUser && lobbyTab === 'casual' && (
              <div className="card mb-6 animate-fade-in border-bf-gold/20">
                <h3 className="font-display text-lg text-bf-gold mb-4 flex items-center gap-2">
                  Getting Started
                </h3>

                {/* Tutorial — full-width primary card */}
                <button
                  onClick={async () => {
                    try {
                      const res = await api.post<{ game_id: string }>('/games/tutorial/start', { lesson_module: 'core' });
                      navigate(`/game/${res.data.game_id}`);
                    } catch { toast.error('Failed to start tutorial'); }
                  }}
                  className="w-full flex items-start gap-4 p-4 rounded-xl bg-bf-gold/10 border border-bf-gold/30 hover:border-bf-gold hover:bg-bf-gold/15 transition-all text-left group mb-3"
                >
                  <div className="w-10 h-10 rounded-lg bg-bf-gold/15 border border-bf-gold/25 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                    <GraduationCap className="w-5 h-5 text-bf-gold" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-display text-bf-gold group-hover:text-white transition-colors">Interactive Tutorial</p>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-bf-gold/80 bg-bf-gold/15 border border-bf-gold/20 px-1.5 py-0.5 rounded">
                        Start here
                      </span>
                    </div>
                    <p className="text-bf-muted text-xs leading-relaxed">
                      ~6 min. Learn draft, attack, fortify, and cards in an interactive practice match. No experience needed.
                    </p>
                  </div>
                </button>

                {/* Quick Solo + Daily — equal secondary cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    disabled={quickSoloLoading}
                    onClick={() => void startQuickMatch()}
                    className="p-4 rounded-lg bg-bf-dark border border-bf-border hover:border-bf-gold/50 transition-colors text-left group disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <Bot className="w-5 h-5 text-bf-gold mb-2 group-hover:scale-110 transition-transform" />
                    <p className="font-display text-bf-gold group-hover:text-white transition-colors">
                      {quickSoloLoading ? 'Starting…' : 'Quick Match'}
                    </p>
                    <p className="text-bf-muted text-xs mt-1">3 AI opponents ready — start now. Random era map.</p>
                  </button>
                  <button
                    onClick={() => navigate('/daily')}
                    className="p-4 rounded-lg bg-bf-dark border border-bf-border hover:border-bf-gold/50 transition-colors text-left group"
                  >
                    <Calendar className="w-5 h-5 text-bf-gold mb-2 group-hover:scale-110 transition-transform" />
                    <p className="font-display text-bf-gold group-hover:text-white transition-colors">Daily Challenge</p>
                    <p className="text-bf-muted text-xs mt-1">
                      {dailySummary && dailySummary.attempts_today > 0
                        ? `${dailySummary.attempts_today} commander${dailySummary.attempts_today === 1 ? '' : 's'} attempted today.`
                        : 'One puzzle per day, same map for everyone.'}
                    </p>
                  </button>
                </div>
              </div>
            )}

            {/* Deep-dive lessons — shown after core tutorial, or for any user who completed at least core */}
            {user && user.has_completed_tutorial && !user.is_guest && lobbyTab === 'casual' && TUTORIAL_V2_ENABLED && (
              <div className="card mb-6 animate-fade-in border-amber-700/25">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <h3 className="font-display text-lg text-amber-400">Training Academy</h3>
                  <Link to="/tutorial" className="text-xs text-bf-gold hover:underline shrink-0">
                    View all
                  </Link>
                </div>
                <p className="text-bf-muted text-xs mb-4">
                  Short deep-dive lessons on optional features. Pick any you haven&apos;t tried.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {TUTORIAL_MODULES.filter((m) => m.id !== 'core').map((mod) => {
                    const done = completedModules.includes(mod.id);
                    const Icon =
                      mod.id === 'advanced_settings' ? Settings2 :
                      mod.id === 'faction_ability' ? Sword :
                      FlaskConical;
                    return (
                      <Link
                        key={mod.id}
                        to={`/tutorial?module=${mod.id}&start=1`}
                        className="flex flex-col gap-2 p-3 rounded-lg bg-bf-dark border border-bf-border hover:border-bf-gold/40 transition-colors group"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <Icon className="w-4 h-4 text-bf-gold shrink-0" aria-hidden />
                          {done ? (
                            <span className="text-[10px] text-green-400 font-medium">Done ✓</span>
                          ) : (
                            <span className="text-[10px] text-bf-muted">~{mod.estimatedMinutes} min</span>
                          )}
                        </div>
                        <p className="font-display text-sm text-bf-gold group-hover:text-white transition-colors leading-tight">
                          {mod.title}
                        </p>
                        <p className="text-bf-muted text-xs leading-relaxed">{mod.description}</p>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Casual / Ranked Tab Strip */}
            <div className="flex gap-1 mb-6 p-1 bg-bf-dark rounded-lg w-fit border border-bf-border">
              {(['casual', 'ranked'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => { setLobbyTab(tab); if (tab === 'casual' && rankedQueued) leaveRankedQueue(); }}
                  className={`flex items-center gap-1.5 px-5 py-2 rounded-md text-sm font-medium transition-all ${
                    lobbyTab === tab
                      ? 'bg-bf-gold/15 text-bf-gold border border-bf-gold/30'
                      : 'text-bf-muted hover:text-bf-text border border-transparent'
                  }`}
                >
                  {tab === 'casual' ? 'Casual' : 'Ranked'}
                </button>
              ))}
            </div>

            {/* Ranked Matchmaking Panel */}
            {lobbyTab === 'ranked' && (
              <div className="card mb-8 animate-fade-in">
            <h3 className="font-display text-xl text-bf-gold mb-2 flex items-center gap-2">
              Ranked 1v1 Matchmaking
            </h3>
            <p className="text-bf-muted text-sm mb-6">
              1v1 domination. No AI. No fog of war. Rating changes apply.
            </p>

            {weeklyChallenge && (
              <div className="mb-6 rounded-lg border border-bf-gold/25 bg-bf-dark/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-bf-muted mb-1">Weekly seeded challenge</p>
                    <p className="text-bf-gold font-medium">Week of {weeklyChallenge.week_start_date}</p>
                    <p className="text-bf-muted text-xs mt-1">
                      {weeklyChallenge.rules_json?.objective ?? 'Same seed, fair conditions for everyone.'}
                    </p>
                    {typeof weeklyChallenge.rules_json?.turn_limit === 'number' && (
                      <p className="text-bf-muted text-xs mt-1">Turn limit: {weeklyChallenge.rules_json.turn_limit}</p>
                    )}
                    {weeklyChallenge.rules_json?.scoring && (
                      <p className="text-bf-muted text-xs mt-1">Ranked by: {formatWeeklyScoring(weeklyChallenge.rules_json.scoring)}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/daily?tab=weekly')}
                    className="btn-secondary text-xs py-1.5 px-3 shrink-0"
                  >
                    Open Weekly
                  </button>
                </div>
                {weeklyPreviewLeaderboard.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-bf-border/70">
                    <p className="text-[11px] uppercase tracking-wider text-bf-muted mb-2">Top this week</p>
                    <div className="space-y-1.5">
                      {weeklyPreviewLeaderboard.map((row, idx) => (
                        <div key={`${row.username}-${idx}`} className="flex items-center justify-between text-xs">
                          <span className="text-bf-text">#{idx + 1} {row.username}</span>
                          <span className="text-bf-gold font-mono">{row.score}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="mb-4">
              <label className="label">Era</label>
              <select className="input max-w-xs" value={rankedEra} onChange={(e) => setRankedEra(e.target.value)} disabled={rankedQueued}>
                {ERAS.map((era) => (
                  <option
                    key={era.id}
                    value={era.id}
                    disabled={era.id === GALACTIC_AGE_ERA_ID && !canAccessGalacticAge(user)}
                  >
                    {era.label}{activeSeasonal.some((s) => s.era_id === era.id) ? ' 🎯' : ''}
                  </option>
                ))}
              </select>
            </div>

            {rankedQueued ? (
              <div className="flex items-center gap-4 p-4 bg-bf-dark rounded-lg border border-bf-gold/20">
                <div className="animate-pulse text-bf-gold"></div>
                <div className="flex-1">
                  <p className="text-bf-text text-sm font-medium">Searching for opponent...</p>
                  <p className="text-bf-muted text-xs">
                    {{ blitz_120: 'Blitz 2m', standard_300: 'Standard 5m', long_1200: 'Long 20m',
                       async_43200: 'Async 12h', async_86400: 'Async 24h', async_259200: 'Async 3d',
                    }[rankedBucket] ?? rankedBucket.replace('_', ' ')} &middot; {queueElapsed}s elapsed
                  </p>
                </div>
                <button onClick={leaveRankedQueue} className="btn-secondary text-sm py-1.5 px-4">Cancel</button>
              </div>
            ) : (
              <div>
                {rankedIntegrity && (
                  <div className="mb-4 rounded-lg border border-bf-border bg-bf-dark/60 p-3">
                    <p className="text-[11px] uppercase tracking-wider text-bf-muted mb-2">Queue integrity</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className={`px-2 py-1 rounded border ${
                        rankedIntegrity.smurf_risk_tier === 'high'
                          ? 'border-red-500/40 text-red-300 bg-red-500/10'
                          : rankedIntegrity.smurf_risk_tier === 'medium'
                            ? 'border-amber-500/40 text-amber-300 bg-amber-500/10'
                            : 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10'
                      }`}>
                        Smurf risk: {rankedIntegrity.smurf_risk_tier}
                      </span>
                      <span className="px-2 py-1 rounded border border-sky-500/35 text-sky-300 bg-sky-500/10">
                        Stall penalties: {rankedIntegrity.stall_penalties}
                      </span>
                      {rankedIntegrity.provisional && (
                        <span className="px-2 py-1 rounded border border-bf-gold/35 text-bf-gold bg-bf-gold/10">
                          Provisional placement
                        </span>
                      )}
                    </div>
                  </div>
                )}
                <p className="text-bf-muted text-xs mb-2 uppercase tracking-wider font-medium">Real-Time</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                  {([
                    { bucket: 'blitz_120',    label: 'Blitz',    desc: '2 min per turn' },
                    { bucket: 'standard_300', label: 'Standard', desc: '5 min per turn' },
                    { bucket: 'long_1200',    label: 'Long',     desc: '20 min per turn' },
                  ] as const).map(({ bucket, label, desc }) => (
                    <button
                      key={bucket}
                      onClick={() => joinRankedQueue(bucket)}
                      className="p-4 rounded-lg bg-bf-dark border border-bf-border hover:border-bf-gold
                                 transition-colors text-left group"
                    >
                      <p className="font-display text-bf-gold group-hover:text-white transition-colors">{label}</p>
                      <p className="text-bf-muted text-xs mt-1">{desc}</p>
                    </button>
                  ))}
                </div>
                <p className="text-bf-muted text-xs mb-2 uppercase tracking-wider font-medium">Async</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {([
                    { bucket: 'async_43200',  label: '12 Hours', desc: '12h per turn' },
                    { bucket: 'async_86400',  label: '24 Hours', desc: '1 day per turn' },
                    { bucket: 'async_259200', label: '3 Days',   desc: '3 days per turn' },
                  ] as const).map(({ bucket, label, desc }) => (
                    <button
                      key={bucket}
                      onClick={() => joinRankedQueue(bucket)}
                      className="p-4 rounded-lg bg-bf-dark border border-bf-border hover:border-bf-gold
                                 transition-colors text-left group"
                    >
                      <p className="font-display text-bf-gold group-hover:text-white transition-colors">{label}</p>
                      <p className="text-bf-muted text-xs mt-1">{desc}</p>
                    </button>
                  ))}
                </div>
                <p className="text-bf-muted text-xs mt-3 italic">
                  Async matches notify you when it&apos;s your turn — play on your own schedule.
                </p>
              </div>
            )}
          </div>
        )}

            {/* Create Game Modal */}
            <Modal
              open={lobbyTab === 'casual' && showCreate}
              onClose={() => { setShowCreate(false); setCustomPairingEnabled(false); }}
              title="Configure New Game"
              className="max-w-2xl w-full"
              showCloseButton
            >
              <form onSubmit={handleCreateGame} className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
                  <div className="md:col-span-2 flex items-center justify-between gap-3 rounded-lg border border-bf-border bg-bf-dark/40 px-3 py-2.5">
                    <div>
                      <p className="text-xs font-medium text-bf-text">Custom rules + theater pairing</p>
                      <p className="text-[11px] text-bf-muted mt-0.5">
                        Mix any rules era with any theater map (e.g. WW2 rules on the Ancient world map).
                      </p>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-bf-text shrink-0 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={customPairingEnabled}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setCustomPairingEnabled(on);
                          if (!on) {
                            setSelectedTheaterMapId(ERA_MAP_IDS[selectedEra] ?? ERA_MAP_IDS.ww2);
                          }
                        }}
                        className="accent-bf-gold"
                      />
                      Enable
                    </label>
                  </div>
                  {mapImmersion && (
                    <div className="md:col-span-2 rounded-lg border border-bf-gold/25 bg-gradient-to-br from-bf-gold/[0.08] to-transparent px-3 py-3">
                      <p className="text-bf-gold text-sm font-display tracking-wide">{mapImmersion.tagline}</p>
                      <p className="text-bf-muted text-xs mt-1.5 leading-relaxed">{mapImmersion.backdrop}</p>
                      <p className="text-bf-muted text-[11px] mt-2">
                        Suggested rules era:{' '}
                        <span className="text-bf-text font-medium">
                          {ERA_LABELS[mapImmersion.recommended_rules_era] ?? mapImmersion.recommended_rules_era}
                        </span>
                        {' '}— matches era cards, tech, and faction roster. You can still change it above.
                      </p>
                    </div>
                  )}
                  <div>
                    <label className="label">
                      Rules Era
                      {activeSeasonal.some((s) => s.era_id === selectedEra) && (
                        <span className="ml-2 text-xs bg-amber-500 text-black px-1.5 py-0.5 rounded font-bold">
                          🎯 Seasonal
                        </span>
                      )}
                    </label>
                    <select
                      className="input"
                      value={selectedEra}
                      onChange={(e) => setSelectedEra(e.target.value)}
                    >
                      {ERAS.map((era) => (
                        <option
                          key={era.id}
                          value={era.id}
                          disabled={era.id === GALACTIC_AGE_ERA_ID && !canAccessGalacticAge(user)}
                        >
                          {era.label}{activeSeasonal.some((s) => s.era_id === era.id) ? ' 🎯' : ''}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-bf-muted mt-1">Factions, tech trees, events, and combat modifiers.</p>
                  </div>
                  {customPairingEnabled ? (
                    <div>
                      <label className="label">Theater Map</label>
                      <select
                        className="input"
                        value={selectedTheaterMapId}
                        onChange={(e) => {
                          const mapId = e.target.value;
                          setSelectedTheaterMapId(mapId);
                          const suggested = recommendedRulesEraForTheater(mapId);
                          if (suggested) setSelectedEra(suggested);
                        }}
                      >
                        {LOBBY_THEATER_OPTIONS.map((opt) => (
                          <option key={opt.map_id} value={opt.map_id}>{opt.label}</option>
                        ))}
                      </select>
                      <p className="text-xs text-bf-muted mt-1">Territories, geography, and globe layout.</p>
                    </div>
                  ) : (
                    <div>
                      <label className="label">Theater Map</label>
                      <p className="input bg-bf-dark/50 border-bf-border text-bf-text cursor-default">
                        {ERAS.find((e) => e.id === selectedEra)?.label ?? selectedEra}
                        <span className="text-bf-muted text-sm ml-2">(bundled)</span>
                      </p>
                    </div>
                  )}
                  <div className="md:col-span-2">
                    <p className="text-xs text-bf-muted mb-2">
                      Preview: <span className="text-bf-gold">{formatLobbyPairingLabel(selectedEra, selectedTheaterMapId)}</span>
                    </p>
                    <LobbyEraMapWarnings
                      hardBlock={createPairingCompatibility.hardBlock}
                      warnings={createPairingCompatibility.warnings}
                    />
                  </div>
                  <div>
                    <label className="label">AI Opponents</label>
                    <select className="input" value={aiCount} onChange={(e) => setAiCount(Number(e.target.value))}>
                      {[0,1,2,3,4,5,6,7].map((n) => (
                        <option key={n} value={n}>{n === 0 ? 'No AI — humans only' : `${n} AI opponent${n !== 1 ? 's' : ''}`}</option>
                      ))}
                    </select>
                    <p className="text-xs text-bf-muted mt-1">
                      {aiCount > 0 ? 'Ready to play instantly — no waiting for a lobby to fill.' : 'Invite friends or wait for players to join.'}
                    </p>
                  </div>
                  {aiCount > 0 && (
                    <div className="md:col-span-2">
                      <label className="label">AI Difficulty</label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {([
                          { id: 'easy', label: 'Easy', desc: 'Forgiving — learn the ropes' },
                          { id: 'medium', label: 'Medium', desc: 'A balanced challenge' },
                          { id: 'hard', label: 'Hard', desc: 'Sharp, calculated play' },
                          { id: 'expert', label: 'Expert', desc: 'Ruthless optimizer' },
                        ] as const).map((d) => {
                          const active = aiDifficulty === d.id;
                          return (
                            <button
                              key={d.id}
                              type="button"
                              onClick={() => setAiDifficulty(d.id)}
                              aria-pressed={active}
                              className={clsx(
                                'rounded-lg border px-3 py-2.5 text-left transition-colors',
                                active
                                  ? 'border-bf-gold bg-bf-gold/10'
                                  : 'border-bf-border bg-bf-dark hover:border-bf-gold/40',
                              )}
                            >
                              <span className={clsx('block text-sm font-medium', active ? 'text-bf-gold' : 'text-bf-text')}>
                                {d.label}
                              </span>
                              <span className="block text-[11px] leading-snug text-bf-muted mt-0.5">{d.desc}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
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
                      <p className="text-xs text-bf-gold mt-1">Players will be notified when it's their turn.</p>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:col-span-2">
                    {/* Info tooltip is a <button>; keep it outside the checkbox <label> so htmlFor targets the input. */}
                    <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 text-sm text-bf-text w-full">
                      <FeatureTooltip text={advancedFeatureTooltip(isCommunityTheaterMap(selectedTheaterMapId) ? selectedTheaterMapId : null, 'territory_draft')} />
                      <label htmlFor="territory-draft-top" className="contents cursor-pointer">
                        <input
                          type="checkbox"
                          id="territory-draft-top"
                          checked={territorySelection}
                          onChange={(e) => { setTerritorySelection(e.target.checked); if (e.target.checked) setFactionsEnabled(false); }}
                          disabled={factionsEnabled}
                          className="w-4 h-4 mt-0.5 accent-bf-gold shrink-0"
                        />
                        <span className="leading-snug min-w-0 select-none">Territory Draft</span>
                      </label>
                    </div>
                    <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 text-sm text-bf-text w-full">
                      <FeatureTooltip text={advancedFeatureTooltip(isCommunityTheaterMap(selectedTheaterMapId) ? selectedTheaterMapId : null, 'asymmetric_factions')} />
                      <label htmlFor="asymmetric-factions-top" className="contents cursor-pointer">
                        <input
                          type="checkbox"
                          id="asymmetric-factions-top"
                          checked={factionsEnabled}
                          onChange={(e) => {
                            setFactionsEnabled(e.target.checked);
                            if (e.target.checked) setTerritorySelection(false);
                          }}
                          disabled={territorySelection}
                          className="w-4 h-4 mt-0.5 accent-bf-gold shrink-0"
                        />
                        <span className="leading-snug min-w-0 select-none">Asymmetric Factions</span>
                      </label>
                    </div>
                  </div>
                    <div className="md:col-span-2 border-t border-bf-border pt-4 mt-2">
                      <label className="label mb-2">Advanced Features</label>
                      {mapImmersion && (
                        <p className="text-[11px] text-bf-muted mb-3 leading-relaxed">
                          Hover each (i) for theater-specific lore layered on the normal rules — tuned for this map.
                        </p>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                        <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 text-sm text-bf-text w-full">
                          <FeatureTooltip text={advancedFeatureTooltip(isCommunityTheaterMap(selectedTheaterMapId) ? selectedTheaterMapId : null, 'economy_buildings')} />
                          <label htmlFor="create-game-economy" className="contents cursor-pointer">
                            <input id="create-game-economy" type="checkbox" checked={economyEnabled} onChange={(e) => setEconomyEnabled(e.target.checked)} className="w-4 h-4 mt-0.5 accent-bf-gold shrink-0" />
                            <span className="leading-snug min-w-0 select-none">Economy &amp; Buildings</span>
                          </label>
                        </div>
                        <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 text-sm text-bf-text w-full">
                          <FeatureTooltip text={advancedFeatureTooltip(isCommunityTheaterMap(selectedTheaterMapId) ? selectedTheaterMapId : null, 'tech_trees')} />
                          <label htmlFor="create-game-tech-trees" className="contents cursor-pointer">
                            <input id="create-game-tech-trees" type="checkbox" checked={techTreesEnabled} onChange={(e) => setTechTreesEnabled(e.target.checked)} className="w-4 h-4 mt-0.5 accent-bf-gold shrink-0" />
                            <span className="leading-snug min-w-0 select-none">Technology Trees</span>
                          </label>
                        </div>
                        <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 text-sm text-bf-text w-full">
                          <FeatureTooltip text={advancedFeatureTooltip(isCommunityTheaterMap(selectedTheaterMapId) ? selectedTheaterMapId : null, 'historical_events')} />
                          <label htmlFor="create-game-events" className="contents cursor-pointer">
                            <input id="create-game-events" type="checkbox" checked={eventsEnabled} onChange={(e) => setEventsEnabled(e.target.checked)} className="w-4 h-4 mt-0.5 accent-bf-gold shrink-0" />
                            <span className="leading-snug min-w-0 select-none">Historical Events</span>
                          </label>
                        </div>
                        <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 text-sm text-bf-text w-full">
                          <FeatureTooltip text={advancedFeatureTooltip(isCommunityTheaterMap(selectedTheaterMapId) ? selectedTheaterMapId : null, 'naval_warfare')} />
                          <label htmlFor="create-game-naval" className="contents cursor-pointer">
                            <input id="create-game-naval" type="checkbox" checked={navalEnabled} onChange={(e) => setNavalEnabled(e.target.checked)} className="w-4 h-4 mt-0.5 accent-bf-gold shrink-0" />
                            <span className="leading-snug min-w-0 select-none">Naval Warfare</span>
                          </label>
                        </div>
                        <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 text-sm text-bf-text w-full">
                          <FeatureTooltip text={advancedFeatureTooltip(isCommunityTheaterMap(selectedTheaterMapId) ? selectedTheaterMapId : null, 'population_stability')} />
                          <label htmlFor="create-game-stability" className="contents cursor-pointer">
                            <input id="create-game-stability" type="checkbox" checked={stabilityEnabled} onChange={(e) => setStabilityEnabled(e.target.checked)} className="w-4 h-4 mt-0.5 accent-bf-gold shrink-0" />
                            <span className="leading-snug min-w-0 select-none">Population &amp; Stability</span>
                          </label>
                        </div>
                        <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 text-sm text-bf-text w-full">
                          <FeatureTooltip text={advancedFeatureTooltip(isCommunityTheaterMap(selectedTheaterMapId) ? selectedTheaterMapId : null, 'fog_of_war')} />
                          <label htmlFor="create-game-fog" className="contents cursor-pointer">
                            <input id="create-game-fog" type="checkbox" checked={fogOfWar} onChange={(e) => setFogOfWar(e.target.checked)} className="w-4 h-4 mt-0.5 accent-bf-gold shrink-0" />
                            <span className="leading-snug min-w-0 select-none">Fog of War</span>
                          </label>
                        </div>
                        <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 text-sm text-bf-text w-full">
                          <FeatureTooltip text="Allow players to propose and honor truces during the game. Disable for a no-quarter free-for-all where no alliances can be formed." />
                          <label htmlFor="create-game-diplomacy" className="contents cursor-pointer">
                            <input id="create-game-diplomacy" type="checkbox" checked={diplomacyEnabled} onChange={(e) => setDiplomacyEnabled(e.target.checked)} className="w-4 h-4 mt-0.5 accent-bf-gold shrink-0" />
                            <span className="leading-snug min-w-0 select-none">Diplomacy</span>
                          </label>
                        </div>
                        {aiCount > 0 && (
                          <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 text-sm text-bf-text w-full">
                            <FeatureTooltip text="Surfaces a single advisory tip at the start of each of your draft phases (probability swings, region threats, thin borders). Available only in solo-vs-AI casual games to avoid asymmetric advantages." />
                            <label htmlFor="create-game-coaching" className="contents cursor-pointer">
                              <input id="create-game-coaching" type="checkbox" checked={coachingEnabled} onChange={(e) => setCoachingEnabled(e.target.checked)} className="w-4 h-4 mt-0.5 accent-bf-gold shrink-0" />
                              <span className="leading-snug min-w-0 select-none">In-Turn Coaching <span className="text-xs text-bf-muted">(solo vs AI only)</span></span>
                            </label>
                          </div>
                        )}
                        {eraAdvancementLobbyEnabled && selectedEra === 'ancient' && (
                          <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 text-sm text-bf-text w-full">
                            <FeatureTooltip text="Optional: advance your civilization to the next era mid-match when you've built your economy and researched foundational tech. Stronger units and new options, but advancement weakens your army briefly and costs gold. Opponents choose their own pace." />
                            <label htmlFor="create-game-era-advancement" className="contents cursor-pointer">
                              <input
                                id="create-game-era-advancement"
                                type="checkbox"
                                checked={eraAdvancementEnabled}
                                onChange={(e) => {
                                  setEraAdvancementEnabled(e.target.checked);
                                  if (e.target.checked) {
                                    // Default to the full-game experience; each
                                    // remains individually uncheckable below.
                                    setEconomyEnabled(true);
                                    setTechTreesEnabled(true);
                                    setStabilityEnabled(true);
                                    setNavalEnabled(true);
                                    setEventsEnabled(true);
                                  }
                                }}
                                className="w-4 h-4 mt-0.5 accent-bf-gold shrink-0"
                              />
                              <span className="leading-snug min-w-0 select-none">Era Advancement <span className="text-xs text-bf-muted">(advance through the ages mid-match)</span></span>
                            </label>
                            {eraAdvancementEnabled && (
                              <div className="col-start-2 col-span-2 mt-2">
                                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Era advancement preset">
                                  {([
                                    ['skirmish', 'Skirmish', 'Ancient → Medieval, faster & forgiving'],
                                    ['standard', 'Standard', 'Ancient → Modern, balanced'],
                                    ['epic', 'Epic', 'Ancient → Space Age, steeper & longer'],
                                  ] as const).map(([id, label, desc]) => (
                                    <button
                                      key={id}
                                      type="button"
                                      role="radio"
                                      aria-checked={eraAdvancementPreset === id}
                                      data-testid={`era-preset-${id}`}
                                      title={desc}
                                      onClick={() => setEraAdvancementPreset(id)}
                                      className={clsx(
                                        'px-2.5 py-1 text-xs rounded-md border transition-colors',
                                        eraAdvancementPreset === id
                                          ? 'border-bf-gold/60 bg-bf-gold/15 text-bf-gold'
                                          : 'border-bf-border bg-bf-dark/60 text-bf-muted hover:text-bf-text',
                                      )}
                                    >
                                      {label}
                                    </button>
                                  ))}
                                </div>
                                <p className="text-[11px] text-bf-muted mt-1">
                                  {eraAdvancementPreset === 'skirmish' && 'Two-era climb with cheaper, lighter gates — quick games.'}
                                  {eraAdvancementPreset === 'standard' && 'Full six-era timeline with balanced costs and gates.'}
                                  {eraAdvancementPreset === 'epic' && 'The full Ancient → Space Age climb with steeper costs and a stricter stability gate — long or async play.'}
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  <div className="md:col-span-2">
                    <label className="label">Victory conditions</label>
                    <p className="text-xs text-bf-muted mb-2">A player wins if they meet any checked condition (last player standing always wins).</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {([
                        ['domination', 'Domination — control every territory', 'Own every single territory on the map simultaneously. A difficult but decisive conquest victory.'],
                        ['threshold', 'Territory threshold', 'Win by controlling a set percentage of territories (configurable below). Rewards sustained expansion over total domination.'],
                        ['capital', 'Capital — occupy all opponents\' capitals', 'Each player has a home capital. Capture every rival capital to win — even if they still hold other territories.'],
                        ['secret_mission', 'Secret mission', 'Each player is secretly assigned a unique objective (e.g. control two specific regions, or eliminate a target player). Completing yours wins the game.'],
                      ] as const).map(([id, label, tip]) => (
                        <div key={id} className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 text-sm text-bf-text w-full">
                          <FeatureTooltip text={tip} />
                          <label htmlFor={`create-game-victory-${id}`} className="contents cursor-pointer">
                            <input
                              id={`create-game-victory-${id}`}
                              type="checkbox"
                              className="w-4 h-4 mt-0.5 accent-bf-gold shrink-0"
                              checked={victoryModes.has(id)}
                              onChange={() => toggleVictoryMode(id)}
                            />
                            <span className="leading-snug min-w-0 select-none">{label}</span>
                          </label>
                        </div>
                      ))}
                    </div>
                    {victoryModes.has('threshold') && (
                      <div className="mt-3 flex items-center gap-3">
                        <label htmlFor="vthr" className="text-sm text-bf-muted whitespace-nowrap">Threshold %</label>
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
                  <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 border-t border-bf-border bg-bf-surface/95 backdrop-blur md:col-span-2">
                    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-end">
                      <button
                        type="button"
                        className="btn-secondary w-full sm:w-auto"
                        onClick={() => { setShowCreate(false); setCustomPairingEnabled(false); }}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn-primary w-full sm:flex-1"
                        disabled={creating || Boolean(createPairingCompatibility.hardBlock)}
                      >
                      {creating ? 'Creating...' : 'Create & Enter Lobby'}
                      </button>
                    </div>
                  </div>
                </form>
            </Modal>

            {/* Join with code / link */}
            {lobbyTab === 'casual' && (
              <div className="card mb-8 animate-fade-in">
            <h3 className="font-display text-xl text-bf-gold mb-2 flex items-center gap-2">
              Join with code
            </h3>
            <p className="text-bf-muted text-sm mb-4">
              Paste the short join code, or the full game ID from your host. You can also use a lobby link with <code className="text-bf-gold/90">?join=</code>.
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
          <h3 className="font-display text-xl text-bf-gold mb-6 flex items-center gap-2">
            Open Games
          </h3>
          {publicGames.length === 0 ? (
            <p className="text-bf-muted text-center py-8">No open games. Create one to get started!</p>
          ) : (
            <div className="space-y-3">
              {publicGames.map((game) => (
                <div key={game.game_id} className="flex items-center justify-between p-4 bg-bf-dark rounded-lg border border-bf-border hover:border-bf-gold transition-colors">
                  <div>
                    <span className="font-medium text-bf-text">{ERA_LABELS[game.era_id] ?? game.era_id}</span>
                    <span className="text-bf-muted text-sm ml-3">{game.player_count} / 8 players</span>
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
            {topLiveGame && (
              <Link
                to={`/spectate/${topLiveGame.game_id}`}
                className="card block hover:border-bf-gold/40 transition-colors group"
              >
                <div className="flex items-center gap-2 mb-1">
                  <Radio className="w-4 h-4 text-green-400" aria-hidden />
                  <h3 className="font-display text-bf-gold">Watch a live game</h3>
                </div>
                <p className="text-bf-text text-sm">
                  {ERA_LABELS[topLiveGame.era_id] ?? topLiveGame.era_id} · {Number(topLiveGame.human_count)} human
                  {Number(topLiveGame.human_count) === 1 ? '' : 's'}
                  {Number(topLiveGame.player_count) > Number(topLiveGame.human_count)
                    ? ` + ${Number(topLiveGame.player_count) - Number(topLiveGame.human_count)} AI`
                    : ''}
                </p>
                <p className="text-bf-muted text-xs mt-1">
                  Turn {topLiveGame.turn_count} · in progress now
                </p>
                <span className="inline-flex items-center gap-1 text-bf-gold text-xs mt-2 group-hover:underline">
                  <Eye className="w-3.5 h-3.5" /> Watch this match
                </span>
              </Link>
            )}
            {user && !user.is_guest ? (
              <>
                {!isNewUser && (
                  <Link
                    to="/daily"
                    className="card block hover:border-bf-gold/40 transition-colors group"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <h3 className="font-display text-bf-gold flex items-center gap-2">
                        <Calendar className="w-4 h-4" /> Daily Challenge
                      </h3>
                      {dailySummary?.completed && (
                        <span className="text-[10px] uppercase tracking-wide text-green-300 border border-green-700/40 bg-green-950/30 rounded px-1.5 py-0.5">
                          Done
                        </span>
                      )}
                    </div>
                    <p className="text-bf-muted text-sm">
                      {dailySummary
                        ? `Today: ${ERA_LABELS[dailySummary.era_id] ?? dailySummary.era_id} · same map for everyone.`
                        : 'One puzzle per day, same map for everyone.'}
                    </p>
                    {dailySummary && dailySummary.attempts_today > 0 && (
                      <p className="text-xs text-bf-gold/80 mt-2">
                        {dailySummary.attempts_today} commander{dailySummary.attempts_today === 1 ? '' : 's'} attempted today
                      </p>
                    )}
                  </Link>
                )}
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

      <footer className="border-t border-bf-border mt-12 py-8 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
          <p className="font-display text-bf-gold/90 text-sm tracking-wide">Dashboard</p>
          <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-bf-muted justify-center sm:justify-end" aria-label="Site">
            <Link to="/lobby" className="hover:text-bf-gold transition-colors">Lobby</Link>
            {!user?.is_guest && (
              <Link to="/war-room" className="hover:text-bf-gold transition-colors">War Room</Link>
            )}
            <Link to="/codex" className="hover:text-bf-gold transition-colors">Codex</Link>
            <Link to="/maps" className="hover:text-bf-gold transition-colors">Map Hub</Link>
            {!user?.is_guest && mapEditorEnabled && (
              <Link to="/editor" className="hover:text-bf-gold transition-colors">Map Editor</Link>
            )}
            <Link to="/friends" className="hover:text-bf-gold transition-colors">Friends</Link>
            <Link to="/profile" className="hover:text-bf-gold transition-colors">Profile</Link>
            <Link to="/privacy" className="hover:text-bf-gold transition-colors">Privacy Policy</Link>
            <span className="text-bf-border">·</span>
            <Link to="/terms" className="hover:text-bf-gold transition-colors">Terms of Service</Link>
            <Link to="/" className="hover:text-bf-gold transition-colors">Marketing Home</Link>
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
