import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/gameStore';
import { api } from '../services/api';
import GameMap from '../components/game/GameMap';
import toast from 'react-hot-toast';
import { Play, Pause, SkipBack, SkipForward, ChevronLeft, Share2, Copy, Check } from 'lucide-react';
import clsx from 'clsx';
import type { GameState } from '../store/gameStore';

const SPEED_OPTIONS = [0.5, 1, 2] as const;
type Speed = (typeof SPEED_OPTIONS)[number];

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

export default function ReplayPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const { replaySnapshots, replayFrame, loadReplay, setReplayFrame, clearGame, gameState } = useGameStore();

  const [mapData, setMapData] = useState<MapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [isPublic, setIsPublic] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load replay on mount
  useEffect(() => {
    if (!gameId) return;
    let mounted = true;
    setLoading(true);
    api
      .get<{ snapshots: Array<{ turn_number: number; state: GameState }> }>(`/games/${gameId}/replay`)
      .then((res) => {
        if (!mounted) return;
        const states = res.data.snapshots.map((s) => s.state);
        if (states.length === 0) {
          setError('No replay data available for this game.');
          return;
        }
        loadReplay(states);
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
    intervalRef.current = setInterval(() => {
      const s = useGameStore.getState();
      const next = s.replayFrame + 1;
      if (next >= s.replaySnapshots.length) {
        stopPlayback();
        return;
      }
      useGameStore.setState({ replayFrame: next, gameState: s.replaySnapshots[next] });
    }, Math.round(1500 / speed));
  }, [speed, stopPlayback]);

  // Restart interval when speed changes while playing
  useEffect(() => {
    if (playing) startPlayback();
  }, [speed]);

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
    setReplayFrame(Math.max(0, replayFrame - 1));
  };

  const handleStepForward = () => {
    stopPlayback();
    setReplayFrame(Math.min(replaySnapshots.length - 1, replayFrame + 1));
  };

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

  return (
    <div className="min-h-screen bg-cc-dark flex flex-col">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-cc-border bg-cc-surface">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-cc-muted hover:text-cc-text transition-colors text-sm"
        >
          <ChevronLeft className="w-4 h-4" /> Back
        </button>
        <div className="h-4 w-px bg-cc-border" />
        <span className="text-cc-gold font-display text-sm tracking-wide">Game Replay</span>
        <span className="text-cc-muted text-xs ml-auto">
          Turn {currentTurn} of {replaySnapshots[totalFrames - 1]?.turn_number ?? totalFrames}
        </span>
        <button
          onClick={handleShareReplay}
          disabled={sharing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cc-gold/10 border border-cc-gold/20 text-cc-gold hover:bg-cc-gold/20 text-xs font-medium transition-all disabled:opacity-50"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
          {isPublic ? 'Copy Link' : 'Share Replay'}
        </button>
      </div>

      {/* Map area */}
      <div className="flex-1 relative overflow-hidden">
        <GameMap
          mapData={mapData}
          onTerritoryClick={() => {}}
          width={window.innerWidth}
          height={window.innerHeight - 120}
        />

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
      </div>

      {/* Playback controls */}
      <div className="border-t border-cc-border bg-cc-surface px-4 py-3 flex flex-col gap-2">
        {/* Scrubber */}
        <input
          type="range"
          min={0}
          max={totalFrames - 1}
          value={replayFrame}
          onChange={handleScrub}
          className="w-full accent-cc-gold cursor-pointer h-1"
        />

        <div className="flex items-center gap-3">
          {/* Step back */}
          <button
            onClick={handleStepBack}
            disabled={replayFrame <= 0}
            className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white disabled:opacity-30 transition-all"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          {/* Play / Pause */}
          <button
            onClick={togglePlay}
            className="p-2 rounded-xl bg-cc-gold/20 hover:bg-cc-gold/30 text-cc-gold border border-cc-gold/30 transition-all"
          >
            {playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </button>

          {/* Step forward */}
          <button
            onClick={handleStepForward}
            disabled={replayFrame >= totalFrames - 1}
            className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white disabled:opacity-30 transition-all"
          >
            <SkipForward className="w-4 h-4" />
          </button>

          {/* Speed selector */}
          <div className="flex items-center gap-1 ml-2">
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

          {/* Frame counter */}
          <span className="text-cc-muted text-xs ml-auto tabular-nums">
            {replayFrame + 1} / {totalFrames}
          </span>
        </div>
      </div>
    </div>
  );
}
