import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import {
  Trophy, ChevronRight, CheckCircle, Circle, Lock,
  Flame, Shield, Sword, ChevronDown, ChevronUp, Plus,
} from 'lucide-react';
import { ERA_LABELS } from '../constants/gameLobbyLabels';
import SubpageShell from '../components/ui/SubpageShell';

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

// ── Helpers ────────────────────────────────────────────────────────────

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

function pathAccentColor(pathId: string | null): string {
  if (pathId === 'blood_empire') return 'border-amber-600/60 bg-amber-900/10';
  if (pathId === 'revolutionary_flame') return 'border-red-600/60 bg-red-900/10';
  if (pathId === 'last_defenders') return 'border-blue-600/60 bg-blue-900/10';
  return 'border-bf-gold/60 bg-bf-gold/5';
}

function campaignDisplayName(c: Campaign): string {
  return c.path_config?.name ?? 'Classic Campaign';
}

// ── Path Selection Screen ──────────────────────────────────────────────

function PathSelectionScreen({
  paths,
  activePathIds,
  hasActiveClassic,
  onSelect,
  onClassic,
  onCancel,
  starting,
  canCancel,
}: {
  paths: AvailablePath[];
  activePathIds: Set<string>;
  hasActiveClassic: boolean;
  onSelect: (pathId: string) => void;
  onClassic: () => void;
  onCancel: () => void;
  starting: boolean;
  canCancel: boolean;
}) {
  return (
    <div>
      <h2 className="text-sm uppercase tracking-widest text-bf-muted mb-2">Choose Your Campaign</h2>
      <p className="text-bf-muted text-sm mb-6">
        Each path puts you in a distinct historical narrative that builds across all six eras.
      </p>
      <div className="flex flex-col gap-4 mb-6">
        {paths.map((path) => {
          const alreadyActive = activePathIds.has(path.path_id);
          return (
            <button
              key={path.path_id}
              onClick={() => onSelect(path.path_id)}
              disabled={starting || alreadyActive}
              title={alreadyActive ? 'You already have an active campaign on this path' : undefined}
              className={`text-left p-4 rounded-lg border transition-colors hover:border-bf-text disabled:opacity-40 disabled:cursor-not-allowed ${pathAccentColor(path.path_id)}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <CarryIcon carryKey={path.signature_carry_key} className={`w-4 h-4 ${carryColor(path.signature_carry_key)}`} />
                    <span className="font-semibold text-bf-text">{path.name}</span>
                    {alreadyActive && (
                      <span className="ml-1 text-[10px] uppercase tracking-widest text-bf-muted bg-bf-surface border border-bf-border rounded-full px-2 py-0.5">
                        In progress
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-bf-muted italic mb-2">{path.tagline}</p>
                  <p className="text-sm text-bf-muted">{path.description}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-bf-muted flex-shrink-0 mt-1" />
              </div>
            </button>
          );
        })}
      </div>
      <div className="border-t border-bf-border pt-4 flex flex-col gap-3">
        <button
          onClick={onClassic}
          disabled={starting || hasActiveClassic}
          title={hasActiveClassic ? 'You already have an active classic campaign' : undefined}
          className="w-full text-left p-4 rounded-lg border border-bf-border bg-bf-surface/50 hover:border-bf-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <div className="flex items-center gap-2 mb-1">
            <Sword className="w-4 h-4 text-bf-muted" />
            <span className="font-semibold text-bf-text">Classic Campaign</span>
            {hasActiveClassic && (
              <span className="ml-1 text-[10px] uppercase tracking-widest text-bf-muted bg-bf-surface border border-bf-border rounded-full px-2 py-0.5">
                In progress
              </span>
            )}
          </div>
          <p className="text-xs text-bf-muted">Free faction choice, standard progression — no narrative path.</p>
        </button>
        {canCancel && (
          <button
            onClick={onCancel}
            disabled={starting}
            className="self-start text-sm text-bf-muted hover:text-bf-text transition-colors disabled:opacity-60"
          >
            ← Back to campaigns
          </button>
        )}
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
          ? 'border-bf-gold/60 bg-bf-gold/5'
          : isDone
            ? 'border-green-600/40 bg-green-900/10'
            : isAttempted
              ? 'border-red-700/40 bg-red-900/10'
              : 'border-bf-border bg-bf-surface/50'
      }`}
    >
      <div className="flex items-center gap-4 p-3">
        <div className="w-6 flex-shrink-0">
          {isDone ? (
            <CheckCircle className="w-5 h-5 text-green-400" />
          ) : isLocked ? (
            <Lock className="w-4 h-4 text-bf-muted" />
          ) : isCurrent ? (
            <ChevronRight className="w-5 h-5 text-bf-gold" />
          ) : (
            <Circle className="w-4 h-4 text-bf-muted" />
          )}
        </div>
        <div className="flex-1">
          <p className={`text-sm font-medium ${isCurrent ? 'text-bf-gold' : isDone ? 'text-green-300' : isLocked ? 'text-bf-muted' : 'text-bf-text'}`}>
            {ERA_LABELS[era.era_id] ?? era.era_id}
          </p>
          {era.faction_id && !isLocked && (
            <p className="text-xs text-bf-muted mt-0.5 capitalize">{era.faction_id.replace(/_/g, ' ')}</p>
          )}
          {isAttempted && !isDone && (
            <p className="text-xs text-red-400 mt-0.5">Failed — try again</p>
          )}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          isDone ? 'bg-green-900/50 text-green-300' :
          isCurrent ? 'bg-bf-gold/20 text-bf-gold' :
          'bg-gray-800 text-bf-muted'
        }`}>
          {idx + 1} / {CAMPAIGN_ERAS.length}
        </span>
        {hasNarrative && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-bf-muted hover:text-bf-text transition-colors flex-shrink-0"
            aria-label={expanded ? 'Collapse narrative' : 'Expand narrative'}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        )}
      </div>

      {expanded && hasNarrative && (
        <div className="px-4 pb-4 border-t border-bf-border/50 mt-0 pt-3 space-y-2">
          {!era.completed && era.intro_text && (
            <p className="text-sm text-bf-muted italic">{era.intro_text}</p>
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

// ── Campaign List Card (for the picker) ────────────────────────────────

function CampaignListCard({
  campaign,
  onOpen,
}: {
  campaign: Campaign;
  onOpen: () => void;
}) {
  const wonCount = campaign.eras.filter((e) => e.won).length;
  const currentLabel = campaign.current_era ? (ERA_LABELS[campaign.current_era] ?? campaign.current_era) : '—';
  const isCompleted = campaign.status === 'completed';

  return (
    <button
      onClick={onOpen}
      className={`text-left p-4 rounded-lg border transition-colors hover:border-bf-text ${pathAccentColor(campaign.path_id)}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <CarryIcon
              carryKey={campaign.path_config?.signature_carry_key ?? 'prestige'}
              className={`w-4 h-4 ${carryColor(campaign.path_config?.signature_carry_key ?? 'prestige')}`}
            />
            <span className="font-semibold text-bf-text">{campaignDisplayName(campaign)}</span>
            {isCompleted ? (
              <span className="text-[10px] uppercase tracking-widest bg-green-900/50 text-green-300 rounded-full px-2 py-0.5">
                Completed
              </span>
            ) : (
              <span className="text-[10px] uppercase tracking-widest bg-bf-gold/20 text-bf-gold rounded-full px-2 py-0.5">
                Active
              </span>
            )}
          </div>
          {campaign.path_config?.tagline && (
            <p className="text-xs text-bf-muted italic mb-2">{campaign.path_config.tagline}</p>
          )}
          <div className="flex flex-wrap items-center gap-3 text-xs text-bf-muted">
            <span>
              {isCompleted ? 'Final era cleared' : (
                <>Next up: <span className="text-bf-text font-medium">{currentLabel}</span></>
              )}
            </span>
            <span>· {wonCount} / {CAMPAIGN_ERAS.length} eras won</span>
            {campaign.prestige_points > 0 && (
              <span className="flex items-center gap-1">
                · <Trophy className="w-3 h-3 text-amber-400" /> {campaign.prestige_points}
              </span>
            )}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-bf-muted flex-shrink-0 mt-1" />
      </div>
    </button>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────

export default function CampaignPage() {
  useAuthStore();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [availablePaths, setAvailablePaths] = useState<AvailablePath[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [continuing, setContinuing] = useState<string | null>(null);
  const [showPathSelection, setShowPathSelection] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get('campaign_id'));

  const refresh = React.useCallback(async () => {
    try {
      const [listRes, pathsRes] = await Promise.all([
        api.get<{ campaigns: Campaign[] }>('/campaign/list').then((r) => r.data.campaigns).catch(() => []),
        api.get<AvailablePath[]>('/campaign/paths').then((r) => r.data).catch(() => []),
      ]);
      setCampaigns(listRes);
      setAvailablePaths(pathsRes);
      // If no campaigns at all, drop the user straight into path selection.
      if (listRes.length === 0) {
        setShowPathSelection(true);
        setSelectedId(null);
      } else if (selectedId && !listRes.find((c) => c.campaign_id === selectedId)) {
        setSelectedId(null);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void refresh();
     
  }, []);

  const activePathIds = new Set(
    campaigns.filter((c) => c.status === 'active' && c.path_id).map((c) => c.path_id!),
  );
  const hasActiveClassic = campaigns.some((c) => c.status === 'active' && !c.path_id);

  const activeCampaigns = campaigns.filter((c) => c.status === 'active');
  const completedCampaigns = campaigns.filter((c) => c.status === 'completed');

  const selectedCampaign = selectedId ? campaigns.find((c) => c.campaign_id === selectedId) ?? null : null;

  const handleStartWithPath = async (pathId?: string) => {
    setStarting(true);
    try {
      const res = await api.post<{ campaign_id: string; game_id: string }>(
        '/campaign/start',
        pathId ? { path_id: pathId } : {},
      );
      navigate(`/game/${res.data.game_id}`);
    } catch (err: unknown) {
      const errData = (err as { response?: { data?: { error?: string; campaign_id?: string } } })?.response?.data;
      const msg = errData?.error ?? 'Failed to start campaign';
      toast.error(msg);
      // If the backend says there's already an active campaign on this path,
      // send the user into it instead of leaving them on a dead-end error.
      if (errData?.campaign_id) {
        await refresh();
        setSelectedId(errData.campaign_id);
        setShowPathSelection(false);
      }
    } finally {
      setStarting(false);
    }
  };

  const handleContinue = async (campaign: Campaign) => {
    if (campaign.status === 'completed') return;
    setContinuing(campaign.campaign_id);
    try {
      const res = await api.post<{ game_id: string }>(
        '/campaign/continue',
        { campaign_id: campaign.campaign_id },
      );
      navigate(`/game/${res.data.game_id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not continue campaign';
      toast.error(msg);
    } finally {
      setContinuing(null);
    }
  };

  const openCampaign = (id: string) => {
    setSelectedId(id);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('campaign_id', id);
      return next;
    }, { replace: true });
  };

  const closeCampaign = () => {
    setSelectedId(null);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('campaign_id');
      return next;
    }, { replace: true });
  };

  if (loading) {
    return (
      <SubpageShell title="ERA CAMPAIGNS" icon={Trophy}>
        <p className="text-bf-muted text-center py-12">Loading campaigns…</p>
      </SubpageShell>
    );
  }

  // ── Path selection screen ─────────────────────────────────────────
  if (showPathSelection) {
    return (
      <SubpageShell title="NEW CAMPAIGN" icon={Sword}>
          <PathSelectionScreen
            paths={availablePaths}
            activePathIds={activePathIds}
            hasActiveClassic={hasActiveClassic}
            onSelect={(pathId) => handleStartWithPath(pathId)}
            onClassic={() => handleStartWithPath(undefined)}
            onCancel={() => setShowPathSelection(false)}
            starting={starting}
            canCancel={campaigns.length > 0}
          />
      </SubpageShell>
    );
  }

  // ── Campaign detail view ──────────────────────────────────────────
  if (selectedCampaign) {
    const campaign = selectedCampaign;
    const isContinuing = continuing === campaign.campaign_id;
    const pathSubtitle = campaign.path_config?.name ?? 'Classic';
    return (
      <SubpageShell title="ERA CAMPAIGN" icon={Trophy}>
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={closeCampaign}
              className="text-sm text-bf-muted hover:text-bf-text transition-colors"
            >
              ← All Campaigns
            </button>
            <span className="text-bf-muted text-sm">·</span>
            <span className="text-sm text-bf-muted">{pathSubtitle}</span>
          </div>

          {/* Path tagline */}
          {campaign.path_config && (
            <div className={`mb-4 p-3 rounded-lg border ${pathAccentColor(campaign.path_id)}`}>
              <p className="text-sm text-bf-muted italic">{campaign.path_config.tagline}</p>
            </div>
          )}

          {/* Badges */}
          <div className="mb-6 flex flex-wrap gap-3">
            {campaign.prestige_points > 0 && (
              <div className="flex items-center gap-2 bg-amber-900/30 border border-amber-600/40 rounded-lg px-4 py-2">
                <Trophy className="w-4 h-4 text-amber-400" />
                <span className="text-amber-300 text-sm font-semibold">{campaign.prestige_points} Prestige</span>
              </div>
            )}
            <PathCarryBadge campaign={campaign} />
          </div>

          {/* Timeline */}
          <div className="mb-8">
            <h2 className="text-sm uppercase tracking-widest text-bf-muted mb-4">Campaign Progress</h2>
            <div className="flex flex-col gap-2">
              {CAMPAIGN_ERAS.map((era, idx) => {
                const entry = campaign.eras.find((e) => e.era_id === era) ?? {
                  era_id: era, index: idx, won: false, completed: false,
                  game_id: null, faction_id: null, map_id: `era_${era}`,
                  intro_text: null, outro_win_text: null, outro_loss_text: null,
                };
                const isCurrent = campaign.current_era === era && campaign.status === 'active';
                const isLocked = idx > campaign.current_era_index;
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
                    narrative={!!campaign.path_id}
                    pathNarrative={campaign.path_narrative ?? {}}
                  />
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 flex-wrap">
            {campaign.status === 'completed' ? (
              <>
                <div className="flex flex-col gap-2">
                  <p className="text-green-400 font-semibold">🏆 Campaign Completed!</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowPathSelection(true)}
                  className="btn-primary"
                >
                  Start Another Campaign
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => handleContinue(campaign)}
                disabled={isContinuing}
                className="btn-primary disabled:opacity-60"
              >
                {isContinuing
                  ? 'Preparing era…'
                  : `Continue → ${ERA_LABELS[campaign.current_era ?? ''] ?? campaign.current_era}`}
              </button>
            )}
            <button
              type="button"
              onClick={closeCampaign}
              className="btn-secondary"
            >
              All Campaigns
            </button>
          </div>
      </SubpageShell>
    );
  }

  // ── Campaign list (multi-campaign picker) ─────────────────────────
  return (
    <SubpageShell title="ERA CAMPAIGNS" icon={Trophy}>
        {/* Active campaigns */}
        {activeCampaigns.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm uppercase tracking-widest text-bf-muted mb-4">
              Active ({activeCampaigns.length})
            </h2>
            <div className="flex flex-col gap-3">
              {activeCampaigns.map((c) => (
                <CampaignListCard
                  key={c.campaign_id}
                  campaign={c}
                  onOpen={() => openCampaign(c.campaign_id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Start new */}
        <div className="mb-8">
          <button
            type="button"
            onClick={() => setShowPathSelection(true)}
            disabled={starting}
            className="btn-primary w-full gap-2 disabled:opacity-60"
          >
            <Plus className="w-4 h-4" />
            {starting ? 'Starting…' : 'Start New Campaign'}
          </button>
          <p className="mt-2 text-xs text-bf-muted text-center">
            Run multiple campaigns in parallel — each path tracks its own progression.
          </p>
        </div>

        {/* Completed */}
        {completedCampaigns.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm uppercase tracking-widest text-bf-muted mb-4">
              Completed ({completedCampaigns.length})
            </h2>
            <div className="flex flex-col gap-3">
              {completedCampaigns.map((c) => (
                <CampaignListCard
                  key={c.campaign_id}
                  campaign={c}
                  onOpen={() => openCampaign(c.campaign_id)}
                />
              ))}
            </div>
          </div>
        )}

    </SubpageShell>
  );
}
