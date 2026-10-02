/**
 * One-time resource grants for the tutorial lessons.
 *
 * These live here rather than inline in `games.routes.ts` because they are not
 * free parameters: each is sized against the advancement gate that lesson has
 * to clear, and that gate is derived from era-advancement settings tuned
 * elsewhere. `tutorialGrants.test.ts` recomputes the gate from those settings
 * and fails if a grant stops covering it — the failure mode otherwise is a
 * first session that stalls one gold short of the one beat it exists to deliver.
 */

/**
 * Core tutorial. The gate is two Ancient tier-1 technologies (3/4/4/4 TP, so 8
 * buys any two and nothing more) plus the advance cost in gold.
 */
export const CORE_TUTORIAL_GRANT_TECH_POINTS = 8;
export const CORE_TUTORIAL_GRANT_GOLD = 16;

/**
 * Era Advancement deep dive. Keeps the full milestone gate — its `ea_gate` card
 * is explicitly about researching a tier-1 parent to unlock its tier-2 child —
 * so it is funded for 3 tier-1 (12 TP) plus 1 tier-2 (6 TP).
 */
export const ERA_LESSON_GRANT_TECH_POINTS = 24;
export const ERA_LESSON_GRANT_GOLD = 60;

/**
 * Galactic Age · Lane Sovereignty. The lesson has the player research Lane
 * Charts (the third attack die across a lane) before the capture that
 * completes their fifth corridor. The grant is that one tech's cost, so the
 * tree offers a choice the budget then settles; the galaxy's other tier-1
 * root costs less, so a player who picks it instead still crosses the lane,
 * at two dice, and `galaxyLaneSovereigntyScenario.test.ts` holds the units to
 * a margin that wins either way.
 */
export const GALAXY_LANE_SOVEREIGNTY_GRANT_TECH_POINTS = 5;
