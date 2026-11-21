import React, { useEffect, useRef, useState } from 'react';
import { Crown, Flag, Shield, Trophy } from 'lucide-react';
import { carryEffectLine, type CampaignCarryEffect } from '../../utils/campaignCarry';
import { api } from '../../services/api';

export interface CampaignIntroData {
  pathName?: string;
  pathTagline?: string;
  signatureCarryLabel?: string;
  eraIndex?: number;
  eraCount?: number;
  eraLabel: string;
  /** The stage's own name ("The Second Front, 1944"), where it has one. */
  stageTitle?: string;
  introText?: string;
  lockedFaction?: string | null;
  /** The powers the stage seats against the player, by display name. */
  opponents?: string[];
  aiDifficulty?: string | null;
  aiCount?: number | null;
  /** What the campaign carries into this stage, in words. */
  carryEffects?: CampaignCarryEffect[];
  /** How the stage is won ("Control 55% of the map"), any one of them. */
  goals?: string[];
  /** The clock's own way to win ("Most territory when turn 30 ends also wins"). */
  turnCap?: string | null;
  /** The stage's era and the player's faction id, to look up the faction's ability. */
  eraId?: string | null;
  lockedFactionId?: string | null;
}

interface CampaignIntroModalProps {
  data: CampaignIntroData;
  onBegin: () => void;
}

function titleCase(s: string): string {
  return s
    .split(/[_\s]+/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : ''))
    .join(' ')
    .trim();
}

