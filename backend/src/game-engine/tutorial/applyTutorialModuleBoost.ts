import type { GameState } from '../../types';

/** One-time boosts for optional tutorial lesson modules (tech TP, etc.). */
export function applyTutorialModuleBoost(state: GameState): void {
  if (!state.settings.tutorial) return;

  const grant = state.settings.tutorial_grant_tech_points;
  if (grant && grant > 0 && state.settings.tech_trees_enabled) {
    const human = state.players.find((p) => !p.is_ai);
    if (human) {
      human.tech_points = (human.tech_points ?? 0) + grant;
    }
  }
}
