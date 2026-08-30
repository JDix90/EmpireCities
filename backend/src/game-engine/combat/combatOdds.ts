/**
 * Exact capture-probability computation for land combat, for use at AI plan time.
 *
 * Mirrors the single-exchange rules in combatResolver.ts precisely:
 *   attackerDice = min(attackingUnits - 1, 3) + flat bonuses (base capped for sea lanes)
 *   defenderDice = min(defendingUnits, 2) + flat bonuses
 *   dice sorted descending; compare min(aDice, dDice) pairs; defender wins ties;
 *   losses capped at (attackers - 1) / defenders per exchange;
 *   legion_reroll (Ancient): the attacker's lowest die is rerolled once, keeping
 *   the better result.
 *
 * `captureProbability` then runs the full-assault DP: the attacker keeps rolling
 * exchanges until the garrison falls (capture) or it drops below 2 units (fail).
 * That is the same loop the grind executor drives and the combat fairness audit
 * simulates (scripts/combatFairnessSim.js) — but exact rather than Monte Carlo,
 * and memoized so the planner can afford to call it for every candidate edge.
 *
 * The planner's previous favorability signal was the saturating (attackDice -
 * defDice), which is blind to garrison size beyond the dice caps and to every
 * dice modifier — the reason the AI mis-ranked fights it could not actually win.
 */

/**
 * Beyond this many dice on a side the extra die barely moves the odds, and the
 * exact enumeration cost grows combinatorially — clamp. (8 dice already needs a
 * +5 bonus over the base 3, i.e. an extreme late-game stack.)
 */
const MAX_DICE = 8;

/**
 * Assault states are clamped to this many units per side before the DP. A fight
 * bigger than 100v100 is decided by the ratio long before the clamp matters.
 */
const MAX_UNITS = 100;

export interface CaptureOddsOptions {
  /** Flat attacker dice bonus (tech + faction + event + era gap + …). */
  attackBonus?: number;
  /** Flat defender dice bonus (building + tech + faction + wonder + era gap + …). */
  defenseBonus?: number;
  /** Base attacker dice cap before bonuses: 3 for land, 2 across a sea lane. */
  attackerBaseCap?: number;
  /** Anti-fortress ceiling on total attacker dice (combat_dice_cap_enabled). */
  maxAttackerDice?: number;
  /** Anti-fortress ceiling on total defender dice (combat_dice_cap_enabled). */
  maxDefenderDice?: number;
  /**
   * Era-transition vulnerability: total defender dice are scaled by this factor
   * (floor, min 1) — mirrors computeLandCombatModifiers' post-cap treatment.
   */
  defenderDiceMult?: number;
  /** Ancient legion_reroll era modifier: reroll the attacker's lowest die once. */
  legionReroll?: boolean;
}

/**
 * All sorted-descending outcomes of rolling `n` d6, as [values, probability]
 * pairs. Enumerated as face-count multisets weighted by the multinomial
 * coefficient, so 8 dice cost C(13,5)=1287 entries instead of 6^8 sequences.
 */
function sortedRollDistribution(n: number): Array<[number[], number]> {
  const out: Array<[number[], number]> = [];
  const counts = new Array<number>(6).fill(0);
  // factorials up to MAX_DICE
  const fact = [1, 1, 2, 6, 24, 120, 720, 5040, 40320];
  const total = Math.pow(6, n);
  const recurse = (face: number, remaining: number) => {
    if (face === 5) {
      counts[5] = remaining;
      let weight = fact[n];
      const values: number[] = [];
      for (let f = 5; f >= 0; f--) {
        weight /= fact[counts[f]];
        for (let i = 0; i < counts[f]; i++) values.push(f + 1);
      }
      out.push([values, weight / total]);
      counts[5] = 0;
      return;
    }
    for (let c = 0; c <= remaining; c++) {
      counts[face] = c;
      recurse(face + 1, remaining - c);
    }
    counts[face] = 0;
  };
  recurse(0, n);
  return out;
}

/**
 * Apply legion_reroll to a sorted-descending attacker roll: the lowest die is
 * rerolled once, keeping the better result. Returns the six resulting sorted
 * rolls (one per reroll face), each carrying 1/6 of the input probability.
 */
function withLegionReroll(dist: Array<[number[], number]>): Array<[number[], number]> {
  const merged = new Map<string, [number[], number]>();
  for (const [values, p] of dist) {
    for (let r = 1; r <= 6; r++) {
      const next = values.slice();
      const last = next.length - 1;
      if (r > next[last]) {
        next[last] = r;
        next.sort((a, b) => b - a);
      }
      const key = next.join(',');
      const entry = merged.get(key);
      if (entry) entry[1] += p / 6;
      else merged.set(key, [next, p / 6]);
    }
  }
  return [...merged.values()];
}

/**
 * dist[dl] = P(defender loses dl units in one exchange of aDice vs dDice).
 * Attacker losses are (comparisons - dl). Memoized process-wide.
 */
