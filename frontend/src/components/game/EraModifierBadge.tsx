import React from 'react';
import clsx from 'clsx';
import type { GameState } from '../../store/gameStore';

interface Props {
  gameState: GameState;
  className?: string;
}

interface ModifierInfo {
  key: string;
  label: string;
  description: string;
  icon: string;
}

const MODIFIER_INFO: ModifierInfo[] = [
  {
    key: 'legion_reroll',
    label: 'Legion Tactics',
    description: 'Attacker may re-roll one die when attacking with 3 dice.',
    icon: '⚔️',
  },
  {
    key: 'castle_fortification',
    label: 'Castle Fortification',
    description: 'Defenders with 4+ units roll an extra die.',
    icon: '🏰',
  },
  {
    key: 'sea_lanes',
    label: 'Sea Lanes',
    description: 'Sea-route attacks are limited to 2 attack dice.',
    icon: '⚓',
  },
  {
    key: 'wartime_logistics',
    label: 'Wartime Logistics',
    description: 'May fortify twice per turn.',
    icon: '🚂',
  },
  {
    key: 'influence_spread',
    label: 'Influence Spread',
    description: 'May spend 3 units to seize a nearby territory without combat.',
    icon: '📡',
  },
  {
    key: 'precision_strike',
    label: 'Precision Strike',
    description: 'Attack with 3 dice when committing 4+ units.',
    icon: '🎯',
  },
  {
    key: 'rifle_doctrine',
    label: 'Rifle Doctrine',
    description: 'Re-roll tied attacker dice to break deadlocks.',
    icon: '🔫',
  },
  {
    key: 'carbonari_network',
    label: 'Carbonari Network',
    description: 'Influence operations can reach beyond adjacent territories.',
    icon: '🕵️',
  },
];

function EraModifierBadge({ gameState, className }: Props) {
  const mods = gameState.era_modifiers;
  if (!mods) return null;

  const active = MODIFIER_INFO.filter((m) => (mods as Record<string, unknown>)[m.key]);
  if (active.length === 0) return null;

  return (
    <div className={clsx('flex flex-wrap gap-1', className)}>
      {active.map((m) => (
        <div
          key={m.key}
          className="group relative flex flex-col items-start"
          title={m.description}
        >
          <span
            className={clsx(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium',
              'bg-amber-900/60 text-amber-200 border border-amber-700/50',
              'cursor-help select-none'
            )}
          >
            <span aria-hidden="true">{m.icon}</span>
            {m.label}
          </span>
          <span className="block text-xs text-amber-300/80 mt-0.5 ml-1 pr-2">
            {m.description}
          </span>
          {/* Tooltip remains for accessibility */}
          <div
            className={clsx(
              'absolute bottom-full left-0 mb-1 w-48 p-2 rounded-md text-xs z-50',
              'bg-gray-900 border border-gray-700 text-gray-200 shadow-lg',
              'invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-opacity'
            )}
          >
            {m.description}
          </div>
        </div>
      ))}
    </div>
  );
}


export default React.memo(EraModifierBadge);
