import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GameEndedNotice from './GameEndedNotice';

function renderNotice(props: Partial<React.ComponentProps<typeof GameEndedNotice>> = {}) {
  const onWatchReplay = vi.fn();
  const onBackToLobby = vi.fn();
  render(
    <MemoryRouter>
      <GameEndedNotice
        abandoned={false}
        onWatchReplay={onWatchReplay}
        onBackToLobby={onBackToLobby}
        {...props}
      />
    </MemoryRouter>,
  );
  return { onWatchReplay, onBackToLobby };
}

describe('GameEndedNotice', () => {
  it('always offers a way off the page', () => {
    // The Pre-Game Room this replaced kept every control inside `{lobby && …}`,
    // so a player returning to a finished game had none at all.
    const { onBackToLobby } = renderNotice();
    fireEvent.click(screen.getByRole('button', { name: /back to lobby/i }));
    expect(onBackToLobby).toHaveBeenCalledTimes(1);
  });

  it('offers the replay for a match that was played out', () => {
    const { onWatchReplay } = renderNotice();
    expect(screen.getByText(/this match has ended/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /watch replay/i }));
    expect(onWatchReplay).toHaveBeenCalledTimes(1);
  });

  it('says so plainly when the match was abandoned', () => {
    renderNotice({ abandoned: true });
    expect(screen.getByText(/this match was abandoned/i)).toBeInTheDocument();
    expect(screen.getByText(/no result to show/i)).toBeInTheDocument();
  });

  it('keeps the wordmark pointing home', () => {
    renderNotice();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/lobby');
  });
});
