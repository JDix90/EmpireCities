import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import {
  Trophy, ChevronRight, CheckCircle, Circle, Lock,
  Flame, Shield, Sword, ChevronDown, ChevronUp,
} from 'lucide-react';
import { ERA_LABELS } from '../constants/gameLobbyLabels';

const CAMPAIGN_ERAS = ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern'] as const;

// ── Types ──────────────────────────────────────────────────────────────

interface CampaignEraEntry {
  era_id: string;
  index: number;
  won: boolean;
  completed: boolean;
  game_id: string | null;
  faction_id: string | null;
  map_id: string;
  intro_text: string | null;
  outro_win_text: string | null;
  outro_loss_text: string | null;
}

interface PathConfig {
  path_id: string;
  name: string;
  tagline: string;
  description: string;
  signature_carry_key: string;
  signature_carry_label: string;
  signature_carry_max: number;
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
  path_id: string | null;
  path_carry: Record<string, number>;
  path_narrative: Record<string, string>;
  path_config: PathConfig | null;
  eras: CampaignEraEntry[];
}

interface AvailablePath {
  path_id: string;
  name: string;
  tagline: string;
  description: string;
  signature_carry_key: string;
  signature_carry_label: string;
  signature_carry_max: number;
  era_count: number;
}

// ── Carry icon helper ──────────────────────────────────────────────────

function CarryIcon({ carryKey, className }: { carryKey: string; className?: string }) {
  if (carryKey === 'survivor_bonus') return <Shield className={className} />;
  if (carryKey === 'revolutionary_spirit') return <Flame className={className} />;
  return <Trophy className={className} />;
}

function carryColor(carryKey: string): string {
  if (carryKey === 'survivor_bonus') return 'text-blue-400';
  if (carryKey === 'revolutionary_spirit') return 'text-red-400';
  return 'text-amber-400';
}

function carryBgColor(carryKey: string): string {
  if (carryKey === 'survivor_bonus') return 'bg-blue-900/30 border-blue-600/40';
  if (carryKey === 'revolutionary_spirit') return 'bg-red-900/30 border-red-600/40';
  return 'bg-amber-900/30 border-amber-600/40';
}

function pathAccentColor(pathId: string): string {
  if (pathId === 'blood_empire') return 'border-amber-600/60 bg-amber-900/10';
  if (pathId === 'revolutionary_flame') return 'border-red-600/60 bg-red-900/10';
  if (pathId === 'last_defenders') return 'border-blue-600/60 bg-blue-900/10';
  return 'border-cc-gold/60 bg-cc-gold/5';
}

// ── Path Selection Screen ──────────────────────────────────────────────

