import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ChallengeFriendModal from './ChallengeFriendModal';

const post = vi.hoisted(() => vi.fn());
vi.mock('../../services/api', () => ({ api: { post } }));

describe('ChallengeFriendModal', () => {
  it("creates a private game, so Open Games never offers the friend's seat", async () => {
    post.mockResolvedValue({ data: { game_id: 'g1', join_code: 'ABCD' } });
    render(
      <MemoryRouter>
        <ChallengeFriendModal open onClose={() => {}} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /create challenge/i }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith('/games', expect.objectContaining({
      is_private: true,
      max_players: 2,
      ai_count: 0,
    }));
  });
});
