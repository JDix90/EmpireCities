/**
 * Exact dice arithmetic for the puzzle solver.
 *
 * Mirrors combatResolver.resolveCombat exactly, including the two era
 * doctrines that reroll attacker dice: legion_reroll (Ancient: the lowest die
 * is rerolled once, keeping the better) and rifle_doctrine (ACW: every die
 * that tied its defender die is rerolled once, keeping the better, then the
 * attacker's dice are re-sorted and every pair compared again). combatOdds
 * models only the first, which is fine for the AI's ranking heuristics and not
 * fine for a verdict that claims to be exact, so this module enumerates the
 * rolls itself and is checked against combatOdds where the two overlap and
 * against resolveCombat by Monte Carlo where they do not
 * (puzzleDiceParity.test.ts).
 *
 * `assaultOutcomes` is the chance node the solver expands: the exact
 * distribution of how a whole assault ends — captured with so many attackers
 * left, or stopped at the attacker's chosen floor — with the engine's capture
 * move-in (min(remaining - 1, 3) units cross, at least one stays) applied.
 */

export interface DiceDoctrine {
  legionReroll: boolean;
  rifleDoctrine: boolean;
}

export const NO_DOCTRINE: DiceDoctrine = { legionReroll: false, rifleDoctrine: false };

/** Outcome of one exchange: how many units each side lost. */
export interface ExchangeOutcome {
  attackerLosses: number;
  defenderLosses: number;
  p: number;
}

const exchangeMemo = new Map<string, ExchangeOutcome[]>();

function rollsOf(n: number): number[][] {
  // All ordered rolls of n dice: 6^n sequences. n ≤ 3 in every reachable
  // puzzle state (dice caps), so this is at most 216 entries.
  const out: number[][] = [[]];
  for (let i = 0; i < n; i++) {
    const next: number[][] = [];
    for (const prefix of out) for (let f = 1; f <= 6; f++) next.push([...prefix, f]);
    out.splice(0, out.length, ...next);
  }
  return out;
}

/**
 * Exact distribution of (attackerLosses, defenderLosses) for one exchange of
 * `aDice` vs `dDice`, before the caller applies the engine's loss caps.
 * Enumerates every ordered roll (and every reroll face where a doctrine
 * rerolls), so the probabilities are exact rationals summed in floating point.
 */
export function exchangeOutcomes(aDice: number, dDice: number, doctrine: DiceDoctrine = NO_DOCTRINE): ExchangeOutcome[] {
  const a = Math.max(1, aDice);
  const d = Math.max(1, dDice);
  const key = `${a}x${d}${doctrine.legionReroll ? 'L' : ''}${doctrine.rifleDoctrine ? 'R' : ''}`;
  const hit = exchangeMemo.get(key);
  if (hit) return hit;

  const tally = new Map<string, number>();
  const add = (al: number, dl: number, p: number) => {
    const k = `${al}:${dl}`;
    tally.set(k, (tally.get(k) ?? 0) + p);
  };

  const attRolls = rollsOf(a);
  const defRolls = rollsOf(d);
  const pBase = 1 / (attRolls.length * defRolls.length);

  for (const attRaw of attRolls) {
    for (const defRaw of defRolls) {
      // resolveCombat sorts both descending before any doctrine.
      const att = [...attRaw].sort((x, y) => y - x);
      const def = [...defRaw].sort((x, y) => y - x);
      // Legion: the lowest attacker die is rerolled once, keep the better.
      const legionVariants: Array<{ att: number[]; p: number }> = [];
      if (doctrine.legionReroll) {
        const minIdx = att.indexOf(Math.min(...att));
        for (let r = 1; r <= 6; r++) {
          const v = [...att];
          v[minIdx] = Math.max(v[minIdx], r);
          v.sort((x, y) => y - x);
          legionVariants.push({ att: v, p: pBase / 6 });
        }
      } else {
        legionVariants.push({ att, p: pBase });
      }

      for (const variant of legionVariants) {
        const cmp = Math.min(variant.att.length, def.length);
        let al = 0;
        let dl = 0;
        const tiedIdx: number[] = [];
        for (let i = 0; i < cmp; i++) {
          if (variant.att[i] > def[i]) dl++;
          else {
            al++;
            if (variant.att[i] === def[i]) tiedIdx.push(i);
          }
        }
        if (!doctrine.rifleDoctrine || tiedIdx.length === 0) {
          add(al, dl, variant.p);
          continue;
        }
        // Rifle doctrine: every tied attacker die rerolls once (keep the
        // better), the attacker's dice are re-sorted, every pair recompared.
        const rerollSets = rollsOf(tiedIdx.length);
        const pEach = variant.p / rerollSets.length;
        for (const rerolls of rerollSets) {
          const v = [...variant.att];
          tiedIdx.forEach((idx, j) => {
            v[idx] = Math.max(v[idx], rerolls[j]);
          });
          v.sort((x, y) => y - x);
          let al2 = 0;
          let dl2 = 0;
          for (let i = 0; i < cmp; i++) {
            if (v[i] > def[i]) dl2++;
            else al2++;
          }
          add(al2, dl2, pEach);
        }
      }
    }
  }

  const out: ExchangeOutcome[] = [...tally.entries()].map(([k, p]) => {
    const [al, dl] = k.split(':').map(Number);
    return { attackerLosses: al, defenderLosses: dl, p };
  });
  exchangeMemo.set(key, out);
  return out;
}

