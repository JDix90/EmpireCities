import { describe, it, expect, beforeEach } from 'vitest';
import {
  captureProbBefore,
  commitActionDecision,
  getDecisionLog,
  clearDecisionLog,
  recordActionDecision,
  summarizeDecisionLog,
  _resetActionAttribution,
} from './actionAttribution';
import type { ActionDecision, GameState, PlayerState, TerritoryState } from '../types';

function makeState(overrides?: Partial<GameState>): GameState {
  const players: PlayerState[] = [
    { player_id: 'human', player_index: 0, username: 'Hero', color: '#f00', is_ai: false, is_eliminated: false, territory_count: 5, cards: [], capital_territory_id: null, secret_mission: null },
    { player_id: 'bot1',  player_index: 1, username: 'AI 1',  color: '#0f0', is_ai: true,  is_eliminated: false, territory_count: 5, cards: [], capital_territory_id: null, secret_mission: null },
  ];
  const territories: Record<string, TerritoryState> = {};
  for (let i = 0; i < 10; i++) {
    territories[`t${i}`] = {
      territory_id: `t${i}`,
      owner_id: i < 5 ? 'human' : 'bot1',
      unit_count: 3,
      unit_type: 'infantry',
    };
  }
  return {
    game_id: 'g1',
    era: 'modern',
    map_id: 'm1',
    phase: 'attack',
    current_player_index: 0,
    turn_number: 3,
    players,
    territories,
    card_deck: [],
    card_set_redemption_count: 0,
    diplomacy: [],
    settings: {
      fog_of_war: false,
      victory_type: 'domination',
      allowed_victory_conditions: ['domination'],
      turn_timer_seconds: 0,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: false,
    },
    draft_units_remaining: 0,
    turn_started_at: 0,
    ...overrides,
  };
}

describe('actionAttribution', () => {
  beforeEach(() => {
    _resetActionAttribution();
  });

  it('records a decision with the exact prob delta when the human acts', () => {
    const state = makeState();
    const probBefore = captureProbBefore(state, 'human');
    expect(probBefore).not.toBeNull();

    // Simulate a mutation that strengthens the human (gain 1 territory).
    state.territories.t5.owner_id = 'human';
    state.players[0].territory_count = 6;
    state.players[1].territory_count = 4;

    commitActionDecision('g1', state, 'human', 'attack', 'Took t5', probBefore);

    const log = getDecisionLog('g1');
    expect(log).toHaveLength(1);
    expect(log[0].player_id).toBe('human');
    expect(log[0].action_type).toBe('attack');
    expect(log[0].summary).toBe('Took t5');
    expect(log[0].turn).toBe(3);
    expect(log[0].step).toBe(0);
    expect(log[0].prob_delta).toBeGreaterThan(0);
    expect(log[0].prob_after).toBeGreaterThan(log[0].prob_before);
  });

  it('does not record decisions when an AI player acts', () => {
    const state = makeState();
    const probBefore = captureProbBefore(state, 'bot1');
    expect(probBefore).toBeNull();
    commitActionDecision('g1', state, 'bot1', 'attack', 'AI move', probBefore);
    expect(getDecisionLog('g1')).toEqual([]);
  });

  it('assigns monotonically increasing step numbers within a game', () => {
    const state = makeState();
    for (let i = 0; i < 5; i++) {
      const before = captureProbBefore(state, 'human');
      commitActionDecision('g1', state, 'human', 'draft', `move ${i}`, before);
    }
    const log = getDecisionLog('g1');
    expect(log.map((d) => d.step)).toEqual([0, 1, 2, 3, 4]);
  });

  it('isolates decisions per game id', () => {
    const stateA = makeState({ game_id: 'gA' });
    const stateB = makeState({ game_id: 'gB' });
    const beforeA = captureProbBefore(stateA, 'human');
    const beforeB = captureProbBefore(stateB, 'human');
    commitActionDecision('gA', stateA, 'human', 'attack', 'A move', beforeA);
    commitActionDecision('gB', stateB, 'human', 'attack', 'B move', beforeB);
    expect(getDecisionLog('gA')).toHaveLength(1);
    expect(getDecisionLog('gB')).toHaveLength(1);
    expect(getDecisionLog('gA')[0].summary).toBe('A move');
    expect(getDecisionLog('gB')[0].summary).toBe('B move');
  });

  it('clearDecisionLog removes only the specified game', () => {
    const stateA = makeState({ game_id: 'gA' });
    const stateB = makeState({ game_id: 'gB' });
    commitActionDecision('gA', stateA, 'human', 'attack', 'A', captureProbBefore(stateA, 'human'));
    commitActionDecision('gB', stateB, 'human', 'attack', 'B', captureProbBefore(stateB, 'human'));
    clearDecisionLog('gA');
    expect(getDecisionLog('gA')).toEqual([]);
    expect(getDecisionLog('gB')).toHaveLength(1);
  });

  it('recordActionDecision wraps a thunk and captures before/after correctly', () => {
    const state = makeState();
    const result = recordActionDecision(
      'g1',
      state,
      'human',
      'attack',
      () => 'wrapped action',
      () => {
        state.territories.t5.owner_id = 'human';
        state.players[0].territory_count = 6;
        state.players[1].territory_count = 4;
        return 'done';
      },
    );
    expect(result).toBe('done');
    const log = getDecisionLog('g1');
    expect(log).toHaveLength(1);
    expect(log[0].summary).toBe('wrapped action');
    expect(log[0].prob_delta).toBeGreaterThan(0);
  });
});

