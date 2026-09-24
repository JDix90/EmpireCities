import { describe, it, expect } from 'vitest';
import { SPACE_AGE_FACTIONS } from './spaceage';
import { TERRITORY_ABILITY_DEFS } from '../abilities/techAbilities';

/**
 * Three of the Space Age's six factions had kits that could never fire.
 *
 * ai_surge (5 tech points), satellite_uplink (4) and mercenary_contract (6)
 * all charged tech points in a game where tech_trees_enabled defaults FALSE
 * (state/gameSettings.ts), so nobody ever accrues any. Mercenary Contract was
 * dead twice over: it also demanded a production building, and validateBuild
 * rejects every build when the economy layer is off, so no territory can have
 * one. Deleting all three abilities outright changed not one digit of a
 * 200-game run.
 *
 * Measured over 5 seeds x 300 games against a 17% fair share. "before" is the
 * same tree with the three abilities nulled, which reproduces the old
 * behaviour exactly because they never fired:
 *
 *                       before    after
 *   solar_caliphate      28.6%    30.0%
 *   sino_hegemony        12.8%    18.2%
 *   climate_alliance     20.0%    18.0%
 *   corpo_enclave        11.2%    15.8%
 *   terran_federation    17.2%    10.2%
 *   lunar_pioneers       10.2%     7.8%
 *   spread               19.0     22.2
 *
 * THE SPREAD GETS WORSE AND THAT IS NOT A SIZING MISTAKE. Four sizings were
 * measured (3/4/2, 3/4/3, 2/3/2, 2/3/3, 3/3/3) and every one landed between
 * 22 and 27, because the era's two outliers do not respond to faction data at
 * all:
 *
 *  - solar_caliphate wins 27.3% with its ability removed AND its reinforcement
 *    removed. Its kit is worth about two points; the rest is its seat.
 *  - lunar_pioneers sits at 3-5% whether it has +1, +2 or +3 reinforcements, a
 *    free unit every turn, or both. It is a Moon faction that cannot reach the
 *    Moon: `lunar_surface` is unclaimed, and adding it to lunar's
 *    home_region_ids is a NO-OP — byte-identical results — because the
 *    geographic dealer does not hand out off-globe tiles that way.
 *
 * So the era needs map work, exactly as ancient does, and this pass does not
 * pretend otherwise. What it fixes is the part that IS faction data: three
 * kits that did nothing now do something, and corpo_enclave is off the floor.
 */
describe('space age balance anchors', () => {
  const byId = new Map(SPACE_AGE_FACTIONS.map((f) => [f.faction_id, f]));

  it('no space age faction kit charges tech points', () => {
    // The general rule is in factionKitParity.test.ts, which runs every draft
    // kit with an empty wallet. This pins the three it was written for.
    for (const id of ['ai_surge', 'satellite_uplink', 'mercenary_contract']) {
      expect(TERRITORY_ABILITY_DEFS[id]?.techCost ?? 0, id).toBe(0);
    }
  });

  it('every space age faction still has a kit', () => {
    for (const f of SPACE_AGE_FACTIONS) {
      expect(f.ability_id, f.faction_id).toBeTruthy();
      expect(f.ability_description, f.faction_id).toBeTruthy();
    }
  });

  it('no space age description still advertises a price', () => {
    // All three said "spend N tech points" — accurate, and describing a kit
    // the player could never use.
    for (const f of SPACE_AGE_FACTIONS) {
      expect(f.ability_description ?? '', f.faction_id).not.toMatch(/spend \d+ (tech|production) points/i);
      expect(f.description ?? '', f.faction_id).not.toMatch(/\(\d+ tech points\)/i);
    }
  });

  it('Terran Federation keeps the transatlantic homeland its lore names', () => {
    // Measured: europe-only takes it 10.2% -> 17.7%, the best single lever in
    // the era. NOT taken, because the lore calls it "a confederation of North
    // Atlantic and European megastates" and because it drops lunar_pioneers to
    // 4.3% and widens the spread to 26.7 — it moves the floor rather than
    // raising it. Recorded so the next person knows it was measured, not missed.
    expect(byId.get('terran_federation')?.home_region_ids)
      .toEqual(['north_america_2100', 'europe_2100']);
  });
});
