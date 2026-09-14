import type { ResourceView } from '../../warfront/economyView';

/**
 * The resource readout: what you have, what it costs to keep, and what the next province
 * will cost.
 *
 * Upkeep and the colonisation price sit next to the stockpile deliberately. Both rules
 * they belong to — villagers eat every minute, and the price rises with every province —
 * are invisible until they bite, and a number a player only meets as a refusal is a rule
 * they never learned. So upkeep is drawn as what it is, a drain under the food it drains,
 * and the colony price carries whether you can afford it rather than only how much it is.
 *
 * Each figure gets a colour of its own and a size worth reading. The row this replaces
 * was seven labels and seven numbers in one type size, which is a legible sentence and an
 * illegible instrument: nothing in it could be found without reading all of it.
 */

export interface WarfrontResourceBarProps {
  resources: ResourceView | null;
}

/** Accent per figure, matched to what the thing is rather than to a rainbow. */
const FOOD = '#d8a657';
const TIMBER = '#7fa864';
const SILVER = '#9fb3c8';
const POP = '#c9a84c';

function Stat({
  accent,
  label,
  value,
  note,
  noteTone,
  children,
}: {
  accent: string;
  label: string;
  value: string;
  note?: string;
  noteTone?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-[74px] items-center gap-2 rounded border border-bf-border/70 bg-bf-dark/50 px-2 py-1">
      <span className="h-6 w-[3px] shrink-0 rounded-full" style={{ backgroundColor: accent }} aria-hidden />
      <div className="leading-tight">
        <div className="text-[9px] uppercase tracking-wider text-bf-muted">{label}</div>
        <div className="font-mono text-[13px] text-bf-text">{value}</div>
        {note ? <div className={`text-[9px] ${noteTone ?? 'text-bf-muted'}`}>{note}</div> : null}
        {children}
      </div>
    </div>
  );
}

export default function WarfrontResourceBar({ resources }: WarfrontResourceBarProps) {
  if (!resources) return null;
  const popFull = resources.pop >= resources.popCap;
  const canColonise = resources.food >= resources.nextColonisePrice;
  const popShare = resources.popCap > 0 ? Math.min(100, (resources.pop * 100) / resources.popCap) : 0;

  return (
    <div
      data-testid="warfront-resources"
      className="flex flex-wrap items-center gap-2 border-b border-bf-border bg-cc-panel/40 px-3 py-1.5"
    >
      <Stat
        accent={FOOD}
        label="Food"
        value={String(resources.food)}
        note={`−${resources.upkeepPerMinute}/min upkeep`}
        noteTone={resources.starving ? 'text-red-300' : 'text-bf-muted'}
      />
      <Stat accent={TIMBER} label="Timber" value={String(resources.timber)} />
      <Stat accent={SILVER} label="Silver" value={String(resources.silver)} />
      <Stat accent={POP} label="Population" value={`${resources.pop}/${resources.popCap}`}>
        <div className="mt-0.5 h-[3px] w-14 overflow-hidden rounded-full bg-bf-border">
          <div
            className={`h-full rounded-full ${popFull ? 'bg-bf-gold' : 'bg-bf-muted'}`}
            style={{ width: `${popShare}%` }}
          />
        </div>
      </Stat>
      <Stat
        accent={canColonise ? TIMBER : '#7a4a4a'}
        label="Next colony"
        value={`${resources.nextColonisePrice}`}
        note={canColonise ? `${resources.provinces} held · affordable` : `${resources.provinces} held · ${resources.nextColonisePrice - resources.food} short`}
        noteTone={canColonise ? 'text-bf-muted' : 'text-red-300'}
      />

      {resources.starving ? (
        <span className="rounded border border-red-500/50 bg-red-500/10 px-2 py-1 text-[11px] text-red-200">
          Starving — everything is bleeding
        </span>
      ) : null}
      {popFull ? (
        <span className="rounded border border-bf-gold/40 bg-bf-gold/10 px-2 py-1 text-[11px] text-bf-gold">
          Population capped — raise a house
        </span>
      ) : null}
    </div>
  );
}
