import React from 'react';
import { Sparkles, AlertTriangle, Check, X } from 'lucide-react';
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
  const status = getAdvanceEraClientStatus(gameState, myPlayer);
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

  return (
    <div className="p-4 border-b border-bf-gold/30 bg-bf-gold/5">
      <h3 className="text-xs font-medium text-bf-gold uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5" /> Era Advancement Active
      </h3>
      <div className="text-sm text-bf-text space-y-2">
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
        {vulnerable && (
          <p className="flex items-start gap-1.5 text-amber-400 text-xs rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            Vulnerable window — opponents hit harder until your next turn.
          </p>
        )}
        {!status.atMaxEra && (
          <>
            <p className="text-xs text-bf-muted">
              Advance mid-match for stronger era-tier combat. Costs scale with your production income.
            </p>
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
    </div>
  );
}
