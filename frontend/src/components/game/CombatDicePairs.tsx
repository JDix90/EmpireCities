import clsx from 'clsx';

export interface DicePair {
  attacker: number;
  defender: number;
  /** Who won the pair: the attacker only on a strictly higher die. */
  winner: 'attacker' | 'defender';
  tie: boolean;
}

/**
 * How a roll was decided, as the server decides it (combat/combatResolver.ts):
 * both sides' dice highest first, compared in pairs, the defender winning
 * ties; dice beyond the shorter side's count face nothing.
 */
export function pairDice(attackerRolls: number[], defenderRolls: number[]): {
  pairs: DicePair[];
  attackerUnpaired: number;
  defenderUnpaired: number;
} {
  const a = [...attackerRolls].sort((x, y) => y - x);
  const d = [...defenderRolls].sort((x, y) => y - x);
  const n = Math.min(a.length, d.length);
  const pairs: DicePair[] = [];
  for (let i = 0; i < n; i++) {
    pairs.push({ attacker: a[i], defender: d[i], winner: a[i] > d[i] ? 'attacker' : 'defender', tie: a[i] === d[i] });
  }
  return { pairs, attackerUnpaired: a.length - n, defenderUnpaired: d.length - n };
}

const dice = (n: number) => (n === 1 ? 'die' : 'dice');

/**
 * The battle result's explanation (combat_explain_enabled): each compared
 * pair, its winner marked in their colour, "tie → defender" where a tie
 * decided it, and the dice that had nothing to face. A player who rolled
 * 6-5-4 against 6-2 and lost a unit used to get no reason; this says the
 * sixes tied, the tie went to the defender, and the 4 faced nothing.
 */
export default function CombatDicePairs({
  attackerRolls,
  defenderRolls,
  attackerColor,
  defenderColor,
  lastOf,
  compact = false,
}: {
  attackerRolls: number[];
  defenderRolls: number[];
  /** Each side's map colour (battle_player_colors_enabled); null keeps red and blue. */
  attackerColor?: string | null;
  defenderColor?: string | null;
  /** A blitz: the dice shown are the last of this many exchanges. */
  lastOf?: number;
  compact?: boolean;
}) {
  const { pairs, attackerUnpaired, defenderUnpaired } = pairDice(attackerRolls, defenderRolls);
  if (pairs.length === 0) return null;
  const sideStyle = (side: 'attacker' | 'defender') => {
    const color = side === 'attacker' ? attackerColor : defenderColor;
    return color ? { color } : undefined;
  };
  const sideClass = (side: 'attacker' | 'defender') =>
    (side === 'attacker' ? attackerColor : defenderColor) ? undefined : side === 'attacker' ? 'text-red-300' : 'text-blue-300';

  return (
    <div
      data-testid="combat-dice-pairs"
      className={clsx('rounded-lg border border-white/10 bg-white/[0.04] text-center', compact ? 'mb-2 px-2 py-1.5' : 'mb-4 px-3 py-2')}
    >
      <p className="text-[11px] text-white/55 mb-1.5">
        {lastOf && lastOf > 1 ? `Last roll of ${lastOf}: highest` : 'Highest'} against highest · ties go to the defender
      </p>
      <ul className="flex flex-wrap justify-center gap-1.5" aria-label="Dice compared">
        {pairs.map((p, i) => (
          <li
            key={i}
            data-testid="combat-dice-pair"
            data-winner={p.winner}
            className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-black/20 px-2 py-0.5 text-xs tabular-nums"
          >
            <span className={clsx('font-bold', p.winner === 'attacker' ? sideClass('attacker') : 'text-white/45')} style={p.winner === 'attacker' ? sideStyle('attacker') : undefined}>
              {p.attacker}
            </span>
            <span className="text-white/45">{p.tie ? 'ties' : p.winner === 'attacker' ? 'beats' : 'loses to'}</span>
            <span className={clsx('font-bold', p.winner === 'defender' ? sideClass('defender') : 'text-white/45')} style={p.winner === 'defender' ? sideStyle('defender') : undefined}>
              {p.defender}
            </span>
            {p.tie && (
              <span className={clsx('font-medium', sideClass('defender'))} style={sideStyle('defender')} data-testid="combat-tie-note">
                → defender
              </span>
            )}
          </li>
        ))}
      </ul>
      {(attackerUnpaired > 0 || defenderUnpaired > 0) && (
        <p className="mt-1.5 text-[11px] text-white/45" data-testid="combat-unpaired">
          {attackerUnpaired > 0
            ? `${attackerUnpaired} attacking ${dice(attackerUnpaired)} had nothing to face`
            : `${defenderUnpaired} defending ${dice(defenderUnpaired)} had nothing to face`}
        </p>
      )}
    </div>
  );
}
