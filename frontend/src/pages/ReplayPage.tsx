import React, { useEffect, useLayoutEffect, useState, useRef, useCallback, useMemo, lazy, Suspense } from 'react';
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
} from 'lucide-react';
import clsx from 'clsx';
import type { GameState } from '../store/gameStore';
import ReplayInsightsPanel, { type ReplayInsight } from '../components/game/ReplayInsightsPanel';
import ReplayTipToast from '../components/game/ReplayTipToast';
import {
  buildTimeLapseIndices,
  nextTimeLapseIndex,
  prevTimeLapseIndex,
} from '../utils/replayTimeLapse';
import { isLiteMode, isMobileViewport, prefersReducedMotion } from '../utils/device';
import { inferWorldId } from '@erasofempire/shared';
import { getGalaxyWorldLore } from '../constants/galaxyLore';
import { resolveGalaxyDrillDownGlobeSkin } from '../utils/galaxyGlobeSkin';

// Heavy three-globe bundle: lazy-load mirroring GamePage so the 2D fallback
// path can render without paying for it.
const GlobeMap = lazy(() => import('../components/game/GlobeMap'));
const GalaxyStrategicView = lazy(() => import('../components/game/GalaxyStrategicView'));

const SPEED_OPTIONS = [0.5, 1, 2, 4, 8] as const;
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
  // We tune defaults and the back button differently than the daily flow so
  // a player landing here straight from their match gets a normal-paced
  // 2D replay rather than a 4x globe time-lapse.
  const fromMatch = searchParams.get('source') === 'match';
  const { replaySnapshots, replayFrame, loadReplay, setReplayFrame, clearGame, gameState } = useGameStore();

  const [mapData, setMapData] = useState<MapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  // Daily-challenge replays default to a faster, time-lapse cadence; match
  // replays and general replays use real-time 1x.
  const [speed, setSpeed] = useState<Speed>(fromDaily ? 4 : 1);
  const [timeLapseMode, setTimeLapseMode] = useState<boolean>(fromDaily);
  // Daily replays open in the cinematic 3D globe view; match replays open in
  // 2D so the local player sees the familiar board they just played on.
  const [mapView, setMapView] = useState<'2d' | 'globe'>(fromMatch ? '2d' : 'globe');
  const [isPublic, setIsPublic] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);
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

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

    async function fetchReplay(attemptsLeft: number): Promise<{ snapshots: Array<{ turn_number: number; state: GameState }> }> {
      try {
        const res = await api.get<{ snapshots: Array<{ turn_number: number; state: GameState }> }>(`/games/${gameId}/replay`);
        return res.data;
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (attemptsLeft > 1 && (status === 404 || status === 503)) {
          await new Promise((r) => setTimeout(r, 2000));
          return fetchReplay(attemptsLeft - 1);
        }
        throw err;
      }
    }

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

    fetchReplay(3)
      .then((data) => {
        if (!mounted) return;
        const states = data.snapshots.map((s) => s.state);
        if (states.length === 0) {
          setError('No replay data available for this game.');
          return;
        }
        loadReplay(states);
        api
          .get<{ highlights: Array<{ turn: number; label: string; type: string }> }>(`/enhancements/replays/${gameId}/highlights`)
          .then((highlightsRes) => {
            if (!mounted) return;
            setHighlights(highlightsRes.data.highlights ?? []);
          })
          .catch(() => {});
        // Coaching insights: separate retry budget so they don't block the main replay.
        setInsightsLoading(true);
        fetchInsights(3)
          .then((items) => {
            if (!mounted) return;
            setInsights(items);
          })
          .finally(() => {
            if (mounted) setInsightsLoading(false);
          });
        // Load map data from first snapshot
        const mapId = states[0]?.map_id;
        if (mapId) {
          return api.get(`/maps/${mapId}`).then((mapRes) => {
            if (!mounted) return;
            setMapData(mapRes.data.map);
          });
        }
      })
      .catch((err: unknown) => {
        if (!mounted) return;
        const msg =
          err && typeof err === 'object' && 'response' in err
            ? ((err as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Failed to load replay')
            : 'Failed to load replay';
        setError(typeof msg === 'string' ? msg : 'Failed to load replay');
        toast.error(typeof msg === 'string' ? msg : 'Failed to load replay');
      })
      .finally(() => { if (mounted) setLoading(false); });

    return () => { mounted = false; clearGame(); };
  }, [gameId]);

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
  const prevTimeLapseFrom = useCallback(
    (currentIdx: number) => prevTimeLapseIndex(timeLapseIndices, currentIdx),
    [timeLapseIndices],
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

  // Playback timer
  const stopPlayback = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setPlaying(false);
  }, []);

  const startPlayback = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setPlaying(true);
    // Time-lapse mode advances frame-by-turn (one snapshot per active player
    // per turn). Standard mode advances every frame. Use a slightly longer
    // base interval in time-lapse so 4× / 8× still read clearly.
    const baseMs = timeLapseMode ? 1100 : 1500;
    const stepMs = Math.max(60, Math.round(baseMs / speed));
    intervalRef.current = setInterval(() => {
      const s = useGameStore.getState();
      let next: number | null;
      if (timeLapseMode) {
        next = nextTimeLapseFrom(s.replayFrame);
      } else {
        next = s.replayFrame + 1 < s.replaySnapshots.length ? s.replayFrame + 1 : null;
      }
      if (next === null) {
        stopPlayback();
        return;
      }
      useGameStore.setState({ replayFrame: next, gameState: s.replaySnapshots[next] });
    }, stepMs);
  }, [speed, stopPlayback, timeLapseMode, nextTimeLapseFrom]);

  // Restart interval when speed or mode changes while playing
  useEffect(() => {
    if (playing) startPlayback();
     
  }, [speed, timeLapseMode]);

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
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    stopPlayback();
    setReplayFrame(Number(e.target.value));
  };

  const handleStepBack = () => {
    stopPlayback();
    if (timeLapseMode) {
      const prev = prevTimeLapseFrom(replayFrame);
      setReplayFrame(prev ?? 0);
    } else {
      setReplayFrame(Math.max(0, replayFrame - 1));
    }
  };

  const handleStepForward = () => {
    stopPlayback();
    if (timeLapseMode) {
      const next = nextTimeLapseFrom(replayFrame);
      if (next !== null) setReplayFrame(next);
    } else {
      setReplayFrame(Math.min(replaySnapshots.length - 1, replayFrame + 1));
    }
  };

  const handleJumpToTurn = useCallback(
    (turn: number) => {
      stopPlayback();
      // Jump to the FIRST frame of the requested turn in the active track so
      // the user sees how that turn unfolded rather than its end-state.
      const indices = timeLapseMode ? timeLapseIndices : replaySnapshots.map((_, i) => i);
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
    [replaySnapshots, timeLapseMode, timeLapseIndices, setReplayFrame, stopPlayback],
  );

  const handleShareReplay = async () => {
    if (!gameId) return;
    setSharing(true);
    try {
      await api.post(`/share/${gameId}/make-public`);
      setIsPublic(true);
      const url = `${window.location.origin}/replay/${gameId}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('Replay link copied!');
      api.post(`/share/${gameId}`, { platform: 'link' }).catch(() => {});
    } catch {
      toast.error('Failed to make replay public');
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
      <div className="min-h-screen bg-cc-dark flex items-center justify-center">
        <p className="text-cc-muted">Loading replay…</p>
      </div>
    );
  }

  if (error || !mapData || replaySnapshots.length === 0) {
    return (
      <div className="min-h-screen bg-cc-dark flex flex-col items-center justify-center gap-4">
        <p className="text-cc-muted">{error ?? 'Replay unavailable.'}</p>
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
  // Mirror GamePage's reduced-globe heuristic: low-power devices and motion-
  // averse users still get the globe, just without continuous spin/effects.
  const reducedGlobe =
    prefersReducedMotion() || isLiteMode() || (isMobileViewport() && mapView === 'globe');

  return (
    <div className="h-screen overflow-hidden bg-cc-dark flex flex-col">
      {/* Top bar */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-cc-border bg-cc-surface">
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
            navigate(-1);
          }}
          className="flex items-center gap-1.5 text-cc-muted hover:text-cc-text transition-colors text-sm"
        >
          <ChevronLeft className="w-4 h-4" />{' '}
          {fromDaily ? 'Back to Daily' : fromMatch ? 'Back to Lobby' : 'Back'}
        </button>
        <div className="h-4 w-px bg-cc-border" />
        <span className="text-cc-gold font-display text-sm tracking-wide">{headerLabel}</span>
        <span className="text-cc-muted text-xs ml-auto">
          Turn {currentTurn} of {replaySnapshots[totalFrames - 1]?.turn_number ?? totalFrames}
        </span>
        <button
          type="button"
          onClick={() => setMapView((v) => (v === 'globe' ? '2d' : 'globe'))}
          aria-pressed={mapView === 'globe'}
          aria-label={mapView === 'globe' ? 'Switch to 2D map' : 'Switch to globe'}
          title={mapView === 'globe' ? 'Switch to 2D map' : 'Switch to globe'}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-cc-border text-cc-muted hover:text-cc-text hover:bg-white/10 text-xs font-medium transition-all"
        >
          {mapView === 'globe' ? <MapIcon className="w-3.5 h-3.5" /> : <GlobeIcon className="w-3.5 h-3.5" />}
          {mapView === 'globe' ? '2D' : 'Globe'}
        </button>
        {mapView === 'globe' && mapData.map_kind === 'galaxy' && (
          <button
            type="button"
            onClick={() => setGalaxyOverviewMode(true)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all ${galaxyOverviewMode ? 'bg-cc-gold/15 border-cc-gold/30 text-cc-gold' : 'bg-white/5 border-cc-border text-cc-muted hover:text-cc-text'}`}
          >
            Galaxy chart
          </button>
        )}
        <button
          type="button"
          onClick={() => setInsightsOpen((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-cc-border text-cc-muted hover:text-cc-text hover:bg-white/10 text-xs font-medium transition-all"
        >
          <FilmIcon className="w-3.5 h-3.5" />
          {insightsOpen ? 'Hide Tips' : 'Show Tips'}
          {insights.length > 0 && (
            <span className="ml-1 text-cc-gold">{insights.length}</span>
          )}
        </button>
        <button
          onClick={handleShareReplay}
          disabled={sharing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cc-gold/10 border border-cc-gold/20 text-cc-gold hover:bg-cc-gold/20 text-xs font-medium transition-all disabled:opacity-50"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
          {isPublic ? 'Copy Link' : 'Share Replay'}
        </button>
      </div>

      {/* Map area — flex-1 between the top bar and the controls. The canvas
          dimensions come from a ResizeObserver on this container so the
          playback chrome stays fully visible without any page scrolling. */}
      <div ref={mapAreaRef} className="flex-1 relative overflow-hidden min-h-0">
        {mapView === 'globe' ? (
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full">
                <p className="text-cc-muted animate-pulse">Loading globe…</p>
              </div>
            }
          >
            {mapData.map_kind === 'galaxy' && galaxyOverviewMode ? (
              <GalaxyStrategicView
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
              />
            ) : (
              <>
                {galaxyWorldBanner && (
                  <div
                    className="absolute top-4 left-1/2 z-20 -translate-x-1/2 pointer-events-none max-w-md px-4 py-2 rounded-lg border border-cc-border bg-black/60 text-center shadow-lg"
                    role="status"
                    aria-live="polite"
                  >
                    <div className="font-display text-cc-gold text-sm sm:text-base">
                      {galaxyWorldBanner.display_name}
                    </div>
                    <div className="text-[11px] sm:text-xs text-cc-muted mt-0.5">
                      {galaxyWorldBanner.tagline}
                    </div>
                  </div>
                )}
                <GlobeMap
                mapData={mapData}
                onTerritoryClick={() => {}}
                width={mapCanvasSize.w}
                height={mapCanvasSize.h}
                reducedEffects={reducedGlobe}
                autoSpin={!reducedGlobe}
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
          />
        )}

        {/* Player list overlay */}
        {currentState && (
          <div className="absolute top-3 right-3 bg-cc-surface/90 border border-cc-border rounded-xl p-3 text-xs space-y-1 max-w-[160px]">
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
          <div className="absolute top-3 left-3 bg-cc-surface/90 border border-cc-border rounded-lg px-3 py-1.5 text-xs text-cc-gold capitalize">
            {currentState.players[currentState.current_player_index]?.username}'s {currentState.phase} phase
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
      <div className="shrink-0 border-t border-cc-border bg-cc-surface px-4 py-3 flex flex-col gap-2">
        {highlights.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-1">
            {highlights.slice(0, 5).map((h, idx) => (
              <button
                key={`${h.turn}-${idx}`}
                onClick={() => handleJumpToTurn(h.turn)}
                className="px-2 py-1 rounded-md text-xs border border-cc-gold/25 bg-cc-gold/10 text-cc-gold hover:bg-cc-gold/20 transition-colors"
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
            className="shrink-0 p-2 rounded-xl bg-cc-gold/20 hover:bg-cc-gold/30 text-cc-gold border border-cc-gold/30 transition-all focus:outline-none focus:ring-2 focus:ring-cc-gold/50"
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
            className="flex-1 accent-cc-gold cursor-pointer h-1"
          />
          <span className="text-cc-muted text-xs tabular-nums shrink-0">
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

          {/* Time-lapse toggle — when on, playback walks one frame per turn-player pair. */}
          <button
            type="button"
            onClick={() => setTimeLapseMode((v) => !v)}
            aria-pressed={timeLapseMode}
            title={timeLapseMode ? 'Time-lapse on' : 'Time-lapse off'}
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all border',
              timeLapseMode
                ? 'bg-cc-gold/20 text-cc-gold border-cc-gold/30'
                : 'bg-white/5 text-white/60 hover:text-white/80 border-cc-border',
            )}
          >
            <Film className="w-3.5 h-3.5" />
            Time-lapse
          </button>

          <div className="flex items-center gap-1 ml-auto">
            {SPEED_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={clsx(
                  'px-2.5 py-1 rounded-lg text-xs font-medium transition-all',
                  speed === s
                    ? 'bg-cc-gold/20 text-cc-gold border border-cc-gold/30'
                    : 'text-white/40 hover:text-white/60 hover:bg-white/5',
                )}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
