import type { GameMap, GameState } from '../../types';
import type { DailyPuzzleSpec } from './dailyPuzzleTypes';
import { openingResources, syncTerritoryCounts } from '../state/gameStateManager';
import { buildDiceQueue } from './puzzleDice';
import { applyAuthoredScenario } from '../scenarios/applyAuthoredScenario';

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

  // Authored day: the calendar's designed board replaces the archetype's
  // hardcoded shaper, through the same applyAuthoredScenario the tutorial and
  // campaign use. The archetype still drives objective evaluation and the
  // route's settings, so an authored military/economy/tech day needs no new
  // machinery — only a board worth playing.
  if (spec.starting_board) {
    if (spec.clear_board) resetOpeningResources(state);
    applyAuthoredScenario(
      state,
      map,
      {
        starting_board: spec.starting_board,
        clear_board: spec.clear_board,
        grants: spec.grants,
      },
      humanPlayerId,
      aiPlayerId,
    );
    if (spec.starting_phase === 'attack') {
      // Tactical boards are fought exactly as authored: no opening draft.
      state.phase = 'attack';
      state.draft_units_remaining = 0;
      state.current_player_index = 0;
    }
    return;
  }

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

/**
 * initializeGameState pays every seat an opening production and tech tick
 * (economy + tech) for the board it dealt. A cleared day throws that board
 * away, but the income stayed, and the day's grants are floors: on a research
 * day the player opened with three points and ten gold earned from territories
 * they never held, so a tier-one goal fell on turn one or two, before the bot
 * next door could matter. Return each seat to the dealt values; the grants
 * are then the whole opening budget, and the rest is earned by holding ground.
 */
function resetOpeningResources(state: GameState): void {
  const opening = openingResources(state.settings);
  for (const player of state.players) {
    player.tech_points = opening.tech_points;
    player.special_resource = opening.special_resource;
  }
}
