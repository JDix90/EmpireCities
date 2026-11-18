import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { carryEffectLine, type CampaignCarryEffect } from '../utils/campaignCarry';
import { useAuthStore } from '../store/authStore';
import { api } from '../services/api';
import toast from 'react-hot-toast';
import {
  Trophy, ChevronRight, CheckCircle, Circle, Lock,
  Flame, Shield, Sword, ChevronDown, ChevronUp, Plus,
} from 'lucide-react';
import { ERA_LABELS } from '../constants/gameLobbyLabels';
import SubpageShell from '../components/ui/SubpageShell';
import GuestGateModal from '../components/ui/GuestGateModal';
import {
  CAMPAIGN_START_GATE, CAMPAIGN_START_GATE_V2, CAMPAIGN_START_GATE_SAVE, CAMPAIGN_PATH_GATE,
  GUEST_SAVED_HERE, SAVE_ACCOUNT_LABEL, withGuestsRanked,
} from '../utils/guestGate';
import { useGuestPromptV2Enabled } from '../store/featureFlagsStore';
import { useGuestCampaignEnabled, useGuestLeaderboardsEnabled, useSaveAccountCopyEnabled } from '../store/featureFlagsStore';
import { ownAuthUiAllowed } from '../utils/embedContext';
import { pendingLineChoice, type CampaignLineChoice } from '../utils/campaignLine';
import { factionDisplayName } from '../utils/factionNames';

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
  /** The stage's own name, where it has one. Absent from an older server. */
  title?: string | null;
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
  /** What the campaign will carry into its next stage, in words. Absent from an older server. */
  carry_effects?: CampaignCarryEffect[];
  path_narrative: Record<string, string>;
  /** The side the path lets the player take. Absent on a path with none. */
  line_choice?: CampaignLineChoice | null;
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
  /** How hard the path is next to the others. Absent from an older server. */
  difficulty?: 'standard' | 'hard' | 'hardest';
  /** The path to start with. */
  recommended_start?: boolean;
  /** The most rounds its opening stage can run. */
  first_stage_max_turns?: number;
  /** A guest can play it while guest_campaign_enabled is on. Absent from an older server. */
  guest_open?: boolean;
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

function pathAccentColor(pathId: string | null): string {
  if (pathId === 'blood_empire') return 'border-amber-600/60 bg-amber-900/10';
  if (pathId === 'revolutionary_flame') return 'border-red-600/60 bg-red-900/10';
  if (pathId === 'last_defenders') return 'border-blue-600/60 bg-blue-900/10';
  return 'border-bf-gold/60 bg-bf-gold/5';
}

function campaignDisplayName(c: Campaign): string {
  return c.path_config?.name ?? 'Classic Campaign';
}

const PATH_DIFFICULTY_LABEL: Record<string, string> = {
  standard: 'Standard',
  hard: 'Hard',
  hardest: 'Hardest',
};

/** "Standard · 6 eras · Opening stage: up to 25 rounds", from what the server sends of it. */
export function pathMetaLine(path: Pick<AvailablePath, 'difficulty' | 'era_count' | 'first_stage_max_turns'>): string {
  return [
    path.difficulty ? PATH_DIFFICULTY_LABEL[path.difficulty] ?? null : null,
    path.era_count ? `${path.era_count} eras` : null,
    path.first_stage_max_turns ? `Opening stage: up to ${path.first_stage_max_turns} rounds` : null,
  ].filter(Boolean).join(' \u00b7 ');
}

// ── Path Selection Screen ──────────────────────────────────────────────