// ── summarizeDecisionLog ────────────────────────────────────────────────────

function makeDecision(
  step: number,
  delta: number,
  player_id = 'human',
): ActionDecision {
  return {
    step,
    turn: step + 1,
    player_id,
    action_type: 'attack',
    summary: `move ${step}`,
    prob_before: 0.5,
    prob_after: 0.5 + delta,
    prob_delta: delta,
  };
}

describe('summarizeDecisionLog', () => {
  it('returns total_decisions: 0 when there are no logs for the player', () => {
    expect(summarizeDecisionLog([], 'human')).toEqual({ total_decisions: 0 });
  });

  it('filters out other players\' decisions before computing best/worst', () => {
    const log: ActionDecision[] = [
      makeDecision(0, 0.10, 'opponent'), // ignored
      makeDecision(1, 0.05, 'human'),
      makeDecision(2, -0.08, 'human'),
    ];
    const summary = summarizeDecisionLog(log, 'human');
    expect(summary.total_decisions).toBe(2);
    expect(summary.best?.step).toBe(1);
    expect(summary.worst?.step).toBe(2);
  });

  it('drops noise-level deltas (|delta| < 2pts) before picking highlights', () => {
    const log: ActionDecision[] = [
      makeDecision(0, 0.005), // noise
      makeDecision(1, -0.01), // noise
      makeDecision(2, 0.04),  // meaningful
    ];
    const summary = summarizeDecisionLog(log, 'human');
    expect(summary.total_decisions).toBe(3); // raw count includes noise
    expect(summary.best?.step).toBe(2);
    // Below-threshold worst is not surfaced — the only meaningful entry is positive.
    expect(summary.worst?.step).toBe(2);
  });

  it('returns total only when every action was below the noise threshold', () => {
    const log: ActionDecision[] = [makeDecision(0, 0.005), makeDecision(1, 0.01)];
    const summary = summarizeDecisionLog(log, 'human');
    expect(summary.total_decisions).toBe(2);
    expect(summary.best).toBeUndefined();
    expect(summary.worst).toBeUndefined();
    expect(summary.biggest_swing).toBeUndefined();
  });

  it('biggest_swing picks the largest |delta| regardless of sign', () => {
    const log: ActionDecision[] = [
      makeDecision(0, 0.06),
      makeDecision(1, -0.12), // largest |delta|
      makeDecision(2, 0.04),
    ];
    const summary = summarizeDecisionLog(log, 'human');
    expect(summary.biggest_swing?.step).toBe(1);
    expect(summary.best?.step).toBe(0); // best positive
    expect(summary.worst?.step).toBe(1); // most negative
  });

  it('biggest_swing equals best when only positive deltas exist', () => {
    const log: ActionDecision[] = [makeDecision(0, 0.05), makeDecision(1, 0.10)];
    const summary = summarizeDecisionLog(log, 'human');
    expect(summary.biggest_swing?.step).toBe(1);
    expect(summary.best?.step).toBe(1);
    expect(summary.worst?.step).toBe(0); // smallest delta is still > threshold
  });
});
