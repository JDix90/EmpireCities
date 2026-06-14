import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, AlertTriangle, Check, X, ChevronDown, ChevronUp } from 'lucide-react';
import clsx from 'clsx';
import type { GameState, PlayerState } from '../../store/gameStore';
import { ERA_LABELS } from '../../constants/gameLobbyLabels';
import { getAdvanceEraClientStatus } from '../../utils/eraAdvancement';

interface AdvanceEraPanelProps {
  gameState: GameState;
  myPlayer: PlayerState;
  isMyTurn: boolean;
  onAdvanceEra: () => void;
  /** Compact strip for map toolbar / mobile bar */
  variant?: 'sidebar' | 'compact';
}

function GateRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={clsx('flex items-start gap-1.5 text-xs', ok ? 'text-green-400/90' : 'text-bf-muted')}>
      {ok ? <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <X className="w-3.5 h-3.5 shrink-0 mt-0.5 opacity-60" />}
      <span>{label}</span>
    </li>
  );
}

export default function AdvanceEraPanel({
  gameState,
  myPlayer,
  isMyTurn,
  onAdvanceEra,
  variant = 'sidebar',
}: AdvanceEraPanelProps) {
  // Collapsed by default: the full requirements checklist is reference
  // material consulted occasionally, but it lives in the FIXED part of the
  // sidebar — expanded it crushed the scrollable section below (cards,
  // players, resources) to a sliver. One summary row earns its place;
  // details are a click away.
  const [expanded, setExpanded] = useState(false);
  const wasReadyRef = useRef(false);

  const status = getAdvanceEraClientStatus(gameState, myPlayer);

  // Auto-expand exactly once when advancement first becomes available —
  // the moment the player actually needs the panel.
  useEffect(() => {
    if (status?.ready && !wasReadyRef.current) {
      wasReadyRef.current = true;
      setExpanded(true);
    }
    if (status && !status.ready) {
      wasReadyRef.current = false;
    }
  }, [status?.ready, status]);

  if (!status) return null;

  const vulnerable = (myPlayer.era_transition_turns_remaining ?? 0) > 0;
  const showButton = !status.atMaxEra && status.canPhase;
  const buttonEnabled = status.ready && isMyTurn && !myPlayer.is_eliminated;

  if (variant === 'compact') {
    if (status.atMaxEra) return null;
    return (
      <button
        type="button"
        onClick={onAdvanceEra}
        disabled={!buttonEnabled}
        title={status.blockers.join(' · ') || `Advance to ${ERA_LABELS[status.nextEraId] ?? status.nextEraId}`}
        className={clsx(
          'inline-flex items-center gap-1.5 min-h-[40px] px-3 py-2 text-xs rounded-lg border shrink-0',
          buttonEnabled
            ? 'border-bf-gold/50 bg-bf-gold/15 text-bf-gold hover:bg-bf-gold/25'
            : 'border-bf-border bg-bf-dark/80 text-bf-muted opacity-80',
        )}
      >
        <Sparkles className="w-3.5 h-3.5" />
        <span className="font-medium">
          {ERA_LABELS[status.nextEraId] ?? status.nextEraId}
        </span>
        <span className="opacity-75">· {status.cost}g</span>
      </button>
    );
  }

  // Terse on purpose: this shares one sidebar row with the section label,
  // and a long phrase truncates the label into "ERA A…".
  const summaryStatus = status.atMaxEra
    ? 'Max era'
    : status.ready
      ? 'Ready!'
      : `${status.blockers.length} to go`;

  return (
    <div className="border-b border-bf-gold/30 bg-bf-gold/5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left"
      >
        <Sparkles className="w-3.5 h-3.5 text-bf-gold shrink-0" />
        <span className="text-xs font-medium text-bf-gold truncate">
          Era Advancement
        </span>
        <span
          className={clsx(
            'ml-auto text-xs shrink-0 rounded-full px-2 py-0.5',
            status.ready && !status.atMaxEra
              ? 'bg-bf-gold/20 text-bf-gold font-semibold'
              : 'text-bf-muted',
          )}
        >
          {summaryStatus}
        </span>
        {expanded
          ? <ChevronUp className="w-3.5 h-3.5 text-bf-muted shrink-0" />
          : <ChevronDown className="w-3.5 h-3.5 text-bf-muted shrink-0" />}
      </button>

      {/* The vulnerability warning is a live combat modifier — never hide it
          behind the collapse. */}
      {vulnerable && (
        <p className="mx-4 mb-2 flex items-start gap-1.5 text-amber-400 text-xs rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          Vulnerable window — opponents hit harder until your next turn.
        </p>
      )}

      {expanded && (
      <div className="px-4 pb-4 text-sm text-bf-text space-y-2">
        <p>
          Your civilization:{' '}
          <span className="text-bf-gold font-medium">
            {ERA_LABELS[status.currentEraId] ?? status.currentEraId}
          </span>
          {!status.atMaxEra && (
            <span className="text-bf-muted text-xs ml-1">
              → {ERA_LABELS[status.nextEraId] ?? status.nextEraId}
            </span>
          )}
        </p>
        {!status.atMaxEra && (
          <>
            <p className="text-xs text-bf-muted">
              Advance mid-match for stronger era-tier combat. Costs scale with your production income.
            </p>
            {status.nextSignatureName && (
              <p className="flex items-start gap-1.5 text-xs text-bf-gold/90 rounded border border-bf-gold/25 bg-bf-gold/10 px-2 py-1.5">
                <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  <span className="font-medium">{status.nextSignatureName}</span>
                  {status.nextSignatureDescription ? ` — ${status.nextSignatureDescription}` : ''}
                </span>
              </p>
            )}
            <ul className="space-y-1 rounded-lg border border-bf-border bg-bf-dark/50 p-2">
              {gameState.settings.tech_trees_enabled && status.gateMode === 'percent' && (
                <GateRow
                  ok={status.techMet}
                  label={`Technologies researched: ${status.techUnlocked}/${status.techRequired}`}
                />
              )}
              {gameState.settings.tech_trees_enabled && status.gateMode === 'milestone' && (
                <>
                  <GateRow
                    ok={status.tier1Met}
                    label={`Tier-1 technologies: ${status.tier1Current}/${status.tier1Required}`}
                  />
                  <GateRow
                    ok={status.tier2Met}
                    label={`Tier-2 technologies: ${status.tier2Current}/${status.tier2Required}`}
                  />
                  {status.tier3Required > 0 && (
                    <GateRow
                      ok={status.tier3Met}
                      label={`Tier-3 technologies: ${status.tier3Current}/${status.tier3Required}`}
                    />
                  )}
                  <GateRow
                    ok={status.buildingsMet}
                    label={`Buildings built: ${status.buildingsCurrent}/${status.buildingsRequired}`}
                  />
                </>
              )}
              {status.stabilityGate != null && (
                <GateRow
                  ok={status.stabilityMet}
                  label={`Empire stability: ${Math.round(status.stability ?? 0)}% (need ${status.stabilityGate}%)`}
                />
              )}
              <GateRow
                ok={status.goldMet}
                label={status.cost > 0
                  ? `Gold: ${status.gold} / ${status.cost} required`
                  : 'Production income: pending (starts after your first economy tick)'}
              />
            </ul>
            {status.catchupGap > 0 && status.catchupDiscountPct > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-emerald-400 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5">
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                Catching up: −{status.catchupDiscountPct}% cost and an eased tech gate while you trail.
              </p>
            )}
            {gameState.era_advancement_preview?.legacy_ability && (
              <p className="flex items-center gap-1.5 text-xs text-amber-300 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5">
                <Sparkles className="w-3.5 h-3.5 shrink-0" />
                Carries forward: your unused {gameState.era_advancement_preview.legacy_ability.label} stays usable once next era.
              </p>
            )}
          </>
        )}
        {showButton && (
          <button
            type="button"
            onClick={onAdvanceEra}
            disabled={!buttonEnabled}
            className={clsx(
              'btn-secondary w-full text-sm py-2',
              !buttonEnabled && 'opacity-60 cursor-not-allowed',
            )}
          >
            {!isMyTurn
              ? 'Advance Era (wait for your turn)'
              : buttonEnabled
                ? `Advance to ${ERA_LABELS[status.nextEraId] ?? status.nextEraId}`
                : 'Advance Era (requirements not met)'}
          </button>
        )}
        {status.atMaxEra && (
          <p className="text-xs text-bf-muted">Maximum era reached for this match.</p>
        )}
      </div>
      )}
    </div>
  );
}