function PathSelectionScreen({
  paths,
  onSelect,
  onClassic,
  starting,
}: {
  paths: AvailablePath[];
  onSelect: (pathId: string) => void;
  onClassic: () => void;
  starting: boolean;
}) {
  return (
    <div>
      <h2 className="text-sm uppercase tracking-widest text-cc-muted mb-2">Choose Your Campaign</h2>
      <p className="text-cc-muted text-sm mb-6">
        Each path puts you in a distinct historical narrative that builds across all six eras.
      </p>
      <div className="flex flex-col gap-4 mb-6">
        {paths.map((path) => (
          <button
            key={path.path_id}
            onClick={() => onSelect(path.path_id)}
            disabled={starting}
            className={`text-left p-4 rounded-lg border transition-colors hover:border-cc-text disabled:opacity-60 ${pathAccentColor(path.path_id)}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <CarryIcon carryKey={path.signature_carry_key} className={`w-4 h-4 ${carryColor(path.signature_carry_key)}`} />
                  <span className="font-semibold text-cc-text">{path.name}</span>
                </div>
                <p className="text-xs text-cc-muted italic mb-2">{path.tagline}</p>
                <p className="text-sm text-cc-muted">{path.description}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-cc-muted flex-shrink-0 mt-1" />
            </div>
          </button>
        ))}
      </div>
      <div className="border-t border-cc-border pt-4">
        <button
          onClick={onClassic}
          disabled={starting}
          className="w-full text-left p-4 rounded-lg border border-cc-border bg-cc-surface/50 hover:border-cc-text transition-colors disabled:opacity-60"
        >
          <div className="flex items-center gap-2 mb-1">
            <Sword className="w-4 h-4 text-cc-muted" />
            <span className="font-semibold text-cc-text">Classic Campaign</span>
          </div>
          <p className="text-xs text-cc-muted">Free faction choice, standard progression — no narrative path.</p>
        </button>
      </div>
    </div>
  );
}

// ── Carry Badge ────────────────────────────────────────────────────────

function PathCarryBadge({ campaign }: { campaign: Campaign }) {
  const pc = campaign.path_config;
  if (!pc) return null;
  const value = campaign.path_carry[pc.signature_carry_key] ?? 0;
  if (value <= 0) return null;

  return (
    <div className={`flex items-center gap-2 border rounded-lg px-4 py-2 w-fit ${carryBgColor(pc.signature_carry_key)}`}>
      <CarryIcon carryKey={pc.signature_carry_key} className={`w-4 h-4 ${carryColor(pc.signature_carry_key)}`} />
      <span className={`text-sm font-semibold ${carryColor(pc.signature_carry_key)}`}>
        {pc.signature_carry_label}: {value} / {pc.signature_carry_max}
      </span>
    </div>
  );
}

// ── Era Row ────────────────────────────────────────────────────────────

function EraRow({
  era,
  idx,
  isCurrent,
  isLocked,
  isDone,
  isAttempted,
  narrative,
  pathNarrative,
}: {
  era: CampaignEraEntry;
  idx: number;
  isCurrent: boolean;
  isLocked: boolean;
  isDone: boolean;
  isAttempted: boolean;
  narrative: boolean;
  pathNarrative: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const outcomeKey = `era_${idx}_outcome`;
  const outcome = pathNarrative[outcomeKey];
  const outroText = outcome === 'won' ? era.outro_win_text : outcome === 'lost' ? era.outro_loss_text : null;

  const hasNarrative = narrative && (era.intro_text || outroText);

  return (
    <div
      className={`rounded-lg border transition-colors ${
        isCurrent
          ? 'border-cc-gold/60 bg-cc-gold/5'
          : isDone
            ? 'border-green-600/40 bg-green-900/10'
            : isAttempted
              ? 'border-red-700/40 bg-red-900/10'
              : 'border-cc-border bg-cc-surface/50'
      }`}
    >
      <div className="flex items-center gap-4 p-3">
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
            {ERA_LABELS[era.era_id] ?? era.era_id}
          </p>
          {era.faction_id && !isLocked && (
            <p className="text-xs text-cc-muted mt-0.5 capitalize">{era.faction_id.replace(/_/g, ' ')}</p>
          )}
          {isAttempted && !isDone && (
            <p className="text-xs text-red-400 mt-0.5">Failed — try again</p>
          )}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          isDone ? 'bg-green-900/50 text-green-300' :
          isCurrent ? 'bg-cc-gold/20 text-cc-gold' :
          'bg-gray-800 text-cc-muted'
        }`}>
          {idx + 1} / {CAMPAIGN_ERAS.length}
        </span>
        {hasNarrative && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-cc-muted hover:text-cc-text transition-colors flex-shrink-0"
            aria-label={expanded ? 'Collapse narrative' : 'Expand narrative'}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        )}
      </div>

      {expanded && hasNarrative && (
        <div className="px-4 pb-4 border-t border-cc-border/50 mt-0 pt-3 space-y-2">
          {!era.completed && era.intro_text && (
            <p className="text-sm text-cc-muted italic">{era.intro_text}</p>
          )}
          {outroText && (
            <div className={`text-sm italic ${outcome === 'won' ? 'text-green-300' : 'text-red-300'}`}>
              {outroText}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────

export default function CampaignPage() {
  useAuthStore();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [availablePaths, setAvailablePaths] = useState<AvailablePath[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [showPathSelection, setShowPathSelection] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get<Campaign>('/campaign/me').then((r) => r.data).catch((err) => {
        if (err?.response?.status !== 404) toast.error('Failed to load campaign');
        return null;
      }),
      api.get<AvailablePath[]>('/campaign/paths').then((r) => r.data).catch(() => []),
    ]).then(([campaignData, pathsData]) => {
      setCampaign(campaignData);
      setAvailablePaths(pathsData);
      // Show path selection if no campaign exists
      if (!campaignData) setShowPathSelection(true);
    }).finally(() => setLoading(false));
  }, []);

  const handleStartWithPath = async (pathId?: string) => {
    setStarting(true);
    try {
      const res = await api.post<{ campaign_id: string; game_id: string }>(
        '/campaign/start',
        pathId ? { path_id: pathId } : {},
      );
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

  // Campaign select / new campaign screen
  if (showPathSelection && !campaign) {
    return (
      <div className="min-h-screen bg-cc-dark text-cc-text">
        <div className="max-w-3xl mx-auto px-4 py-8">
          <div className="flex items-center gap-3 mb-8">
            <Link to="/profile" className="text-cc-gold hover:text-white transition-colors text-sm">← Back</Link>
            <span className="text-cc-muted">·</span>
            <h1 className="font-display text-2xl text-cc-gold tracking-widest">ERA CAMPAIGN</h1>
          </div>
          <PathSelectionScreen
            paths={availablePaths}
            onSelect={(pathId) => handleStartWithPath(pathId)}
            onClassic={() => handleStartWithPath(undefined)}
            starting={starting}
          />
        </div>
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
          {campaign?.path_config && (
            <span className="text-sm text-cc-muted">— {campaign.path_config.name}</span>
          )}
        </div>

        {/* Path tagline */}
        {campaign?.path_config && (
          <div className={`mb-4 p-3 rounded-lg border ${pathAccentColor(campaign.path_id!)}`}>
            <p className="text-sm text-cc-muted italic">{campaign.path_config.tagline}</p>
          </div>
        )}

        {/* Badges row */}
        <div className="mb-6 flex flex-wrap gap-3">
          {campaign && campaign.prestige_points > 0 && (
            <div className="flex items-center gap-2 bg-amber-900/30 border border-amber-600/40 rounded-lg px-4 py-2">
              <Trophy className="w-4 h-4 text-amber-400" />
              <span className="text-amber-300 text-sm font-semibold">{campaign.prestige_points} Prestige</span>
            </div>
          )}
          {campaign && <PathCarryBadge campaign={campaign} />}
        </div>

        {/* Campaign timeline */}
        <div className="mb-8">
          <h2 className="text-sm uppercase tracking-widest text-cc-muted mb-4">Campaign Progress</h2>
          <div className="flex flex-col gap-2">
            {CAMPAIGN_ERAS.map((era, idx) => {
              const entry = campaign?.eras.find((e) => e.era_id === era) ?? {
                era_id: era, index: idx, won: false, completed: false,
                game_id: null, faction_id: null, map_id: `era_${era}`,
                intro_text: null, outro_win_text: null, outro_loss_text: null,
              };
              const isCurrent = campaign?.current_era === era && campaign?.status === 'active';
              const isLocked = !campaign || idx > campaign.current_era_index;
              const isDone = entry.won === true;
              const isAttempted = entry.completed === true && !isDone;

              return (
                <EraRow
                  key={era}
                  era={entry}
                  idx={idx}
                  isCurrent={isCurrent}
                  isLocked={isLocked}
                  isDone={isDone}
                  isAttempted={isAttempted}
                  narrative={!!campaign?.path_id}
                  pathNarrative={campaign?.path_narrative ?? {}}
                />
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 flex-wrap">
          {!campaign ? (
            <button
              onClick={() => setShowPathSelection(true)}
              disabled={starting}
              className="px-6 py-3 bg-cc-gold text-cc-dark font-semibold rounded-lg hover:bg-yellow-400 transition-colors disabled:opacity-60"
            >
              {starting ? 'Starting…' : 'Start Campaign'}
            </button>
          ) : campaign.status === 'completed' ? (
            <div className="flex flex-col gap-2">
              <p className="text-green-400 font-semibold">🏆 Campaign Completed!</p>
              <button
                onClick={() => {
                  setCampaign(null);
                  setShowPathSelection(true);
                }}
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
              Continue → {ERA_LABELS[campaign.current_era ?? ''] ?? campaign.current_era}
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
