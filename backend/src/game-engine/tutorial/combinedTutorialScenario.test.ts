import { describe, it, expect } from 'vitest';
import { COMBINED_TUTORIAL_SCENARIO } from './combinedTutorialScenario';
import { getTutorialMap } from './tutorialScript';
import { calculateReinforcements } from '../combat/combatResolver';

/**
 * The scenario is authored against Tutorial Island by territory id, and
 * `applyAuthoredScenario` deliberately skips ids it cannot find (a scenario can
 * outlive the map it was written against). That failure mode is silent, so the
 * only thing standing between a renamed territory and a first-time player
 * landing on a randomly-dealt board is this test.
 */
describe('combined tutorial scenario', () => {
  const map = getTutorialMap();
  const board = COMBINED_TUTORIAL_SCENARIO.starting_board ?? {};
  const ids = new Set(map.territories.map((t) => t.territory_id));

  it('covers every territory on Tutorial Island, and nothing else', () => {
    expect(new Set(Object.keys(board))).toEqual(ids);
  });

  it('splits the island along its two realms', () => {
    const regionOf = (territoryId: string) =>
      map.territories.find((t) => t.territory_id === territoryId)?.region_id;
    for (const [territoryId, spec] of Object.entries(board)) {
      expect(regionOf(territoryId)).toBe(spec.owner === 'human' ? 'tut_west' : 'tut_east');
    }
  });

  it('gives the human the whole Western Realm, so the region bonus the draft step explains is real', () => {
    const west = map.territories.filter((t) => t.region_id === 'tut_west');
    expect(west.length).toBeGreaterThan(0);
    for (const t of west) expect(board[t.territory_id]?.owner).toBe('human');
    expect(map.regions.find((r) => r.region_id === 'tut_west')?.bonus).toBeGreaterThan(0);
  });

  it('offers two live fronts, priced differently', () => {
    const borders = (a: string, b: string) =>
      map.connections.some((c) => (c.from === a && c.to === b) || (c.from === b && c.to === a));
    // The `choose_front` card names both of these by name. Each western
    // territory borders exactly one eastern one, so a renamed connection turns
    // the card's copy into an instruction the board cannot satisfy.
    expect(borders('tut_a1', 'tut_b1')).toBe(true);
    expect(borders('tut_a3', 'tut_b3')).toBe(true);

    // Cheap opening: attacker rolls with (units − 1), and the first attack a new
    // player ever makes should be lopsided in their favour.
    expect(board.tut_a1.unit_count - 1).toBeGreaterThanOrEqual(2 * board.tut_b1.unit_count);
    // Slower flank: still favourable, but it costs more than the hub — that
    // difference is the whole decision the card is asking the player to make.
    expect(board.tut_a3.unit_count).toBeGreaterThan(board.tut_b3.unit_count);
    expect(board.tut_b3.unit_count).toBeGreaterThan(board.tut_b1.unit_count);
  });

  it('leaves the third front obviously wrong, so the other two read as a choice', () => {
    expect(board.tut_a2.unit_count).toBeLessThan(board.tut_b2.unit_count);
  });

  it('keeps Mountain Pass out of reach, so the board cannot be conquered before the era steps', () => {
    // A domination win on turn 2 would end the tutorial immediately before the
    // part that makes Borderfall not-Risk.
    const strongestHuman = Math.max(
      ...Object.values(board).filter((s) => s.owner === 'human').map((s) => s.unit_count),
    );
    expect(board.tut_b2.unit_count).toBeGreaterThan(strongestHuman);
  });

  it('pays a visible realm bonus at the 2 players this map is played with', () => {
    // Continent bonuses scale by player count, so a bonus authored for the
    // 6-player reference can round to +0 in a 1v1 — which is what the realm
    // labels read before this was raised. The draft step promises the bonus, so
    // it has to actually arrive.
    const west = map.territories.filter((t) => t.region_id === 'tut_west');
    const bonus = map.regions.find((r) => r.region_id === 'tut_west')?.bonus ?? 0;
    const withRealm = calculateReinforcements(west.length, bonus, 2);
    const withoutRealm = calculateReinforcements(west.length, 0, 2);
    expect(withRealm).toBeGreaterThan(withoutRealm);
  });

  it('is even on units — the human advantage is shape, not a handout', () => {
    const total = (owner: 'human' | 'ai') =>
      Object.values(board)
        .filter((s) => s.owner === owner)
        .reduce((sum, s) => sum + s.unit_count, 0);
    expect(total('human')).toBe(total('ai'));
  });
});
