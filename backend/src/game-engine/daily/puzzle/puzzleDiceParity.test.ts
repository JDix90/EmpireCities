/**
 * The solver's dice arithmetic against the engine's.
 *
 * A verdict that says "84 percent" has to be the engine's 84 percent. Three
 * checks: the exact per-exchange distribution equals combatOdds's (which
 * already mirrors resolveCombat) wherever both apply; rifle doctrine, which
 * combatOdds does not model, matches resolveCombat by Monte Carlo; and the
 * whole-assault capture chance equals combatOdds's exact DP.
 */
import { describe, it, expect } from 'vitest';
import { captureProbability, exchangeLossDistribution } from '../../combat/combatOdds';
import { resolveCombat } from '../../combat/combatResolver';
import { createSeededRng } from '../../victory/missions';
import { assaultOutcomes, captureChance, exchangeOutcomes, type AssaultRules } from './dice';

const LAND: AssaultRules = { attackerCap: 3, defenderBonus: 0, doctrine: { legionReroll: false, rifleDoctrine: false } };
const LEGION: AssaultRules = { ...LAND, doctrine: { legionReroll: true, rifleDoctrine: false } };
const RIFLE: AssaultRules = { ...LAND, doctrine: { legionReroll: false, rifleDoctrine: true } };
const SEA: AssaultRules = { ...LAND, attackerCap: 2 };

describe('exchangeOutcomes vs combatOdds.exchangeLossDistribution', () => {
  for (const legion of [false, true]) {
    for (let a = 1; a <= 3; a++) {
      for (let d = 1; d <= 2; d++) {
        it(`${a} vs ${d} dice${legion ? ' with legion reroll' : ''} agrees to 1e-12`, () => {
          const mine = exchangeOutcomes(a, d, { legionReroll: legion, rifleDoctrine: false });
          const theirs = exchangeLossDistribution(a, d, legion);
          const marginal = new Array<number>(theirs.length).fill(0);
          let total = 0;
          for (const o of mine) {
            marginal[o.defenderLosses] += o.p;
            total += o.p;
            // Losses in one exchange always sum to the comparisons made.
            expect(o.attackerLosses + o.defenderLosses).toBe(Math.min(a, d));
          }
          expect(total).toBeCloseTo(1, 12);
          theirs.forEach((p, i) => expect(marginal[i]).toBeCloseTo(p, 12));
        });
      }
    }
  }
});

describe('rifle doctrine vs resolveCombat (Monte Carlo)', () => {
  it('matches the engine within sampling error on a 3-vs-2-dice exchange', () => {
    const rng = createSeededRng(4242);
    const dieRoll = () => Math.floor(rng() * 6) + 1;
    const N = 40_000;
    const counts = new Map<string, number>();
    for (let i = 0; i < N; i++) {
      const r = resolveCombat(4, 2, undefined, undefined, dieRoll, { rifle_doctrine: true });
      const k = `${r.attacker_losses}:${r.defender_losses}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const exact = exchangeOutcomes(3, 2, RIFLE.doctrine);
    for (const o of exact) {
      const observed = (counts.get(`${o.attackerLosses}:${o.defenderLosses}`) ?? 0) / N;
      expect(Math.abs(observed - o.p)).toBeLessThan(0.012);
    }
  });
});

describe('captureChance vs combatOdds.captureProbability', () => {
  const cases: Array<[number, number]> = [[10, 6], [8, 4], [5, 5], [3, 1], [2, 1], [12, 9]];
  for (const [a, d] of cases) {
    it(`${a} vs ${d} on land, plain and legion`, () => {
      expect(captureChance(a, d, LAND)).toBeCloseTo(captureProbability(a, d), 9);
      expect(captureChance(a, d, LEGION)).toBeCloseTo(captureProbability(a, d, { legionReroll: true }), 9);
    });
    it(`${a} vs ${d} across a sea lane`, () => {
      expect(captureChance(a, d, SEA)).toBeCloseTo(captureProbability(a, d, { attackerBaseCap: 2 }), 9);
    });
  }
});

describe('assaultOutcomes', () => {
  it('sums to one, respects the floor, and moves min(remaining - 1, 3) across on a capture', () => {
    for (const keep of [1, 3]) {
      const outs = assaultOutcomes(9, 4, keep, LAND);
      expect(outs.reduce((s, o) => s + o.p, 0)).toBeCloseTo(1, 10);
      for (const o of outs) {
        if (o.captured) {
          expect(o.toUnits).toBeGreaterThanOrEqual(1);
          expect(o.toUnits).toBeLessThanOrEqual(3);
          expect(o.fromUnits).toBeGreaterThanOrEqual(1);
        } else {
          expect(o.fromUnits).toBeLessThanOrEqual(keep);
          expect(o.toUnits).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it('a stopped assault keeps more attackers alive than an all-in one', () => {
    const allIn = assaultOutcomes(7, 5, 1, LAND);
    const careful = assaultOutcomes(7, 5, 3, LAND);
    const expectedFrom = (outs: typeof allIn) => outs.reduce((s, o) => s + o.p * o.fromUnits, 0);
    expect(expectedFrom(careful)).toBeGreaterThan(expectedFrom(allIn));
    expect(captureChance(7, 5, LAND)).toBeGreaterThan(careful.filter((o) => o.captured).reduce((s, o) => s + o.p, 0));
  });
});
