import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const motion = vi.hoisted(() => ({ reduced: true }));
vi.mock('../../utils/device', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/device')>()),
  prefersReducedMotion: () => motion.reduced,
}));

import ResultsRewards, { levelBarPlan, type ResultsXpSummary } from './ResultsRewards';

// The review's guest: 105 XP from the game and two medals paying 1,000 more,
// from Level 1 to Level 3, on a screen that said "+105 XP".
const levelledUp: ResultsXpSummary = {
  game: 105,
  medals: [{ id: 'first_victory', xp: 500 }, { id: 'conqueror', xp: 500 }],
  before: { xp: 50, level: 1, floor: 0, next: 250 },
  after: { xp: 1155, level: 3, floor: 1000, next: 2250 },
};
const sameLevel: ResultsXpSummary = {
  game: 60,
  medals: [],
  before: { xp: 1100, level: 3, floor: 1000, next: 2250 },
  after: { xp: 1160, level: 3, floor: 1000, next: 2250 },
};
const names: Record<string, string> = { first_victory: 'First Victory', conqueror: 'Conqueror' };

describe('levelBarPlan', () => {
  it('fills within a level from the old total to the new', () => {
    expect(levelBarPlan(sameLevel)).toEqual({ levelled: false, start: 0.08, firstStop: 0.128, end: 0.128 });
  });

  it('fills the old level to the end, then the new level from empty', () => {
    expect(levelBarPlan(levelledUp)).toEqual({ levelled: true, start: 0.2, firstStop: 1, end: 0.124 });
  });
});

describe('ResultsRewards', () => {
  beforeEach(() => { motion.reduced = true; });
  afterEach(() => vi.useRealTimers());

  it('shows the new level, the level-up, and the XP the game and the medals paid', () => {
    render(<ResultsRewards xp={levelledUp} xpEarned={105} medalIds={['first_victory', 'conqueror']} medalName={(id) => names[id]!} />);
    expect(screen.getByTestId('results-level')).toHaveTextContent('Level 3');
    expect(screen.getByTestId('results-level-up')).toHaveTextContent('Level up · 1 → 3');
    expect(screen.getByTestId('results-xp-breakdown')).toHaveTextContent('+1,105 XP (105 from the game, 1,000 from medals)');
    expect(screen.getByText('1,155 / 2,250 XP · 1,095 to Level 4')).toBeInTheDocument();
    const medals = screen.getByTestId('results-medals');
    expect(medals).toHaveTextContent('First Victory');
    expect(medals).toHaveTextContent('+500 XP');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1155');
  });

  it('says plain "Level up!" for one level, and nothing for none', () => {
    const oneUp = { ...levelledUp, after: { xp: 300, level: 2, floor: 250, next: 1000 } };
    const { unmount } = render(<ResultsRewards xp={oneUp} medalIds={[]} medalName={String} />);
    expect(screen.getByTestId('results-level-up')).toHaveTextContent('Level up!');
    unmount();
    render(<ResultsRewards xp={sameLevel} medalIds={[]} medalName={String} />);
    expect(screen.queryByTestId('results-level-up')).toBeNull();
    expect(screen.getByTestId('results-xp-breakdown')).toHaveTextContent('+60 XP');
  });

  it('plays the level-up: the old level fills, then the new level shows', () => {
    vi.useFakeTimers();
    motion.reduced = false;
    render(<ResultsRewards xp={levelledUp} medalIds={[]} medalName={String} />);
    expect(screen.getByTestId('results-level')).toHaveTextContent('Level 1');
    expect(screen.getByTestId('results-level-fill').style.width).toBe('20%');
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.getByTestId('results-level-fill').style.width).toBe('100%');
    expect(screen.queryByTestId('results-level-up')).toBeNull();
    act(() => { vi.advanceTimersByTime(1100); });
    expect(screen.getByTestId('results-level')).toHaveTextContent('Level 3');
    expect(screen.getByTestId('results-level-up')).toBeInTheDocument();
    expect(screen.getByTestId('results-level-fill').style.width).toBe('12.4%');
  });

  it('shows the friend-streak bonus with the gold', () => {
    render(<ResultsRewards xp={sameLevel} medalIds={[]} medalName={String} gold={{ awarded: 22, multiplier: 1, winStreak: 1, friendStreakPercent: 10 }} />);
    expect(screen.getByTestId('results-friend-streak')).toHaveTextContent('+10% friend streak bonus');
  });

  it('falls back to the game\'s XP when the server sent no summary', () => {
    render(<ResultsRewards xpEarned={105} medalIds={['conqueror']} medalName={(id) => names[id]!} />);
    expect(screen.queryByTestId('results-level')).toBeNull();
    expect(screen.getByText('+105 XP')).toBeInTheDocument();
    expect(screen.getByTestId('results-medals')).toHaveTextContent('Conqueror');
  });
});
