import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Target, CheckCircle } from 'lucide-react';
import { api } from '../../services/api';

interface Challenge {
  challenge_id: string;
  title: string;
  description: string | null;
  target_count: number;
  reward_gold: number;
  reward_xp: number;
  condition_type: string;
  progress: number;
  completed_at: string | null;
}

interface ChallengesResponse {
  month: string;
  days_remaining: number;
  challenges: Challenge[];
}

interface MonthlyChallengesProps {
  className?: string;
}

export default function MonthlyChallenges({ className }: MonthlyChallengesProps) {
  const [data, setData] = useState<ChallengesResponse | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    api.get('/progression/challenges')
      .then((res) => setData(res.data))
      .catch(() => {});
  }, []);

  if (!data || data.challenges.length === 0) return null;

  const completedCount = data.challenges.filter((c) => c.completed_at).length;
  const displayChallenges = expanded ? data.challenges : data.challenges.slice(0, 4);

  return (
    <div className={clsx('rounded-xl bg-cc-surface border border-cc-border p-4', className)}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target size={16} className="text-cc-gold" />
          <span className="font-display text-sm text-cc-gold">Monthly Challenges</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-cc-muted">
          <span>{completedCount}/{data.challenges.length} complete</span>
          <span>·</span>
          <span>{data.days_remaining}d left</span>
        </div>
      </div>

      <div className="space-y-2">
        {displayChallenges.map((ch) => (
          <ChallengeCard key={ch.challenge_id} challenge={ch} />
        ))}
      </div>

      {data.challenges.length > 4 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-3 text-xs text-cc-gold hover:text-cc-gold/80 transition-colors w-full text-center"
        >
          {expanded ? 'Show less' : `Show all ${data.challenges.length} challenges`}
        </button>
      )}
    </div>
  );
}

function ChallengeCard({ challenge }: { challenge: Challenge }) {
  const isComplete = challenge.completed_at != null;
  const progressPct = Math.min((challenge.progress / challenge.target_count) * 100, 100);

  return (
    <div
      className={clsx(
        'rounded-lg p-3 border transition-all',
        isComplete
          ? 'border-green-500/20 bg-green-500/5'
          : 'border-cc-border bg-cc-dark/50',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {isComplete && <CheckCircle size={12} className="text-green-400 shrink-0" />}
            <p className={clsx('text-sm font-medium truncate', isComplete ? 'text-green-400' : 'text-cc-text')}>
              {challenge.title}
            </p>
          </div>
          {challenge.description && (
            <p className="text-xs text-cc-muted mt-0.5 truncate">{challenge.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 text-xs">
          {challenge.reward_gold > 0 && (
            <span className="text-cc-gold">🪙 {challenge.reward_gold}</span>
          )}
          {challenge.reward_xp > 0 && (
            <span className="text-blue-400">✨ {challenge.reward_xp} XP</span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {!isComplete && (
        <div className="mt-2">
          <div className="flex justify-between text-[10px] text-cc-muted mb-0.5">
            <span>{challenge.progress}/{challenge.target_count}</span>
            <span>{Math.round(progressPct)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-cc-dark overflow-hidden">
            <div
              className="h-full rounded-full bg-cc-gold transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
