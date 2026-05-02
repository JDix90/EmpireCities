import React, { useEffect } from 'react';
import { Crown, Flag, Shield, Trophy } from 'lucide-react';

export interface CampaignIntroData {
  pathName?: string;
  pathTagline?: string;
  signatureCarryLabel?: string;
  eraIndex?: number;
  eraCount?: number;
  eraLabel: string;
  introText?: string;
  lockedFaction?: string | null;
  aiDifficulty?: string | null;
  aiCount?: number | null;
  prestigeBonus?: number | null;
  carry?: { survivor_bonus?: number; revolutionary_spirit?: number };
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

  const carryValue =
    data.carry?.survivor_bonus
    ?? data.carry?.revolutionary_spirit
    ?? data.prestigeBonus
    ?? 0;
  const carryShown = carryValue > 0 && !!data.signatureCarryLabel;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm px-4 pt-safe pb-safe"
      role="dialog"
      aria-modal="true"
      aria-labelledby="campaign-intro-title"
    >
      <div className="bg-cc-surface border border-cc-gold/35 rounded-2xl p-6 sm:p-8 w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-center gap-2 mb-1">
          <Crown className="w-4 h-4 text-cc-gold" />
          <p className="text-xs uppercase tracking-[0.28em] text-cc-gold/85 font-display">
            Era Campaign
          </p>
        </div>
        <p className="text-cc-muted text-xs text-center mb-4">{eraSubtitle}</p>

        <h2
          id="campaign-intro-title"
          className="font-display text-2xl sm:text-3xl text-cc-gold text-center mb-1"
        >
          {data.pathName ?? 'Classic Campaign'}
        </h2>
        {data.pathTagline && (
          <p className="text-center text-cc-muted text-sm italic mb-5">{data.pathTagline}</p>
        )}

        {data.introText && (
          <div className="mb-5">
            <p className="text-cc-text text-sm leading-relaxed">{data.introText}</p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3 mb-6">
          <div className="rounded-lg border border-cc-border bg-cc-dark/50 px-3 py-3 text-center">
            <Flag className="w-4 h-4 text-cc-gold/80 mx-auto mb-1.5" />
            <p className="text-[10px] uppercase tracking-wider text-cc-muted mb-0.5">Faction</p>
            <p className="text-sm text-cc-text font-medium leading-tight">
              {data.lockedFaction ? titleCase(data.lockedFaction) : 'Free choice'}
            </p>
          </div>
          <div className="rounded-lg border border-cc-border bg-cc-dark/50 px-3 py-3 text-center">
            <Shield className="w-4 h-4 text-cc-gold/80 mx-auto mb-1.5" />
            <p className="text-[10px] uppercase tracking-wider text-cc-muted mb-0.5">Opposition</p>
            <p className="text-sm text-cc-text font-medium leading-tight capitalize">
              {data.aiCount ? `${data.aiCount} AI` : 'AI'}
              {data.aiDifficulty ? ` \u00b7 ${data.aiDifficulty}` : ''}
            </p>
          </div>
          <div className="rounded-lg border border-cc-border bg-cc-dark/50 px-3 py-3 text-center">
            <Trophy className="w-4 h-4 text-cc-gold/80 mx-auto mb-1.5" />
            <p className="text-[10px] uppercase tracking-wider text-cc-muted mb-0.5">
              {carryShown && data.signatureCarryLabel ? data.signatureCarryLabel : 'Carry'}
            </p>
            <p className="text-sm text-cc-text font-medium leading-tight">
              {carryShown ? `+${carryValue}` : '\u2014'}
            </p>
          </div>
        </div>

        {data.lockedFaction && (
          <p className="text-cc-muted text-xs text-center mb-4">
            Your faction is fixed for this era of the campaign.
          </p>
        )}

        <button
          type="button"
          onClick={onBegin}
          className="btn-primary w-full py-3 text-base"
          autoFocus
        >
          Begin Era
        </button>
      </div>
    </div>
  );
}
