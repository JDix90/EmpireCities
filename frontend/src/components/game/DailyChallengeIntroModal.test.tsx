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
