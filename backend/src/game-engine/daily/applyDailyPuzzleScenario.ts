import type { GameMap, GameState } from '../../types';
import type { DailyPuzzleSpec } from './dailyPuzzleTypes';
import { syncTerritoryCounts } from '../state/gameStateManager';
import { buildDiceQueue } from './puzzleDice';

/**
 * After {@link initializeGameState}, reshape the board for puzzle archetypes (not domination).
 */
export function applyDailyPuzzleScenario(
  state: GameState,
  map: GameMap,
  spec: DailyPuzzleSpec,
  humanPlayerId: string,
  aiPlayerId: string,
): void {
  if (spec.archetype === 'domination') {
    state.puzzle_dice_queue = buildDiceQueue(spec.dice_queue_seed, 400);
    state.puzzle_dice_index = 0;
    return;
  }

  state.puzzle_dice_queue = buildDiceQueue(spec.dice_queue_seed, 500);
  state.puzzle_dice_index = 0;
  state.puzzle_feedback_mistakes = 0;

  if (spec.archetype === 'military_capture' && spec.target_territory_id && spec.anchor_territory_id) {
    const tids = Object.keys(state.territories).sort();
    for (const tid of tids) {
      const t = state.territories[tid];
      t.owner_id = null;
      t.unit_count = 0;
      if (t.buildings) t.buildings = [];
    }
    const anchor = state.territories[spec.anchor_territory_id];
    const target = state.territories[spec.target_territory_id];
    if (anchor && target) {
      anchor.owner_id = humanPlayerId;
      anchor.unit_count = 8;
      target.owner_id = aiPlayerId;
      target.unit_count = 4;
    }
    // Other territories neutral 0 — border skirmish focus
    state.phase = 'attack';
    state.draft_units_remaining = 0;
    state.current_player_index = 0;
    syncTerritoryCounts(state);
    return;
  }

  if (spec.archetype === 'economy_build' && spec.building_type) {
    state.settings.economy_enabled = true;
    const human = state.players.find((p) => p.player_id === humanPlayerId);
    if (human) {
      human.special_resource = 12;
    }
    state.phase = 'draft';
    return;
  }

  if (spec.archetype === 'tech_research' && spec.tech_id) {
    state.settings.tech_trees_enabled = true;
    const human = state.players.find((p) => p.player_id === humanPlayerId);
    if (human) {
      human.tech_points = Math.max(human.tech_points ?? 0, 16);
    }
    state.phase = 'draft';
    return;
  }
}
