import type { ResourceView } from '../../warfront/economyView';

/**
 * The resource readout: what you have, what it costs to keep, and what the next province
 * will cost.
 *
 * Upkeep and the colonisation price sit next to the stockpile deliberately. Both rules
 * they belong to — villagers eat every minute, and the price rises with every province —
 * are invisible until they bite, and a number a player only meets as a refusal is a rule
 * they never learned.
 */

export interface WarfrontResourceBarProps {
  resources: ResourceView | null;
}

function Stat({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-bf-muted">{label}</span>
      <span className={`font-mono ${tone || 'text-bf-text'}`}>{value}</span>
    </span>
  );
}

export default function WarfrontResourceBar({ resources }: WarfrontResourceBarProps) {
  if (!resources) return null;
  const popFull = resources.pop >= resources.popCap;
  return (
    <div
      data-testid="warfront-resources"
      className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-bf-border bg-cc-panel/40 px-4 py-1.5 text-[11px]"
    >
      <Stat label="Food" value={String(resources.food)} tone={resources.starving ? 'text-red-300' : ''} />
      <Stat label="Timber" value={String(resources.timber)} />
      <Stat label="Silver" value={String(resources.silver)} />
      <Stat
        label="Pop"
        value={`${resources.pop}/${resources.popCap}`}
        tone={popFull ? 'text-bf-gold' : ''}
      />
      <Stat label="Upkeep" value={`${resources.upkeepPerMinute}/min`} />
      <Stat label="Provinces" value={String(resources.provinces)} />
      <Stat
        label="Next colony"
        value={`${resources.nextColonisePrice} food`}
        tone={resources.food < resources.nextColonisePrice ? 'text-red-300' : ''}
      />
      {resources.starving ? (
        <span className="rounded border border-red-500/50 bg-red-500/10 px-2 py-0.5 text-red-200">
          Starving — everything is bleeding
        </span>
      ) : null}
      {popFull ? (
        <span className="rounded border border-bf-gold/40 bg-bf-gold/10 px-2 py-0.5 text-bf-gold">
          Population capped — raise a house
        </span>
      ) : null}
    </div>
  );
}
