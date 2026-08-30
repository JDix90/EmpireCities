import { describe, it, expect } from 'vitest';
import type { GameMap, GameState } from '../../types';
import { computeAiTurn } from './aiBot';
import {
  aiAttackExchangeBudget,
  shouldPressDecidedGame,
  DECIDED_GAME_BUDGET_MULT,
} from './aiAttackGrind';

/**
 * Decided-game escape (ai_decided_game_press_enabled).
 *
 * Once an AI holds a clear majority of the board and armies, the tuned
 * per-turn budget becomes the reason solo games drag: the winner dribbles a
 * few exchanges a turn while everyone can already call the result. Past the
 * win-probability threshold the budget doubles and the planner lifts its
 * attack cap, so the game ends instead of decaying.
 */

const AI = 'ai_1';
const HUMAN = 'p1';

/** 9 AI territories, each adjacent to its own 1-unit enemy territory. */
function starMap(): GameMap {
  const territories = [];
  const connections = [];
  for (let i = 1; i <= 9; i++) {
    territories.push(
      { territory_id: `a${i}`, name: `A${i}`, polygon: [], center_point: [0, 0], region_id: 'r' },
      { territory_id: `e${i}`, name: `E${i}`, polygon: [], center_point: [0, 0], region_id: 'r' },
    );
    connections.push({ from: `a${i}`, to: `e${i}`, type: 'land' });
  }
  return {
    map_id: 'press_fixture',
    name: 'Press Fixture',
    territories,
    connections,
    regions: [{ region_id: 'r', name: 'R', bonus: 0 }],
  } as unknown as GameMap;
}

function starState(): GameState {
  const territories: Record<string, unknown> = {};
  for (let i = 1; i <= 9; i++) {
    territories[`a${i}`] = { territory_id: `a${i}`, owner_id: AI, unit_count: 10 };
    territories[`e${i}`] = { territory_id: `e${i}`, owner_id: HUMAN, unit_count: 1 };
  }
  return {
    game_id: 'g',
    era: 'ww2',
    map_id: 'press_fixture',
    phase: 'attack',
    turn_number: 10,
    current_player_index: 0,
    players: [
      // territory_count 14 vs 4: a decided board (the star edges below are the
      // fighting FRONT, not the whole empire). 4 also keeps the finisher bonus
      // at zero so the planner test isolates the cap.
      { player_id: AI, player_index: 0, username: 'AI', color: '#000', is_ai: true, is_eliminated: false, territory_count: 14, cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000 },
      { player_id: HUMAN, player_index: 1, username: 'P', color: '#fff', is_ai: false, is_eliminated: false, territory_count: 4, cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000 },
    ],
    territories,
    settings: {},
    era_modifiers: {},
    diplomacy: [],
    card_deck: [],
    discard_pile: [],
  } as unknown as GameState;
}

describe('aiAttackExchangeBudget', () => {
  it('doubles the budget under press, difficulty numbers otherwise unchanged', () => {
    expect(aiAttackExchangeBudget('medium', false)).toBe(4);
    expect(aiAttackExchangeBudget('medium', true)).toBe(4 * DECIDED_GAME_BUDGET_MULT);
    expect(aiAttackExchangeBudget('hard', false)).toBe(8);
    expect(aiAttackExchangeBudget('hard', true)).toBe(8 * DECIDED_GAME_BUDGET_MULT);
    // Tutorial never attacks; zero doubled is still zero.
    expect(aiAttackExchangeBudget('tutorial', true)).toBe(0);
  });
});

describe('shouldPressDecidedGame', () => {
  it('fires for the clear leader and never for the trailer', () => {
    // 14 of 18 territories and ~91% of the armies: blend 0.55*0.78 + 0.45*0.91
    // = 0.84, comfortably past the 0.7 threshold.
    const state = starState();
    expect(shouldPressDecidedGame(state, AI, 'medium')).toBe(true);
    expect(shouldPressDecidedGame(state, HUMAN, 'medium')).toBe(false);
  });

  it('stays quiet in a balanced game', () => {
    const state = starState();
    for (let i = 1; i <= 9; i++) {
      (state.territories[`e${i}`] as { unit_count: number }).unit_count = 10;
    }
    expect(shouldPressDecidedGame(state, AI, 'medium')).toBe(false);
    expect(shouldPressDecidedGame(state, HUMAN, 'medium')).toBe(false);
  });

  it('easy and tutorial never press, however decided the game', () => {
    const state = starState();
    expect(shouldPressDecidedGame(state, AI, 'easy')).toBe(false);
    expect(shouldPressDecidedGame(state, AI, 'tutorial')).toBe(false);
  });
});

describe('planner attack cap under press', () => {
  const countAttacks = (decidedGamePress: boolean): number =>
    computeAiTurn(starState(), starMap(), 'medium', { decidedGamePress }).filter(
      (a) => a.type === 'attack' && a.from !== '__influence__',
    ).length;

  it('medium plans 4 attacks normally and 8 when the game is decided', () => {
    // All 9 star edges are near-certain captures; only the cap separates the runs.
    expect(countAttacks(false)).toBe(4);
    expect(countAttacks(true)).toBe(8);
  });
});