/** The engine's dice counts for one exchange, given the structural cap. */
export function diceCounts(attackers: number, defenders: number, attackerCap: number, defenderBonus: number): { aDice: number; dDice: number } {
  return {
    aDice: Math.max(1, Math.min(attackers - 1, attackerCap)),
    dDice: Math.max(1, Math.min(defenders, 2) + defenderBonus),
  };
}

export interface AssaultRules {
  /** 3 on land; 2 across a sea lane in the Discovery era. */
  attackerCap: number;
  /** Flat defender dice bonus (defense buildings). 0 on an authored puzzle board. */
  defenderBonus: number;
  doctrine: DiceDoctrine;
}

export function assaultRulesKey(r: AssaultRules): string {
  return `${r.attackerCap}/${r.defenderBonus}/${r.doctrine.legionReroll ? 'L' : ''}${r.doctrine.rifleDoctrine ? 'R' : ''}`;
}

/** How a whole assault ended. */
export interface AssaultEnd {
  captured: boolean;
  /** Units left on the attacking territory after losses and, on a capture, after the move-in. */
  fromUnits: number;
  /** Units on the defending territory: the survivors on a stop, the garrison that crossed on a capture. */
  toUnits: number;
  p: number;
}

const assaultMemo = new Map<string, AssaultEnd[]>();

/**
 * Exact distribution of how an assault ends when the attacker presses until
 * the garrison falls or their stack drops to `keep` units (the engine refuses
 * to attack from a single unit, so keep ≥ 1). Losses are capped the way
 * resolveCombat caps them; on a capture, min(remaining - 1, 3) units cross
 * and at least one stays, exactly as executeLandAttack moves them.
 */
export function assaultOutcomes(attackers: number, defenders: number, keep: number, rules: AssaultRules): AssaultEnd[] {
  const floor = Math.max(1, keep);
  const key = `${attackers}v${defenders}k${floor}|${assaultRulesKey(rules)}`;
  const hit = assaultMemo.get(key);
  if (hit) return hit;

  const tally = new Map<string, AssaultEnd>();
  const record = (captured: boolean, fromUnits: number, toUnits: number, p: number) => {
    const k = `${captured ? 'c' : 's'}${fromUnits}:${toUnits}`;
    const e = tally.get(k);
    if (e) e.p += p;
    else tally.set(k, { captured, fromUnits, toUnits, p });
  };

  // Iterative expansion over (a, d) states with accumulated probability;
  // states are visited in order of decreasing a + d so each is expanded once.
  const pending = new Map<string, { a: number; d: number; p: number }>();
  pending.set(`${attackers}:${defenders}`, { a: attackers, d: defenders, p: 1 });
  while (pending.size > 0) {
    // Pick the state with the largest a + d (no state feeds a larger one).
    let best: { a: number; d: number; p: number } | null = null;
    let bestKey = '';
    for (const [k, s] of pending) {
      if (!best || s.a + s.d > best.a + best.d) {
        best = s;
        bestKey = k;
      }
    }
    pending.delete(bestKey);
    const { a, d, p } = best!;
    if (d <= 0) {
      const cross = Math.max(1, Math.min(a - 1, 3));
      record(true, Math.max(1, a - cross), cross, p);
      continue;
    }
    if (a <= floor || a < 2) {
      record(false, a, d, p);
      continue;
    }
    const { aDice, dDice } = diceCounts(a, d, rules.attackerCap, rules.defenderBonus);
    for (const o of exchangeOutcomes(aDice, dDice, rules.doctrine)) {
      const al = Math.min(o.attackerLosses, a - 1);
      const dl = Math.min(o.defenderLosses, d);
      const na = a - al;
      const nd = d - dl;
      const k = `${na}:${nd}`;
      const e = pending.get(k);
      if (e) e.p += p * o.p;
      else pending.set(k, { a: na, d: nd, p: p * o.p });
    }
  }
  const out = [...tally.values()];
  assaultMemo.set(key, out);
  return out;
}

/** P(capture) for a press-until-decided assault, for the plan's `min_odds` and the gate's reports. */
export function captureChance(attackers: number, defenders: number, rules: AssaultRules): number {
  if (defenders <= 0) return 1;
  if (attackers < 2) return 0;
  return assaultOutcomes(attackers, defenders, 1, rules).filter((o) => o.captured).reduce((s, o) => s + o.p, 0);
}
