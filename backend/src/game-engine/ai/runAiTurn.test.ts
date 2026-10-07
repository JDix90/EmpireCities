/**
 * The bot's turn runs with no socket: planAiTurn + playAiTurn with headless
 * hooks play whole games on a real map, which is what lets a harness measure
 * the same code live games run. That the live game runs these two, at the
 * seat's styled level, is checked against a real bot turn in
 * sockets/aiTurnRunnerSocket.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap, GameSettings, GameState } from '../../types';
import { advanceToNextPlayer, checkVictory, initializeGameState } from '../state/gameStateManager';
import { computeAiTurn } from './aiBot';
import { headlessAiTurnHooks, planAiTurn, playAiTurn, type AiTurnHooks } from './runAiTurn';

const MAP = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_risorgimento.json'), 'utf-8'),
) as GameMap;

const FLAGS = { captureOddsScoring: true, attackGrind: true, decidedGamePress: true };

/** Quick Match's classic rules: cards on and escalating, the 65% Conquest ending. */
function settings(): GameSettings {
  return {
    fog_of_war: false,
    turn_timer_seconds: 0,
    initial_unit_count: 3,
    card_set_escalating: true,
    diplomacy_enabled: false,
    allowed_victory_conditions: ['domination', 'threshold'],
    victory_threshold: 65,
    victory_type: 'domination',
    max_turns: 60,
  } as GameSettings;
}

function newGame(seats: number): GameState {
  const players = Array.from({ length: seats }, (_, i) => ({
    player_id: `bot_${i}`,
    player_index: i,
    username: `Bot ${i}`,
    color: ['#e74c3c', '#3498db', '#2ecc71', '#f39c12'][i]!,
    is_ai: true,
    ai_difficulty: 'medium' as const,
    is_eliminated: false,
    mmr: 1000,
  }));
  return initializeGameState('headless', 'risorgimento', MAP, players, settings());
}

/** Headless hooks that also count what the live game would have been asked to do. */
function countingHooks(state: GameState): { hooks: AiTurnHooks; calls: Record<string, number> } {
  const base = headlessAiTurnHooks(state, MAP);
  const calls: Record<string, number> = {};
  const hooks = Object.fromEntries(
    Object.entries(base).map(([name, fn]) => [
      name,
      (...args: unknown[]) => {
        calls[name] = (calls[name] ?? 0) + 1;
        return (fn as (...a: unknown[]) => unknown)(...args);
      },
    ]),
  ) as unknown as AiTurnHooks;
  return { hooks, calls };
}

/** Bot turns until the game ends or the turn cap passes, as processAiTurn chains them. */
async function playGame(state: GameState, hooks: AiTurnHooks): Promise<number> {
  let turns = 0;
  while (state.phase !== 'game_over' && state.turn_number <= 60 && turns < 400) {
    const player = state.players[state.current_player_index]!;
    const plan = await planAiTurn(state, MAP, player, player.ai_difficulty ?? 'medium', FLAGS, {
      planningState: () => state,
      plan: async (s, m, d, o) => computeAiTurn(s, m, d, o),
    });
    turns += 1;
    if ((await playAiTurn(state, MAP, player, player.ai_difficulty ?? 'medium', plan, 'draft', hooks)) === 'over') break;
    advanceToNextPlayer(state, MAP);
    if (await hooks.victoryCheck()) break;
  }
  return turns;
}

describe('a bot turn with no socket', () => {
  it('plays whole games to an ending on a real map', async () => {
    for (let game = 0; game < 5; game += 1) {
      const state = newGame(3);
      const { hooks, calls } = countingHooks(state);
      const turns = await playGame(state, hooks);
      expect(turns).toBeGreaterThan(3);
      // Every territory is still on the board, held by someone or neutral.
      expect(Object.keys(state.territories)).toHaveLength(MAP.territories.length);
      // The live game would have been asked to pace, broadcast and check for a win.
      expect(calls.delay).toBeGreaterThan(0);
      expect(calls.broadcast).toBeGreaterThan(0);
      expect(calls.victoryCheck).toBeGreaterThan(0);
      if (state.phase === 'game_over') {
        expect(checkVictory(state, MAP)).not.toBeNull();
        expect(state.winner_id).toBeTruthy();
      }
    }
  });

  it('places every reinforcement and ends in the fortify phase', async () => {
    const state = newGame(2);
    const player = state.players[state.current_player_index]!;
    const plan = await planAiTurn(state, MAP, player, 'medium', FLAGS, {
      planningState: () => state,
      plan: async (s, m, d, o) => computeAiTurn(s, m, d, o),
    });
    const outcome = await playAiTurn(state, MAP, player, 'medium', plan, 'draft', headlessAiTurnHooks(state, MAP));
    expect(outcome).toBe('done');
    expect(state.draft_units_remaining).toBe(0);
    expect(state.phase).toBe('fortify');
  });

  it('hands the turn the board its seat sees, to choose its targets on', async () => {
    const state = newGame(2);
    const player = state.players[state.current_player_index]!;
    const view = { ...state };
    const plan = await planAiTurn(state, MAP, player, 'medium', FLAGS, {
      planningState: () => view,
      plan: async () => [],
    });
    expect(plan.view?.()).toBe(view);
  });

  it('stops at the first exchange when that exchange wins the game', async () => {
    // A victory check that always says the game is over: the turn must stop
    // after the exchange that triggered it, report 'over', and never fortify.
    let checked = false;
    for (let game = 0; game < 10 && !checked; game += 1) {
      const state = newGame(2);
      const player = state.players[state.current_player_index]!;
      const plan = await planAiTurn(state, MAP, player, 'medium', FLAGS, {
        planningState: () => state,
        plan: async (s, m, d, o) => computeAiTurn(s, m, d, o),
      });
      let exchanges = 0;
      const hooks: AiTurnHooks = {
        ...headlessAiTurnHooks(state, MAP),
        victoryCheck: async () => true,
        recordCombat: () => { exchanges += 1; },
      };
      const outcome = await playAiTurn(state, MAP, player, 'medium', plan, 'draft', hooks);
      if (exchanges === 0) continue; // this opening planned no attack; try another
      expect(exchanges).toBe(1);
      expect(outcome).toBe('over');
      expect(state.phase).toBe('attack');
      checked = true;
    }
    expect(checked).toBe(true);
  });
});