export default function CampaignIntroModal({ data, onBegin }: CampaignIntroModalProps) {
  // Begin Era takes focus (Enter begins, as before) without scrolling to it:
  // autoFocus scrolled a card taller than the screen straight to its bottom,
  // past the era's title and story.
  const beginRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    beginRef.current?.focus({ preventScroll: true });
  }, []);

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

  const eraSubtitle =
    typeof data.eraIndex === 'number' && typeof data.eraCount === 'number'
      ? `Era ${data.eraIndex + 1} of ${data.eraCount} \u00b7 ${data.eraLabel}`
      : data.eraLabel;

  const carryEffects = data.carryEffects ?? [];
  const goals = data.goals ?? [];

  // The faction's ability, from the era endpoint the briefing and the Bonuses
  // modal read. Best effort: the line is left out until the fetch succeeds.
  const [ability, setAbility] = useState<string | null>(null);
  useEffect(() => {
    if (!data.eraId || !data.lockedFactionId) return;
    let cancelled = false;
    api
      .get(`/eras/${data.eraId}/factions`)
      .then((res) => {
        if (cancelled) return;
        const factions = (res.data?.factions ?? []) as Array<{ faction_id: string; ability_description?: string }>;
        setAbility(factions.find((f) => f.faction_id === data.lockedFactionId)?.ability_description ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [data.eraId, data.lockedFactionId]);

  return (
    // The card is taller than a phone screen. Centred in a fixed box that could
    // not scroll, it was cut off at both ends: its top under the status bar and
    // Begin Era against the home indicator. The overlay scrolls instead, the
    // card is centred only while it fits, and a margin clears the status bar
    // and home indicator (pt-safe-4 = 1rem + the inset; the inset is 0 in a
    // browser tab).
    <div
      className="fixed inset-0 z-[60] overflow-y-auto overscroll-contain bg-black/75 backdrop-blur-sm px-4 pt-safe-4 pb-safe-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="campaign-intro-title"
      data-testid="campaign-intro-overlay"
    >
      <div className="min-h-full flex items-center justify-center">
        <div className="bg-bf-surface border border-bf-gold/35 rounded-2xl p-6 sm:p-8 w-full max-w-lg shadow-2xl">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Crown className="w-4 h-4 text-bf-gold" />
            <p className="text-xs uppercase tracking-[0.28em] text-bf-gold/85 font-display">
              Era Campaign
            </p>
          </div>
          <p className="text-bf-muted text-xs text-center mb-4">{eraSubtitle}</p>

          <h2
            id="campaign-intro-title"
            className="font-display text-2xl sm:text-3xl text-bf-gold text-center mb-1"
          >
            {data.pathName ?? 'Classic Campaign'}
          </h2>
          {data.stageTitle ? (
            <p className="text-center text-bf-text text-base font-display mb-5" data-testid="campaign-intro-stage-title">
              {data.stageTitle}
            </p>
          ) : data.pathTagline && (
            <p className="text-center text-bf-muted text-sm italic mb-5">{data.pathTagline}</p>
          )}

          {data.introText && (
            <div className="mb-5">
              <p className="text-bf-text text-sm leading-relaxed">{data.introText}</p>
            </div>
          )}

          {/* How the stage is won, first: it is what the player came to do. */}
          {goals.length > 0 && (
            <div className="rounded-lg border border-bf-gold/40 bg-bf-gold/5 px-3 py-2.5 mb-3" data-testid="campaign-intro-goal">
              <p className="text-[10px] uppercase tracking-wider text-bf-gold/80 mb-1">{data.stageTitle ? 'Objective' : 'How to win'}</p>
              <ul className="space-y-0.5">
                {goals.map((goal, i) => (
                  <li key={goal} className="text-sm text-bf-text font-medium">
                    {i > 0 && <span className="text-bf-muted font-normal">or </span>}
                    {goal}
                  </li>
                ))}
              </ul>
              {data.turnCap && <p className="text-xs text-bf-muted mt-1">{data.turnCap}.</p>}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 mb-3">
            <div className="rounded-lg border border-bf-border bg-bf-dark/50 px-3 py-3 text-center">
              <Flag className="w-4 h-4 text-bf-gold/80 mx-auto mb-1.5" />
              <p className="text-[10px] uppercase tracking-wider text-bf-muted mb-0.5">Faction</p>
              <p className="text-sm text-bf-text font-medium leading-tight">
                {data.lockedFaction ? titleCase(data.lockedFaction) : 'Assigned when the era begins'}
              </p>
            </div>
            <div className="rounded-lg border border-bf-border bg-bf-dark/50 px-3 py-3 text-center">
              <Shield className="w-4 h-4 text-bf-gold/80 mx-auto mb-1.5" />
              <p className="text-[10px] uppercase tracking-wider text-bf-muted mb-0.5">Opposition</p>
              <p className="text-sm text-bf-text font-medium leading-tight capitalize">
                {data.aiCount ? `${data.aiCount} AI` : 'AI'}
                {data.aiDifficulty ? ` \u00b7 ${data.aiDifficulty}` : ''}
              </p>
            </div>
          </div>

          {/* What earlier eras carried into this one: the effect, not a number. */}
          <div className="rounded-lg border border-bf-border bg-bf-dark/50 px-3 py-2.5 mb-5" data-testid="campaign-intro-carry">
            <p className="text-[10px] uppercase tracking-wider text-bf-muted mb-1 flex items-center gap-1.5">
              <Trophy className="w-3.5 h-3.5 text-bf-gold/80" aria-hidden />
              Carried forward
            </p>
            {carryEffects.length > 0 ? (
              <ul className="space-y-0.5">
                {carryEffects.map((effect) => (
                  <li key={effect.key} className="text-sm text-bf-text">{carryEffectLine(effect)}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-bf-muted">
                Nothing yet.
                {data.signatureCarryLabel ? ` Win this era to carry ${data.signatureCarryLabel} into the next.` : ''}
              </p>
            )}
          </div>

          {data.opponents && data.opponents.length > 0 && (
            <p className="text-xs text-bf-muted text-center mb-3" data-testid="campaign-intro-opponents">
              Against: <span className="text-bf-text">{data.opponents.join(', ')}</span>
            </p>
          )}

          {ability && (
            <p className="text-xs text-bf-muted text-center mb-4" data-testid="campaign-intro-ability">
              <span className="text-bf-text">{data.lockedFaction}</span> — {ability}
            </p>
          )}

          <button
            type="button"
            onClick={onBegin}
            className="btn-primary w-full py-3 text-base"
            ref={beginRef}
          >
            Begin Era
          </button>
        </div>
      </div>
    </div>
  );
}
