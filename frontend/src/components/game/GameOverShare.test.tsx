/**
 * Share on the results screen hands out the replay link only once the replay
 * is public. It used to fire make-public and offer the link either way; for a
 * guest the server refused, so the link opened on "This replay isn't public"
 * for whoever received it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const post = vi.hoisted(() => vi.fn());
vi.mock('../../services/api', () => ({ api: { get: vi.fn(async () => ({ data: {} })), post } }));
const generateShareCard = vi.hoisted(() => vi.fn(async () => new Blob(['png'], { type: 'image/png' })));
vi.mock('../../utils/shareCard', () => ({ generateShareCard, buildShareText: () => 'text' }));

import ActionModal, { type GameOverModalData } from './ActionModal';
import { useAuthStore } from '../../store/authStore';

const data = {
  type: 'game_over',
  gameId: 'g1',
  isWinner: true,
  winnerName: 'SwiftFalcon_48213',
  winnerColor: '#c0392b',
  turnCount: 9,
  viewerId: 'me',
  victory_condition: 'threshold',
  players: [
    { player_id: 'me', username: 'SwiftFalcon_48213', color: '#c0392b', territory_count: 10, is_eliminated: false, is_ai: false },
    { player_id: 'ai1', username: 'AI Bot 1', color: '#3498db', territory_count: 4, is_eliminated: false, is_ai: true },
  ],
  xpEarned: 105,
} as GameOverModalData;

async function openShare() {
  render(<MemoryRouter><ActionModal data={data} onDismiss={() => {}} /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'Share' }));
  await screen.findByText('Share Your Result');
}

describe('sharing from the results screen', () => {
  beforeEach(() => {
    post.mockReset();
    generateShareCard.mockClear();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    URL.createObjectURL = vi.fn(() => 'blob:share-card');
    URL.revokeObjectURL = vi.fn();
    useAuthStore.setState({
      user: { user_id: 'me', username: 'SwiftFalcon_48213', level: 2, xp: 250, mmr: 1000, is_guest: true },
      isAuthenticated: true,
    });
  });

  it('offers the replay link once the replay is public', async () => {
    post.mockResolvedValue({ data: { ok: true } });
    await openShare();
    expect(post).toHaveBeenCalledWith('/share/g1/make-public');
    expect(screen.getByTestId('share-replay-link')).toHaveTextContent('/replay/g1');
    expect(screen.queryByTestId('share-no-replay-link')).toBeNull();
    expect(generateShareCard).toHaveBeenCalledWith(expect.objectContaining({
      shareUrl: `${window.location.origin}/replay/g1?source=share`,
    }));
  });

  it('gives a guest no link to a replay that stayed private, and says what would share one', async () => {
    post.mockRejectedValue({ response: { status: 403 } });
    await openShare();
    expect(screen.queryByTestId('share-replay-link')).toBeNull();
    expect(screen.getByTestId('share-no-replay-link')).toHaveTextContent('Save your account to share a link to the replay.');
    // The picture carries the site's address, not the dead replay link.
    expect(generateShareCard).toHaveBeenCalledWith(expect.objectContaining({ shareUrl: window.location.origin }));
  });
});
