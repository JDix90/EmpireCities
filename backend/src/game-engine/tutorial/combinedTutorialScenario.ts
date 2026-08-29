import type { AuthoredScenario } from '../../types';

/**
 * Opening position for the combined core tutorial on Tutorial Island
 * (`tutorialScript.ts` — 6 territories, two 3-territory realms).
 *
 * Random placement on a 6-territory board is a coin flip between "the coached
 * attack has an obvious favourable target" and "the player is boxed in", so the
 * board is authored instead:
 *
 *   - The human holds all of the Western Realm, so the region bonus the draft
 *     step explains (+2) is real from turn 1 rather than hypothetical.
 *   - `tut_a1` is the hub (it borders `tut_a2`, `tut_a3` and `tut_b1`) and gets
 *     the big stack, so the `attack_do` step always has a strong source.
 *   - `tut_b1` is deliberately thin: the first attack a new player ever makes
 *     should win. It is also the East's hub, so taking it opens the map.
 *   - `tut_b2` / `tut_b3` are thick enough that the board can't be conquered
 *     before the era steps land — a domination win on turn 2 would end the
 *     tutorial right before the part that makes Borderfall not-Risk.
 *
 * Unit totals are equal (12 v 12); the human's advantage is entirely in shape.
 */
export const COMBINED_TUTORIAL_SCENARIO: AuthoredScenario = {
  starting_board: {
    tut_a1: { owner: 'human', unit_count: 6 },
    tut_a2: { owner: 'human', unit_count: 3 },
    tut_a3: { owner: 'human', unit_count: 3 },
    tut_b1: { owner: 'ai', unit_count: 2 },
    tut_b2: { owner: 'ai', unit_count: 5 },
    tut_b3: { owner: 'ai', unit_count: 5 },
  },
};