function PathSelectionScreen({
  paths,
  activePathIds,
  onSelect,
  onCancel,
  starting,
  canCancel,
  needsAccount,
}: {
  paths: AvailablePath[];
  activePathIds: Set<string>;
  /** For a guest who can play some paths: whether this one still needs a saved account. */
  needsAccount?: (path: AvailablePath) => boolean;
  onSelect: (pathId: string) => void;
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
                    {path.recommended_start && !alreadyActive && (
                      <span
                        className="ml-1 text-[10px] uppercase tracking-widest text-bf-gold bg-bf-gold/10 border border-bf-gold/40 rounded-full px-2 py-0.5"
                        data-testid="campaign-path-start-here"
                      >
                        Start here
                      </span>
                    )}
                    {needsAccount?.(path) && (
                      <span
                        className="ml-1 text-[10px] uppercase tracking-widest text-bf-muted bg-bf-surface border border-bf-border rounded-full px-2 py-0.5"
                        data-testid="campaign-path-needs-account"
                      >
                        Needs a saved account
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-bf-muted italic mb-2">{path.tagline}</p>
                  {pathMetaLine(path) && (
                    <p className="text-xs text-bf-text/80 mb-2" data-testid="campaign-path-meta">{pathMetaLine(path)}</p>
                  )}
                  <p className="text-sm text-bf-muted">{path.description}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-bf-muted flex-shrink-0 mt-1" />
              </div>
            </button>
          );
        })}
      </div>
      <div className="border-t border-bf-border pt-4 flex flex-col gap-3">
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

// ── Carry effects ──────────────────────────────────────────────────────

/**
 * What the campaign carries into its next stage: the effect each stat has,
 * as the server words it. The stored numbers ("Prestige: 6 / 12") ran past
 * what the game applies, so they are not shown.
 */
