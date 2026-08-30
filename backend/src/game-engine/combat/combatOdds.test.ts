import { describe, it, expect } from 'vitest';
import { captureProbability, exchangeLossDistribution } from './combatOdds';
import { resolveCombat } from './combatResolver';

// Deterministic d6 for the Monte Carlo cross-check (mulberry32).
function seededDie(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return 1 + (((t ^ (t >>> 14)) >>> 0) % 6);
  };
}

/**
 * Reference assault: drive the REAL resolveCombat in the same loop the DP
 * models (attack while attacker >= 2 and garrison stands), with the same
 * bonus semantics computeLandCombatModifiers produces (override = base +
 * flat bonus, recomputed per exchange as units drop).
 */
function monteCarloCapture(
  a0: number,
  d0: number,
  attackBonus: number,
  defenseBonus: number,
  trials: number,
  die: () => number,
): number {
  let captures = 0;
  for (let t = 0; t < trials; t++) {
    let a = a0;
    let d = d0;
    while (a >= 2 && d >= 1) {
      const attOverride = attackBonus > 0 ? Math.min(a - 1, 3) + attackBonus : undefined;
      const defOverride = defenseBonus > 0 ? Math.min(d, 2) + defenseBonus : undefined;
      const r = resolveCombat(a, d, attOverride, defOverride, die);
      a -= r.attacker_losses;
      d -= r.defender_losses;
      if (r.territory_captured) {
        captures++;
        break;
      }
    }
  }
  return captures / trials;
}

describe('exchangeLossDistribution', () => {
  it('matches the published 3v2 dice odds exactly', () => {
    // Classic Risk single-exchange 3-attacker vs 2-defender dice:
    // P(def -2) = 2890/7776, P(1 each) = 2611/7776, P(att -2) = 2275/7776.
    const dist = exchangeLossDistribution(3, 2);
    expect(dist[2]).toBeCloseTo(2890 / 7776, 12);
    expect(dist[1]).toBeCloseTo(2611 / 7776, 12);
    expect(dist[0]).toBeCloseTo(2275 / 7776, 12);
  });

  it('matches the published 2v1 and 1v1 odds exactly', () => {
    // 2 attacker dice vs 1 defender die: P(def loses) = 125/216.
    expect(exchangeLossDistribution(2, 1)[1]).toBeCloseTo(125 / 216, 12);
    // 1v1: attacker needs strict >, defender wins ties: 15/36.
    expect(exchangeLossDistribution(1, 1)[1]).toBeCloseTo(15 / 36, 12);
  });

  it('is a probability distribution', () => {
    for (const [a, d] of [[1, 1], [3, 2], [3, 3], [5, 4], [8, 8]] as const) {
      const dist = exchangeLossDistribution(a, d);
      expect(dist).toHaveLength(Math.min(a, d) + 1);
      expect(dist.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 12);
    }
  });

  it('legion reroll shifts losses toward the defender', () => {
    const plain = exchangeLossDistribution(3, 2, false);
    const legion = exchangeLossDistribution(3, 2, true);
    expect(legion.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 12);
    expect(legion[2]).toBeGreaterThan(plain[2]);
    expect(legion[0]).toBeLessThan(plain[0]);
  });
});

describe('captureProbability — exact small cases', () => {
  it('2v1 is a single 1v1 exchange: 15/36', () => {
    expect(captureProbability(2, 1)).toBeCloseTo(15 / 36, 12);
  });

  it('3v1 is 2v1 dice then a possible 1v1 retry', () => {
    const expected = 125 / 216 + (91 / 216) * (15 / 36);
    expect(captureProbability(3, 1)).toBeCloseTo(expected, 12);
  });

  it('degenerate inputs', () => {
    expect(captureProbability(1, 5)).toBe(0); // can't attack at all
    expect(captureProbability(10, 0)).toBe(1); // nothing to capture
  });
});

describe('captureProbability — structure', () => {
  it('is monotone in attackers and defenders', () => {
    let prev = 0;
    for (let a = 2; a <= 20; a++) {
      const p = captureProbability(a, 6);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
    prev = 1;
    for (let d = 1; d <= 20; d++) {
      const p = captureProbability(8, d);
      expect(p).toBeLessThanOrEqual(prev);
      prev = p;
    }
  });

  it('attack bonuses raise the odds, defense bonuses lower them', () => {
    const base = captureProbability(8, 6);
    expect(captureProbability(8, 6, { attackBonus: 1 })).toBeGreaterThan(base);
    expect(captureProbability(8, 6, { defenseBonus: 1 })).toBeLessThan(base);
    expect(captureProbability(8, 6, { legionReroll: true })).toBeGreaterThan(base);
  });

  it('the sea-lane base cap of 2 dice hurts the attacker', () => {
    expect(captureProbability(10, 5, { attackerBaseCap: 2 })).toBeLessThan(
      captureProbability(10, 5),
    );
  });

  it('the anti-fortress defender cap tames stacked defense bonuses', () => {
    const uncapped = captureProbability(20, 8, { defenseBonus: 5 });
    const capped = captureProbability(20, 8, { defenseBonus: 5, maxDefenderDice: 4 });
    expect(capped).toBeGreaterThan(uncapped);
  });

  it('era-transition vulnerability raises the odds', () => {
    expect(captureProbability(8, 6, { defenderDiceMult: 0.75 })).toBeGreaterThan(
      captureProbability(8, 6),
    );
  });

  it('a big stack against a small garrison is near-certain; the reverse near-zero', () => {
    expect(captureProbability(30, 3)).toBeGreaterThan(0.99);
    expect(captureProbability(3, 30)).toBeLessThan(0.01);
  });
});

describe('captureProbability — cross-check against the real resolveCombat', () => {
  // The DP must agree with a Monte Carlo assault driven by the production
  // resolver. 30k seeded trials keep the sampling error around ±0.6%.
  const TRIALS = 30_000;
  const TOL = 0.015;

  it.each([
    [5, 3, 0, 0],
    [10, 8, 0, 0],
    [7, 4, 1, 0],
    [10, 6, 0, 1],
    [15, 10, 0, 0],
  ])('%iv%i (att+%i def+%i)', (a, d, aB, dB) => {
    const mc = monteCarloCapture(a, d, aB, dB, TRIALS, seededDie(a * 1000 + d * 10 + aB + dB));
    const dp = captureProbability(a, d, { attackBonus: aB, defenseBonus: dB });
    expect(Math.abs(dp - mc)).toBeLessThan(TOL);
  });
});
