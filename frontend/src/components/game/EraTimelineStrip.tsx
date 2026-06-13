import React from 'react';
import clsx from 'clsx';
import type { GameState, PlayerState } from '../../store/gameStore';
import { ERA_LABELS } from '../../constants/gameLobbyLabels';
import { eraMeta } from '../../constants/eraMeta';

interface EraTimelineStripProps {
  gameState: GameState;
  /** The viewing player — their marker is highlighted. */
  myPlayer?: PlayerState | null;
}

/**
 * Compact horizontal map of the era advancement spine with each player's
 * position marked, so "who is ahead" reads at a glance. Renders only when era
 * advancement is on and the spine has more than one step.
 */
export default function EraTimelineStrip({ gameState, myPlayer }: EraTimelineStripProps) {
  const steps = gameState.era_spine ?? [];
  if (!gameState.settings.era_advancement_enabled || steps.length < 2) return null;

  const maxIndex = steps.length - 1;
  const clampIndex = (i: number) => Math.min(Math.max(i, 0), maxIndex);
  const livePlayers = gameState.players.filter((p) => !p.is_eliminated);

  return (
    <div
      className="px-3 py-2 border-b border-bf-border/60 bg-bf-dark/40"
      data-testid="era-timeline"
      role="group"
      aria-label="Era advancement progress"
    >
      <div className="flex items-stretch">
        {steps.map((step, i) => {
          const meta = eraMeta(step.era_id);
          const here = livePlayers.filter((p) => clampIndex(p.current_era_index ?? 0) === i);
          const mineHere = !!myPlayer && clampIndex(myPlayer.current_era_index ?? 0) === i;
          return (
            <React.Fragment key={`${step.era_id}-${i}`}>
              {i > 0 && (
                <div className="flex-1 self-start mt-[7px] h-px bg-bf-border/70 min-w-[8px]" aria-hidden />
              )}
              <div
                className="flex flex-col items-center gap-0.5 shrink-0"
                data-testid={`era-timeline-step-${i}`}
                title={`${ERA_LABELS[step.era_id] ?? step.era_id}${here.length ? ` — ${here.map((p) => p.username).join(', ')}` : ''}`}
              >
                <span
                  className={clsx('w-3.5 h-3.5 rounded-full border', mineHere ? 'ring-2 ring-offset-1 ring-offset-bf-dark' : '')}
                  style={{ backgroundColor: meta.color, borderColor: meta.color, ...(mineHere ? { boxShadow: `0 0 0 1px ${meta.color}` } : {}) }}
                />
                <span className="text-[8px] leading-tight text-bf-muted whitespace-nowrap">{meta.short}</span>
                <div className="flex flex-wrap justify-center gap-0.5 max-w-[44px] min-h-[6px]">
                  {here.map((p) => (
                    <span
                      key={p.player_id}
                      data-testid={`era-timeline-marker-${p.player_id}`}
                      className={clsx('w-1.5 h-1.5 rounded-full', p.player_id === myPlayer?.player_id ? 'ring-1 ring-white/80' : '')}
                      style={{ backgroundColor: p.color }}
                      title={p.username}
                    />
                  ))}
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
