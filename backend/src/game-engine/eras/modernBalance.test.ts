import { describe, it, expect } from 'vitest';
import { MODERN_FACTIONS } from './modern';
import { TERRITORY_ABILITY_DEFS } from '../abilities/techAbilities';

/**
 * Modern's 28-point spread was one stat and one homeland, and these values are
 * the fix.
 *
 * Measured with scripts/simFactionBalance.ts, 300 games at each of seeds 41, 7
 * and 99, against a 17% fair share:
 *
 *   before            after
 *   western  34%      20%
 *   petro    20%      21%
 *   cyber    18%      18%
 *   rogue    12%      21%
 *   emerging  9%      12%
 *   eastern   6%       9%
 *   spread   28        14
 *
 * Home claims were wildly uneven — western_power, petro_state and cyber_power
 * each claimed twelve territories across two regions while eastern_bloc
 * claimed five — and claim breadth ordered the era.
 *
 * EASTERN BLOC IS NOT BALANCED ON ITS NUMBER and must not be. `armored_push`
 * is a fortify-phase ability, and the planner emits at most one fortify move
 * per turn, so the harness cannot see it at all (the note in
 * simFactionBalance.ts has the measurement). Its 9% is a floor, not a verdict.
 * Nothing here changes its kit.
 */
describe('modern balance anchors', () => {
  const byId = new Map(MODERN_FACTIONS.map((f) => [f.faction_id, f]));

  it('the Western Bloc does not carry an attack die on the widest home claim', () => {
    // An attack die compounds, so it is worth everything on a good seat. This
    // one sat on twelve territories with Europe uncontested; removing it alone
    // took the era's spread from 28 points to 17.7. Same as japan in #399 and
    // spain in #400.
    expect(byId.get('western_power')?.passive_attack_bonus ?? 0).toBe(0);
  });

  it('the Petrostate claims the Gulf, not the Gulf and all of Africa', () => {
    // Twelve territories plus a now-payable Oil Wealth ran away at 29-33%.
    const petro = byId.get('petro_state')?.home_region_ids ?? [];
    expect(petro).toContain('middle_east');
    expect(petro).not.toContain('sub_saharan_africa');
  });

  it('both draft abilities can be paid for with tech trees off', () => {
    // Tech is off by default and in every campaign stage, so a tech cost here
    // is a kit that does nothing. Oil Wealth is one unit rather than three
    // because three free units a turn made the Petrostate the era's runaway on
    // its own.
    expect(TERRITORY_ABILITY_DEFS.economic_boom?.techCost ?? 0).toBe(0);
    expect(TERRITORY_ABILITY_DEFS.economic_boom?.ownPlacement?.units).toBe(2);
    expect(TERRITORY_ABILITY_DEFS.oil_wealth?.techCost ?? 0).toBe(0);
    expect(TERRITORY_ABILITY_DEFS.oil_wealth?.ownPlacement?.units).toBe(1);
  });

  it('no modern description promises a defence die or a stat the faction lacks', () => {
    // western_power and rogue_state are two of the eight descriptions #397
    // recorded as still promising innate defence dice, which no faction may
    // have at all (factionDefense.test.ts).
    for (const f of MODERN_FACTIONS) {
      expect(f.description, `${f.faction_id} claims a defence die`).not.toMatch(/defense die|defence die/i);
      if (/tech point/i.test(f.description)) {
        expect(f.tech_point_income ?? 0, `${f.faction_id} claims tech points`).toBeGreaterThan(0);
      }
    }
  });
});
