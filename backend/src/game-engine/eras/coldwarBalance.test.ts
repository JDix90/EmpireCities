import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { COLDWAR_FACTIONS } from './coldwar';

/**
 * Cold War's 28-point spread was the era's only shared homeland plus the
 * widest claim on the board, and these values are the fix.
 *
 * Measured with scripts/simFactionBalance.ts, 300 games at each of seeds 41, 7
 * and 99, against a 17% fair share:
 *
 *   before            after
 *   decolonization 34%   24%   (eliminated 1-5% -> 2-4%)
 *   nato_proxy     11%   25%
 *   china          22%   15%
 *   uk_cw           5%   13%   (eliminated 53% -> 10%)
 *   usa_cw         12%   11%
 *   ussr           16%   11%
 *   spread         28     16
 *
 * `nato_europe` was claimed by BOTH the United Kingdom and the NATO Alliance —
 * the same fault that made ww2's Germany unplayable in #399 — and the two of
 * them finished last. uk_ireland is its own region now, so the Alliance gets
 * the continent.
 *
 * The United Kingdom's second home is Latin America rather than the Middle
 * East, which was the more historically apt choice and measured at 6-7%: the
 * Middle East is the most contested region on the board and left the seat
 * fragmented. The Caribbean was British for most of this era.
 */
describe('coldwar balance anchors', () => {
  const byId = new Map(COLDWAR_FACTIONS.map((f) => [f.faction_id, f]));

  it('the United Kingdom and the NATO Alliance do not share a homeland', () => {
    const uk = byId.get('uk_cw')?.home_region_ids ?? [];
    const nato = byId.get('nato_proxy')?.home_region_ids ?? [];
    expect(nato).toContain('nato_europe');
    expect(uk).not.toContain('nato_europe');
    expect(uk).toContain('british_isles_cw');
  });

  it('uk_ireland is its own region on the board', () => {
    const map = JSON.parse(
      readFileSync(join(__dirname, '../../../../database/maps/era_coldwar.json'), 'utf-8'),
    ) as {
      territories: { territory_id: string; region_id: string }[];
      regions: { region_id: string }[];
    };
    expect(map.territories.find((t) => t.territory_id === 'uk_ireland')?.region_id)
      .toBe('british_isles_cw');
    expect(map.regions.map((r) => r.region_id)).toContain('british_isles_cw');
  });

  it('the United Kingdom can take ground, not only survive on it', () => {
    // It carried no numeric bonus at all and a once-per-GAME reaction, the
    // thinnest kit measured anywhere. Elimination fell 53% -> 10% on these
    // numbers, but wins did not move until the homeland changed too.
    expect(byId.get('uk_cw')?.passive_attack_bonus ?? 0).toBeGreaterThanOrEqual(1);
    expect(byId.get('uk_cw')?.reinforce_bonus ?? 0).toBeGreaterThanOrEqual(1);
  });

  it('the Non-Aligned Movement claims one region, not two', () => {
    const decol = byId.get('decolonization_movement')?.home_region_ids ?? [];
    expect(decol).toEqual(['africa_cw']);
  });

  /**
   * The Soviet Union had no ability at all. It was the one faction of the five
   * kitless ones that was genuinely losing rather than merely featureless:
   * 11% of 900 games against a 17% fair share, and eliminated in 53% when no
   * other seat in the era passed 12%. A forty-point elimination gap is a seat
   * being dogpiled with nothing that makes dogpiling expensive.
   *
   * A toll rather than income, for that reason. 300 games at each of seeds 41,
   * 7 and 99:
   *
   *   before            after
   *   ussr  11%  53%    17%  40%
   *   spread 16.3       15.3
   *
   * Income was measured too and is the wrong shape: a free unit a turn put it
   * at 24% and a second reinforcement plus the toll at 19% with elimination
   * down to 22%, both of which trade one lopsided seat for another.
   */
  it('the Soviet Union makes ground taken off it expensive', () => {
    expect(byId.get('ussr')?.ability_id).toBe('scorched_earth');
    expect(byId.get('ussr')?.ability_description).toBeTruthy();
  });

  it('no coldwar description promises a defence die or a stat the faction lacks', () => {
    // china_cw and nato_proxy are two of the eight #397 recorded as still
    // promising innate defence dice, which no faction may have at all.
    for (const f of COLDWAR_FACTIONS) {
      expect(f.description, `${f.faction_id} claims a defence die`).not.toMatch(/defense die|defence die/i);
      if (/tech point/i.test(f.description)) {
        expect(f.tech_point_income ?? 0, `${f.faction_id} claims tech points`).toBeGreaterThan(0);
      }
    }
  });
});
