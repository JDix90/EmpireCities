import { describe, it, expect } from 'vitest';
import type { GameMap, GameState } from '../../types';
import type { DailyPuzzleSpec } from './dailyPuzzleTypes';
import { applyDailyPuzzleScenario } from './applyDailyPuzzleScenario';

const HUMAN = 'p1';
const AI = 'ai_1';

function fixtureMap(): GameMap {
  return {
    map_id: 'daily_fixture',
    name: 'Daily Fixture',
    territories: ['a', 'b', 'c', 'd'].map((id) => ({
      territory_id: id, name: id.toUpperCase(), polygon: [], center_point: [0, 0], region_id: 'r',
    })),
    connections: [
      { from: 'a', to: 'b', type: 'land' },
      { from: 'b', to: 'c', type: 'land' },
      { from: 'c', to: 'd', type: 'land' },
    ],
    regions: [{ region_id: 'r', name: 'R', bonus: 0 }],
  } as unknown as GameMap;
}

function fixtureState(): GameState {
  return {
    game_id: 'g',
    era: 'ancient',
    map_id: 'daily_fixture',
    phase: 'draft',
    turn_number: 1,
    current_player_index: 0,
    draft_units_remaining: 5,
    players: [
      { player_id: HUMAN, player_index: 0, username: 'H', color: '#fff', is_ai: false, is_eliminated: false, territory_count: 2, cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000 },
      { player_id: AI, player_index: 1, username: 'A', color: '#000', is_ai: true, is_eliminated: false, territory_count: 2, cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000 },
    ],
    territories: {
      a: { territory_id: 'a', owner_id: HUMAN, unit_count: 3 },
      b: { territory_id: 'b', owner_id: AI, unit_count: 3 },
      c: { territory_id: 'c', owner_id: HUMAN, unit_count: 3 },
      d: { territory_id: 'd', owner_id: AI, unit_count: 3 },
    },
    settings: {},
    era_modifiers: {},
    diplomacy: [],
    card_deck: [],
    discard_pile: [],
  } as unknown as GameState;
}

function authoredSpec(extra: Partial<DailyPuzzleSpec> = {}): DailyPuzzleSpec {
  return {
    archetype: 'military_capture',
    title: 'T', intro: 'I', goal: 'G',
    era_id: 'ancient', map_id: 'daily_fixture',
    seed: 1, player_count: 2, max_turns: 8, dice_queue_seed: 42,
    target_territory_id: 'b',
    starting_board: {
      a: { owner: 'human', unit_count: 10 },
      b: { owner: 'ai', unit_count: 6 },
    },
    clear_board: true,
    starting_phase: 'attack',
    ...extra,
  };
}

describe('applyDailyPuzzleScenario — authored days', () => {
  it('applies the authored board exactly and opens in the attack phase', () => {
    const state = fixtureState();
    applyDailyPuzzleScenario(state, fixtureMap(), authoredSpec(), HUMAN, AI);

    expect(state.territories.a).toMatchObject({ owner_id: HUMAN, unit_count: 10 });
    expect(state.territories.b).toMatchObject({ owner_id: AI, unit_count: 6 });
    // clear_board: everything unlisted is neutral scenery.
    expect(state.territories.c.owner_id).toBeNull();
    expect(state.territories.d.owner_id).toBeNull();

    expect(state.phase).toBe('attack');
    expect(state.draft_units_remaining).toBe(0);
    expect(state.current_player_index).toBe(0);
    // Deterministic dice + mistake tracking, same as generated puzzle days.
    expect(state.puzzle_dice_queue?.length).toBeGreaterThan(0);
    expect(state.puzzle_feedback_mistakes).toBe(0);
    // Ownership counters resynced for the authored board.
    expect(state.players[0].territory_count).toBe(1);
    expect(state.players[1].territory_count).toBe(1);
  });

  it('an additive board (no clear_board) leaves unlisted territories as dealt', () => {
    const state = fixtureState();
    applyDailyPuzzleScenario(
      state,
      fixtureMap(),
      authoredSpec({ clear_board: undefined, starting_phase: undefined }),
      HUMAN,
      AI,
    );
    expect(state.territories.a.unit_count).toBe(10);
    expect(state.territories.c).toMatchObject({ owner_id: HUMAN, unit_count: 3 });
    expect(state.territories.d).toMatchObject({ owner_id: AI, unit_count: 3 });
    // Without starting_phase the puzzle opens normally, in draft.
    expect(state.phase).toBe('draft');
  });

  it('grants set resource floors for the human seat', () => {
    const state = fixtureState();
    applyDailyPuzzleScenario(
      state,
      fixtureMap(),
      authoredSpec({ grants: { gold: 6, tech_points: 4 } }),
      HUMAN,
      AI,
    );
    const human = state.players.find((p) => p.player_id === HUMAN)!;
    expect(human.special_resource).toBe(6);
    expect(human.tech_points).toBe(4);
  });

  it('a generated (no starting_board) military spec keeps the legacy 8v4 shaper', () => {
    const state = fixtureState();
    applyDailyPuzzleScenario(
      state,
      fixtureMap(),
      authoredSpec({ starting_board: undefined, clear_board: undefined, starting_phase: undefined, anchor_territory_id: 'a' }),
      HUMAN,
      AI,
    );
    expect(state.territories.a).toMatchObject({ owner_id: HUMAN, unit_count: 8 });
    expect(state.territories.b).toMatchObject({ owner_id: AI, unit_count: 4 });
    expect(state.phase).toBe('attack');
  });
});
