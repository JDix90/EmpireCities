/**
 * A guest deletes their own account (guest_account_deletion_enabled): the
 * profile's form asks a guest for their name, not a password, and signs them
 * out after; Settings → Account links to it. Off, a guest sees no form (the
 * server would refuse it), and accounts are as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ProfilePage from './ProfilePage';
import SettingsPage from './SettingsPage';
import { useAuthStore } from '../store/authStore';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

const getMock = vi.hoisted(() => vi.fn());
const deleteMock = vi.hoisted(() => vi.fn(async () => ({ data: { message: 'Account deleted' } })));
vi.mock('../services/api', () => ({
  api: { get: (...a: unknown[]) => getMock(...a), post: vi.fn(), put: vi.fn(), delete: deleteMock },
}));
vi.mock('../components/settings/NotificationPreferences', () => ({ default: () => <div /> }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const setFlag = (on: boolean) =>
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, guest_account_deletion_enabled: on } }));

const logout = vi.fn(async () => {});

function renderOwnProfile(isGuest: boolean) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/users/me') {
      return { data: { user_id: 'me', username: 'BraveOtter_123', level: 2, xp: 120, mmr: 1000, created_at: '2026-11-01T00:00:00.000Z', ratings: {}, is_guest: isGuest } };
    }
    if (url === '/users/me/stats') {
      const bucket = { played: 0, won: 0, win_rate: 0 };
      return { data: { overall: bucket, solo: bucket, multi: bucket, hybrid: bucket, by_era: {}, streaks: { current_win: 0, best_win: 0 }, favorite_era: null } };
    }
    if (url === '/users/me/achievements/progress') return { data: {} };
    // An account's profile shows its referral panel.
    if (url === '/progression/referral') return { data: { code: 'ABC123', referrals: [] } };
    return { data: [] };
  });
  useAuthStore.setState({ user: { user_id: 'me', username: 'BraveOtter_123', is_guest: isGuest } as never, isAuthenticated: true, logout } as never);
  return render(
    <MemoryRouter initialEntries={['/profile']}>
      <Routes>
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/" element={<p>home page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('a guest deleting their account', () => {
  beforeEach(() => {
    getMock.mockReset();
    deleteMock.mockClear();
    logout.mockClear();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    setFlag(true);
  });
  afterEach(() => setFlag(false));

  it('asks a guest for their name, deletes, signs out and goes home', async () => {
    renderOwnProfile(true);
    const card = await screen.findByTestId('delete-account');
    expect(card).toHaveTextContent(/guest account \(your name, games, ratings and progress\)/);
    expect(card).toHaveTextContent('Confirm with your username');
    const field = screen.getByPlaceholderText('BraveOtter_123');
    expect(field).toHaveAttribute('type', 'text');
    fireEvent.change(field, { target: { value: 'BraveOtter_123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('/users/me', { data: { confirm_username: 'BraveOtter_123' } }));
    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(await screen.findByText('home page')).toBeInTheDocument();
  });

  it('shows a guest no form with the switch off, and an account its password form either way', async () => {
    setFlag(false);
    const { unmount } = renderOwnProfile(true);
    // Loaded: the page shows Recent Games, which sits below where the form would be.
    expect(await screen.findByText('Recent Games')).toBeInTheDocument();
    expect(screen.queryByTestId('delete-account')).toBeNull();
    unmount();

    renderOwnProfile(false);
    const card = await screen.findByTestId('delete-account');
    expect(card).toHaveTextContent('Confirm with password');
    expect(card).toHaveTextContent('Permanently remove your account and sign out.');
  });

  it('links to it from Settings → Account, for a guest and an account, only with the switch on', () => {
    getMock.mockResolvedValue({ data: {} });
    for (const isGuest of [true, false]) {
      useAuthStore.setState({ user: { user_id: 'me', username: 'BraveOtter_123', is_guest: isGuest } as never, isAuthenticated: true } as never);
      const { unmount } = render(<MemoryRouter><SettingsPage /></MemoryRouter>);
      expect(screen.getByTestId('settings-delete-account')).toHaveAttribute('href', '/profile#delete-account');
      unmount();
    }
    setFlag(false);
    render(<MemoryRouter><SettingsPage /></MemoryRouter>);
    expect(screen.queryByTestId('settings-delete-account')).toBeNull();
  });
});
