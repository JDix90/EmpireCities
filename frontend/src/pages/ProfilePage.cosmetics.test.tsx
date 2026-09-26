import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProfilePage from './ProfilePage';
import { useAuthStore } from '../store/authStore';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

const getMock = vi.fn();
vi.mock('../services/api', () => ({
  api: { get: (...a: unknown[]) => getMock(...a), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

/** Another player's profile, wearing what `worn` says. */
function renderProfileOf(worn: { equipped_frame?: string | null; equipped_banner?: string | null }) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/users/rival') {
      return {
        data: {
          user_id: 'rival', username: 'rival', level: 12, xp: 30000, mmr: 1000,
          created_at: '2025-01-01T00:00:00.000Z', ratings: {}, ...worn,
        },
      };
    }
    return { data: [] };
  });
  useAuthStore.setState({ user: { user_id: 'me', username: 'me', is_guest: false } as never });
  return render(
    <MemoryRouter initialEntries={['/profile/rival']}>
      <Routes>
        <Route path="/profile/:userId" element={<ProfilePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const setStoreV2 = (on: boolean) =>
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, store_v2_enabled: on } }));

describe('ProfilePage cosmetics', () => {
  beforeEach(() => getMock.mockReset());
  // In act: the page is still mounted and re-renders on the flag.
  afterEach(() => act(() => setStoreV2(false)));

  describe('with store_v2_enabled on', () => {
    beforeEach(() => setStoreV2(true));

    it('rings the avatar in any frame and shows the banner beside the name', async () => {
      const { container } = renderProfileOf({ equipped_frame: 'frame_level_50', equipped_banner: 'emperor_title' });

      expect(await screen.findByRole('heading', { name: 'rival' })).toBeInTheDocument();
      expect(container.querySelector('[data-frame="frame_level_50"]')).not.toBeNull();
      expect(screen.getByRole('img', { name: 'Emperor' })).toBeInTheDocument();
    });

    it('shows no ring and no banner when nothing is worn', async () => {
      const { container } = renderProfileOf({ equipped_frame: null, equipped_banner: null });

      expect(await screen.findByRole('heading', { name: 'rival' })).toBeInTheDocument();
      expect(screen.queryByTestId('frame-ring')).not.toBeInTheDocument();
      expect(container.querySelector('[data-banner]')).toBeNull();
    });
  });

  describe('with store_v2_enabled off', () => {
    beforeEach(() => setStoreV2(false));

    it('draws the four rings it always has, and nothing else', async () => {
      // The avatar's wrapper, which carries the ring's gradient classes.
      const ringOf = (container: HTMLElement) => container.querySelector('.p-1.rounded-full.shrink-0');

      const { container, unmount } = renderProfileOf({ equipped_frame: 'frame_gold' });
      expect(await screen.findByRole('heading', { name: 'rival' })).toBeInTheDocument();
      expect(ringOf(container)).toHaveClass('bg-gradient-to-r', 'from-yellow-500');
      unmount();

      const other = renderProfileOf({ equipped_frame: 'frame_level_50', equipped_banner: 'emperor_title' });
      expect(await screen.findByRole('heading', { name: 'rival' })).toBeInTheDocument();
      expect(ringOf(other.container)).not.toBeNull();
      expect(ringOf(other.container)).not.toHaveClass('bg-gradient-to-r');
      expect(other.container.querySelector('[data-frame]')).toBeNull();
      expect(screen.queryByRole('img', { name: 'Emperor' })).not.toBeInTheDocument();
    });
  });
});
