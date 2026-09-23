import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DISCOVERY_FACTIONS } from './discovery';
import { TERRITORY_ABILITY_DEFS } from '../abilities/techAbilities';

/**
 * Discovery's 26-point spread was two factions, and these values are the fix.
 *
 * Measured with scripts/simFactionBalance.ts, 300 games at each of seeds 41, 7
 * and 99, against a 17% fair share:
 *
 *   before            after
 *   spain    29%      25%
 *   ming     22%      22%
 *   portugal 21%      17%
 *   england  16%      13%
 *   ottoman   9%      14%   (eliminated 21% -> 29%)
 *   mughal    3%       9%   (eliminated 81% -> 52%)
 *   spread   26        17
 *
 * The room metric that ordered the ancient era runs BACKWARDS here: Mughal had
 * the most uncontested neutral territory on the board (1.3 against 0.2-1.0) and
 * the best opening income, and won 3%. Discovery is a kit era, not a
 * positional one.
 *
 * Mughal had no numeric bonus of any kind and one ability costing 5 tech
 * points — unpayable with tech trees off, which is the default and every
 * campaign stage. Ottoman held the best-shaped opening in the era (one
 * contiguous block, second-lowest border pressure) behind a defender reaction,
 * and starved the same way the Byzantines did.
 */
describe('discovery balance anchors', () => {
  const byId = new Map(DISCOVERY_FACTIONS.map((f) => [f.faction_id, f]));

  it('Spice Trade can be paid for in a game with tech trees off', () => {
    // This was the Mughal Empire's entire kit. No other faction uses it.
    expect(TERRITORY_ABILITY_DEFS.spice_trade?.techCost ?? 0).toBe(0);
    expect(TERRITORY_ABILITY_DEFS.spice_trade?.draftReinforcements).toBe(2);
  });

  it('Mughal and Ottoman can take ground, not only hold it', () => {
    // Income alone was measured at 1-2% for Mughal with elimination still over
    // half: a faction that cannot take territory cannot pay for the territory
    // it has. Same finding as byzantine in medieval and parthia in ancient.
    expect(byId.get('mughal')?.passive_attack_bonus ?? 0).toBeGreaterThanOrEqual(1);
    expect(byId.get('ottoman')?.passive_attack_bonus ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('no discovery description promises a stat the faction does not carry', () => {
    // Ottoman advertised its flat +2 as conditional on holding sea_routes, and
    // Mughal advertised "+3 extra tech points per turn" with no
    // tech_point_income field at all. Same defect class as the eight in #397.
    const ottoman = byId.get('ottoman');
    expect(ottoman?.description).not.toMatch(/sea_routes/);
    const mughal = byId.get('mughal');
    if (/tech point/i.test(mughal?.description ?? '')) {
      expect(mughal?.tech_point_income ?? 0).toBeGreaterThan(0);
    }
  });

  it('Mughal India pays like the small rich region it is', () => {
    const map = JSON.parse(
      readFileSync(join(__dirname, '../../../../database/maps/era_discovery.json'), 'utf-8'),
    ) as { regions: { region_id: string; bonus: number }[] };
    const bonusOf = (id: string) => map.regions.find((r) => r.region_id === id)?.bonus ?? 0;
    expect(bonusOf('mughal_india')).toBeGreaterThanOrEqual(5);
  });
});
