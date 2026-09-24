import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { WW2_FACTIONS } from './ww2';
import { TERRITORY_ABILITY_DEFS } from '../abilities/techAbilities';

/**
 * WW2's 31-point spread came from two structural faults, and these values are
 * the fix. Pinned for the same reason as the ancient anchors: each looks
 * arbitrary alone, and reverting any of them reopens the gap.
 *
 * Measured with scripts/simFactionBalance.ts, 300 games at each of seeds 41, 7
 * and 99, against a 17% fair share:
 *
 *   before            after
 *   japan    37%      17%   (eliminated 16% -> 10%)
 *   china    22%      18%
 *   uk       14%      19%
 *   usa      11%      17%
 *   soviet   10%      13%
 *   germany   6%      17%   (eliminated 79% -> 61%)
 *   spread   31        6
 *
 * The first fault was invisible until the harness could see it: `blitzkrieg`
 * has no TERRITORY_ABILITY_DEFS entry, so Germany was being measured with no
 * ability at all. Mirroring it changed nothing — Germany was genuinely last.
 *
 * What was actually wrong is that the UK claimed `western_front` too, making
 * Germany's the only shared homeland in the era. Germany opened in 2.3
 * disconnected blocks against 4.5 different enemies while Japan and the
 * Soviets got theirs whole.
 *
 * The second: Japan and Germany held the IDENTICAL passive — one attack die —
 * and finished 31 points apart. An attack die compounds, so it is worth
 * everything in a good seat and nothing in a bad one. Trading Japan's for a
 * reinforcement, which is linear, is what closed the era.
 */
describe('ww2 balance anchors', () => {
  const byId = new Map(WW2_FACTIONS.map((f) => [f.faction_id, f]));

  it('Germany does not share its homeland', () => {
    const uk = byId.get('uk')?.home_region_ids ?? [];
    const germany = byId.get('germany')?.home_region_ids ?? [];
    expect(germany).toContain('western_front');
    expect(uk).not.toContain('western_front');
  });

  it('the UK still holds the island its stages are written around', () => {
    // The Last Defenders' ww2 stage tells the player they hold "an island, a
    // navy" and asks for "your island, North Africa". Moving the UK off
    // Britain took that stage from 24% to 4%.
    expect(byId.get('uk')?.home_region_ids).toContain('british_isles');
  });

  it('britain_ww2 is its own region on the board', () => {
    const map = JSON.parse(
      readFileSync(join(__dirname, '../../../../database/maps/era_ww2.json'), 'utf-8'),
    ) as {
      territories: { territory_id: string; region_id: string }[];
      regions: { region_id: string }[];
    };
    const britain = map.territories.find((t) => t.territory_id === 'britain_ww2');
    expect(britain?.region_id).toBe('british_isles');
    expect(map.regions.map((r) => r.region_id)).toContain('british_isles');
  });

  /**
   * Two dead kits in this era, and they were dead in different ways.
   *
   * The UK had no ability, and the single trait it advertised was
   * `stability_recovery_bonus`, which does nothing unless stability_enabled is
   * on — and it defaults FALSE (state/gameSettings.ts). The field is kept,
   * because it is real when stability IS on; it just no longer stands in for a
   * kit.
   *
   * The Soviet Union's Mass Mobilization was worse: it existed, and it had
   * never once fired for a bot. Both AI call sites derived "does this ability
   * need a target?" from `def.ownPlacement`, which mass_mobilization does not
   * carry, so executeTechAbility was handed `undefined` and rejected the call
   * silently. Deleting the ability outright changed not one digit of a
   * 60-game run. See TARGETED_DRAFT_ABILITIES and factionKitParity.test.ts.
   *
   * 5 seeds x 300 games, 17% fair share. The USSR fix landed first, so the
   * "before" column below is already measured against a Soviet Union that
   * works — otherwise the UK would be tuned against a phantom:
   *
   *   before            after
   *   uk    17.7%  57%  22.6%  41%
   *   ussr  11.6%       (unchanged here; its ww2 kit now fires)
   *   spread   7.7      11.2
   *
   * The UK is the era leader now, and that is the honest price of it having a
   * kit at all. THREE different mechanics were measured and every one landed
   * in the same place — a free unit a turn 22.6%, a per-capture toll 22.7%,
   * the same unit restricted to front-line tiles 22.4% — because the UK holds
   * the widest home claim in the era (bonus 10 over nine territories, roughly
   * double anyone else's, granted deliberately in #399 when it lost the
   * continent). A once-per-GAME reaction was measured too and was worth
   * +0.0%: on a 100-turn game, one saved tile is not a kit.
   *
   * Paying for it by trimming middle_east_th 4 -> 3 was measured and REJECTED:
   * it does hold the UK to 18.6%, but the spread goes to 14.0 on the same
   * seeds — worse than leaving it alone. Same finding as `africa` in ancient.
   * No ww2 map value is touched.
   */
  it('the United Kingdom has a kit, and it is not an inert stat', () => {
    const uk = byId.get('uk');
    expect(uk?.ability_id).toBe('commonwealth');
    expect(uk?.ability_description).toBeTruthy();
    // The description may mention stability, but it may not BE the kit.
    expect(uk?.description).not.toMatch(/^Island fortress and global empire — recovers stability/);
  });

  /**
   * A third dead kit in this era, found after the other two. Arsenal of
   * Democracy charged 5 tech points, so it never fired in a normal game — the
   * old copy even hedged, "where research is in play", which was accurate and
   * damning, since research is NOT in play by default. The USA's real kit was
   * one reinforcement.
   *
   * 5 seeds x 300: usa 13.2% -> 14.2%, spread 11.2 -> 11.6.
   *
   * Sized at ONE unit, not the three the def carried. Three free units a turn
   * was measured and took Germany from 14.6% to 7.0%; two took it to 10.3%.
   * The def's original size was written for a game where you had to pay for it.
   */
  it('the Arsenal is payable in a game with no research', () => {
    expect(TERRITORY_ABILITY_DEFS.arsenal_of_democracy?.techCost ?? 0).toBe(0);
    expect(TERRITORY_ABILITY_DEFS.arsenal_of_democracy?.ownPlacement?.units).toBe(1);
    expect(byId.get('usa')?.ability_description).not.toMatch(/spend/i);
  });

  it('the Middle East still pays 4, because trimming it was measured as worse', () => {
    const map = JSON.parse(
      readFileSync(join(__dirname, '../../../../database/maps/era_ww2.json'), 'utf-8'),
    ) as { regions: { region_id: string; bonus: number }[] };
    expect(map.regions.find((r) => r.region_id === 'middle_east_th')?.bonus).toBe(4);
  });

  it('Japan is paid in reinforcements, not attack dice', () => {
    // Germany carries the same +1 attack die and won 6% with it. The die is
    // not what Japan was worth — the seat was.
    expect(byId.get('japan')?.passive_attack_bonus ?? 0).toBe(0);
    expect(byId.get('japan')?.reinforce_bonus ?? 0).toBeGreaterThanOrEqual(1);
  });
});
