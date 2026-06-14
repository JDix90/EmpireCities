import { describe, it, expect } from 'vitest';
import type { TerritoryState } from '../../types';
import {
  navalBombardmentDefenseDice,
  resolveSeaCrossing,
  NAVAL_BOMBARDMENT_DEFENSE_CAP,
} from './navalManager';

function terr(navalUnits: number): TerritoryState {
  return { territory_id: 't', owner_id: 'p', unit_count: 10, unit_type: 'infantry', naval_units: navalUnits } as TerritoryState;
}

describe('navalBombardmentDefenseDice', () => {
  it('is +1 per two surviving fleets, rounded up', () => {
    expect(navalBombardmentDefenseDice(0)).toBe(0);
    expect(navalBombardmentDefenseDice(1)).toBe(1);
    expect(navalBombardmentDefenseDice(2)).toBe(1);
    expect(navalBombardmentDefenseDice(3)).toBe(2);
    expect(navalBombardmentDefenseDice(4)).toBe(2);
    expect(navalBombardmentDefenseDice(5)).toBe(3);
    expect(navalBombardmentDefenseDice(6)).toBe(3);
  });

  it('caps the bombardment penalty', () => {
    expect(navalBombardmentDefenseDice(100)).toBe(NAVAL_BOMBARDMENT_DEFENSE_CAP);
  });
});

describe('resolveSeaCrossing', () => {
  it('lands uncontested when the target has no fleets, consuming one ferry fleet', () => {
    const from = terr(3);
    const to = terr(0);
    const r = resolveSeaCrossing(from, to);
    expect(r.canLand).toBe(true);
    expect(r.fleetSunk).toBe(false);
    expect(r.bombardmentDefenseBonus).toBe(0);
    expect(r.navalResult).toBeUndefined();
    expect(from.naval_units).toBe(2); // one fleet ferried the troops
    expect(to.naval_units).toBe(0);
  });

  it('always lands with 3 attacking fleets regardless of garrison (the spiral fix)', () => {
    // attacker loses at most 2 fleets per exchange, so 3 fleets always keep one
    // afloat to ferry the troops — a heavily-garrisoned island is no longer a wall.
    for (let i = 0; i < 100; i++) {
      const from = terr(3);
      const to = terr(20);
      const r = resolveSeaCrossing(from, to);
      expect(r.canLand).toBe(true);
      expect(r.fleetSunk).toBe(false);
      expect(r.bombardmentDefenseBonus).toBe(NAVAL_BOMBARDMENT_DEFENSE_CAP); // big surviving garrison
      expect(from.naval_units).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps fleet bookkeeping consistent with the naval exchange', () => {
    for (let i = 0; i < 200; i++) {
      const from = terr(5);
      const to = terr(4);
      const r = resolveSeaCrossing(from, to);
      const nr = r.navalResult!;
      expect(nr).toBeDefined();
      // Defender = start − defender losses.
      expect(to.naval_units).toBe(Math.max(0, 4 - nr.defender_losses));
      const attackerAfterCombat = Math.max(0, 5 - nr.attacker_losses);
      // 5v4 → attacker loses ≤2, so a ship always survives to land.
      expect(r.canLand).toBe(true);
      expect(from.naval_units).toBe(attackerAfterCombat - 1); // one ferried
      expect(r.bombardmentDefenseBonus).toBe(navalBombardmentDefenseDice(to.naval_units!));
    }
  });

  it('fails the landing (fleet sunk) when the crossing wipes the attacker, but is not a wall', () => {
    let sunkSeen = false;
    let landedSeen = false;
    for (let i = 0; i < 300; i++) {
      const from = terr(1);
      const to = terr(2);
      const r = resolveSeaCrossing(from, to);
      if (r.canLand) {
        landedSeen = true;
        expect(r.fleetSunk).toBe(false);
      } else {
        sunkSeen = true;
        expect(r.fleetSunk).toBe(true);
        expect(from.naval_units).toBe(0);
        expect(r.bombardmentDefenseBonus).toBe(0);
      }
    }
    // Both outcomes are reachable from a 1-v-2 crossing (coin-flip-ish).
    expect(sunkSeen).toBe(true);
    expect(landedSeen).toBe(true);
  });
});
