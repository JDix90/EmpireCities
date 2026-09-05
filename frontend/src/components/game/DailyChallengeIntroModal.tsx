import React, { useEffect } from 'react';
import { Calendar, Clock, Target, Trophy } from 'lucide-react';
import { estimatedTime } from '../../utils/dailyEstimate';

export interface DailyIntroSpec {
  archetype?: 'domination' | 'military_capture' | 'hold_territory' | 'control_region' | 'capture_chain' | 'economy_build' | 'tech_research' | string;
  title?: string;
  intro?: string;
  goal?: string;
  max_turns?: number;
  player_count?: number;
  /** Par: the turn the obvious line solves this day on. Beat it to score above 1000. */
  par_turns?: number;
}

interface DailyChallengeIntroModalProps {
  spec: DailyIntroSpec;
  /** YYYY-MM-DD — used in the header. */
  challengeDate?: string;
  /** Difficulty label, defaults to "Hard" because daily uses hard AI today. */
  difficultyLabel?: string;
  /** Friendly era label. */
  eraLabel?: string;
  onBegin: () => void;
}

const ARCHETYPE_LABELS: Record<string, string> = {
  domination: 'Domination',
  military_capture: 'Capture and Hold',
  hold_territory: 'Hold the Line',
  control_region: 'Control the Region',
  capture_chain: 'Forced March',
  economy_build: 'Economy Build',
  tech_research: 'Tech Research',
};

function archetypeLabel(archetype: string | undefined): string {
  if (!archetype) return 'Daily Mission';
  return ARCHETYPE_LABELS[archetype] ?? archetype.replace(/_/g, ' ');
}

function formatChallengeDate(raw: string | undefined): string {
  if (!raw || typeof raw !== 'string') return '';
  const ymd = raw.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

export default function DailyChallengeIntroModal({
  spec,
  challengeDate,
  difficultyLabel = 'Hard',
  eraLabel,
  onBegin,
}: DailyChallengeIntroModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') onBegin();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onBegin]);

  const dateLabel = formatChallengeDate(challengeDate);
  const time = estimatedTime(spec);
  const arche = archetypeLabel(spec.archetype);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm px-4 pt-safe pb-safe"
      role="dialog"
      aria-modal="true"
      aria-labelledby="daily-intro-title"
    >
      <div className="bg-bf-surface border border-bf-gold/35 rounded-2xl p-6 sm:p-8 w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-center gap-2 mb-1">
          <Calendar className="w-4 h-4 text-bf-gold" />
          <p className="text-xs uppercase tracking-[0.28em] text-bf-gold/85 font-display">Daily Challenge</p>
        </div>
        {dateLabel && (
          <p className="text-bf-muted text-xs text-center mb-4">{dateLabel}</p>
        )}

        <h2
          id="daily-intro-title"
          className="font-display text-2xl sm:text-3xl text-bf-gold text-center mb-2"
        >
          {spec.title ?? 'Today\u2019s Mission'}
        </h2>
        {eraLabel && (
          <p className="text-center text-bf-muted text-sm mb-4">{eraLabel}</p>
        )}

        {(spec.intro || spec.goal) && (
          <div className="space-y-3 text-bf-muted text-sm leading-relaxed mb-5">
            {spec.intro && <p>{spec.intro}</p>}
            {spec.goal && (
              <p className="text-bf-text">
                <span className="text-bf-gold/85 font-medium">Goal: </span>
                {spec.goal}
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-6">
          <div className="rounded-lg border border-bf-border bg-bf-dark/50 px-3 py-3 text-center">
            <Target className="w-4 h-4 text-bf-gold/80 mx-auto mb-1.5" />
            <p className="text-[10px] uppercase tracking-wider text-bf-muted mb-0.5">Mission</p>
            <p className="text-sm text-bf-text font-medium leading-tight">{arche}</p>
          </div>
          <div className="rounded-lg border border-bf-border bg-bf-dark/50 px-3 py-3 text-center">
            <Trophy className="w-4 h-4 text-bf-gold/80 mx-auto mb-1.5" />
            <p className="text-[10px] uppercase tracking-wider text-bf-muted mb-0.5">Difficulty</p>
            <p className="text-sm text-bf-text font-medium leading-tight capitalize">{difficultyLabel}</p>
          </div>
          <div className="rounded-lg border border-bf-border bg-bf-dark/50 px-3 py-3 text-center">
            <Clock className="w-4 h-4 text-bf-gold/80 mx-auto mb-1.5" />
            <p className="text-[10px] uppercase tracking-wider text-bf-muted mb-0.5">Est. Time</p>
            <p className="text-sm text-bf-text font-medium leading-tight">{time}</p>
          </div>
        </div>

        {(typeof spec.max_turns === 'number' || typeof spec.player_count === 'number') && (
          <p className="text-bf-muted text-xs text-center mb-5">
            {typeof spec.par_turns === 'number' && (
              <>
                Par: <span className="text-bf-text">{spec.par_turns} {spec.par_turns === 1 ? 'turn' : 'turns'}</span>
                <span className="mx-2 text-bf-border">•</span>
              </>
            )}
            {typeof spec.max_turns === 'number' && (
              <>Turn limit: <span className="text-bf-text">{spec.max_turns}</span></>
            )}
            {typeof spec.max_turns === 'number' && typeof spec.player_count === 'number' && (
              <span className="mx-2 text-bf-border">•</span>
            )}
            {typeof spec.player_count === 'number' && (
              <>Opponents: <span className="text-bf-text">{Math.max(0, spec.player_count - 1)} AI</span></>
            )}
          </p>
        )}

        <button
          type="button"
          onClick={onBegin}
          className="btn-primary w-full py-3 text-base"
          autoFocus
        >
          Begin Challenge
        </button>
      </div>
    </div>
  );
}
