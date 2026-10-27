import React, { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo, Suspense } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useGameStore } from '../store/gameStore';
import { api } from '../services/api';
import ChroniclePanel from '../components/game/ChroniclePanel';
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
  ScrollText,
  Lightbulb,
  Orbit,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuthStore } from '../store/authStore';
import { loadReplaySnapshots, ReplayNotPublicError } from '../utils/replayLoader';
import { boardKeyOf, projectMapToBoard } from '../utils/projectMapToBoard';
import { replayBackTarget } from '../utils/replayBackTarget';
import { buildCondensedTimeline, condenseReasonLabel } from '../utils/replayCondense';
import ReplayClipExporter from '../components/game/ReplayClipExporter';
import ReplayInsightsPanel, { type ReplayInsight } from '../components/game/ReplayInsightsPanel';
import ReplayTipToast from '../components/game/ReplayTipToast';
import ReplayPlayBanner from '../components/game/ReplayPlayBanner';
import ReplayActionsMenu, { type ReplayMenuAction } from '../components/game/ReplayActionsMenu';
import Modal from '../components/ui/Modal';
import {
  buildTimeLapseIndices,
  nextTimeLapseIndex,
} from '../utils/replayTimeLapse';
import { isMobileViewport, isPhoneLayout, prefersReducedMotion } from '../utils/device';
import { useGameVisibleHeightEnabled } from '../store/featureFlagsStore';
import {
  distinctHighlights,
  nextReplaySpeed,
  REPLAY_SPEED_OPTIONS,
  replayPhaseLabel,
  type ReplaySpeed,
} from '../utils/replayControls';
import { isLiteMode } from '../utils/userPreferences';
import { usePageFrameBudget } from '../hooks/useFrameBudget';
import { inferWorldId } from '@borderfall/shared';
import { getGalaxyWorldLore } from '../constants/galaxyLore';
import { resolveGalaxyDrillDownGlobeSkin } from '../utils/galaxyGlobeSkin';
import { proceduralWorldTextureUrl } from '../utils/proceduralPlanet';
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

