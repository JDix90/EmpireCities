import type { AuthoredScenario } from '../../types';

/**
 * Opening position for the Lane Sovereignty lesson, on the real galaxy board
 * (`database/maps/era_galaxy.json`): three seats, so the headline rule the
 * player meets is the one every game of three or more seats plays — hold both
 * gateways of five of the eight charted lanes at your own turn start, three
 * turns running (`victory/laneSovereignty.ts`). A duel would need five rounds,
 * and the lesson would spend most of its length pressing End Turn.
 *
 * The seats, in the order the start route inserts them:
 *   0  the human, Helion Navigators, home world Verdan Reach;
 *   1  the first AI, Void Custodians, home world Nexus Station — the seat
 *      `applyAuthoredScenario` resolves `owner: 'ai'` to;
 *   2  the second AI, Forge Syndicate, home world Rust Belt, left exactly as
 *      the Colonies deal gave it.
 * Sol III is nobody's home, so it opens as a neutral colony (state/galaxyModes.ts),
 * and the three-seat board bridges the ring's two gaps with colony lanes that
 * carry attacks but never count for Sovereignty — which the lesson says.
 *
 * Only the tiles that differ from the deal are named; the rest of the board is
 * whatever `initializeGameState` dealt (the human's whole home world, the
 * Custodians' half of Nexus around the neutral Vault, the Forge's Rust Belt,
 * the Sol colony). `galaxyLaneSovereigntyScenario.test.ts` builds the game the
 * way the route does and pins the position that results.
 *
 * The shape of it: the Navigators have spread along the ring. They hold the
 * far gateway of every lane out of Verdan — both Sol ends and both Rust ends —
 * which makes those four lanes corridors. The fifth is the lane from Hematite
 * Span (theirs, on Rust) to Antenna Spire (the Custodians' gateway on Nexus
 * Station): one capture across one lane, and the network is theirs to hold.
 *
 *   - The attack rolls at most 2 dice across a lane, 3 with Lane Charts, which
 *     the lesson has the player research first; the Custodians defend a lane
 *     with an extra die (`lane_defense_bonus`). Twelve units against two is
 *     the margin that makes the capture a formality rather than a roll.
 *   - The Rust beachheads sit on the Forge's world at 3 units each. The
 *     tutorial AI never attacks (`aiBot.ts`), so they are never tested; they
 *     exist so the chart shows four corridors in the player's colour.
 */
export const GALAXY_LANE_SOVEREIGNTY_SCENARIO: AuthoredScenario = {
  starting_board: {
    // Sol III: the far ends of the two Sol–Verdan lanes, on the neutral colony.
    sol_guinea: { owner: 'human', unit_count: 3 },
    sol_pacific_rim: { owner: 'human', unit_count: 3 },
    // Rust Belt: the far ends of the two Verdan–Rust lanes…
    rust_anvil_basin: { owner: 'human', unit_count: 3 },
    rust_crucible_deep: { owner: 'human', unit_count: 3 },
    // …and the near end of the Rust–Nexus lane the lesson is about.
    rust_hematite_span: { owner: 'human', unit_count: 12 },
    // Nexus Station: the target, the Custodians' gateway facing Rust.
    nexus_antenna_spire: { owner: 'ai', unit_count: 2 },
  },
};

/** The lane the lesson's winning move crosses, source to target. */
export const GALAXY_LANE_SOVEREIGNTY_WINNING_LANE = {
  from: 'rust_hematite_span',
  to: 'nexus_antenna_spire',
} as const;
