import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ANCIENT_FACTIONS } from './ancient';

/**
 * The ancient era's spread was structural, not a kit gap, and these three
 * values are the fix. They are pinned here because each one looks arbitrary on
 * its own and reverting any of them silently puts the era back on the floor.
 *
 * Measured with scripts/simFactionBalance.ts, 300 games at each of seeds 41, 7
 * and 99, against a 17% fair share:
 *
 *   before            after
 *   han      45%      40%
 *   rome     28%      19%
 *   carthage 14%      17%
 *   maurya   11%      10%
 *   germanic  1%       7%   (eliminated 92% -> 70%)
 *   parthia   1%       7%   (eliminated 95% -> 56%)
 *   spread   44       33
 *
 * What the diagnosis turned on: counting, per faction, the neutral territories
 * it reaches before any rival does. Parthia and the Germanic tribes opened with
 * 0.3 of them; everyone else had 3.0 to 4.5, and the ranking of that one number
 * ordered the era. Reinforcements scale with territory count, so a faction with
 * nowhere to grow cannot out-earn anyone — which is why attack dice moved
 * Parthia by two points and income moved it by ten.
 */
describe('ancient era balance anchors', () => {
  const byId = new Map(ANCIENT_FACTIONS.map((f) => [f.faction_id, f]));

  it('Parthia is paid for a position it cannot expand out of', () => {
    // 2 was not enough (6%) and neither was 2 plus an attack die (7%). 4 read
    // best of all here and is deliberately not what shipped: see the note in
    // ancient.ts for what it did to an AI Parthia in the campaign.
    expect(byId.get('parthia')?.reinforce_bonus ?? 0).toBeGreaterThanOrEqual(3);
    expect(byId.get('parthia')?.reinforce_bonus ?? 0).toBeLessThanOrEqual(3);
  });

  it('the Germanic tribes do not claim the steppe', () => {
    // Claiming it smeared their homeland from Gaul to Manchuria across a front
    // they could not hold, and it belongs to horse nomads besides.
    expect(byId.get('germanic_tribes')?.home_region_ids).not.toContain('steppe');
  });

  it('Han China is not the best-paying home region as well as the safest', () => {
    // Han China is the only 4-territory homeland on the board that is not
    // contested on three or more sides, and it opens eight doors into empty
    // Asia. Paying it like the contested ones is what made Han a 45% seat.
    const map = JSON.parse(
      readFileSync(join(__dirname, '../../../../database/maps/era_ancient.json'), 'utf-8'),
    ) as { regions: { region_id: string; bonus: number }[] };
    const bonusOf = (id: string) => map.regions.find((r) => r.region_id === id)?.bonus ?? 0;
    expect(bonusOf('han_china')).toBeLessThanOrEqual(3);
    expect(bonusOf('han_china')).toBeLessThan(bonusOf('parthia'));
  });
});
