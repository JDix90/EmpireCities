import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PostTutorialPromptModal from './PostTutorialPromptModal';

describe('PostTutorialPromptModal', () => {
  it('keeps solo as the primary CTA with no challenge callback', () => {
    const onStartSolo = vi.fn();
    render(
      <PostTutorialPromptModal onStartSolo={onStartSolo} onBackToLobby={vi.fn()} />,
    );
    fireEvent.click(screen.getByText('Start Solo Game'));
    expect(onStartSolo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Challenge a friend/)).not.toBeInTheDocument();
  });

  it('offers the async challenge CTA when the callback is provided', () => {
    const onChallengeFriend = vi.fn();
    render(
      <PostTutorialPromptModal
        onStartSolo={vi.fn()}
        onBackToLobby={vi.fn()}
        onChallengeFriend={onChallengeFriend}
      />,
    );
    fireEvent.click(screen.getByText(/Challenge a friend — play a turn a day/));
    expect(onChallengeFriend).toHaveBeenCalledTimes(1);
    // Solo must remain present and primary
    expect(screen.getByText('Start Solo Game')).toBeInTheDocument();
  });
});
