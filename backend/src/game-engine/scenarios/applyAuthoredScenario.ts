import type { AuthoredScenario, GameMap, GameState } from '../../types';
import { calculateContinentBonuses, syncTerritoryCounts } from '../state/gameStateManager';
import { calculateReinforcements } from '../combat/combatResolver';
import { getPlayerReinforceBonus } from '../state/techManager';

/**
 * Apply a hand-authored opening position on top of a freshly initialised game.
 *
 * `initializeGameState` deals territories by uniform shuffle (or geographic
 * blocks with factions on), which is right for a real match and useless for
 * teaching: a tutorial needs a known board where the coached attack has a
 * favourable target and the player's holdings are adjacent. This is the one
 * place that reshapes a board after init, so tutorials, daily puzzles and
 * campaign missions can share it rather than each growing their own.
 *
 * Deliberately additive: only territories named in `starting_board` change, so
 * a scenario may shape a single front and leave the rest of a large map as
 * dealt. Pass `clear_board` to start from an empty map instead.
 *
 * Seat labels are resolved here rather than baked into the scenario, because
 * player ids are generated per game.
 *
 * Pure with respect to everything except `state`, which it mutates in place —
 * matching `applyDailyPuzzleScenario`, its neighbour at the same seam.
 */
export function applyAuthoredScenario(
  state: GameState,
  map: GameMap,
  scenario: AuthoredScenario | undefined,
  humanPlayerId: string | null,
  aiPlayerId: string | null,
): void {
  if (!scenario) return;

  if (scenario.clear_board) {
    for (const territory of Object.values(state.territories)) {
      territory.owner_id = null;
      territory.unit_count = 0;
      if (territory.buildings) territory.buildings = [];
    }
  }

  if (scenario.starting_board) {
    for (const [territoryId, spec] of Object.entries(scenario.starting_board)) {
      const territory = state.territories[territoryId];
      // A scenario outlives the map it was written against; a renamed or removed
      // territory must not take the whole game start down with it.
      if (!territory) continue;

      let ownerId: string | null = null;
      if (spec.owner === 'human') ownerId = humanPlayerId;
      else if (spec.owner === 'ai') ownerId = aiPlayerId;

      territory.owner_id = ownerId;
      // An owned territory always holds at least one unit; an unowned one holds none.
      territory.unit_count = ownerId ? Math.max(1, Math.floor(spec.unit_count)) : 0;
      if (spec.buildings) territory.buildings = [...spec.buildings];
    }
  }

  if (scenario.grants && humanPlayerId) {
    const human = state.players.find((p) => p.player_id === humanPlayerId);
    if (human) {
      // Floors, not assignments: a grant must never take away what the seat
      // already earned from economy bootstrap or a module boost.
      if (typeof scenario.grants.tech_points === 'number') {
        human.tech_points = Math.max(human.tech_points ?? 0, scenario.grants.tech_points);
      }
      if (typeof scenario.grants.gold === 'number') {
        human.special_resource = Math.max(human.special_resource ?? 0, scenario.grants.gold);
      }
    }
  }

  syncTerritoryCounts(state);

  if (scenario.starting_board || scenario.clear_board) {
    recomputeOpeningDraft(state, map);
  }
}

/**
 * `initializeGameState` computes the opening draft from the board it dealt, so
 * reshaping ownership afterwards leaves a reinforcement count for a board that
 * no longer exists — including any region bonus the scenario just handed the
 * player. Recompute it the same way init does.
 *
 * Only the opening draft, and only when it is non-zero: `applyDailyPuzzleScenario`
 * runs at this same seam and deliberately zeroes the draft (a puzzle opens in
 * the attack the player must find, not in a placement), and that choice must
 * survive a scenario layered on top of it.
 */
function recomputeOpeningDraft(state: GameState, map: GameMap): void {
  if (state.phase !== 'draft' || state.turn_number !== 1) return;
  if (state.draft_units_remaining <= 0) return;

  const firstPlayer = state.players[state.current_player_index];
  if (!firstPlayer) return;

  const bonus = calculateContinentBonuses(state, map, firstPlayer.player_id);
  state.draft_units_remaining =
    calculateReinforcements(firstPlayer.territory_count, bonus, state.players.length)
    + getPlayerReinforceBonus(state, firstPlayer.player_id);
}
