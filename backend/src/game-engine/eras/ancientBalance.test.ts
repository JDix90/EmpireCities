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

  /**
   * Carthage shipped with no ability and no numeric bonus at all — the only
   * faction in the game whose entire kit was a sentence of scenery, and one of
   * five the lore catalog covered for by advertising an ability ("Naval
   * Supremacy") that had never existed.
   *
   * It was not weak. Over 5 seeds x 300 games against a 17% fair share:
   *
   *   before            after
   *   carthage  17.0%   20.8%
   *   eliminated  47%   34.2%
   *   era spread 32.7   33.2
   *
   * Paying for the kit by trimming `africa` 5 -> 4 was measured over the same
   * five seeds and REJECTED. It does hold Carthage to 18.4%, but han rises
   * 38.8% -> 41.2% at EVERY seed and the spread goes 33.2 -> 35.6: making the
   * densest region on the map less worth fighting over helps the faction that
   * already runs the era. The map is untouched.
   *
   * Ancient's spread is han's, not Carthage's — han wins 38.8% while germanic
   * and parthia sit at 6-8%. That is a separate pass and this one deliberately
   * does not pretend to have fixed it.
   */
  it('Carthage has a kit at all', () => {
    const carthage = byId.get('carthage');
    expect(carthage?.ability_id).toBe('mercenary_levy');
    expect(carthage?.ability_description).toBeTruthy();
  });

  /**
   * Han led the era at 38.8% of 1500 games WITH NO WORKING ABILITY. Silk Road
   * granted 3 tech points and nothing else, and tech_trees_enabled defaults
   * false, so its whole kit was scenery — the same defect as the five dead
   * kits fixed alongside it. It now places a caravan levy as well, and the
   * tech grant is kept for games with research on.
   *
   * That fix is deliberately NOT a nerf, and the numbers say it is not one:
   * han 38.8% -> 38.8%, spread 33.2 -> 32.4 over 5 seeds x 300.
   *
   * Han's 38.8% cannot be fixed from faction data and this pass does not
   * pretend to. Swapping han's and parthia's HOMELANDS moves 48%/8% to 2%/55%
   * — the seat wins, not the faction, and handing han parthia's +3
   * reinforcements in the cramped seat still leaves it at 2%. Every kit
   * package measured (a real ability at reinforce 2, 1 and 0) lands the era
   * between 33 and 34. Giving parthia the steppe BACKFIRES, dropping parthia
   * 8% -> 7% and germanic 6% -> 4%, because a second home region stretches its
   * line — the same lesson the Confederacy taught. Closing this needs map
   * surgery on han_china's ten doors into empty Asia.
   */
  /**
   * Han's 38.8% was never a kit and never a door — it was HALF A MAP.
   *
   * 29 of era_ancient's 57 territories carry `unlock_era_index > 0`, and in a
   * normal game they are never placed at all: era_advancement_enabled defaults
   * false (eraAdvancement/constants.ts types it as the literal `false`), and
   * `seedsFullBoardAtStart` only ever returns true for space_age behind its own
   * flag. So ancient was played on 28 tiles, and on those 28 tiles han held the
   * largest home (4) with only ONE rival adjacent — the only faction with both.
   *
   * That is why nothing else moved it, and every failed attempt is recorded
   * below so they are not retried. Closing han's "ten doors into empty Asia"
   * changed nothing because five of the six regions behind them (far_east,
   * southeast_asia, himalaya, insulindia, northern_reaches) are 100% gated —
   * the doors opened onto tiles that do not exist. Removing four of those edges
   * and removing six produced BYTE-IDENTICAL results.
   *
   * Ungating five of them is the fix. 5 seeds x 300 games, 17% fair share:
   *
   *   before            after
   *   han       38.8%   26.6%
   *   carthage  20.8%   28.6%
   *   rome      17.2%   25.2%
   *   maurya     8.8%    8.4%
   *   parthia    8.4%    5.6%
   *   germanic   6.4%    5.6%
   *   spread    32.4    24.0
   *
   * 24 tiles stay gated, so era-advancement games keep a frontier to unlock.
   * germanic_tribes' own second home region was among the gated ones, so it
   * had been playing a 2-tile homeland its data says is 4.
   */
  it('the five frontier tiles ancient is actually played on are not gated', () => {
    const map = JSON.parse(
      readFileSync(join(__dirname, '../../../../database/maps/era_ancient.json'), 'utf-8'),
    ) as { territories: { territory_id: string; region_id: string; unlock_era_index?: number }[] };
    const live = map.territories.filter((t) => !(t.unlock_era_index ?? 0));
    // 28 -> 33. If this drops back the era returns to a 32-point spread.
    expect(live.length).toBe(33);
    for (const id of ['scandinavia', 'volga_bulgaria', 'nippon', 'indochina', 'tibet_nepal']) {
      const t = map.territories.find((x) => x.territory_id === id);
      expect(t?.unlock_era_index ?? 0, `${id} must stay live`).toBe(0);
    }
    // Still a frontier left for era-advancement games.
    expect(map.territories.length - live.length).toBeGreaterThanOrEqual(20);
  });

  it("germanic_tribes can actually reach both halves of its own homeland", () => {
    const map = JSON.parse(
      readFileSync(join(__dirname, '../../../../database/maps/era_ancient.json'), 'utf-8'),
    ) as { territories: { region_id: string; unlock_era_index?: number }[] };
    const gatedHome = map.territories
      .filter((t) => (byId.get('germanic_tribes')?.home_region_ids ?? []).includes(t.region_id))
      .filter((t) => (t.unlock_era_index ?? 0) > 0);
    expect(gatedHome).toEqual([]);
  });

  it('Han has a kit that works with research switched off', () => {
    const han = byId.get('han');
    expect(han?.ability_id).toBe('silk_road');
    expect(han?.ability_description).not.toMatch(/^Silk Road: once per turn during draft, add \+3 tech points\.$/);
  });

  it('africa still pays like the dense region it is', () => {
    // Pinned because trimming it is the obvious "pay for the kit" move and it
    // was measured as making the era worse, not better.
    const map = JSON.parse(
      readFileSync(join(__dirname, '../../../../database/maps/era_ancient.json'), 'utf-8'),
    ) as { regions: { region_id: string; bonus: number }[] };
    expect(map.regions.find((r) => r.region_id === 'africa')?.bonus).toBe(5);
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
