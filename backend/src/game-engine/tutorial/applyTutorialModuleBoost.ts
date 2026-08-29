import type { GameState } from '../../types';

/**
 * One-time boosts for tutorial lesson modules (research points, gold).
 *
 * Tutorials are deliberately excluded from the economy/tech bootstrap in
 * `initializeGameState`, so a lesson that needs resources cannot get them by
 * setting `economy_tech_starting_*` — it asks for them here instead, and only
 * for the systems that lesson actually switched on.
 */
export function applyTutorialModuleBoost(state: GameState): void {
  if (!state.settings.tutorial) return;

  const human = state.players.find((p) => !p.is_ai);
  if (!human) return;

  const techGrant = state.settings.tutorial_grant_tech_points;
  if (techGrant && techGrant > 0 && state.settings.tech_trees_enabled) {
    human.tech_points = (human.tech_points ?? 0) + techGrant;
  }

  const goldGrant = state.settings.tutorial_grant_gold;
  if (goldGrant && goldGrant > 0 && state.settings.economy_enabled) {
    human.special_resource = (human.special_resource ?? 0) + goldGrant;
  }
}
