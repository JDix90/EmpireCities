import React, { useEffect, useState, useRef } from 'react';
import { X } from 'lucide-react';
import { CombatResult } from '../../store/gameStore';

interface MobileCombatBannerProps {
  lastCombatResult: CombatResult | null;
  onOpenFullLog: () => void;
}

function MobileCombatBanner({
  lastCombatResult,
  onOpenFullLog,
}: MobileCombatBannerProps) {
  const [visible, setVisible] = useState(false);
  const [displayResult, setDisplayResult] = useState<CombatResult | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevResultRef = useRef<CombatResult | null>(null);

  useEffect(() => {
    if (lastCombatResult && lastCombatResult !== prevResultRef.current) {
      prevResultRef.current = lastCombatResult;
      setDisplayResult(lastCombatResult);
      setVisible(true);

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setVisible(false), 6000);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [lastCombatResult]);

  if (!visible || !displayResult) return null;
  const attackerFactionBonus = displayResult.attacker_bonus_breakdown?.faction ?? 0;
  const defenderFactionBonus = displayResult.defender_bonus_breakdown?.faction ?? 0;

  return (
    <div className="hidden max-md:block">
      <div
        className="fixed bottom-[72px] inset-x-3 z-20 animate-slide-up bg-bf-surface border border-bf-border rounded-xl shadow-2xl"
        onClick={() => setVisible(false)}
      >
        <div className="p-3">
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            {displayResult.fromName && displayResult.toName ? (
              <p className="text-xs font-medium text-bf-text truncate flex-1">
                {displayResult.fromName} → {displayResult.toName}
              </p>
            ) : (
              <p className="text-xs font-medium text-bf-text">Combat Result</p>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                setVisible(false);
              }}
              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-bf-muted hover:text-bf-text ml-1 shrink-0 -mr-2"
              aria-label="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Dice rolls */}
          <div className="flex gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-bf-muted mb-0.5">
                {displayResult.attackerName ?? 'Attacker'}
              </p>
              <div className="flex gap-1">
                {displayResult.attacker_rolls.map((roll, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center justify-center w-5 h-5 rounded bg-red-500/20 text-red-400 font-mono text-xs font-bold"
                  >
                    {roll}
                  </span>
                ))}
              </div>
              {displayResult.attacker_losses > 0 && (
                <p className="text-red-400 text-[10px] mt-0.5">
                  -{displayResult.attacker_losses} troop{displayResult.attacker_losses > 1 ? 's' : ''}
                </p>
              )}
            </div>
            <div className="w-px bg-bf-border shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-bf-muted mb-0.5">
                {displayResult.defenderName ?? 'Defender'}
              </p>
              <div className="flex gap-1">
                {displayResult.defender_rolls.map((roll, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center justify-center w-5 h-5 rounded bg-blue-500/20 text-blue-400 font-mono text-xs font-bold"
                  >
                    {roll}
                  </span>
                ))}
              </div>
              {displayResult.defender_losses > 0 && (
                <p className="text-blue-400 text-[10px] mt-0.5">
                  -{displayResult.defender_losses} troop{displayResult.defender_losses > 1 ? 's' : ''}
                </p>
              )}
            </div>
          </div>

          {/* Territory captured */}
          {displayResult.territory_captured && (
            <p className="text-bf-gold font-medium text-xs pt-1.5 mt-1.5 border-t border-bf-border">
              Territory Captured!
            </p>
          )}
          {(attackerFactionBonus > 0 || defenderFactionBonus > 0) && (
            <div className="pt-1.5 mt-1.5 border-t border-bf-border space-y-1">
              {attackerFactionBonus > 0 && (
                <p className="text-[10px] px-2 py-1 rounded border border-red-500/40 bg-red-900/20 text-red-300">
                  ⚔️ Faction attack bonus (+{attackerFactionBonus} die)
                </p>
              )}
              {defenderFactionBonus > 0 && (
                <p className="text-[10px] px-2 py-1 rounded border border-blue-500/40 bg-blue-900/20 text-blue-300">
                  🛡️ Faction defense bonus (+{defenderFactionBonus} die)
                </p>
              )}
            </div>
          )}

          {/* View full log link — min 44px hit target per Apple HIG / Material */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setVisible(false);
              onOpenFullLog();
            }}
            className="min-h-[44px] flex items-center text-xs text-bf-muted hover:text-bf-gold mt-1 transition-colors"
          >
            View full log →
          </button>
        </div>
      </div>
    </div>
  );
}


export default React.memo(MobileCombatBanner);
