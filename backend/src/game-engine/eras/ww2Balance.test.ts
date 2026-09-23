import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { WW2_FACTIONS } from './ww2';

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

  it('Japan is paid in reinforcements, not attack dice', () => {
    // Germany carries the same +1 attack die and won 6% with it. The die is
    // not what Japan was worth — the seat was.
    expect(byId.get('japan')?.passive_attack_bonus ?? 0).toBe(0);
    expect(byId.get('japan')?.reinforce_bonus ?? 0).toBeGreaterThanOrEqual(1);
  });
});
