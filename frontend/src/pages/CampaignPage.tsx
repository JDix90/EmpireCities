import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import { Trophy, ChevronRight, CheckCircle, Circle, Lock } from 'lucide-react';
import { ERA_LABELS } from '../constants/gameLobbyLabels';

const CAMPAIGN_ERAS = ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern'] as const;

interface CampaignEraEntry {
  era_id: string;
  index: number;
  won: boolean;
  completed: boolean;
  game_id: string | null;
}

interface Campaign {
  campaign_id: string;
  status: 'active' | 'completed';
  current_era: string | null;
  current_era_index: number;
  next_era: string | null;
  prestige_points: number;
  started_at: string;
  completed_at: string | null;
  eras: CampaignEraEntry[];
}

export default function CampaignPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    api.get<Campaign>('/campaign/me')
      .then((res) => setCampaign(res.data))
      .catch((err) => {
        if (err?.response?.status !== 404) {
          toast.error('Failed to load campaign');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const handleStart = async () => {
    setStarting(true);
    try {
      const res = await api.post<{ campaign_id: string; game_id: string }>('/campaign/start');
      navigate(`/game/${res.data.game_id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Failed to start campaign';
      toast.error(msg);
    } finally {
      setStarting(false);
    }
  };

  const handleContinue = () => {
    if (!campaign) return;
    const currentEntry = campaign.eras.find((e) => e.era_id === campaign.current_era && e.game_id);
    if (currentEntry?.game_id) {
      navigate(`/game/${currentEntry.game_id}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-cc-dark flex items-center justify-center">
        <p className="text-cc-muted">Loading campaign…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cc-dark text-cc-text">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link to="/profile" className="text-cc-gold hover:text-white transition-colors text-sm">← Back</Link>
          <span className="text-cc-muted">·</span>
          <h1 className="font-display text-2xl text-cc-gold tracking-widest">ERA CAMPAIGN</h1>
        </div>

        {/* Prestige badge */}
        {campaign && campaign.prestige_points > 0 && (
          <div className="mb-6 flex items-center gap-2 bg-amber-900/30 border border-amber-600/40 rounded-lg px-4 py-2 w-fit">
            <Trophy className="w-4 h-4 text-amber-400" />
            <span className="text-amber-300 text-sm font-semibold">{campaign.prestige_points} Prestige Points</span>
          </div>
        )}

        {/* Campaign timeline */}
        <div className="mb-8">
          <h2 className="text-sm uppercase tracking-widest text-cc-muted mb-4">Campaign Progress</h2>
          <div className="flex flex-col gap-2">
            {CAMPAIGN_ERAS.map((era, idx) => {
              const entry = campaign?.eras.find((e) => e.era_id === era);
              const isCurrent = campaign?.current_era === era && campaign?.status === 'active';
              const isLocked = !campaign || idx > (campaign.current_era_index);
              const isDone = entry?.won === true;
              const isAttempted = entry?.completed === true && !isDone;

              return (
                <div
                  key={era}
                  className={`flex items-center gap-4 p-3 rounded-lg border transition-colors ${
                    isCurrent
                      ? 'border-cc-gold/60 bg-cc-gold/5'
                      : isDone
                        ? 'border-green-600/40 bg-green-900/10'
                        : isAttempted
                          ? 'border-red-700/40 bg-red-900/10'
                          : 'border-cc-border bg-cc-surface/50'
                  }`}
                >
                  <div className="w-6 flex-shrink-0">
                    {isDone ? (
                      <CheckCircle className="w-5 h-5 text-green-400" />
                    ) : isLocked ? (
                      <Lock className="w-4 h-4 text-cc-muted" />
                    ) : isCurrent ? (
                      <ChevronRight className="w-5 h-5 text-cc-gold" />
                    ) : (
                      <Circle className="w-4 h-4 text-cc-muted" />
                    )}
                  </div>
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${isCurrent ? 'text-cc-gold' : isDone ? 'text-green-300' : isLocked ? 'text-cc-muted' : 'text-cc-text'}`}>
                      {ERA_LABELS[era] ?? era}
                    </p>
                    {isAttempted && !isDone && (
                      <p className="text-xs text-red-400 mt-0.5">Failed — try again</p>
                    )}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    isDone ? 'bg-green-900/50 text-green-300' :
                    isCurrent ? 'bg-cc-gold/20 text-cc-gold' :
                    isLocked ? 'bg-gray-800 text-cc-muted' :
                    'bg-gray-800 text-cc-muted'
                  }`}>
                    {idx + 1} / {CAMPAIGN_ERAS.length}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          {!campaign ? (
            <button
              onClick={handleStart}
              disabled={starting}
              className="px-6 py-3 bg-cc-gold text-cc-dark font-semibold rounded-lg hover:bg-yellow-400 transition-colors disabled:opacity-60"
            >
              {starting ? 'Starting…' : 'Start Campaign'}
            </button>
          ) : campaign.status === 'completed' ? (
            <div className="flex flex-col gap-2">
              <p className="text-green-400 font-semibold">🏆 Campaign Completed!</p>
              <button
                onClick={handleStart}
                disabled={starting}
                className="px-6 py-3 bg-cc-surface border border-cc-border text-cc-text rounded-lg hover:bg-cc-border/20 transition-colors disabled:opacity-60"
              >
                {starting ? 'Starting…' : 'New Campaign'}
              </button>
            </div>
          ) : (
            <button
              onClick={handleContinue}
              className="px-6 py-3 bg-cc-gold text-cc-dark font-semibold rounded-lg hover:bg-yellow-400 transition-colors"
            >
              Continue Campaign → {ERA_LABELS[campaign.current_era ?? ''] ?? campaign.current_era}
            </button>
          )}
          <Link
            to="/lobby"
            className="px-6 py-3 border border-cc-border text-cc-muted rounded-lg hover:border-cc-text hover:text-cc-text transition-colors"
          >
            Back to Lobby
          </Link>
        </div>
      </div>
    </div>
  );
}
