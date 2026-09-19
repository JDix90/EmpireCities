import type { AuthoredScenario } from '../../types';

/**
 * Opening position for the core tutorial on the tutorial board
 * (`tutorialScript.ts` — mainland Italy in 6 territories, two 3-territory
 * realms split along the Apennine watershed).
 *
 * Random placement on a 6-territory board is a coin flip between "the coached
 * attack has an obvious favourable target" and "the player is boxed in", so the
 * board is authored instead. It is shaped around one idea: the first attack a
 * new player makes should be a *choice* between live openings, not a single
 * arrow to follow.
 *
 *   - The human holds all of the Tyrrhenian Coast, so the region bonus the
 *     opening card explains (+1 after player-count scaling) is real from turn 1.
 *   - `tut_a1` → `tut_b1` is the cheap opening: 5 against 2, and Umbria &
 *     Abruzzo is the Adriatic hub (it borders both `tut_b2` and `tut_b3`), so
 *     taking it puts the player next to everything.
 *   - `tut_a3` → `tut_b3` is the slower flank: 5 against 3, favourable but not
 *     free, across the broad northern front.
 *   - `tut_a2` → `tut_b2` is the option that should look wrong: 2 against 7.
 *     A third front that reads as obviously bad is what makes the others read
 *     as a decision.
 *   - `tut_b2` (Apulia) is thick enough that the board can't be conquered
 *     before the era steps land — a domination win on turn 2 would end the
 *     tutorial right before the part that makes Borderfall not-Risk.
 *
 * Real borders give the player two more fronts than the old invented grid did
 * (`tut_a1` also reaches `tut_b3`, and `tut_a2` reaches `tut_b1`). Both are
 * priced to stay secondary: the extra line into the hub is 2 against 2, and the
 * northern one duplicates a flank the card already names.
 *
 * Unit totals are equal (12 v 12); the human's advantage is entirely in shape.
 * The tutorial-difficulty bot never attacks (`aiBot.ts`), so none of these
 * stacks are defending against anything — they exist to price the choice.
 */
export const COMBINED_TUTORIAL_SCENARIO: AuthoredScenario = {
  starting_board: {
    tut_a1: { owner: 'human', unit_count: 5 },
    tut_a2: { owner: 'human', unit_count: 2 },
    tut_a3: { owner: 'human', unit_count: 5 },
    tut_b1: { owner: 'ai', unit_count: 2 },
    tut_b2: { owner: 'ai', unit_count: 7 },
    tut_b3: { owner: 'ai', unit_count: 3 },
  },
};
