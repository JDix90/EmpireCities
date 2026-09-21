/**
 * The briefing card reads the day's own AI setting. It used to say "Hard" for
 * every day, which was wrong for hold days (medium on purpose) and for any
 * set-piece that names its own difficulty.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DailyChallengeIntroModal from './DailyChallengeIntroModal';

const base = { archetype: 'hold_territory', title: 'Persepolis', intro: 'Hold.', goal: 'Hold Persia for 7 turns.' };

describe('DailyChallengeIntroModal difficulty', () => {
  it("shows the spec's ai_difficulty", () => {
    render(<DailyChallengeIntroModal spec={{ ...base, ai_difficulty: 'medium' }} onBegin={() => {}} />);
    expect(screen.getByText('medium')).toBeTruthy();
    expect(screen.queryByText('Hard')).toBeNull();
  });

  it('falls back to medium when the spec carries no difficulty, matching the server default', () => {
    render(<DailyChallengeIntroModal spec={base} onBegin={() => {}} />);
    expect(screen.getByText('medium')).toBeTruthy();
  });

  it('lets an explicit label win', () => {
    render(<DailyChallengeIntroModal spec={{ ...base, ai_difficulty: 'medium' }} difficultyLabel="Hard" onBegin={() => {}} />);
    expect(screen.getByText('Hard')).toBeTruthy();
  });

  it('names the mission by archetype', () => {
    render(<DailyChallengeIntroModal spec={base} onBegin={() => {}} />);
    expect(screen.getByText('Hold the Line')).toBeTruthy();
  });
});

describe('DailyChallengeIntroModal — a v2 decision puzzle', () => {
  const v2 = {
    version: 2 as const,
    theme: 'cut the supply line',
    plan_prose: ['While it holds the objective, it reinforces Persia.', 'While you hold the objective, Bactria attacks Persia.'],
    decisions_target: 2,
    verdicts: 'before_dice' as const,
    intent: 'arrows' as const,
    decisions: 2,
  };

  it("shows the opponent's plan and the decision count, and drops par", () => {
    render(<DailyChallengeIntroModal spec={{ ...base, archetype: 'military_capture', max_turns: 3, par_turns: 3, v2 }} onBegin={() => {}} />);
    expect(screen.getByTestId('daily-intro-plan')).toBeTruthy();
    expect(screen.getByText('While it holds the objective, it reinforces Persia.')).toBeTruthy();
    expect(screen.getByText('2 decisions decide this one · the board answers before the dice')).toBeTruthy();
    expect(screen.queryByText(/Par:/)).toBeNull();
    // The theme is the lesson; it is told at the end, not at the start.
    expect(screen.queryByText(/cut the supply line/)).toBeNull();
  });

  it('says a silent day is graded at the end', () => {
    render(<DailyChallengeIntroModal spec={{ ...base, v2: { ...v2, verdicts: 'silent', intent: 'prose', decisions: 3 } }} onBegin={() => {}} />);
    expect(screen.getByText('3 decisions decide this one · graded silently, revealed at the end')).toBeTruthy();
  });

  it('keeps the v1 card for a day without a plan', () => {
    render(<DailyChallengeIntroModal spec={{ ...base, max_turns: 8, par_turns: 4 }} onBegin={() => {}} />);
    expect(screen.queryByTestId('daily-intro-plan')).toBeNull();
    expect(screen.getByText(/Par:/)).toBeTruthy();
  });
});
