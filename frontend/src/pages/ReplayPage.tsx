import React, { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo, Suspense } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useGameStore } from '../store/gameStore';
import { api } from '../services/api';
import GameMap from '../components/game/GameMap';
import toast from 'react-hot-toast';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronLeft,
  Share2,
  Check,
  Film,
  FilmIcon,
  Globe as GlobeIcon,
  Map as MapIcon,
  Info,
  X,
  Sparkles,
  Lock,
  LogIn,
  Clapperboard,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuthStore } from '../store/authStore';
import { loadReplaySnapshots, ReplayNotPublicError } from '../utils/replayLoader';
import { buildCondensedTimeline, condenseReasonLabel } from '../utils/replayCondense';
import ReplayClipExporter from '../components/game/ReplayClipExporter';
import ReplayInsightsPanel, { type ReplayInsight } from '../components/game/ReplayInsightsPanel';
import ReplayTipToast from '../components/game/ReplayTipToast';
import {
  buildTimeLapseIndices,
  nextTimeLapseIndex,
} from '../utils/replayTimeLapse';
import { isMobileViewport, prefersReducedMotion } from '../utils/device';
import { isLiteMode } from '../utils/userPreferences';
import { inferWorldId } from '@borderfall/shared';
import { getGalaxyWorldLore } from '../constants/galaxyLore';
import { resolveGalaxyDrillDownGlobeSkin } from '../utils/galaxyGlobeSkin';
import { useMapVisualEvents } from '../hooks/useMapVisualEvents';
import { useGalaxyMapVisualPulse } from '../hooks/useGalaxyMapVisualPulse';
import {
  diffReplayMapVisuals,
  REPLAY_MAP_FX_LIMITATIONS,
  REPLAY_MAP_FX_NOT_INFERRED,
} from '../utils/replayMapVisualDiff';
import {
  computeContestedBorders,
  phaseTintClass,
} from '../utils/mapAmbientEffects';

import { GalaxyStrategicViewLazy, GlobeMapLazy, preloadGlobeChunks } from '../utils/globeLoader';

const SPEED_OPTIONS = [0.5, 1, 2, 4, 8] as const;
const REPLAY_MAP_FX_HINT_KEY = 'replay_map_fx_hint_dismissed';
type Speed = (typeof SPEED_OPTIONS)[number];

interface MapData {
  map_id?: string;
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
  map_kind?: 'standard' | 'galaxy';
  worlds?: Array<{
    world_id: string;
    display_name: string;
    globe_image_url?: string;
    bump_image_url?: string;
    show_atmosphere?: boolean;
    atmosphere_color?: string;
    atmosphere_altitude?: number;
    background_color?: string;
  }>;
  territories: Array<{
    territory_id: string;
    name: string;
    polygon: number[][];
    center_point: [number, number];
    region_id: string;
    geo_polygon?: [number, number][];
    globe_id?: 'earth' | 'moon';
    world_id?: string;
    galaxy_position?: [number, number];
    globe_image_url?: string;
    bump_image_url?: string;
  }>;
  connections: Array<{ from: string; to: string; type: 'land' | 'sea' | 'orbit' }>;
  regions?: Array<{ region_id: string; name: string; bonus: number }>;
}

