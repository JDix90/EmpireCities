import { describe, it, expect } from 'vitest';
import { buildInsightsFromDecisionLog, buildInsightsFromSnapshots } from './playerValueEnhancements';
import type { ActionDecision, GameState } from '../types';

function snapshotState(turn: number, humanTerritories: number, hasResigned = false): GameState {
  const territories: GameState['territories'] = {};
  for (let i = 0; i < 12; i++) {
    territories[`t${i}`] = {
      owner_id: i < humanTerritories ? 'human' : 'bot',
      unit_count: 1,
    } as GameState['territories'][string];
  }
  return {
    game_id: 'g1',
    era: 'ancient',
    map_id: 'm1',
    phase: 'attack',
    current_player_index: 0,
    turn_number: turn,
    players: [
      {
        player_id: 'human', player_index: 0, username: 'Me', color: '#fff',
        is_ai: false, is_eliminated: hasResigned, has_resigned: hasResigned,
        territory_count: humanTerritories, cards: [], mmr: 1000,
        capital_territory_id: null, secret_mission: null,
      },
      {
        player_id: 'bot', player_index: 1, username: 'Bot', color: '#f00',
        is_ai: true, is_eliminated: false,
        territory_count: 12 - humanTerritories, cards: [], mmr: 1000,
        capital_territory_id: null, secret_mission: null,
      },
    ],
    territories,
    card_deck: [],
    card_set_redemption_count: 0,
    diplomacy: [],
    settings: { fog_of_war: false, turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: true, diplomacy_enabled: false },
    draft_units_remaining: 0,
    turn_started_at: 0,
  } as unknown as GameState;
}

describe('buildInsightsFromSnapshots — resignation handling', () => {
  it('does not turn the resignation territory-zeroing into a combat insight', () => {
    const rows = [
      { turn_number: 1, state_json: snapshotState(1, 4) },
      { turn_number: 2, state_json: snapshotState(2, 4) },
      // Final snapshot: the player resigned — territories zeroed by bookkeeping.
      { turn_number: 3, state_json: snapshotState(3, 0, true) },
    ];
    const insights = buildInsightsFromSnapshots(rows);
    expect(insights.every((i) => i.turn !== 3)).toBe(true);
    expect(insights.every((i) => !/You lost \d+ territor/.test(i.explanation))).toBe(true);
  });

  it('still reports genuine swings on earlier turns of a resigned game', () => {
    const rows = [
      { turn_number: 1, state_json: snapshotState(1, 7) },
      { turn_number: 2, state_json: snapshotState(2, 3) }, // real combat loss of 4
      { turn_number: 3, state_json: snapshotState(3, 0, true) }, // resignation artifact
    ];
    const insights = buildInsightsFromSnapshots(rows);
    expect(insights.some((i) => i.turn === 2)).toBe(true);
    expect(insights.every((i) => i.turn !== 3)).toBe(true);
  });

  it('keeps final-turn insights for games that ended without resignation', () => {
    const rows = [
      { turn_number: 1, state_json: snapshotState(1, 7) },
      { turn_number: 2, state_json: snapshotState(2, 3) },
    ];
    const insights = buildInsightsFromSnapshots(rows);
    expect(insights.some((i) => i.turn === 2)).toBe(true);
  });
});

function decision(overrides: Partial<ActionDecision> = {}): ActionDecision {
  return {
    step: 0,
    turn: 1,
    player_id: 'human',
    action_type: 'attack',
    summary: 'Attacked X → Y',
    prob_before: 0.5,
    prob_after: 0.5,
    prob_delta: 0,
    ...overrides,
  };
}

