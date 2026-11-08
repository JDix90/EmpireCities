import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { ERA_LABELS } from '../../constants/gameLobbyLabels';
import {
  TEST_PLAY_DIFFICULTIES,
  TEST_PLAY_ERAS,
  clampOpponents,
  defaultTestPlayEra,
  startTestGame,
  type TestPlayDifficulty,
  type TestPlayEra,
} from '../../utils/testPlay';

interface TestPlayButtonProps {
  /** The saved map, or null for one not saved yet (then `beforeStart` must save it). */
  mapId: string | null;
  eraTheme?: string | null;
  /** Why it cannot start right now; shown as the tooltip and disables the button. */
  disabledReason?: string | null;
  /** Runs before the game is created: save first, and return the map id to play. */
  beforeStart?: () => Promise<string | null>;
  onStarted?: (options: { mapId: string; era: TestPlayEra; opponents: number }) => void;
  className?: string;
  /** Compact: icon and label only, for a card. */
  size?: 'sm' | 'md';
}

/**
 * "Test play": the author against bots on their own map, started at once.
 * A small popover picks the rules era, the table size and the bots'
 * difficulty; the server refuses an unpublished map that would not pass
 * review, and says why.
 */
export default function TestPlayButton({
  mapId,
  eraTheme,
  disabledReason = null,
  beforeStart,
  onStarted,
  className = '',
  size = 'md',
}: TestPlayButtonProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [era, setEra] = useState<TestPlayEra>(() => defaultTestPlayEra(eraTheme));
  const [opponents, setOpponents] = useState(3);
  const [difficulty, setDifficulty] = useState<TestPlayDifficulty>('medium');
  const [starting, setStarting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEra(defaultTestPlayEra(eraTheme));
  }, [eraTheme]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const start = async () => {
    if (starting) return;
    setStarting(true);
    try {
      const id = beforeStart ? await beforeStart() : mapId;
      if (!id) return;
      const count = clampOpponents(opponents);
      const gameId = await startTestGame({ mapId: id, era, opponents: count, difficulty });
      onStarted?.({ mapId: id, era, opponents: count });
      setOpen(false);
      navigate(`/game/${gameId}`);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) toast.error(err.response?.data?.error || 'Could not start a test game');
      else toast.error('Could not start a test game');
    } finally {
      setStarting(false);
    }
  };

  const disabled = !!disabledReason;
  const padding = size === 'sm' ? 'text-xs py-1.5 px-3' : 'text-sm py-1.5';

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={disabledReason ?? 'Play this map against bots'}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`btn-secondary ${padding} flex items-center gap-2 disabled:opacity-50`}
      >
        <Play className="w-4 h-4" aria-hidden />
        <span>Test play</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Test play options"
          className="absolute right-0 top-full mt-2 z-30 w-64 rounded-lg border border-bf-border bg-bf-surface shadow-xl p-3 text-sm"
        >
          <label className="label text-xs" htmlFor="test-play-era">Rules era</label>
          <select
            id="test-play-era"
            className="input text-sm py-1.5 mb-2"
            value={era}
            onChange={(e) => setEra(e.target.value as TestPlayEra)}
          >
            {TEST_PLAY_ERAS.map((id) => (
              <option key={id} value={id}>{ERA_LABELS[id] ?? id}</option>
            ))}
          </select>
          <label className="label text-xs" htmlFor="test-play-opponents">Bot opponents</label>
          <input
            id="test-play-opponents"
            type="number"
            min={1}
            max={5}
            className="input text-sm py-1.5 mb-2"
            value={opponents}
            onChange={(e) => setOpponents(clampOpponents(Number(e.target.value) || 1))}
          />
          <label className="label text-xs" htmlFor="test-play-difficulty">Difficulty</label>
          <select
            id="test-play-difficulty"
            className="input text-sm py-1.5 mb-3"
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value as TestPlayDifficulty)}
          >
            {TEST_PLAY_DIFFICULTIES.map((d) => (
              <option key={d} value={d} className="capitalize">{d.charAt(0).toUpperCase() + d.slice(1)}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void start()}
            disabled={starting}
            className="btn-primary w-full text-sm py-1.5 disabled:opacity-50"
          >
            {starting ? 'Starting…' : 'Start test game'}
          </button>
          <p className="text-[11px] text-bf-muted mt-2">Private, starts at once, and counts for nothing.</p>
        </div>
      )}
    </div>
  );
}
