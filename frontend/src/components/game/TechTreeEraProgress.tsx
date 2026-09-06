import React from 'react';
import clsx from 'clsx';
import { Sparkles } from 'lucide-react';
import type { GameState, PlayerState } from '../../store/gameStore';
import { ERA_LABELS } from '../../constants/gameLobbyLabels';
import { getAdvanceEraClientStatus, listEraGateRows } from '../../utils/eraAdvancement';

interface Props {
  gameState: GameState;
  player?: PlayerState | null;
  /**
   * Advance the era. When supplied and the gate is ready, the rail offers the
   * button inline. The only other Advance control lives in a sidebar panel that
   * is collapsed by default and sits *behind* this modal's backdrop, so a
   * player told "the gate is ready" had to guess that they must first close the
   * tree, find the panel and expand it.
   */
  onAdvanceEra?: () => void;
  /** Advancing is a draft-phase action on your own turn. */
  canAdvanceNow?: boolean;
}

const ECHO_LABELS: Array<[string, string]> = [
  ['attack_bonus', 'Atk'],
  ['defense_bonus', 'Def'],
  ['reinforce_bonus', 'Reinf'],
  ['tech_point_income', 'TP/turn'],
];

/** Sum tech-echo contributions across the era-keyed (or legacy flat) store. */
function summarizeEcho(
  echo?: Record<string, number> | Record<string, Record<string, number>>,
): Record<string, number> {
  const totals: Record<string, number> = {};
  if (!echo) return totals;
  const values = Object.values(echo);
  const isFlat = values.some((v) => typeof v === 'number');
  const add = (stat: string, v: unknown) => {
    if (typeof v === 'number' && v !== 0) totals[stat] = (totals[stat] ?? 0) + v;
  };
  if (isFlat) {
    for (const [stat, v] of Object.entries(echo)) add(stat, v);
  } else {
    for (const bucket of values) {
      if (bucket && typeof bucket === 'object') {
        for (const [stat, v] of Object.entries(bucket)) add(stat, v);
      }
    }
  }
  return totals;
}

function GateChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={clsx(
        'px-1.5 py-0.5 rounded text-[11px] border whitespace-nowrap',
        ok ? 'border-green-700/50 bg-green-900/30 text-green-300' : 'border-gray-700 bg-gray-800/60 text-gray-400',
      )}
    >
      {label}
    </span>
  );
}

/**
 * Era-advancement continuity rail shown at the top of the tech tree: the
 * advancement gate progress (so research choices map to the gate while you
 * browse) and the bonuses echoed forward from past eras.
 */
export default function TechTreeEraProgress({ gameState, player, onAdvanceEra, canAdvanceNow }: Props) {
  if (!gameState.settings.era_advancement_enabled || !player) return null;
  const status = getAdvanceEraClientStatus(gameState, player);
  if (!status) return null;

  const gateRows = listEraGateRows(gameState, status);
  const unmet = gateRows.filter((r) => !r.ok);

  const echo = summarizeEcho(player.era_advancement_tech_echo);
  const echoTags = ECHO_LABELS
    .filter(([stat]) => echo[stat])
    .map(([stat, label]) => `+${echo[stat]} ${label}`);

  return (
    <div className="px-4 pt-3" data-testid="techtree-era-progress">
      <div className="rounded-lg border border-bf-gold/30 bg-bf-gold/5 p-3 space-y-2">
        {status.atMaxEra ? (
          <p className="text-xs text-amber-200/90">Final era reached — your research stands on the apex tree.</p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-amber-200">
                Advancement gate → {ERA_LABELS[status.nextEraId] ?? status.nextEraId}
              </p>
              <span className={clsx('text-[11px]', status.ready ? 'text-green-400 font-semibold' : 'text-bf-muted')}>
                {status.ready ? 'Ready' : `${unmet.length} to go`}
              </span>
            </div>
            <div className="flex flex-wrap gap-1" data-testid="techtree-gate-chips">
              {gateRows.map((row) => (
                <GateChip key={row.key} ok={row.ok} label={row.chip} />
              ))}
            </div>
            {/* Name the thing that is missing. The chips alone could all read
                green while the summary said "1 to go" — the phase requirement
                had no chip of its own — which left the player counting a
                blocker they could not see. */}
            {!status.ready && unmet.length > 0 && (
              <p className="text-[11px] text-amber-200/80" data-testid="techtree-gate-blockers">
                Still needed: {unmet.map((r) => r.label).join(' · ')}
              </p>
            )}
            {status.nextSignatureName && (
              <p className="flex items-start gap-1 text-[11px] text-bf-gold/90">
                <Sparkles className="w-3 h-3 shrink-0 mt-0.5" />
                <span><span className="font-medium">{status.nextSignatureName}</span> on arrival</span>
              </p>
            )}
            {status.ready && onAdvanceEra && (
              <button
                type="button"
                onClick={onAdvanceEra}
                disabled={!canAdvanceNow}
                data-testid="techtree-advance-era"
                className="btn-primary w-full text-sm py-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {canAdvanceNow
                  ? `Advance to ${ERA_LABELS[status.nextEraId] ?? status.nextEraId}`
                  : 'Advance Era (wait for your turn)'}
              </button>
            )}
          </>
        )}
        {echoTags.length > 0 && (
          <p className="text-[11px] text-bf-muted pt-1 border-t border-bf-border/50" data-testid="techtree-echo">
            Echoed from past eras: <span className="text-blue-300">{echoTags.join(' · ')}</span>
            <span className="opacity-70"> (fades as you advance further)</span>
          </p>
        )}
      </div>
    </div>
  );
}