describe('buildInsightsFromDecisionLog', () => {
  it('returns empty array when log is empty', () => {
    expect(buildInsightsFromDecisionLog([])).toEqual([]);
  });

  it('returns empty array when no decision moved win probability', () => {
    const decisions: ActionDecision[] = [
      decision({ step: 0, prob_delta: 0.001 }),
      decision({ step: 1, prob_delta: -0.005 }),
    ];
    expect(buildInsightsFromDecisionLog(decisions)).toEqual([]);
  });

  it('selects the top 3 decisions by |delta| when no high-impact swings exist', () => {
    const decisions: ActionDecision[] = [
      decision({ step: 0, turn: 1, prob_delta: 0.02 }),
      decision({ step: 1, turn: 2, prob_delta: -0.05 }),
      decision({ step: 2, turn: 3, prob_delta: 0.04 }),
      decision({ step: 3, turn: 4, prob_delta: -0.07 }),
      decision({ step: 4, turn: 5, prob_delta: 0.03 }),
    ];
    const insights = buildInsightsFromDecisionLog(decisions);
    expect(insights).toHaveLength(3);
    // Top 3 by magnitude are step 3 (.07), step 1 (.05), step 2 (.04). After
    // chronological re-sort: step 1 (turn 2), step 2 (turn 3), step 3 (turn 4).
    expect(insights.map((i) => i.turn)).toEqual([2, 3, 4]);
  });

  it('promotes ALL high-impact swings (|delta| ≥ 0.12) even beyond top-3', () => {
    const decisions: ActionDecision[] = [
      decision({ step: 0, turn: 1, prob_delta: 0.13 }),
      decision({ step: 1, turn: 2, prob_delta: -0.15 }),
      decision({ step: 2, turn: 3, prob_delta: 0.18 }),
      decision({ step: 3, turn: 4, prob_delta: -0.20 }),
      decision({ step: 4, turn: 5, prob_delta: 0.14 }),
    ];
    const insights = buildInsightsFromDecisionLog(decisions);
    expect(insights).toHaveLength(5);
    expect(insights.map((i) => i.turn)).toEqual([1, 2, 3, 4, 5]);
  });

  it('uses high-impact swings PLUS top-N filler when fewer than 3 cross the threshold', () => {
    const decisions: ActionDecision[] = [
      decision({ step: 0, turn: 1, prob_delta: 0.13 }), // high impact
      decision({ step: 1, turn: 2, prob_delta: -0.05 }),
      decision({ step: 2, turn: 3, prob_delta: 0.04 }),
      decision({ step: 3, turn: 4, prob_delta: -0.03 }),
    ];
    const insights = buildInsightsFromDecisionLog(decisions);
    expect(insights).toHaveLength(3);
    expect(insights.map((i) => i.turn)).toEqual([1, 2, 3]);
  });

  it('marks high-impact swings as "high" and others as "medium"', () => {
    const decisions: ActionDecision[] = [
      decision({ step: 0, turn: 1, prob_delta: 0.20 }),
      decision({ step: 1, turn: 2, prob_delta: 0.05 }),
      decision({ step: 2, turn: 3, prob_delta: 0.04 }),
    ];
    const insights = buildInsightsFromDecisionLog(decisions);
    expect(insights[0].impact).toBe('high');
    expect(insights[1].impact).toBe('medium');
    expect(insights[2].impact).toBe('medium');
  });

  it('produces explanations that quote the exact before/after percentages', () => {
    const decisions: ActionDecision[] = [
      decision({
        step: 0,
        turn: 5,
        action_type: 'attack',
        summary: 'Attacked Ukraine → Afghanistan with 5 units; failed (lost 3)',
        prob_before: 0.41,
        prob_after: 0.33,
        prob_delta: -0.08,
      }),
      decision({ step: 1, turn: 6, prob_delta: 0.05 }),
      decision({ step: 2, turn: 7, prob_delta: -0.02 }),
    ];
    const [first] = buildInsightsFromDecisionLog(decisions);
    expect(first.explanation).toContain('Attacked Ukraine');
    expect(first.explanation).toContain('41%');
    expect(first.explanation).toContain('33%');
    expect(first.explanation).toContain('-8 pts');
  });

  it('orders surfaced insights chronologically by step (action order), not by magnitude', () => {
    const decisions: ActionDecision[] = [
      decision({ step: 0, turn: 1, prob_delta: 0.05 }),  // smallest, oldest
      decision({ step: 1, turn: 3, prob_delta: -0.10 }),
      decision({ step: 2, turn: 5, prob_delta: 0.20 }),  // largest, newest
    ];
    const insights = buildInsightsFromDecisionLog(decisions);
    // Despite step 2 having the largest |delta|, the surfaced order is step ascending
    // so the modal reads as a narrative.
    expect(insights.map((i) => i.turn)).toEqual([1, 3, 5]);
  });
});
