import { useState } from 'react';
import { X, Sword, Flag, Skull, ChevronDown, ChevronUp, History } from 'lucide-react';
import clsx from 'clsx';
import type { CombatResult } from '../../store/gameStore';

export interface TurnRecapEntry {
  playerName: string;
  playerColor: string;
  turnNumber: number;
  combats: CombatResult[];
}

/**
 * Coalesce another player's finished turn into the recap list.
 * Quiet turns (no battles) are skipped — the panel only reports action.
 */
export function appendRecap(list: TurnRecapEntry[], entry: TurnRecapEntry): TurnRecapEntry[] {
  if (entry.combats.length === 0) return list;
  return [...list, entry];
}

export function summarizeRecap(combats: CombatResult[]): {
  battles: number;
  captures: number;
  destroyed: number;
} {
  return {
    battles: combats.length,
    captures: combats.filter((c) => c.territory_captured).length,
    destroyed: combats.reduce((s, c) => s + c.defender_losses, 0),
  };
}

/**
 * Non-blocking replacement for the queued per-AI "TURN COMPLETE" modals:
 * a collapsible overlay summarizing what other players did since the local
 * player's last turn. Never intercepts input outside its own box and never
 * consumes the turn clock.
 */
export default function AiTurnRecapPanel({
  recaps,
  onDismiss,
}: {
  recaps: TurnRecapEntry[];
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [openEntries, setOpenEntries] = useState<Record<number, boolean>>({});

  if (recaps.length === 0) return null;

  const totalCaptures = recaps.reduce((s, r) => s + summarizeRecap(r.combats).captures, 0);

  return (
    <div className="absolute top-3 right-3 z-20 w-[290px] max-w-[85vw] rounded-xl border border-bf-border bg-bf-surface/95 backdrop-blur-sm shadow-xl text-sm">
      <div className="flex items-center gap-2 px-3 py-2">
        <History className="w-4 h-4 text-bf-gold shrink-0" aria-hidden />
        <button
          type="button"
          className="flex-1 flex items-center gap-1.5 text-left text-bf-text hover:text-bf-gold min-w-0"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          <span className="truncate">
            While you were away ({recaps.length} {recaps.length === 1 ? 'turn' : 'turns'}
            {totalCaptures > 0 ? `, ${totalCaptures} ${totalCaptures === 1 ? 'capture' : 'captures'}` : ''})
          </span>
          {expanded ? (
            <ChevronUp className="w-3.5 h-3.5 shrink-0" aria-hidden />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 shrink-0" aria-hidden />
          )}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="text-bf-muted hover:text-bf-text shrink-0"
          aria-label="Dismiss recap"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {expanded && (
        <div className="max-h-64 overflow-y-auto border-t border-bf-border/70 divide-y divide-bf-border/50">
          {recaps.map((recap, i) => {
            const stats = summarizeRecap(recap.combats);
            const open = !!openEntries[i];
            return (
              <div key={i} className="px-3 py-2">
                <button
                  type="button"
                  className="w-full flex items-center gap-2 text-left"
                  onClick={() => setOpenEntries((m) => ({ ...m, [i]: !m[i] }))}
                  aria-expanded={open}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: recap.playerColor }}
                    aria-hidden
                  />
                  <span className="text-bf-text truncate flex-1">{recap.playerName}</span>
                  <span className="flex items-center gap-2 text-xs text-bf-muted tabular-nums shrink-0">
                    <span className="flex items-center gap-0.5"><Sword className="w-3 h-3" aria-hidden />{stats.battles}</span>
                    <span className={clsx('flex items-center gap-0.5', stats.captures > 0 && 'text-yellow-400')}>
                      <Flag className="w-3 h-3" aria-hidden />{stats.captures}
                    </span>
                    <span className="flex items-center gap-0.5"><Skull className="w-3 h-3" aria-hidden />{stats.destroyed}</span>
                  </span>
                </button>
                {open && (
                  <div className="mt-1.5 space-y-1 pl-4">
                    {recap.combats.map((c, j) => (
                      <div key={j} className="flex items-center gap-2 text-xs text-bf-muted">
                        <span className="truncate flex-1">
                          {c.fromName ?? '?'} → {c.toName ?? '?'}
                        </span>
                        {c.territory_captured ? (
                          <span className="text-yellow-400 shrink-0">Captured</span>
                        ) : c.defender_losses > 0 ? (
                          <span className="shrink-0">−{c.defender_losses} def</span>
                        ) : c.attacker_losses > 0 ? (
                          <span className="shrink-0">−{c.attacker_losses} atk</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
