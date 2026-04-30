import { describe, it, expect } from 'vitest';
import { buildInsightsFromDecisionLog } from './playerValueEnhancements';
import type { ActionDecision } from '../types';

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
