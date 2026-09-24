import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { MEDIEVAL_FACTIONS } from './medieval';

/**
 * Medieval's frontier was dead content, and ungating it is the whole fix.
 *
 * Seven of era_medieval's 36 territories carried `unlock_era_index`, and in a
 * normal game they were never placed: era_advancement_enabled defaults false
 * and `seedsFullBoardAtStart` only covers space_age. Vinland, the Caribbean,
 * Southern Africa, Madagascar, Australia, Polynesia and Kamchatka were an
 * authored 1->5 unlock ladder that no default game ever climbed.
 *
 * 5 seeds x 300 games, 17% fair share:
 *
 *   before            after
 *   england   26.8%   16.8%
 *   france    25.0%   20.6%
 *   mongol    12.8%   21.4%
 *   byzantine 10.8%   15.0%
 *   hre       10.0%   14.4%
 *   caliphate 14.4%   11.6%
 *   spread    18.4    11.4
 *
 * Tighter at every seed (15/17/20/20/20 -> 8/8/12/13/16), the leader down ten
 * points and the floor up four. The Mongols gain most, from Kamchatka and the
 * Pacific Rim, which is the right faction to hand that ground to.
 *
 * MEDIEVAL IS THE ONLY ERA WHERE THIS HELPS, and the others were measured, not
 * assumed. Ungating the same frontier content elsewhere is a regression, twice
 * a severe one, because on an already-balanced board the extra tiles are dealt
 * to whichever factions sit next to them:
 *
 *   discovery  15.0 -> 25.4     ww2      11.6 -> 17.8
 *   modern     14.6 -> 17.8     coldwar  16.6 -> 47.4
 *
 * Cold War is the extreme: ussr +29.6 and nato_proxy +27.0, both adjacent to
 * the polar, antarctic and space frontiers, while decolonization_movement
 * loses 25.2. Those four maps keep their ladders.
 *
 * Seeding the frontier as NEUTRAL GARRISONS instead of dealing it — what
 * `seedStandaloneFrontierTerritories` already does for space_age — was
 * measured too. It is better for ancient (24.0 -> 12.2) and discovery (15.0 ->
 * 13.0), does nothing for medieval, and is worse for ww2 (13.8), modern (22.2)
 * and coldwar (34.4). So it cannot simply be switched on globally either; it
 * would have to be per-era, which the current flag shape does not express.
 */
describe('medieval balance anchors', () => {
  const byId = new Map(MEDIEVAL_FACTIONS.map((f) => [f.faction_id, f]));

  it('the whole medieval board is in play from turn one', () => {
    const map = JSON.parse(
      readFileSync(join(__dirname, '../../../../database/maps/era_medieval.json'), 'utf-8'),
    ) as { territories: { territory_id: string; unlock_era_index?: number }[] };
    const gated = map.territories.filter((t) => (t.unlock_era_index ?? 0) > 0);
    expect(gated.map((t) => t.territory_id)).toEqual([]);
    expect(map.territories.length).toBe(36);
  });

  it('the seven frontier tiles are all still on the map', () => {
    // Ungated, not deleted — the content is the point.
    const map = JSON.parse(
      readFileSync(join(__dirname, '../../../../database/maps/era_medieval.json'), 'utf-8'),
    ) as { territories: { territory_id: string }[] };
    const ids = new Set(map.territories.map((t) => t.territory_id));
    for (const id of ['vinland', 'caribbean_isles', 'southern_africa', 'madagascar',
      'australia', 'polynesia', 'kamchatka']) {
      expect(ids, id).toContain(id);
    }
  });

  it('every medieval faction still has a kit', () => {
    for (const f of MEDIEVAL_FACTIONS) {
      expect(f.ability_id, f.faction_id).toBeTruthy();
      expect(f.ability_description, f.faction_id).toBeTruthy();
    }
    expect(byId.size).toBe(6);
  });
});
