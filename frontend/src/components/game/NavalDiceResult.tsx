import type { NavalCombatResult } from '../../store/gameStore';
import { resolveTerritoryName, type MapNameLookup } from '../../utils/mapDisplayNames';

/**
 * A fleet battle's dice. Deliberately unlike the land dice beside it: round
 * teal tokens instead of square red/blue ones, an anchor header, and losses
 * counted in fleets, so nobody reads a sea fight as troops dying.
 */
function NavalDie({ value, side }: { value: number; side: 'attacker' | 'defender' }) {
  return (
    <span
      className={
        side === 'attacker'
          ? 'inline-flex items-center justify-center w-5 h-5 rounded-full border border-cyan-300/70 bg-cyan-500/25 text-cyan-100 font-mono text-xs font-bold'
          : 'inline-flex items-center justify-center w-5 h-5 rounded-full border border-teal-300/40 bg-teal-900/60 text-teal-200 font-mono text-xs font-bold'
      }
    >
      {value}
    </span>
  );
}

export default function NavalDiceResult({
  result,
  attackerName,
  defenderName,
  mapNameLookup,
}: {
  result: NavalCombatResult;
  attackerName?: string;
  defenderName?: string;
  mapNameLookup?: MapNameLookup | null;
}) {
  const fleets = (n: number) => `${n} fleet${n === 1 ? '' : 's'}`;
  return (
    <div
      data-testid="naval-dice-result"
      className="mb-3 p-3 rounded-lg border border-cyan-700/60 bg-cyan-950/40 text-xs space-y-2"
    >
      <p className="flex items-center gap-1.5 text-cyan-200 font-medium min-w-0">
        <span aria-hidden>⚓</span>
        <span className="whitespace-nowrap shrink-0">Fleet battle</span>
        <span className="text-cyan-200/60 font-normal truncate min-w-0">
          {resolveTerritoryName(result.fromId, mapNameLookup)} → {resolveTerritoryName(result.toId, mapNameLookup)}
        </span>
      </p>
      <div className="flex gap-3">
        <div className="flex-1">
          <p className="text-cyan-100/70 mb-0.5">{attackerName ?? 'Attacker'}</p>
          <div className="flex gap-1" aria-label={`Attacking fleets rolled ${result.attacker_rolls.join(', ')}`}>
            {result.attacker_rolls.map((roll, i) => <NavalDie key={i} value={roll} side="attacker" />)}
          </div>
          {result.attacker_losses > 0 && (
            <p className="text-cyan-300 mt-1">Lost {fleets(result.attacker_losses)}</p>
          )}
        </div>
        <div className="w-px bg-cyan-800/60" />
        <div className="flex-1">
          <p className="text-cyan-100/70 mb-0.5">{defenderName ?? 'Defender'}</p>
          <div className="flex gap-1" aria-label={`Defending fleets rolled ${result.defender_rolls.join(', ')}`}>
            {result.defender_rolls.map((roll, i) => <NavalDie key={i} value={roll} side="defender" />)}
          </div>
          {result.defender_losses > 0 && (
            <p className="text-teal-300 mt-1">Lost {fleets(result.defender_losses)}</p>
          )}
        </div>
      </div>
      <p className="pt-1 border-t border-cyan-800/60 text-cyan-200">
        {result.attacker_won ? 'Every defending fleet sunk' : 'Defending fleets still afloat'}
      </p>
    </div>
  );
}