const REPLAY_MAP_FX_HINT_KEY = 'replay_map_fx_hint_dismissed';

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
  /**
   * React Router stamps 'default' on an entry the app did not navigate to —
   * a fresh tab, a pasted link, a hard refresh. There is nothing in-app behind
   * it, so history.back() either does nothing or leaves the site entirely.
   */
  const isFirstAppEntry = useLocation().key === 'default';
  const fromDaily = searchParams.get('source') === 'daily';
  // `source=match` is set by GamePage's "Watch Replay" CTA on GameOverView.
  // Match replays still open on the globe by default; playback stays 1x (not
  // the daily time-lapse cadence).
  const fromMatch = searchParams.get('source') === 'match';
  // Shared links append ?source=share. Those open straight into the condensed
  // Highlights reel so a first-time viewer sees the best moments immediately.
  const fromShare = searchParams.get('source') === 'share';
  // Game-over "Clip" CTA deep-links ?clip=auto: open the exporter and start
  // generating as soon as the replay is ready — share in two clicks, not six.
  const autoClip = searchParams.get('clip') === 'auto';
  const { replaySnapshots, replayFrame, loadReplay, setReplayFrame, clearGame, gameState } = useGameStore();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const [authoredMap, setMapData] = useState<MapData | null>(null);
  // The authored map lists every territory the board can ever hold; era maps
  // author later-era frontiers that only unlock through Era Advancement. A
  // frame draws just the tiles its snapshot has in play, so a 33-territory
  // Ancient game replays on 33 territories, not the 57 the file carries.
  const boardKey = boardKeyOf((gameState ?? replaySnapshots[replayFrame])?.territories);
  const mapData = useMemo(
    () => (authoredMap && boardKey ? projectMapToBoard(authoredMap, new Set(boardKey.split('|'))) : authoredMap),
    [authoredMap, boardKey],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Set when a replay exists but isn't public and the viewer can't see it.
  const [notPublic, setNotPublic] = useState(false);
  const [playing, setPlaying] = useState(false);
  // Daily-challenge replays default to a faster, time-lapse cadence; match
  // replays and general replays use real-time 1x.
  const [speed, setSpeed] = useState<ReplaySpeed>(fromDaily ? 4 : 1);
  // Playback cadence: 'all' walks every frame, 'timelapse' one frame per
  // turn-player pair, 'highlights' the condensed reel with variable dwell.
  // The clip IS the condensed reel, so a clip deep-link opens on it whatever
  // brought the viewer here — that used to ride on `source=share`, which also
  // decided where Back goes and so could not be used by a player leaving their
  // own match.
  const [playbackMode, setPlaybackMode] = useState<'all' | 'timelapse' | 'highlights'>(
    fromShare || autoClip ? 'highlights' : fromDaily ? 'timelapse' : 'all',
  );
  // Replays default to the 3D globe; viewers can switch to 2D from the toolbar.
  const [mapView, setMapView] = useState<'2d' | 'globe'>('globe');
  const [isPublic, setIsPublic] = useState(false);
  const [loadedPublic, setLoadedPublic] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
  /** Make-public confirmation gate — sharing publishes the replay. */
  const [confirmShare, setConfirmShare] = useState(false);
  const [clipExporterOpen, setClipExporterOpen] = useState(false);
  const [highlights, setHighlights] = useState<Array<{ turn: number; label: string; type: string; impact?: 'high' | 'medium'; prob_delta?: number }>>([]);
  const [insights, setInsights] = useState<ReplayInsight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [activeTip, setActiveTip] = useState<ReplayInsight | null>(null);
  // A phone gets its own layout (the game's phone test, so a phone turned on
  // its side keeps it). Its header, controls and panels are built to leave the
  // map most of the screen: the desktop page, squeezed onto one, covered the
  // globe with the chronicle and left it a strip a few rows of pixels tall.
  const [phoneLayout, setPhoneLayout] = useState(() => isPhoneLayout());
  const [landscape, setLandscape] = useState(
    () => typeof window !== 'undefined' && window.innerWidth > window.innerHeight,
  );
  useEffect(() => {
    const sync = () => {
      setPhoneLayout(isPhoneLayout());
      setLandscape(window.innerWidth > window.innerHeight);
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);
  // The page as tall as what the browser shows, on the game page's switch:
  // under 100vh a phone's playback controls sat behind Safari's toolbar.
  const visibleHeight = useGameVisibleHeightEnabled();
  // The tips list opens with the page on a desktop, beside the map. On a phone
  // it would take the map's place, and each tip still surfaces on its own as
  // playback reaches its turn.
  const [insightsOpen, setInsightsOpen] = useState(() => !isPhoneLayout());
  // The chronicle rides the same participant gate as the coaching tips. It
  // opens on arrival when the game-over modal's "Watch it play out" sent the
  // viewer here from its Chronicle tab.
  const [chronicleOpen, setChronicleOpen] = useState(() => searchParams.get('chronicle') === '1');
  // On a phone the tips and the chronicle share one panel under the map, so
  // opening one closes the other (and a desktop window narrowed to a phone's
  // width with both open keeps the chronicle).
  const toggleInsights = () => {
    setInsightsOpen((v) => !v);
    if (phoneLayout) setChronicleOpen(false);
  };
  const toggleChronicle = () => {
    setChronicleOpen((v) => !v);
    if (phoneLayout) setInsightsOpen(false);
  };
  useEffect(() => {
    if (phoneLayout && insightsOpen && chronicleOpen) setInsightsOpen(false);
  }, [phoneLayout, insightsOpen, chronicleOpen]);
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
  // The frame budget (docs/MOBILE_UX_PLAN.md M-14): a phone watching a replay
  // gets the game page's 30 fps cap and maps that idle between frames of the
  // replay, and steps down when it runs hot; battery saver does the same on
  // any device.
  const frameBudget = usePageFrameBudget();
  // Lite mode's visual rules: the viewer's own setting, or the reduced tier.
  const liteVisuals = isLiteMode() || frameBudget.reduced;

  const playbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Measure the flex-1 map area so the canvas always fills exactly the space
  // between the top bar and the playback controls — no scrolling, no clipped
  // chrome. Initial guess is conservative until the ResizeObserver fires. The
  // height's floor is low enough for a phone on its side: a canvas taller than
  // its box is cut off at the bottom, globe and all.
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
      const h = Math.max(120, Math.floor(height));
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
            .get<{ highlights: Array<{ turn: number; label: string; type: string; impact?: 'high' | 'medium'; prob_delta?: number }> }>(`/enhancements/replays/${gameId}/highlights`)
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
        highlights,
      }),
    [replaySnapshots, highlights],
  );

  // ?clip=auto: once the replay is loaded and viewable, open the clip
  // exporter (which auto-generates via its autoStart prop). One-shot — if the
  // viewer closes it, it stays closed.
  const autoClipOpenedRef = useRef(false);
  useEffect(() => {
    if (!autoClip || autoClipOpenedRef.current) return;
    if (loading || notPublic || replaySnapshots.length === 0 || !mapData) return;
    autoClipOpenedRef.current = true;
    setClipExporterOpen(true);
  }, [autoClip, loading, notPublic, replaySnapshots.length, mapData]);
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
    return showMapAnimations && !prefersReducedMotion() && !liteVisuals;
  }, [activeReplayState, showMapAnimations, liteVisuals]);

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

  /** Already-public replays just re-copy the link; first share asks first. */
  const requestShareReplay = () => {
    if (isPublic) { void handleShareReplay(); return; }
    setConfirmShare(true);
  };

  const handleShareReplay = async () => {
    if (!gameId) return;
    setConfirmShare(false);
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
  const backTarget = replayBackTarget({
    fromDaily,
    fromMatch,
    loadedPublic,
    isAuthenticated,
    isFirstAppEntry,
  });
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
    prefersReducedMotion() || liteVisuals || (isMobileViewport() && mapView === 'globe') || !showMapAnimations || speed >= 4;
  const replayPhaseTintClass = phaseTintClass(currentState?.phase, replayAmbientEnabled && !reducedGlobe);
  const lastTurn = replaySnapshots[totalFrames - 1]?.turn_number ?? totalFrames;
  const goBack = () => {
    if (backTarget.to === 'back') navigate(-1);
    else navigate(backTarget.to);
  };
  const toggleMapView = () => {
    setMapView((v) => {
      const next = v === 'globe' ? '2d' : 'globe';
      if (next === 'globe') preloadGlobeChunks();
      return next;
    });
  };
  const highlightChips = distinctHighlights(highlights);
  // The phone's one panel under the map: the chronicle or the tips, never both.
  const phoneSheet: 'chronicle' | 'tips' | null = !phoneLayout
    ? null
    : chronicleOpen && gameId
      ? 'chronicle'
      : insightsOpen
        ? 'tips'
        : null;
  // What the phone header keeps behind its "More" button.
  const phoneMenuActions: ReplayMenuAction[] = [
    { label: 'Export clip', icon: Clapperboard, onSelect: () => setClipExporterOpen(true) },
    ...(loadedPublic
      ? [{ label: 'Copy link', icon: Share2, onSelect: () => void handleCopyLink() }]
      : [
          {
            label: isPublic ? 'Copy link' : 'Share replay',
            icon: Share2,
            onSelect: requestShareReplay,
            disabled: sharing,
          },
          ...(isPublic
            ? [{ label: 'Make private', icon: Lock, onSelect: () => void handleMakePrivate(), disabled: sharing }]
            : []),
        ]),
  ];
  const phoneIconButton = (on: boolean) =>
    clsx(
      'tap-target shrink-0 flex items-center justify-center gap-1 h-8 min-w-8 px-2 rounded-lg border text-xs font-medium transition-colors',
      on
        ? 'bg-bf-gold/15 border-bf-gold/30 text-bf-gold'
        : 'bg-white/5 border-bf-border text-bf-muted hover:text-bf-text',
    );

  return (
    <div className={clsx(visibleHeight ? 'h-visible' : 'h-screen', 'overflow-hidden bg-bf-dark flex flex-col')}>
      {/* Top bar. A phone gets one row of icons: the desktop row ran off the
          right edge, its labels wrapping to three lines each. */}
      {phoneLayout ? (
        <div className="shrink-0 flex items-center gap-2 px-3 pt-safe-2 pb-2 border-b border-bf-border bg-bf-surface">
          <button
            type="button"
            onClick={goBack}
            aria-label={backTarget.label}
            title={backTarget.label}
            className="tap-target shrink-0 -ml-1 p-1 rounded-lg text-bf-muted hover:text-bf-text transition-colors"
          >
            <ChevronLeft className="w-5 h-5" aria-hidden />
          </button>
          <span className="text-bf-muted text-xs whitespace-nowrap tabular-nums">
            Turn {currentTurn}/{lastTurn}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={toggleMapView}
              aria-label={mapView === 'globe' ? 'Switch to 2D map' : 'Switch to globe'}
              title={mapView === 'globe' ? 'Switch to 2D map' : 'Switch to globe'}
              className={phoneIconButton(false)}
            >
              {mapView === 'globe' ? <MapIcon className="w-4 h-4" aria-hidden /> : <GlobeIcon className="w-4 h-4" aria-hidden />}
            </button>
            {mapView === 'globe' && mapData.map_kind === 'galaxy' && (
              <button
                type="button"
                onClick={() => setGalaxyOverviewMode(true)}
                aria-label="Galaxy chart"
                aria-pressed={galaxyOverviewMode}
                title="Galaxy chart"
                className={phoneIconButton(galaxyOverviewMode)}
              >
                <Orbit className="w-4 h-4" aria-hidden />
              </button>
            )}
            {!loadedPublic && (
              <button
                type="button"
                onClick={toggleInsights}
                aria-label={insightsOpen ? 'Hide coaching tips' : 'Show coaching tips'}
                aria-pressed={insightsOpen}
                title="Coaching tips"
                className={phoneIconButton(phoneSheet === 'tips')}
              >
                <Lightbulb className="w-4 h-4" aria-hidden />
                {insights.length > 0 && <span className="tabular-nums">{insights.length}</span>}
              </button>
            )}
            {!loadedPublic && (
              <button
                type="button"
                onClick={toggleChronicle}
                aria-label={chronicleOpen ? 'Hide chronicle' : 'Show chronicle'}
                aria-pressed={chronicleOpen}
                title="Read this match as a dated history"
                className={phoneIconButton(phoneSheet === 'chronicle')}
              >
                <ScrollText className="w-4 h-4" aria-hidden />
              </button>
            )}
            <ReplayActionsMenu actions={phoneMenuActions} />
          </div>
        </div>
      ) : (
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-bf-border bg-bf-surface">
        <button
          onClick={goBack}
          className="flex items-center gap-1.5 text-bf-muted hover:text-bf-text transition-colors text-sm"
        >
          <ChevronLeft className="w-4 h-4" /> {backTarget.label}
        </button>
        <div className="h-4 w-px bg-bf-border" />
        <span className="text-bf-gold font-display text-sm tracking-wide">{headerLabel}</span>
        <span className="text-bf-muted text-xs ml-auto">
          Turn {currentTurn} of {lastTurn}
        </span>
        <button
          type="button"
          onMouseEnter={preloadGlobeChunks}
          onFocus={preloadGlobeChunks}
          onClick={toggleMapView}
          aria-pressed={mapView === 'globe'}
          aria-label={mapView === 'globe' ? 'Switch to 2D map' : 'Switch to globe'}
          title={mapView === 'globe' ? 'Switch to 2D map' : 'Switch to globe'}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-bf-border text-bf-muted hover:text-bf-text hover:bg-white/10 text-xs font-medium transition-all"
        >
          {mapView === 'globe' ? <MapIcon className="w-3.5 h-3.5" /> : <GlobeIcon className="w-3.5 h-3.5" />}
          <span>{mapView === 'globe' ? '2D' : 'Globe'}</span>
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
            onClick={toggleInsights}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-bf-border text-bf-muted hover:text-bf-text hover:bg-white/10 text-xs font-medium transition-all"
          >
            <FilmIcon className="w-3.5 h-3.5" />
            {insightsOpen ? 'Hide Tips' : 'Show Tips'}
            {insights.length > 0 && (
              <span className="ml-1 text-bf-gold">{insights.length}</span>
            )}
          </button>
        )}
        {!loadedPublic && (
          <button
            type="button"
            onClick={toggleChronicle}
            title="Read this match as a dated history"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-bf-border text-bf-muted hover:text-bf-text hover:bg-white/10 text-xs font-medium transition-all"
          >
            <ScrollText className="w-3.5 h-3.5" />
            {chronicleOpen ? 'Hide Chronicle' : 'Chronicle'}
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
            <span>Copy Link</span>
          </button>
        ) : (
          <>
            <button
              onClick={requestShareReplay}
              disabled={sharing}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bf-gold/10 border border-bf-gold/20 text-bf-gold hover:bg-bf-gold/20 text-xs font-medium transition-all disabled:opacity-50"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
              <span>{isPublic ? 'Copy Link' : 'Share Replay'}</span>
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
      )}

      <ReplayPlayBanner />

      {/* The map and, on a phone, the panel that holds the chronicle or the
          tips: under the map, or beside it with the phone on its side. */}
      <div className={clsx('flex-1 min-h-0 flex', phoneLayout && landscape ? 'flex-row' : 'flex-col')}>
      {/* Map area — flex-1 between the top bar and the controls. The canvas
          dimensions come from a ResizeObserver on this container so the
          playback chrome stays fully visible without any page scrolling. */}
      <div ref={mapAreaRef} className={`flex-1 relative overflow-hidden min-h-0 min-w-0${replayPhaseTintClass ? ` ${replayPhaseTintClass}` : ''}`}>
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
                frameBudget={frameBudget.active}
                frameBudgetFps={frameBudget.fps}
                autoSpin={!reducedGlobe}
                ambientEnabled={replayAmbientEnabled && !reducedGlobe}
                turnHolderPlayerId={replayTurnHolder?.player_id ?? null}
                contestedBorders={replayContestedBorders}
                activeWorldId={mapData.map_kind === 'galaxy' ? focusedWorldId : 'earth'}
                globeImageUrl={
                  mapData.map_kind === 'galaxy'
                    ? (proceduralWorldTextureUrl(focusedWorldId) ??
                        replayGalaxyGlobeSkin?.globeImageUrl ??
                        focusedWorldSkin?.globe_image_url)
                    : undefined
                }
                bumpImageUrl={mapData.map_kind === 'galaxy' ? '' : undefined}
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
            moonInset
            mapData={mapData}
            onTerritoryClick={() => {}}
            width={mapCanvasSize.w}
            height={mapCanvasSize.h}
            mapVisualEvents={mapVisualEvents}
            onMapVisualDone={onMapVisualDone}
            reducedEffects={reducedGlobe}
            frameBudget={frameBudget.active}
            ambientEnabled={replayAmbientEnabled && !reducedGlobe}
            turnHolderPlayerId={replayTurnHolder?.player_id ?? null}
            turnHolderColor={replayTurnHolder?.color}
            contestedBorders={replayContestedBorders}
          />
        )}

        {/* Player list overlay */}
        {currentState && (
          <div
            className={clsx(
              'absolute bg-bf-surface/90 border border-bf-border rounded-xl space-y-1',
              // A phone's globe has no zoom buttons in the bottom corner, and
              // its "Skip animations" button takes the top one.
              phoneLayout ? 'bottom-2 right-2 p-2 text-[11px] max-w-[140px]' : 'top-3 right-3 p-3 text-xs max-w-[160px]',
            )}
          >
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

        {/* Phase indicator. On a phone a long name wraps rather than taking
            the width of the map. */}
        {currentState && (
          <div
            className={clsx(
              'absolute flex flex-col gap-1.5 items-start',
              phoneLayout ? 'top-2 left-2 max-w-[calc(100%-10.5rem)]' : 'top-3 left-3',
            )}
          >
            <div className={clsx('bg-bf-surface/90 border border-bf-border rounded-lg text-xs text-bf-gold', phoneLayout ? 'px-2.5 py-1' : 'px-3 py-1.5')}>
              {replayPhaseLabel(currentState.phase, currentState.players[currentState.current_player_index]?.username)}
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
        {insightsOpen && !phoneLayout && (
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

        {/* Chronicle — the match as a dated history; each entry scrubs playback. */}
        {chronicleOpen && gameId && !phoneLayout && (
          <div className="absolute top-16 left-3 z-30 w-[min(24rem,calc(100%-1.5rem))] max-h-[70%] overflow-y-auto">
            <ChroniclePanel
              gameId={gameId}
              currentTurn={currentTurn}
              onJumpToTurn={handleJumpToTurn}
            />
          </div>
        )}

        {/* Floating tip toast — surfaces automatically when playback hits a tip's turn. */}
        {activeTip && (
          <ReplayTipToast
            insight={activeTip}
            onClose={() => setActiveTip(null)}
            docked={phoneLayout}
          />
        )}
      </div>

      {phoneSheet && (
        <div
          className={clsx(
            'shrink-0 min-h-0 flex flex-col bg-bf-surface border-bf-border',
            landscape ? 'w-[min(22rem,45%)] border-l' : 'max-h-[42%] border-t',
          )}
          data-testid="replay-phone-panel"
        >
          {phoneSheet === 'chronicle' && gameId ? (
            <ChroniclePanel
              gameId={gameId}
              currentTurn={currentTurn}
              onJumpToTurn={handleJumpToTurn}
              onClose={() => setChronicleOpen(false)}
              className="min-h-0 flex flex-col rounded-none border-0"
            />
          ) : (
            <ReplayInsightsPanel
              insights={insights}
              currentTurn={currentTurn}
              loading={insightsLoading && insights.length === 0}
              onJumpToTurn={handleJumpToTurn}
              onShowTip={(tip) => {
                lastToastedTurnRef.current = tip.turn;
                setActiveTip(tip);
              }}
              onClose={() => setInsightsOpen(false)}
              fill
            />
          )}
        </div>
      )}
      </div>

      {/* Playback controls — pinned to the bottom of the viewport via shrink-0
          so they're always visible without scrolling. */}
      <div
        className={clsx(
          'shrink-0 border-t border-bf-border bg-bf-surface flex flex-col',
          phoneLayout ? 'px-3 pt-2 pb-safe-2 gap-1.5' : 'px-4 py-3 gap-2',
        )}
      >
        {highlightChips.length > 0 && (
          // A phone keeps the chips to one row that scrolls sideways.
          <div
            className={clsx(
              'flex items-center gap-2',
              phoneLayout ? 'overflow-x-auto scrollbar-none -mx-3 px-3' : 'flex-wrap mb-1',
            )}
          >
            {highlightChips.map((h, idx) => (
              <button
                key={`${h.turn}-${idx}`}
                onClick={() => handleJumpToTurn(h.turn)}
                className={clsx(
                  'px-2 py-1 rounded-md text-xs border border-bf-gold/25 bg-bf-gold/10 text-bf-gold hover:bg-bf-gold/20 transition-colors',
                  phoneLayout && 'shrink-0 whitespace-nowrap',
                )}
              >
                T{h.turn}: {h.label}
              </button>
            ))}
          </div>
        )}
        {/* A phone on its side has the width for the timeline and the
            secondary controls in one row, and not the height for two. */}
        <div className={phoneLayout && landscape ? 'flex items-center gap-3' : 'contents'}>
        {/* Timeline row — primary play/pause sits inline with the scrubber so
            the user can pause/resume without scanning the secondary controls. */}
        <div className={clsx('flex items-center gap-3', phoneLayout && landscape && 'flex-1 min-w-0')}>
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

        {/* Secondary controls — step / mode / speed. On a phone the modes are
            icons (their names stay their accessible names) and the speeds are
            one button, so the row fits a 320px screen. */}
        <div className={clsx('flex items-center', phoneLayout ? 'gap-2' : 'gap-3')}>
          <button
            onClick={handleStepBack}
            disabled={replayFrame <= 0}
            aria-label="Step back one frame"
            className="tap-target p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white disabled:opacity-30 transition-all"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          <button
            onClick={handleStepForward}
            disabled={replayFrame >= totalFrames - 1}
            aria-label="Step forward one frame"
            className="tap-target p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white disabled:opacity-30 transition-all"
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
              'tap-target flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border',
              playbackMode === 'highlights'
                ? 'bg-bf-gold/20 text-bf-gold border-bf-gold/30'
                : 'bg-white/5 text-white/60 hover:text-white/80 border-bf-border',
            )}
          >
            <Sparkles className="w-3.5 h-3.5" aria-hidden />
            <span className={phoneLayout ? 'sr-only' : undefined}>Highlights</span>
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
              'tap-target flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border',
              playbackMode === 'timelapse'
                ? 'bg-bf-gold/20 text-bf-gold border-bf-gold/30'
                : 'bg-white/5 text-white/60 hover:text-white/80 border-bf-border',
            )}
          >
            <Film className="w-3.5 h-3.5" aria-hidden />
            <span className={phoneLayout ? 'sr-only' : undefined}>Time-lapse</span>
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
              'tap-target flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border',
              showMapAnimations
                ? 'bg-bf-gold/20 text-bf-gold border-bf-gold/30'
                : 'bg-white/5 text-white/60 hover:text-white/80 border-bf-border',
            )}
          >
            Map FX
          </button>

          {phoneLayout ? (
            <button
              type="button"
              onClick={() => setSpeed((v) => nextReplaySpeed(v))}
              aria-label={`Playback speed ${speed}×, tap for the next speed`}
              title="Playback speed"
              className="tap-target ml-auto px-2.5 py-1 rounded-lg text-xs font-medium tabular-nums bg-bf-gold/20 text-bf-gold border border-bf-gold/30"
            >
              {speed}×
            </button>
          ) : (
          <div className="flex items-center gap-1 ml-auto">
            {REPLAY_SPEED_OPTIONS.map((s) => (
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
          )}
        </div>
        </div>

        {!replayFxHintDismissed && (
          <div
            className={clsx(
              'flex items-start gap-2 rounded-lg border border-bf-border bg-white/[0.03] px-3 text-xs text-white/70',
              phoneLayout ? 'py-1.5' : 'mt-2 py-2',
            )}
            data-testid="replay-map-fx-disclaimer"
          >
            <Info className="w-4 h-4 shrink-0 text-bf-gold mt-0.5" aria-hidden />
            <div className="flex-1 min-w-0">
              {showMapAnimations ? (
                <>
                  {/* A phone shows the first line until Learn more: the whole
                      note took five lines under the controls. */}
                  <p>
                    <span className="text-white/85 font-medium">Replay map animations are inferred</span>
                    {(!phoneLayout || replayFxHintExpanded) && (
                      <span>
                        {' '}from turn snapshots. Captures and unit changes usually animate; strikes, event cards,
                        naval battles, and fortify moves may not. Use 1×–2× speed for best results.
                      </span>
                    )}
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
          autoStart={autoClip}
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

      {/* Publishing gate: one click used to make the replay public instantly. */}
      <Modal
        open={confirmShare}
        onClose={() => setConfirmShare(false)}
        title="Share this replay?"
        className="max-w-sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-bf-text">
            Sharing makes this replay <span className="text-bf-gold font-medium">publicly viewable</span> by
            anyone with the link, and copies the link to your clipboard.
          </p>
          <p className="text-xs text-bf-muted">You can switch it back with “Make Private” at any time.</p>
          <div className="flex gap-2 justify-end">
            <button className="btn-secondary text-sm px-4 py-2" onClick={() => setConfirmShare(false)}>
              Cancel
            </button>
            <button
              className="btn-primary text-sm px-4 py-2 disabled:opacity-60"
              disabled={sharing}
              onClick={() => void handleShareReplay()}
            >
              {sharing ? 'Sharing…' : 'Share publicly'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
