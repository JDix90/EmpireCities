/**
 * The Getting Started banner: the quest the lobby picked for this player
 * (lobby_cleanup_enabled), with where to do it, or the fixed chain without one.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import OnboardingBanner from './OnboardingBanner';
import { nextQuest } from '../../utils/questOrder';

describe('OnboardingBanner', () => {
  it('shows the picked quest, its place among the player\'s quests, and where to do it', () => {
    const pick = nextQuest([{ quest_id: 'first_win', completed_at: '2026-11-01' }], true);
    render(<OnboardingBanner stage={1} pick={pick} />);
    expect(screen.getByText('Getting Started — 2/3')).toBeInTheDocument();
    expect(screen.getByText('Master Builder')).toBeInTheDocument();
    expect(screen.getByTestId('quest-where')).toHaveTextContent('start a Full Game');
  });

  it('shows nothing when the player has nothing left they can do', () => {
    const { container } = render(<OnboardingBanner stage={1} pick={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is the fixed chain without a pick', () => {
    render(<OnboardingBanner stage={1} />);
    expect(screen.getByText('Getting Started — 2/6')).toBeInTheDocument();
    expect(screen.queryByTestId('quest-where')).toBeNull();
  });
});
