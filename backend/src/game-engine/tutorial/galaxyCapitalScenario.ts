import type { AuthoredScenario } from '../../types';

/**
 * Opening position for the Capital lesson, on the real galaxy board
 * (`database/maps/era_galaxy.json`), two seats: the human plays the Stellar
 * Mandate on Sol III, the AI the Helion Navigators on Verdan Reach, and the
 * Rust Belt and Nexus Station open as neutral colonies (state/galaxyModes.ts).
 *
 * Capitals are not authored here; they cannot be. `assignCapitals` fixes each
 * seat's capital at init, before any scenario runs, as the first of the seat's
 * dealt systems by id, and nothing re-reads it. On this board that is Amazon
 * Basin for the Mandate and Chlorophage Span for the Navigators, and both are
 * gateways: Amazon Basin is Sol's door to Nexus Station, Chlorophage Span is
 * Verdan's door facing Guinea Coast. So the galaxy's capital win is a lane
 * crossing, which is what the lesson teaches, and the scenario only has to
 * keep those two systems with the seats the deal gave them.
 * `galaxyCapitalScenario.test.ts` builds the game as the start route does and
 * pins both capitals, so a change to the deal fails there and not on a card.
 *
 * Only the tiles that differ from the deal are named: Guinea Coast, the
 * Mandate's gateway facing the Navigators' capital, is stacked for the
 * crossing; the capital itself is thinned to two units. A lane attack rolls
 * at most 2 dice without Lane Charts, which the lesson does not grant, and the
 * Navigators defend a lane with no extra die, so eight against two wins
 * through the cap over a few rolls. The tutorial AI never attacks (`aiBot.ts`),
 * so Amazon Basin, the capital the player must keep, is never threatened —
 * the lesson says so, and says what losing it would cost.
 */
export const GALAXY_CAPITAL_HUMAN_CAPITAL = 'sol_amazonia';
export const GALAXY_CAPITAL_RIVAL_CAPITAL = 'verdan_chlorophage_span';

/** The lane the lesson's winning move crosses, source to target. */
export const GALAXY_CAPITAL_WINNING_LANE = {
  from: 'sol_guinea',
  to: GALAXY_CAPITAL_RIVAL_CAPITAL,
} as const;

export const GALAXY_CAPITAL_SCENARIO: AuthoredScenario = {
  starting_board: {
    sol_guinea: { owner: 'human', unit_count: 8 },
    [GALAXY_CAPITAL_RIVAL_CAPITAL]: { owner: 'ai', unit_count: 2 },
  },
};
