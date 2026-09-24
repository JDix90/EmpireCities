import { describe, it, expect, vi } from 'vitest';
import type { Server } from 'socket.io';
import type { GameMap, GameState } from '../types';
import type { DailyPuzzleSpec } from '../game-engine/daily/dailyPuzzleTypes';
import { maybeResolveDailyPuzzle, settleDailyRun } from './dailyPuzzleSocket';

/**
 * The resolver turns an objective status plus the clock into a finished game.
 * The one subtle case is the hold verb, where the clock running out is the
 * win rather than the loss — the objective stays "pending" (still held) the
 * whole way and the resolver has to read that as success.
 */

const HUMAN = 'human-1';
const AI = 'ai-1';

const map: GameMap = { map_id: 'm', name: 'm', territories: {}, connections: [], regions: [] } as unknown as GameMap;

function specFor(archetype: DailyPuzzleSpec['archetype']): DailyPuzzleSpec {
  return {
    archetype,
    title: 't', intro: 'i', goal: 'g',
    era_id: 'ancient', map_id: 'm', seed: 1, player_count: 2, max_turns: 6, dice_queue_seed: 1,
    target_territory_id: 'fort',
    anchor_territory_id: 'camp',
  };
}

function stateWith(spec: DailyPuzzleSpec, fortOwner: string, turn: number): GameState {
  return {
    phase: 'attack',
    turn_number: turn,
    players: [
      { player_id: HUMAN, is_ai: false, is_eliminated: false },
      { player_id: AI, is_ai: true, is_eliminated: false },
    ],
    territories: {
      fort: { owner_id: fortOwner, unit_count: 4 },
      camp: { owner_id: AI, unit_count: 9 },
    },
    settings: { daily_challenge_spec: spec },
  } as unknown as GameState;
}

const io = { to: () => ({ emit: () => {} }) } as unknown as Server;

function resolve(state: GameState) {
  const finalize = vi.fn();
  const done = maybeResolveDailyPuzzle(io, 'g1', { state, map }, null, HUMAN, finalize);
  return { done, finalize, state };
}

describe('maybeResolveDailyPuzzle — hold_territory', () => {
  it('keeps the game running while the target is held and the clock has time', () => {
    const { done, finalize } = resolve(stateWith(specFor('hold_territory'), HUMAN, 3));
    expect(done).toBe(false);
    expect(finalize).not.toHaveBeenCalled();
  });

  it('ends the game as a loss the moment the AI takes the target', () => {
    const { done, finalize, state } = resolve(stateWith(specFor('hold_territory'), AI, 3));
    expect(done).toBe(true);
    expect(finalize).toHaveBeenCalledWith(io, 'g1', state, [AI]);
    expect(state.puzzle_objective_met).toBe(false);
  });

  it('ends the game as a WIN when the clock runs out with the target still held', () => {
    const { done, finalize, state } = resolve(stateWith(specFor('hold_territory'), HUMAN, 7));
    expect(done).toBe(true);
    expect(finalize).toHaveBeenCalledWith(io, 'g1', state, [HUMAN]);
    expect(state.puzzle_objective_met).toBe(true);
    expect(state.winner_id).toBe(HUMAN);
  });

  it('the clock is still a loss for a capture day', () => {
    // fort is AI-held: not captured by the time the clock runs out.
    const { done, finalize, state } = resolve(stateWith(specFor('military_capture'), AI, 7));
    expect(done).toBe(true);
    expect(finalize).toHaveBeenCalledWith(io, 'g1', state, [AI]);
    expect(state.puzzle_objective_met).toBe(false);
  });
});

describe('settleDailyRun', () => {
  it('scores a conquest that beat the objective to the finish as a lost run', () => {
    // The reported day: research a tech, but the only rival fell on turn 1.
    // The game is the human's; the challenge is not.
    const state = stateWith(specFor('tech_research'), HUMAN, 1);
    expect(settleDailyRun(state, HUMAN, [HUMAN])).toEqual({ won: false, outcome: 'unmet' });
  });

  it('scores a met objective as a won run', () => {
    const state = stateWith(specFor('tech_research'), HUMAN, 3);
    state.puzzle_objective_met = true;
    expect(settleDailyRun(state, HUMAN, [HUMAN])).toEqual({ won: true, outcome: 'solved' });
  });

  it('scores a lost game as a failed run', () => {
    const state = stateWith(specFor('hold_territory'), AI, 3);
    state.puzzle_objective_met = false;
    expect(settleDailyRun(state, HUMAN, [AI])).toEqual({ won: false, outcome: 'failed' });
  });

  it('leaves a domination day to the game result, with no objective outcome', () => {
    const state = stateWith(specFor('domination'), HUMAN, 4);
    expect(settleDailyRun(state, HUMAN, [HUMAN])).toEqual({ won: true, outcome: null });
    expect(settleDailyRun(state, HUMAN, [AI])).toEqual({ won: false, outcome: null });
  });
});