const exchangeMemo = new Map<string, number[]>();

export function exchangeLossDistribution(
  aDice: number,
  dDice: number,
  legionReroll = false,
): number[] {
  const a = Math.max(1, Math.min(aDice, MAX_DICE));
  const d = Math.max(1, Math.min(dDice, MAX_DICE));
  const key = `${a}x${d}${legionReroll ? 'L' : ''}`;
  const cached = exchangeMemo.get(key);
  if (cached) return cached;

  let attRolls = sortedRollDistribution(a);
  if (legionReroll) attRolls = withLegionReroll(attRolls);
  const defRolls = sortedRollDistribution(d);

  const cmp = Math.min(a, d);
  const dist = new Array<number>(cmp + 1).fill(0);
  for (const [attackerRolls, pA] of attRolls) {
    for (const [defenderRolls, pD] of defRolls) {
      let dl = 0;
      for (let i = 0; i < cmp; i++) {
        if (attackerRolls[i] > defenderRolls[i]) dl++;
      }
      dist[dl] += pA * pD;
    }
  }
  exchangeMemo.set(key, dist);
  return dist;
}

/** Dice counts for an assault state, mirroring computeLandCombatModifiers. */
function diceForState(a: number, d: number, opts: CaptureOddsOptions): { aDice: number; dDice: number } {
  const attackBonus = opts.attackBonus ?? 0;
  const defenseBonus = opts.defenseBonus ?? 0;
  const baseCap = opts.attackerBaseCap ?? 3;

  const aBase = Math.min(a - 1, baseCap);
  let aDice = aBase + attackBonus;
  // The anti-fortress cap never drops below the structural base.
  if (opts.maxAttackerDice !== undefined) {
    aDice = Math.min(aDice, Math.max(aBase, opts.maxAttackerDice));
  }

  const dBase = Math.min(d, 2);
  let dDice = dBase + defenseBonus;
  if (opts.maxDefenderDice !== undefined) {
    dDice = Math.min(dDice, Math.max(dBase, opts.maxDefenderDice));
  }
  // Era-transition vulnerability scales total dice, applied after the cap.
  if (opts.defenderDiceMult !== undefined && opts.defenderDiceMult < 1) {
    dDice = Math.max(1, Math.floor(dDice * opts.defenderDiceMult));
  }

  return {
    aDice: Math.max(1, Math.min(aDice, MAX_DICE)),
    dDice: Math.max(1, Math.min(dDice, MAX_DICE)),
  };
}

const assaultMemo = new Map<string, Map<number, number>>();

function optsKey(opts: CaptureOddsOptions): string {
  return [
    opts.attackBonus ?? 0,
    opts.defenseBonus ?? 0,
    opts.attackerBaseCap ?? 3,
    opts.maxAttackerDice ?? -1,
    opts.maxDefenderDice ?? -1,
    opts.defenderDiceMult ?? 1,
    opts.legionReroll ? 1 : 0,
  ].join('|');
}

/**
 * P(the attacker eventually captures) for a full assault: repeated exchanges
 * from a territory holding `attackers` units against `defenders`, continuing
 * while the attacker has >= 2 units and the garrison stands. Exact, memoized.
 *
 * Note this models "press until decided", not one exchange — the shipped grind
 * executor presses within a per-turn budget and a material-edge floor, and a
 * stack can finish a fight across turns, so the assault probability is the
 * honest long-run favorability signal for ranking targets.
 */
export function captureProbability(
  attackers: number,
  defenders: number,
  opts: CaptureOddsOptions = {},
): number {
  if (defenders <= 0) return 1;
  if (attackers < 2) return 0;
  const a0 = Math.min(attackers, MAX_UNITS);
  const d0 = Math.min(defenders, MAX_UNITS);

  const cfg = optsKey(opts);
  let memo = assaultMemo.get(cfg);
  if (!memo) {
    memo = new Map();
    assaultMemo.set(cfg, memo);
  }

  const recurse = (a: number, d: number): number => {
    if (d <= 0) return 1;
    if (a < 2) return 0;
    const key = a * (MAX_UNITS + 1) + d;
    const hit = memo!.get(key);
    if (hit !== undefined) return hit;

    const { aDice, dDice } = diceForState(a, d, opts);
    const dist = exchangeLossDistribution(aDice, dDice, opts.legionReroll);
    const cmp = dist.length - 1;
    let p = 0;
    for (let dl = 0; dl <= cmp; dl++) {
      if (dist[dl] === 0) continue;
      // resolveCombat caps losses so neither side is over-killed.
      const defenderLosses = Math.min(dl, d);
      const attackerLosses = Math.min(cmp - dl, a - 1);
      p += dist[dl] * recurse(a - attackerLosses, d - defenderLosses);
    }
    memo!.set(key, p);
    return p;
  };

  return recurse(a0, d0);
}