function CarryEffects({ campaign }: { campaign: Campaign }) {
  const effects = campaign.carry_effects ?? [];
  if (effects.length === 0 || campaign.status === 'completed') return null;
  return (
    <div className="mb-6 rounded-lg border border-bf-gold/25 bg-bf-gold/5 px-4 py-3" data-testid="campaign-carry-effects">
      <p className="text-[11px] uppercase tracking-widest text-bf-muted mb-1.5">Carried into your next era</p>
      <ul className="space-y-1">
        {effects.map((effect) => (
          <li key={effect.key} className="flex items-center gap-2 text-sm text-bf-text">
            <Trophy className="w-3.5 h-3.5 text-bf-gold shrink-0" aria-hidden />
            {carryEffectLine(effect)}
          </li>
        ))}
      </ul>
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
            {era.title && !isLocked && <span className="font-normal text-bf-muted"> · {era.title}</span>}
          </p>
          {era.faction_id && !isLocked && (
            <p className="text-xs text-bf-muted mt-0.5 capitalize">
              {factionDisplayName(era.era_id, era.faction_id) ?? era.faction_id.replace(/_/g, ' ')}
            </p>
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
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-bf-muted flex-shrink-0 mt-1" />
      </div>
    </button>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────

export default function CampaignPage() {
  const isGuest = useAuthStore((s) => !!s.user?.is_guest);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [availablePaths, setAvailablePaths] = useState<AvailablePath[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [continuing, setContinuing] = useState<string | null>(null);
  const [showPathSelection, setShowPathSelection] = useState(false);
  const [showGuestGate, setShowGuestGate] = useState(false);
  /** The campaign whose side is being chosen, while its dialog is open. */
  const [choosingLineFor, setChoosingLineFor] = useState<string | null>(null);
  const guestPromptV2 = useGuestPromptV2Enabled();
  const saveAccountCopy = useSaveAccountCopyEnabled();
  const guestsRanked = useGuestLeaderboardsEnabled();
  const guestCampaign = useGuestCampaignEnabled();
  // Choosing a path used to create and open the Era 1 game on the spot, with
  // no settings shown and no way back; the run then sat in HQ as "active"
  // (PT-017). The choice now opens a confirmation first.
  const [pendingStart, setPendingStart] = useState<{ pathId?: string; name: string; tagline?: string } | null>(null);
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

  const activeCampaigns = campaigns.filter((c) => c.status === 'active');
  const completedCampaigns = campaigns.filter((c) => c.status === 'completed');

  const selectedCampaign = selectedId ? campaigns.find((c) => c.campaign_id === selectedId) ?? null : null;

  /** Whether this guest can play the path: the flag is on and the server marks it open. */
  const guestMayPlay = (pathId?: string): boolean =>
    guestCampaign && !!pathId && availablePaths.find((p) => p.path_id === pathId)?.guest_open === true;

  const handleStartWithPath = async (pathId?: string) => {
    // A guest may browse campaigns (GET /campaign/list and /paths take any
    // authenticated caller) but not start one — POST /campaign/start carries
    // `rejectGuest` and answers 403. Intercepting here turns that dead end into
    // the account offer at the moment they have chosen a campaign and pressed go.
    // With guest_campaign_enabled the server lets a guest into the paths it
    // marks open; any other still gets the offer.
    if (isGuest && !guestMayPlay(pathId)) {
      setShowGuestGate(true);
      return;
    }
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

  const startConfirm = pendingStart && (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 pt-safe pb-safe"
      onClick={() => setPendingStart(null)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="campaign-start-title"
        className="bg-bf-surface border border-bf-border rounded-xl p-5 sm:p-6 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[11px] uppercase tracking-widest text-bf-muted mb-1">Start a campaign</p>
        <h3 id="campaign-start-title" className="font-display text-lg text-bf-gold mb-1">{pendingStart.name}</h3>
        {pendingStart.tagline && <p className="text-xs text-bf-muted italic mb-3">{pendingStart.tagline}</p>}
        <p className="text-sm text-bf-muted mb-5">
          This creates your first era&apos;s game and opens it. The run stays in Campaign HQ, and a stage
          you leave part-way is kept there to pick up.
        </p>
        {/* A guest can play on; saving is offered, never required. */}
        {isGuest && ownAuthUiAllowed() && (
          <p className="text-xs text-bf-muted -mt-3 mb-5" data-testid="campaign-start-guest-note">
            {GUEST_SAVED_HERE}. You can save your account at any point to keep this campaign safe and play it
            on any device.
          </p>
        )}
        <div className="flex gap-3">
          <button type="button" className="btn-secondary flex-1" onClick={() => setPendingStart(null)}>
            Not yet
          </button>
          <button
            type="button"
            className="btn-primary flex-1 disabled:opacity-60"
            disabled={starting}
            onClick={() => {
              const pathId = pendingStart.pathId;
              setPendingStart(null);
              void handleStartWithPath(pathId);
            }}
          >
            {starting ? 'Starting…' : 'Start campaign'}
          </button>
        </div>
      </div>
    </div>
  );

  const handleContinue = async (campaign: Campaign, line?: string) => {
    if (campaign.status === 'completed') return;
    // A stage that offers a side asks for it before it deals the game.
    if (!line && pendingLineChoice(campaign)) {
      setChoosingLineFor(campaign.campaign_id);
      return;
    }
    setChoosingLineFor(null);
    setContinuing(campaign.campaign_id);
    try {
      const res = await api.post<{ game_id: string }>(
        '/campaign/continue',
        { campaign_id: campaign.campaign_id, ...(line ? { line } : {}) },
      );
      navigate(`/game/${res.data.game_id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not continue campaign';
      toast.error(msg);
    } finally {
      setContinuing(null);
    }
  };

  // The side to fight on, asked by the stage that offers one.
  const choosingCampaign = choosingLineFor ? campaigns.find((c) => c.campaign_id === choosingLineFor) ?? null : null;
  const lineChoice = choosingCampaign ? pendingLineChoice(choosingCampaign) : null;
  const lineChooser = choosingCampaign && lineChoice && (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 pt-safe pb-safe overflow-y-auto"
      onClick={() => setChoosingLineFor(null)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="campaign-line-title"
        data-testid="campaign-line-chooser"
        className="bg-bf-surface border border-bf-gold/35 rounded-xl p-5 sm:p-6 w-full max-w-2xl my-6"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[11px] uppercase tracking-widest text-bf-muted mb-1">
          {choosingCampaign.path_config?.name ?? 'Campaign'} · Era {lineChoice.choose_at + 1} of {CAMPAIGN_ERAS.length}
        </p>
        <h3 id="campaign-line-title" className="font-display text-xl text-bf-gold mb-1">Choose your side</h3>
        <p className="text-sm text-bf-muted mb-4">
          {ERA_LABELS[CAMPAIGN_ERAS[lineChoice.choose_at] ?? ''] ?? 'This era'} is fought from one of two sides, and
          the side you take is the one you lead through the eras that follow.
          {lineChoice.chosen ? ' You can change sides for as long as this era is not yet won.' : ''}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {lineChoice.options.map((option) => {
            const faction = factionDisplayName(CAMPAIGN_ERAS[lineChoice.choose_at], option.faction_id);
            return (
              <button
                key={option.line_id}
                type="button"
                data-testid={`campaign-line-${option.line_id}`}
                disabled={continuing === choosingCampaign.campaign_id}
                onClick={() => void handleContinue(choosingCampaign, option.line_id)}
                className="text-left rounded-lg border border-bf-border bg-bf-dark/50 hover:border-bf-gold/60 focus-visible:border-bf-gold/60 transition-colors p-4 disabled:opacity-60"
              >
                <p className="font-display text-lg text-bf-gold leading-tight">{option.name}</p>
                {option.title && <p className="text-sm text-bf-text mt-1">{option.title}</p>}
                {faction && <p className="text-xs text-bf-muted mt-0.5">You command: {faction}</p>}
                <p className="text-sm text-bf-muted mt-2">{option.pitch}</p>
                {lineChoice.chosen === option.line_id && (
                  <p className="text-xs text-bf-gold/80 mt-2">Your side on the last attempt</p>
                )}
              </button>
            );
          })}
        </div>
        <button type="button" className="btn-secondary w-full" onClick={() => setChoosingLineFor(null)}>
          Not yet
        </button>
      </div>
    </div>
  );

  // ?continue=1: a stage's results sent the player here to go straight on, to
  // the next era after a win or the same stage after a loss. Once, and the
  // parameter is dropped so Back does not start another game.
  const autoContinue = searchParams.get('continue') === '1';
  const autoContinuedRef = React.useRef(false);
  useEffect(() => {
    if (!autoContinue || loading || autoContinuedRef.current) return;
    autoContinuedRef.current = true;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('continue');
      return next;
    }, { replace: true });
    if (selectedCampaign && selectedCampaign.status === 'active') void handleContinue(selectedCampaign);
  }, [autoContinue, loading, selectedCampaign]);

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

  // Rendered by every branch a guest can reach a start action from. Fixed
  // positioning means it does not matter where in the tree it sits.
  // The gate's only action is creating an account, which a CrazyGames embed
  // forbids — so there it is not offered at all.
  // With the campaign open to guests the offer is about one path, not all of them.
  const gateCopy = guestCampaign && availablePaths.some((p) => p.guest_open)
    ? CAMPAIGN_PATH_GATE
    : saveAccountCopy ? CAMPAIGN_START_GATE_SAVE : guestPromptV2 ? CAMPAIGN_START_GATE_V2 : CAMPAIGN_START_GATE;
  const guestGate = showGuestGate && ownAuthUiAllowed() ? (
    <GuestGateModal
      copy={guestsRanked ? withGuestsRanked(gateCopy) : gateCopy}
      onCreateAccount={() => navigate('/upgrade')}
      onDismiss={() => setShowGuestGate(false)}
    />
  ) : null;

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
            onSelect={(pathId) => {
              // A guest gets the account offer, not a confirm, for a path not open to them.
              if (isGuest && !guestMayPlay(pathId)) { setShowGuestGate(true); return; }
              const path = availablePaths.find((p) => p.path_id === pathId);
              setPendingStart({ pathId, name: path?.name ?? 'Campaign', tagline: path?.tagline });
            }}
            onCancel={() => setShowPathSelection(false)}
            needsAccount={isGuest && guestCampaign ? (path) => !path.guest_open : undefined}
            starting={starting}
            canCancel={campaigns.length > 0}
          />
          {guestGate}
          {startConfirm}
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

          {/* A guest's run lives on this device until the account is saved:
              said here, where the run is, and never in the way of playing it. */}
          {isGuest && ownAuthUiAllowed() && campaign.status === 'active' && (
            <div
              className="mb-4 p-3 rounded-lg border border-bf-gold/30 bg-bf-gold/5 flex flex-col sm:flex-row sm:items-center gap-3"
              data-testid="campaign-guest-save"
            >
              <p className="text-sm text-bf-text flex-1">
                {GUEST_SAVED_HERE}. Save your account to keep this campaign safe, pick it up on any device and
                open the other paths.
              </p>
              <button type="button" className="btn-secondary flex-shrink-0" onClick={() => navigate('/upgrade')}>
                {SAVE_ACCOUNT_LABEL}
              </button>
            </div>
          )}

          {/* Badges */}
          <CarryEffects campaign={campaign} />

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
          {lineChooser}
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

        {guestGate}
    </SubpageShell>
  );
}