export default function ReplayPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fromDaily = searchParams.get('source') === 'daily';
  // `source=match` is set by GamePage's "Watch Replay" CTA on GameOverView.
  // Match replays still open on the globe by default; playback stays 1x (not
  // the daily time-lapse cadence).
  const fromMatch = searchParams.get('source') === 'match';
  // Shared links append ?source=share. Those open straight into the condensed
  // Highlights reel so a first-time viewer sees the best moments immediately.
  const fromShare = searchParams.get('source') === 'share';
  const { replaySnapshots, replayFrame, loadReplay, setReplayFrame, clearGame, gameState } = useGameStore();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const [mapData, setMapData] = useState<MapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Set when a replay exists but isn't public and the viewer can't see it.
  const [notPublic, setNotPublic] = useState(false);
  const [playing, setPlaying] = useState(false);
  // Daily-challenge replays default to a faster, time-lapse cadence; match
  // replays and general replays use real-time 1x.
  const [speed, setSpeed] = useState<Speed>(fromDaily ? 4 : 1);
  // Playback cadence: 'all' walks every frame, 'timelapse' one frame per
  // turn-player pair, 'highlights' the condensed reel with variable dwell.
  const [playbackMode, setPlaybackMode] = useState<'all' | 'timelapse' | 'highlights'>(
    fromShare ? 'highlights' : fromDaily ? 'timelapse' : 'all',
  );
  // Replays default to the 3D globe; viewers can switch to 2D from the toolbar.
  const [mapView, setMapView] = useState<'2d' | 'globe'>('globe');
  const [isPublic, setIsPublic] = useState(false);
  const [loadedPublic, setLoadedPublic] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [clipExporterOpen, setClipExporterOpen] = useState(false);
  const [highlights, setHighlights] = useState<Array<{ turn: number; label: string; type: string }>>([]);
  const [insights, setInsights] = useState<ReplayInsight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [activeTip, setActiveTip] = useState<ReplayInsight | null>(null);
  const [insightsOpen, setInsightsOpen] = useState(true);
  const [galaxyOverviewMode, setGalaxyOverviewMode] = useState(true);
  const [focusedWorldId, setFocusedWorldId] = useState('earth');
  const [galaxyWorldBanner, setGalaxyWorldBanner] = useState<{
    display_name: string;
    tagline: string;
  } | null>(null);
  const lastToastedTurnRef = useRef<number | null>(null);
  // Guards the "auto-start playback once the replay is fully loaded" effect
  // so it fires exactly once per game-id mount, not on every state change.
  const autoStartedRef = useRef(false);

  const [showMapAnimations, setShowMapAnimations] = useState(true);
  const [replayFxHintDismissed, setReplayFxHintDismissed] = useState(() => {
    try {
      return localStorage.getItem(REPLAY_MAP_FX_HINT_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [replayFxHintExpanded, setReplayFxHintExpanded] = useState(false);
  const lastDiffFrameRef = useRef<number | null>(null);
  const {
    mapVisualEvents,
    globeEvents,
    pushMapVisualLocal,
    onMapVisualDone,
    clearMapVisuals,
  } = useMapVisualEvents();

  const playbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Measure the flex-1 map area so the canvas always fills exactly the space
  // between the top bar and the playback controls — no scrolling, no clipped
  // chrome. Initial guess is conservative until the ResizeObserver fires.
  const mapAreaRef = useRef<HTMLDivElement>(null);
  const [mapCanvasSize, setMapCanvasSize] = useState(() => {
    if (typeof window === 'undefined') return { w: 900, h: 600 };
    return {
      w: Math.max(320, window.innerWidth),
      h: Math.max(240, window.innerHeight - 200),
    };
  });

  useLayoutEffect(() => {
    const el = mapAreaRef.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      const w = Math.max(320, Math.floor(width));
      const h = Math.max(240, Math.floor(height));
      setMapCanvasSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [loading, mapData, mapView]);

  useEffect(() => {
    if (mapView === 'globe') preloadGlobeChunks();
  }, [mapView]);

  useEffect(() => {
    const md = mapData;
    if (!md) return;
    if (md.map_kind === 'galaxy') {
      setGalaxyOverviewMode(true);
      const wid =
        md.worlds?.[0]?.world_id ??
        inferWorldId(md.territories[0] ?? { territory_id: '', region_id: '' });
      setFocusedWorldId(wid);
    } else {
      setGalaxyOverviewMode(false);
      setFocusedWorldId('earth');
    }
  }, [mapData?.map_id]);

  const focusedWorldSkin = useMemo(() => {
    if (!mapData?.worlds) return null;
    return mapData.worlds.find((w) => w.world_id === focusedWorldId) ?? null;
  }, [mapData?.worlds, focusedWorldId]);

  const replayGalaxyGlobeSkin = useMemo(() => {
    if (mapData?.map_kind !== 'galaxy') return null;
    return resolveGalaxyDrillDownGlobeSkin({
      worlds: mapData.worlds,
      territories: mapData.territories,
      focusedWorldId,
      selectedTerritoryId: null,
    });
  }, [mapData?.map_kind, mapData?.worlds, mapData?.territories, focusedWorldId]);

  useEffect(() => {
    if (mapData?.map_kind !== 'galaxy') {
      setGalaxyWorldBanner(null);
      return;
    }
    if (galaxyOverviewMode) {
      setGalaxyWorldBanner(null);
      return;
    }
    const lore = getGalaxyWorldLore(focusedWorldId);
    if (!lore) return;
    setGalaxyWorldBanner({ display_name: lore.display_name, tagline: lore.tagline });
    const t = window.setTimeout(() => setGalaxyWorldBanner(null), 1500);
    return () => window.clearTimeout(t);
  }, [mapData?.map_kind, galaxyOverviewMode, focusedWorldId]);

  // Load replay on mount — retry up to 3× with 2 s delay for spectators redirected
  // immediately after game:over (DB write may still be in flight).
  useEffect(() => {
    if (!gameId) return;
    let mounted = true;
    setLoading(true);
    setNotPublic(false);

    async function fetchInsights(attemptsLeft: number): Promise<ReplayInsight[]> {
      try {
        const res = await api.get<{ insights: ReplayInsight[] }>(`/enhancements/matches/${gameId}/insights`);
        return res.data.insights ?? [];
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        // Insight generation can race with the post-match pipeline; back off and retry.
        if (attemptsLeft > 1 && (status === 404 || status === 503)) {
          await new Promise((r) => setTimeout(r, 2000));
          return fetchInsights(attemptsLeft - 1);
        }
        return [];
      }
    }

    loadReplaySnapshots(gameId, { authenticated: isAuthenticated })
      .then((result) => {
        if (!mounted) return;
        const states = result.snapshots.map((s) => s.state);
        if (states.length === 0) {
          setError('No replay data available for this game.');
          return;
        }
        setLoadedPublic(result.isPublic);
        setIsPublic(result.isPublic);
        loadReplay(states);

        // Coaching insights + server highlights only exist behind authed
        // endpoints; skip them for public (non-participant) viewers.
        if (!result.isPublic) {
          api
            .get<{ highlights: Array<{ turn: number; label: string; type: string }> }>(`/enhancements/replays/${gameId}/highlights`)
            .then((highlightsRes) => {
              if (!mounted) return;
              setHighlights(highlightsRes.data.highlights ?? []);
            })
            .catch(() => {});
          setInsightsLoading(true);
          fetchInsights(3)
            .then((items) => {
              if (!mounted) return;
              setInsights(items);
            })
            .finally(() => {
              if (mounted) setInsightsLoading(false);
            });
        } else {
          setInsightsLoading(false);
        }

        // Load map geometry from the first snapshot. Public viewers use the
        // unauthenticated public-map endpoint; participants use the authed one.
        const mapId = states[0]?.map_id;
        if (mapId) {
          const mapReq = result.isPublic
            ? api.get(`/share/${gameId}/public-map`)
            : api.get(`/maps/${mapId}`);
          return mapReq.then((mapRes) => {
            if (!mounted) return;
            setMapData(mapRes.data.map);
          });
        }
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        if (err instanceof ReplayNotPublicError) {
          setNotPublic(true);
          return;
        }
        const msg =
          err && typeof err === 'object' && 'response' in err
            ? ((err as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Failed to load replay')
            : 'Failed to load replay';
        setError(typeof msg === 'string' ? msg : 'Failed to load replay');
        toast.error(typeof msg === 'string' ? msg : 'Failed to load replay');
      })
      .finally(() => { if (mounted) setLoading(false); });

    return () => { mounted = false; clearGame(); };
  }, [gameId, isAuthenticated]);

  // Time-lapse cadence — index list into replaySnapshots, recomputed when the
  // snapshot list changes. We always keep a fallback to all-frames so the
  // scrubber resolves correctly when time-lapse mode is off.
  const timeLapseIndices = useMemo(
    () => buildTimeLapseIndices(replaySnapshots),
    [replaySnapshots],
  );

  const nextTimeLapseFrom = useCallback(
    (currentIdx: number) => nextTimeLapseIndex(timeLapseIndices, currentIdx),
    [timeLapseIndices],
  );

  // Condensed highlight reel — sub-60s curated timeline with variable dwell.
  // Server highlight turns boost their frames' scores when available.
  const condensedTimeline = useMemo(
    () =>
      buildCondensedTimeline(replaySnapshots, {
        highlightTurns: highlights.map((h) => h.turn),
      }),
    [replaySnapshots, highlights],
  );
  const highlightIndices = useMemo(
    () => condensedTimeline.frames.map((f) => f.index),
    [condensedTimeline],
  );
  const condensedByIndex = useMemo(() => {
    const m = new Map<number, (typeof condensedTimeline.frames)[number]>();
    for (const f of condensedTimeline.frames) m.set(f.index, f);
    return m;
  }, [condensedTimeline]);

  // Indices the active playback mode steps through.
  const stepIndices = useMemo(() => {
    if (playbackMode === 'highlights') return highlightIndices;
    if (playbackMode === 'timelapse') return timeLapseIndices;
    return replaySnapshots.map((_, i) => i);
  }, [playbackMode, highlightIndices, timeLapseIndices, replaySnapshots]);

  const nextStepFrom = useCallback(
    (currentIdx: number) => {
      for (const idx of stepIndices) if (idx > currentIdx) return idx;
      return null;
    },
    [stepIndices],
  );
  const prevStepFrom = useCallback(
    (currentIdx: number) => {
      let prev: number | null = null;
      for (const idx of stepIndices) {
        if (idx >= currentIdx) break;
        prev = idx;
      }
      return prev;
    },
    [stepIndices],
  );

  // Map turn numbers → coaching tip for fast lookup as the playhead advances.
  const insightByTurn = useMemo(() => {
    const m = new Map<number, ReplayInsight>();
    for (const i of insights) {
      if (!m.has(i.turn)) m.set(i.turn, i);
    }
    return m;
  }, [insights]);

  // Auto-show the tip toast when playback enters a turn with a coaching tip.
  // Reset the "already shown" tracker when the user manually scrubs back to or
  // past the previously-shown turn so the tip can resurface naturally.
  useEffect(() => {
    if (!gameState) return;
    const turn = gameState.turn_number ?? 0;
    if (lastToastedTurnRef.current !== null && turn < lastToastedTurnRef.current) {
      lastToastedTurnRef.current = null;
    }
    if (turn === lastToastedTurnRef.current) return;
    const tip = insightByTurn.get(turn);
    if (tip) {
      lastToastedTurnRef.current = turn;
      setActiveTip(tip);
    }
  }, [gameState, insightByTurn]);

  // Playback timer. A setTimeout chain (rather than a fixed-interval timer)
  // lets Highlights mode dwell variably — longer on big moments, short on
  // transitions — while 'all'/'timelapse' use a steady per-frame cadence.
  const stopPlayback = useCallback(() => {
    if (playbackRef.current) {
      clearTimeout(playbackRef.current);
      playbackRef.current = null;
    }
    setPlaying(false);
  }, []);

  // Given the current frame, decide the next frame and how long to dwell on
  // the current one before advancing.
  const computeNextFrame = useCallback(
    (current: number): { next: number | null; holdMs: number } => {
      const snaps = useGameStore.getState().replaySnapshots;
      if (playbackMode === 'highlights') {
        const order = highlightIndices;
        if (order.length === 0) return { next: null, holdMs: 1000 };
        const pos = order.findIndex((idx) => idx >= current);
        if (pos === -1) return { next: null, holdMs: 1000 }; // past the reel end
        const dwell = condensedByIndex.get(order[pos])?.dwellMs ?? 800;
        const holdMs = Math.max(120, Math.round(dwell / speed));
        // Off-reel (user scrubbed elsewhere): snap onto the reel briefly.
        if (order[pos] !== current) {
          return { next: order[pos], holdMs: Math.max(120, Math.round(400 / speed)) };
        }
        const nextPos = pos + 1;
        if (nextPos >= order.length) return { next: null, holdMs };
        return { next: order[nextPos], holdMs };
      }
      if (playbackMode === 'timelapse') {
        return { next: nextTimeLapseFrom(current), holdMs: Math.max(60, Math.round(1100 / speed)) };
      }
      const next = current + 1 < snaps.length ? current + 1 : null;
      return { next, holdMs: Math.max(60, Math.round(1500 / speed)) };
    },
    [playbackMode, speed, highlightIndices, condensedByIndex, nextTimeLapseFrom],
  );

  const scheduleTick = useCallback(() => {
    const cur = useGameStore.getState().replayFrame;
    const { next, holdMs } = computeNextFrame(cur);
    if (next === null) {
      stopPlayback();
      return;
    }
    playbackRef.current = setTimeout(() => {
      const s = useGameStore.getState();
      useGameStore.setState({ replayFrame: next, gameState: s.replaySnapshots[next] ?? null });
      scheduleTick();
    }, holdMs);
  }, [computeNextFrame, stopPlayback]);

  const startPlayback = useCallback(() => {
    if (playbackRef.current) clearTimeout(playbackRef.current);
    setPlaying(true);
    scheduleTick();
  }, [scheduleTick]);

  // Restart the timer when speed or mode changes while playing. `playing` and
  // `startPlayback` must be in the dep list because both are read from the
  // effect body — missing deps previously meant a `setPlaying(true)` outside
  // this effect (auto-start) wouldn't pick up later speed/mode toggles in
  // the same render cycle.
  useEffect(() => {
    if (playing) startPlayback();
  }, [speed, playbackMode, playing, startPlayback]);

  // Auto-start playback once the replay is fully loaded. The ref guard makes
  // this fire exactly once per game-id mount; manual pause/play afterwards is
  // unaffected. Triggered when both snapshots and the map texture are in
  // place so the first frame the user sees is already animating.
  useEffect(() => {
    if (autoStartedRef.current) return;
    if (loading) return;
    if (replaySnapshots.length === 0) return;
    if (!mapData) return;
    autoStartedRef.current = true;
    startPlayback();
     
  }, [loading, replaySnapshots.length, mapData]);

  useEffect(() => {
    return () => {
      if (playbackRef.current) clearTimeout(playbackRef.current);
    };
  }, []);

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    stopPlayback();
    clearMapVisuals();
    lastDiffFrameRef.current = null;
    setReplayFrame(Number(e.target.value));
  };

  const handleStepBack = () => {
    stopPlayback();
    clearMapVisuals();
    lastDiffFrameRef.current = null;
    const prev = prevStepFrom(replayFrame);
    setReplayFrame(prev ?? 0);
  };

  const handleStepForward = () => {
    stopPlayback();
    clearMapVisuals();
    lastDiffFrameRef.current = null;
    const next = nextStepFrom(replayFrame);
    if (next !== null) setReplayFrame(next);
  };

  const handleJumpToTurn = useCallback(
    (turn: number) => {
      stopPlayback();
      clearMapVisuals();
      lastDiffFrameRef.current = null;
      // Jump to the FIRST frame of the requested turn in the active track so
      // the user sees how that turn unfolded rather than its end-state.
      const indices = stepIndices;
      let target = -1;
      for (const idx of indices) {
        if ((replaySnapshots[idx]?.turn_number ?? 0) >= turn) {
          target = idx;
          break;
        }
      }
      if (target < 0) target = replaySnapshots.length - 1;
      setReplayFrame(target);
    },
    [replaySnapshots, stepIndices, setReplayFrame, stopPlayback, clearMapVisuals],
  );

  // Infer map visuals from snapshot diffs when the playhead advances.
  useEffect(() => {
    if (!showMapAnimations || replayFrame <= 0) return;
    if (lastDiffFrameRef.current === replayFrame) return;
    lastDiffFrameRef.current = replayFrame;

    const prev = replaySnapshots[replayFrame - 1];
    const next = replaySnapshots[replayFrame];
    if (!next) return;

    const inferred = diffReplayMapVisuals(prev, next);
    for (const [i, ev] of inferred.entries()) {
      pushMapVisualLocal({
        ...ev,
        id: `replay-${replayFrame}-${i}-${ev.kind}-${ev.territoryId}`,
      });
    }
  }, [replayFrame, replaySnapshots, showMapAnimations, pushMapVisualLocal]);

  const activeReplayState = gameState ?? replaySnapshots[replayFrame] ?? null;

  const replayAmbientEnabled = useMemo(() => {
    if (!activeReplayState || activeReplayState.phase === 'game_over') return false;
    return showMapAnimations && !prefersReducedMotion() && !isLiteMode();
  }, [activeReplayState, showMapAnimations]);

  const galaxyPulse = useGalaxyMapVisualPulse(
    mapVisualEvents,
    mapData,
    showMapAnimations && mapData?.map_kind === 'galaxy',
  );

  const replayTurnHolder = activeReplayState?.players[activeReplayState.current_player_index ?? 0];
  const replayContestedBorders = useMemo(() => {
    if (!activeReplayState || !mapData || !replayAmbientEnabled) return [];
    return computeContestedBorders(
      activeReplayState.territories,
      mapData.connections,
      replayTurnHolder?.player_id,
      activeReplayState.phase,
    );
  }, [activeReplayState, mapData, replayAmbientEnabled, replayTurnHolder?.player_id]);

  const handleShareReplay = async () => {
    if (!gameId) return;
    setSharing(true);
    try {
      await api.post(`/share/${gameId}/make-public`);
      setIsPublic(true);
      // ?source=share opens the link straight into the condensed Highlights reel.
      const url = `${window.location.origin}/replay/${gameId}?source=share`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('Replay link copied!');
      api.post(`/share/${gameId}`, { platform: 'clipboard' }).catch(() => {});
    } catch {
      toast.error('Failed to make replay public');
    } finally {
      setSharing(false);
    }
  };

  // Public viewers: the replay is already public, so just copy the link.
  const handleCopyLink = async () => {
    if (!gameId) return;
    try {
      const url = `${window.location.origin}/replay/${gameId}?source=share`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('Replay link copied!');
    } catch {
      toast.error('Failed to copy link');
    }
  };

  // Revoke public access (visibility toggle). Only meaningful for participants.
  const handleMakePrivate = async () => {
    if (!gameId) return;
    setSharing(true);
    try {
      await api.post(`/share/${gameId}/make-private`);
      setIsPublic(false);
      toast.success('Replay is now private.');
    } catch {
      toast.error('Failed to make replay private');
    } finally {
      setSharing(false);
    }
  };

  const togglePlay = () => {
    if (playing) {
      stopPlayback();
    } else {
      if (replayFrame >= replaySnapshots.length - 1) setReplayFrame(0);
      startPlayback();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-bf-dark flex items-center justify-center">
        <p className="text-bf-muted">Loading replay…</p>
      </div>
    );
  }

  if (notPublic) {
    return (
      <div className="min-h-screen bg-bf-dark flex flex-col items-center justify-center gap-4 px-6 text-center">
        <Lock className="w-10 h-10 text-bf-gold/70" />
        <div>
          <h1 className="font-display text-bf-text text-xl">This replay isn't public</h1>
          <p className="text-bf-muted text-sm mt-1 max-w-sm">
            The player who shared this match hasn't made it publicly viewable
            {isAuthenticated ? '.' : ', or you need to sign in if you played in it.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!isAuthenticated && (
            <button
              className="btn-primary text-sm flex items-center gap-1.5"
              onClick={() => navigate(`/login?redirect=${encodeURIComponent(`/replay/${gameId}`)}`)}
            >
              <LogIn className="w-4 h-4" /> Sign in
            </button>
          )}
          <button className="btn-secondary text-sm" onClick={() => navigate('/')}>
            Go Home
          </button>
        </div>
      </div>
    );
  }

  if (error || !mapData || replaySnapshots.length === 0) {
    return (
      <div className="min-h-screen bg-bf-dark flex flex-col items-center justify-center gap-4">
        <p className="text-bf-muted">{error ?? 'Replay unavailable.'}</p>
        <button className="btn-secondary text-sm" onClick={() => navigate(-1)}>
          Go Back
        </button>
      </div>
    );
  }

  const totalFrames = replaySnapshots.length;
  const currentState = gameState ?? replaySnapshots[replayFrame];
  const currentTurn = currentState?.turn_number ?? replayFrame;
  const headerLabel = fromDaily
    ? 'Daily Challenge Replay'
    : fromMatch
      ? 'Match Replay'
      : 'Game Replay';
  const clipEraLabel = (() => {
    const raw = replaySnapshots[0]?.era ?? currentState?.era ?? '';
    if (!raw) return 'Borderfall';
    return raw
      .replace(/^era_/, '')
      .split(/[_-]/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  })();
  // Mirror GamePage's reduced-globe heuristic: low-power devices and motion-
  // averse users still get the globe, just without continuous spin/effects.
  const reducedGlobe =
    prefersReducedMotion() || isLiteMode() || (isMobileViewport() && mapView === 'globe') || !showMapAnimations || speed >= 4;
  const replayPhaseTintClass = phaseTintClass(currentState?.phase, replayAmbientEnabled && !reducedGlobe);

  return (
    <div className="h-screen overflow-hidden bg-bf-dark flex flex-col">
      {/* Top bar */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-bf-border bg-bf-surface">
        <button
          onClick={() => {
            // Daily and match replays both have well-defined return targets.
            // Generic replays fall back to history.back() so deep-links and
            // shared replays don't strand the user on /lobby unexpectedly.
            if (fromDaily) {
              navigate('/daily');
              return;
            }
            if (fromMatch) {
              navigate('/lobby');
              return;
            }
            // Public viewers arriving from a shared link have no in-app history
            // to fall back on — send them somewhere sensible instead of off-site.
            if (loadedPublic && !isAuthenticated) {
              navigate('/');
              return;
            }
            navigate(-1);
          }}
          className="flex items-center gap-1.5 text-bf-muted hover:text-bf-text transition-colors text-sm"
        >
          <ChevronLeft className="w-4 h-4" />{' '}
          {fromDaily ? 'Back to Daily' : fromMatch ? 'Back to Lobby' : loadedPublic && !isAuthenticated ? 'Home' : 'Back'}
        </button>
        <div className="h-4 w-px bg-bf-border" />
        <span className="text-bf-gold font-display text-sm tracking-wide">{headerLabel}</span>
        <span className="text-bf-muted text-xs ml-auto">
          Turn {currentTurn} of {replaySnapshots[totalFrames - 1]?.turn_number ?? totalFrames}
        </span>
        <button
          type="button"
          onMouseEnter={preloadGlobeChunks}
          onFocus={preloadGlobeChunks}
          onClick={() => {
            setMapView((v) => {
              const next = v === 'globe' ? '2d' : 'globe';
              if (next === 'globe') preloadGlobeChunks();
              return next;
            });
          }}
          aria-pressed={mapView === 'globe'}
          aria-label={mapView === 'globe' ? 'Switch to 2D map' : 'Switch to globe'}
          title={mapView === 'globe' ? 'Switch to 2D map' : 'Switch to globe'}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-bf-border text-bf-muted hover:text-bf-text hover:bg-white/10 text-xs font-medium transition-all"
        >
          {mapView === 'globe' ? <MapIcon className="w-3.5 h-3.5" /> : <GlobeIcon className="w-3.5 h-3.5" />}
          {mapView === 'globe' ? '2D' : 'Globe'}
        </button>
        {mapView === 'globe' && mapData.map_kind === 'galaxy' && (
          <button
            type="button"
            onClick={() => setGalaxyOverviewMode(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${galaxyOverviewMode ? 'bg-bf-gold/15 border-bf-gold/30 text-bf-gold' : 'bg-white/5 border-bf-border text-bf-muted hover:text-bf-text'}`}
          >
            Galaxy chart
          </button>
        )}
        {/* Coaching tips only exist for participants (authed endpoint). */}
        {!loadedPublic && (
          <button
            type="button"
            onClick={() => setInsightsOpen((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-bf-border text-bf-muted hover:text-bf-text hover:bg-white/10 text-xs font-medium transition-all"
          >
            <FilmIcon className="w-3.5 h-3.5" />
            {insightsOpen ? 'Hide Tips' : 'Show Tips'}
            {insights.length > 0 && (
              <span className="ml-1 text-bf-gold">{insights.length}</span>
            )}
          </button>
        )}
        {/* Export a short, branded highlight clip (video/GIF) for socials. */}
        <button
          type="button"
          onClick={() => setClipExporterOpen(true)}
          title="Export highlight clip (video / GIF)"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-bf-border text-bf-muted hover:text-bf-text hover:bg-white/10 text-xs font-medium transition-all"
        >
          <Clapperboard className="w-3.5 h-3.5" />
          Clip
        </button>
        {/* Public viewers (non-participants) can copy the already-public link;
            participants can make it public, copy it, or revoke. */}
        {loadedPublic ? (
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bf-gold/10 border border-bf-gold/20 text-bf-gold hover:bg-bf-gold/20 text-xs font-medium transition-all"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
            Copy Link
          </button>
        ) : (
          <>
            <button
              onClick={handleShareReplay}
              disabled={sharing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bf-gold/10 border border-bf-gold/20 text-bf-gold hover:bg-bf-gold/20 text-xs font-medium transition-all disabled:opacity-50"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
              {isPublic ? 'Copy Link' : 'Share Replay'}
            </button>
            {isPublic && (
              <button
                onClick={handleMakePrivate}
                disabled={sharing}
                title="Stop sharing this replay publicly"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-bf-border text-bf-muted hover:text-bf-text hover:bg-white/10 text-xs font-medium transition-all disabled:opacity-50"
              >
                <Lock className="w-3.5 h-3.5" />
                Make Private
              </button>
            )}
          </>
        )}
      </div>

      {/* Map area — flex-1 between the top bar and the controls. The canvas
          dimensions come from a ResizeObserver on this container so the
          playback chrome stays fully visible without any page scrolling. */}
      <div ref={mapAreaRef} className={`flex-1 relative overflow-hidden min-h-0${replayPhaseTintClass ? ` ${replayPhaseTintClass}` : ''}`}>
        {mapView === 'globe' ? (
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full">
                <p className="text-bf-muted animate-pulse">Loading globe…</p>
              </div>
            }
          >
            {mapData.map_kind === 'galaxy' && galaxyOverviewMode ? (
              <GalaxyStrategicViewLazy
                mapData={mapData}
                gameState={currentState}
                selectedTerritoryId={null}
                onTerritoryClick={(tid) => {
                  const t = mapData.territories.find((x) => x.territory_id === tid);
                  if (t) {
                    setFocusedWorldId(inferWorldId(t));
                    setGalaxyOverviewMode(false);
                  }
                }}
                width={mapCanvasSize.w}
                height={mapCanvasSize.h}
                orbitAccessAllowed={true}
                pulseWorldId={galaxyPulse.worldId}
                pulseKey={galaxyPulse.key}
                pulseLabel={galaxyPulse.label}
              />
            ) : (
              <>
                {galaxyWorldBanner && (
                  <div
                    className="absolute top-4 left-1/2 z-20 -translate-x-1/2 pointer-events-none max-w-md px-4 py-2 rounded-lg border border-bf-border bg-black/60 text-center shadow-lg"
                    role="status"
                    aria-live="polite"
                  >
                    <div className="font-display text-bf-gold text-sm sm:text-base">
                      {galaxyWorldBanner.display_name}
                    </div>
                    <div className="text-[11px] sm:text-xs text-bf-muted mt-0.5">
                      {galaxyWorldBanner.tagline}
                    </div>
                  </div>
                )}
                <GlobeMapLazy
                mapData={mapData}
                onTerritoryClick={() => {}}
                width={mapCanvasSize.w}
                height={mapCanvasSize.h}
                events={globeEvents}
                onEventDone={onMapVisualDone}
                reducedEffects={reducedGlobe}
                autoSpin={!reducedGlobe}
                ambientEnabled={replayAmbientEnabled && !reducedGlobe}
                turnHolderPlayerId={replayTurnHolder?.player_id ?? null}
                contestedBorders={replayContestedBorders}
                activeWorldId={mapData.map_kind === 'galaxy' ? focusedWorldId : 'earth'}
                globeImageUrl={
                  mapData.map_kind === 'galaxy'
                    ? (replayGalaxyGlobeSkin?.globeImageUrl ?? focusedWorldSkin?.globe_image_url)
                    : undefined
                }
                bumpImageUrl={
                  mapData.map_kind === 'galaxy'
                    ? replayGalaxyGlobeSkin?.bumpImageUrl !== undefined
                      ? replayGalaxyGlobeSkin.bumpImageUrl
                      : focusedWorldSkin?.bump_image_url !== undefined
                        ? focusedWorldSkin.bump_image_url
                        : undefined
                    : undefined
                }
                showAtmosphere={
                  mapData.map_kind === 'galaxy'
                    ? (replayGalaxyGlobeSkin?.showAtmosphere ?? focusedWorldSkin?.show_atmosphere ?? true)
                    : true
                }
                {...(mapData.map_kind === 'galaxy'
                  ? {
                      atmosphereColor:
                        replayGalaxyGlobeSkin?.atmosphereColor ??
                        focusedWorldSkin?.atmosphere_color ??
                        'lightskyblue',
                      atmosphereAltitude:
                        replayGalaxyGlobeSkin?.atmosphereAltitude ??
                        focusedWorldSkin?.atmosphere_altitude ??
                        0.15,
                      backgroundColor:
                        replayGalaxyGlobeSkin?.backgroundColor ?? focusedWorldSkin?.background_color,
                    }
                  : {})}
              />
              </>
            )}
          </Suspense>
        ) : (
          <GameMap
            mapData={mapData}
            onTerritoryClick={() => {}}
            width={mapCanvasSize.w}
            height={mapCanvasSize.h}
            mapVisualEvents={mapVisualEvents}
            onMapVisualDone={onMapVisualDone}
            reducedEffects={reducedGlobe}
            ambientEnabled={replayAmbientEnabled && !reducedGlobe}
            turnHolderPlayerId={replayTurnHolder?.player_id ?? null}
            turnHolderColor={replayTurnHolder?.color}
            contestedBorders={replayContestedBorders}
          />
        )}

        {/* Player list overlay */}
        {currentState && (
          <div className="absolute top-3 right-3 bg-bf-surface/90 border border-bf-border rounded-xl p-3 text-xs space-y-1 max-w-[160px]">
            {currentState.players.map((p) => (
              <div key={p.player_id} className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                <span className={clsx('truncate', p.is_eliminated ? 'text-white/30 line-through' : 'text-white/70')}>
                  {p.username}
                </span>
                <span className="text-white/30 ml-auto tabular-nums shrink-0">{p.territory_count}</span>
              </div>
            ))}
          </div>
        )}

        {/* Phase indicator */}
        {currentState && (
          <div className="absolute top-3 left-3 flex flex-col gap-1.5 items-start">
            <div className="bg-bf-surface/90 border border-bf-border rounded-lg px-3 py-1.5 text-xs text-bf-gold capitalize">
              {currentState.players[currentState.current_player_index]?.username}'s {currentState.phase} phase
            </div>
            {playbackMode === 'highlights' && condensedByIndex.has(replayFrame) && (
              <div className="flex items-center gap-1.5 bg-bf-gold/15 border border-bf-gold/30 rounded-lg px-2.5 py-1 text-[11px] text-bf-gold">
                <Sparkles className="w-3 h-3" />
                {condenseReasonLabel(condensedByIndex.get(replayFrame)!.reason)}
              </div>
            )}
          </div>
        )}

        {/* Coaching insights sidebar (collapsible) */}
        {insightsOpen && (
          <div className="absolute top-16 right-3 z-30">
            <ReplayInsightsPanel
              insights={insights}
              currentTurn={currentTurn}
              loading={insightsLoading && insights.length === 0}
              onJumpToTurn={handleJumpToTurn}
              onShowTip={(tip) => {
                lastToastedTurnRef.current = tip.turn;
                setActiveTip(tip);
              }}
            />
          </div>
        )}

        {/* Floating tip toast — surfaces automatically when playback hits a tip's turn. */}
        {activeTip && (
          <ReplayTipToast
            insight={activeTip}
            onClose={() => setActiveTip(null)}
          />
        )}
      </div>

      {/* Playback controls — pinned to the bottom of the viewport via shrink-0
          so they're always visible without scrolling. */}
      <div className="shrink-0 border-t border-bf-border bg-bf-surface px-4 py-3 flex flex-col gap-2">
        {highlights.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-1">
            {highlights.slice(0, 5).map((h, idx) => (
              <button
                key={`${h.turn}-${idx}`}
                onClick={() => handleJumpToTurn(h.turn)}
                className="px-2 py-1 rounded-md text-xs border border-bf-gold/25 bg-bf-gold/10 text-bf-gold hover:bg-bf-gold/20 transition-colors"
              >
                T{h.turn}: {h.label}
              </button>
            ))}
          </div>
        )}
        {/* Timeline row — primary play/pause sits inline with the scrubber so
            the user can pause/resume without scanning the secondary controls. */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? 'Pause replay' : 'Play replay'}
            aria-pressed={playing}
            title={playing ? 'Pause' : 'Play'}
            className="shrink-0 p-2 rounded-xl bg-bf-gold/20 hover:bg-bf-gold/30 text-bf-gold border border-bf-gold/30 transition-all focus:outline-none focus:ring-2 focus:ring-bf-gold/50"
          >
            {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </button>
          <input
            type="range"
            min={0}
            max={totalFrames - 1}
            value={replayFrame}
            onChange={handleScrub}
            aria-label="Replay scrubber"
            className="flex-1 accent-bf-gold cursor-pointer h-1"
          />
          <span className="text-bf-muted text-xs tabular-nums shrink-0">
            {replayFrame + 1} / {totalFrames}
          </span>
        </div>

        {/* Secondary controls — step / mode / speed. */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleStepBack}
            disabled={replayFrame <= 0}
            aria-label="Step back one frame"
            className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white disabled:opacity-30 transition-all"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          <button
            onClick={handleStepForward}
            disabled={replayFrame >= totalFrames - 1}
            aria-label="Step forward one frame"
            className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white disabled:opacity-30 transition-all"
          >
            <SkipForward className="w-4 h-4" />
          </button>

          {/* Highlights mode — plays the condensed sub-60s reel with variable dwell. */}
          <button
            type="button"
            onClick={() => {
              stopPlayback();
              setPlaybackMode((m) => (m === 'highlights' ? 'all' : 'highlights'));
            }}
            aria-pressed={playbackMode === 'highlights'}
            title={`Highlights reel${condensedTimeline.frames.length ? ` · ${condensedTimeline.frames.length} moments` : ''}`}
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border',
              playbackMode === 'highlights'
                ? 'bg-bf-gold/20 text-bf-gold border-bf-gold/30'
                : 'bg-white/5 text-white/60 hover:text-white/80 border-bf-border',
            )}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Highlights
          </button>

          {/* Time-lapse — walks one frame per turn-player pair. */}
          <button
            type="button"
            onClick={() => {
              stopPlayback();
              setPlaybackMode((m) => (m === 'timelapse' ? 'all' : 'timelapse'));
            }}
            aria-pressed={playbackMode === 'timelapse'}
            title={playbackMode === 'timelapse' ? 'Time-lapse on' : 'Time-lapse off'}
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border',
              playbackMode === 'timelapse'
                ? 'bg-bf-gold/20 text-bf-gold border-bf-gold/30'
                : 'bg-white/5 text-white/60 hover:text-white/80 border-bf-border',
            )}
          >
            <Film className="w-3.5 h-3.5" />
            Time-lapse
          </button>

          <button
            type="button"
            onClick={() => {
              setShowMapAnimations((v) => !v);
              clearMapVisuals();
              lastDiffFrameRef.current = null;
            }}
            aria-pressed={showMapAnimations}
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border',
              showMapAnimations
                ? 'bg-bf-gold/20 text-bf-gold border-bf-gold/30'
                : 'bg-white/5 text-white/60 hover:text-white/80 border-bf-border',
            )}
          >
            Map FX
          </button>

          <div className="flex items-center gap-1 ml-auto">
            {SPEED_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={clsx(
                  'px-2.5 py-1 rounded-lg text-xs font-medium transition-all',
                  speed === s
                    ? 'bg-bf-gold/20 text-bf-gold border border-bf-gold/30'
                    : 'text-white/40 hover:text-white/60 hover:bg-white/5',
                )}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>

        {!replayFxHintDismissed && (
          <div
            className="mt-2 flex items-start gap-2 rounded-lg border border-bf-border bg-white/[0.03] px-3 py-2 text-xs text-white/70"
            data-testid="replay-map-fx-disclaimer"
          >
            <Info className="w-4 h-4 shrink-0 text-bf-gold mt-0.5" aria-hidden />
            <div className="flex-1 min-w-0">
              {showMapAnimations ? (
                <>
                  <p>
                    <span className="text-white/85 font-medium">Replay map animations are inferred</span>
                    {' '}from turn snapshots. Captures and unit changes usually animate; strikes, event cards,
                    naval battles, and fortify moves may not. Use 1×–2× speed for best results.
                  </p>
                  {replayFxHintExpanded && (
                    <ul className="mt-2 space-y-1 list-disc pl-4 text-white/55">
                      <li>Usually inferred: {REPLAY_MAP_FX_LIMITATIONS.join(', ')}</li>
                      <li>Often missing: {REPLAY_MAP_FX_NOT_INFERRED.join(', ')}</li>
                    </ul>
                  )}
                  <button
                    type="button"
                    onClick={() => setReplayFxHintExpanded((v) => !v)}
                    className="mt-1 text-bf-gold/90 hover:text-bf-gold underline-offset-2 hover:underline"
                  >
                    {replayFxHintExpanded ? 'Show less' : 'Learn more'}
                  </button>
                </>
              ) : (
                <p>Map FX off — enable to see inferred capture and unit-change animations.</p>
              )}
            </div>
            <button
              type="button"
              aria-label="Dismiss replay map FX note"
              onClick={() => {
                setReplayFxHintDismissed(true);
                try {
                  localStorage.setItem(REPLAY_MAP_FX_HINT_KEY, '1');
                } catch {
                  /* ignore */
                }
              }}
              className="shrink-0 p-1 rounded hover:bg-white/10 text-white/40 hover:text-white/70"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {gameId && (
        <ReplayClipExporter
          open={clipExporterOpen}
          onClose={() => setClipExporterOpen(false)}
          frames={condensedTimeline.frames}
          snapshots={replaySnapshots}
          mapData={mapData}
          eraLabel={clipEraLabel}
          gameId={gameId}
          onShared={(platform) => {
            api.post(`/share/${gameId}`, { platform }).catch(() => {});
          }}
        />
      )}
    </div>
  );
}
