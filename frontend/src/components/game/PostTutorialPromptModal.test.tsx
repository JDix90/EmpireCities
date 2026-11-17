import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PostTutorialPromptModal from './PostTutorialPromptModal';
import { POST_TUTORIAL_MATCH_LINE } from '../../utils/firstMatch';

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

  it('says three AI opponents for the old solo game, and the line it is given otherwise', () => {
    const { unmount } = render(<PostTutorialPromptModal onStartSolo={vi.fn()} onBackToLobby={vi.fn()} />);
    expect(screen.getByText(/Three AI opponents are standing by/)).toBeInTheDocument();
    unmount();

    // tutorial_wrapup_to_match_enabled: Start leads to the lobby's Quick Match (the first match for a newcomer).
    render(<PostTutorialPromptModal onStartSolo={vi.fn()} onBackToLobby={vi.fn()} line={POST_TUTORIAL_MATCH_LINE} />);
    expect(screen.getByText(POST_TUTORIAL_MATCH_LINE)).toBeInTheDocument();
    expect(screen.queryByText(/Three AI opponents/)).not.toBeInTheDocument();
  });
});
