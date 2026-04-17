import React from 'react';
import { X, Scroll } from 'lucide-react';
import clsx from 'clsx';

export interface EventEffect {
  type: string;
  target: string;
  value: number;
  target_id?: string;
  duration_turns?: number;
}

export interface EventChoice {
  choice_id: string;
  label: string;
  effect: EventEffect;
}

export interface EventCard {
  card_id: string;
  title: string;
  description: string;
  category: 'global' | 'regional' | 'player_targeted' | 'natural_disaster';
  era_id: string;
  effect?: EventEffect;
  choices?: EventChoice[];
  affects_all_players?: boolean;
  result_summary?: Array<{ territory_id: string; name: string; delta: number }>;
}

function formatEffectSummary(effect: EventEffect | undefined, affectsAll?: boolean): string | null {
  if (!effect) return null;
  const v = effect.value ?? 1;
  const dur = effect.duration_turns != null ? ` for ${effect.duration_turns} turn${effect.duration_turns !== 1 ? 's' : ''}` : '';
  switch (effect.type) {
    case 'units_added':
      return affectsAll
        ? `All players receive ${v} reinforcement${v !== 1 ? 's' : ''}`
        : `You receive ${v} reinforcement${v !== 1 ? 's' : ''}`;
    case 'units_removed':
      return affectsAll
        ? `All players lose up to ${v} unit${v !== 1 ? 's' : ''} from each of their territories`
        : `You lose up to ${v} unit${v !== 1 ? 's' : ''} total, taken from your largest territories first`;
    case 'region_disaster':
      return `Every territory worldwide loses ${v} unit${v !== 1 ? 's' : ''} (minimum 1 remains per territory)`;
    case 'attack_modifier':
      return `+${v} attack die${dur}`;
    case 'defense_modifier':
      return `+${v} defense die${dur}`;
    case 'production_bonus':
      return `+${v} production per turn${dur}`;
    case 'truce':
      return `Combat is forbidden for ${v} turn${v !== 1 ? 's' : ''}`;
    case 'stability_change':
      return v >= 0
        ? `All territories gain ${v} stability`
        : `All territories lose ${Math.abs(v)} stability`;
    default:
      return null;
  }
}

const CATEGORY_STYLES: Record<string, { bg: string; border: string; badge: string; label: string }> = {
  global: { bg: 'bg-blue-900/40', border: 'border-blue-600/50', badge: 'bg-blue-800 text-blue-200', label: 'Global Event' },
  regional: { bg: 'bg-amber-900/40', border: 'border-amber-600/50', badge: 'bg-amber-800 text-amber-200', label: 'Regional Event' },
  player_targeted: { bg: 'bg-purple-900/40', border: 'border-purple-600/50', badge: 'bg-purple-800 text-purple-200', label: 'Targeted Event' },
  natural_disaster: { bg: 'bg-red-900/40', border: 'border-red-600/50', badge: 'bg-red-800 text-red-200', label: 'Natural Disaster' },
};

interface Props {
  card: EventCard;
  isMyTurn: boolean;
  onChoice: (choiceId: string) => void;
  onDismiss: () => void;
}

export default function EventCardModal({ card, isMyTurn, onChoice, onDismiss }: Props) {
  const style = CATEGORY_STYLES[card.category] ?? CATEGORY_STYLES.global;
  const hasChoices = card.choices && card.choices.length > 0;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 backdrop-blur-sm animate-fade-in px-3 py-4 pt-safe pb-safe sm:px-4">
      <div className="relative z-10 flex min-h-full items-start justify-center sm:items-center">
        <div className={clsx(
          'border rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[min(92vh,calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1.5rem))] overflow-y-auto overscroll-contain',
          style.bg, style.border,
        )}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700/50">
          <div className="flex items-center gap-2">
            <Scroll className="text-amber-400 w-5 h-5" />
            <span className={clsx('px-2 py-0.5 rounded-full text-xs font-medium', style.badge)}>
              {style.label}
            </span>
          </div>
          {!hasChoices && (
            <button onClick={onDismiss} className="text-gray-400 hover:text-white transition-colors" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <h2 className="text-xl font-display text-white">{card.title}</h2>
          <p className="text-sm text-gray-300 leading-relaxed">{card.description}</p>

          {/* Mechanical effect summary */}
          {(() => {
            const summary = formatEffectSummary(card.effect, card.affects_all_players);
            return summary ? (
              <div className="px-3 py-2 rounded-lg bg-amber-900/30 border border-amber-700/40">
                <p className="text-xs text-amber-300">
                  <span className="font-semibold">Effect: </span>{summary}
                </p>
              </div>
            ) : null;
          })()}

          {/* What actually happened (instant effects only) */}
          {card.result_summary && card.result_summary.length > 0 && (
            <div className="px-3 py-2 rounded-lg bg-gray-800/50 border border-gray-700/40">
              <p className="text-xs font-semibold text-gray-400 mb-1">What happened:</p>
              {card.result_summary.map(({ territory_id, name, delta }) => (
                <p key={territory_id} className="text-xs text-gray-300">
                  <span className="text-cc-gold">{name}</span>
                  <span className={delta < 0 ? ' text-red-400' : ' text-green-400'}>
                    {' '}{delta > 0 ? `+${delta}` : delta} unit{Math.abs(delta) !== 1 ? 's' : ''}
                  </span>
                </p>
              ))}
            </div>
          )}

          {card.affects_all_players && (
            <p className="text-xs text-amber-400 italic">This event affects all players.</p>
          )}

          {/* Choices */}
          {hasChoices && isMyTurn && (
            <div className="space-y-2 pt-2">
              {card.choices!.map((c) => {
                const choiceSummary = formatEffectSummary(c.effect, card.affects_all_players);
                return (
                <button
                  key={c.choice_id}
                  onClick={() => onChoice(c.choice_id)}
                  className={clsx(
                    'w-full text-left px-4 py-2.5 rounded-lg border transition-colors',
                    'border-gray-600/50 bg-gray-800/60 hover:bg-gray-700/60 hover:border-gray-500',
                    'text-sm text-gray-200',
                  )}
                >
                  <span>{c.label}</span>
                  {choiceSummary && (
                    <span className="block text-xs text-amber-300/80 mt-0.5">{choiceSummary}</span>
                  )}
                </button>
                );
              })}
            </div>
          )}

          {hasChoices && !isMyTurn && (
            <p className="text-xs text-gray-500 italic">Waiting for the current player to choose...</p>
          )}

          {/* Dismiss for non-choice cards */}
          {!hasChoices && (
            <button
              onClick={onDismiss}
              className="w-full mt-2 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium transition-colors"
            >
              Continue
            </button>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
