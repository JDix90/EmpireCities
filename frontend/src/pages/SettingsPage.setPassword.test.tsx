/**
 * An account saved with just an email (email_account_save_enabled) has no
 * password to change, so Settings offers to set one, without the current one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SettingsPage from './SettingsPage';
import { useAuthStore } from '../store/authStore';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

const postMock = vi.fn();
vi.mock('../services/api', () => ({
  api: { get: vi.fn().mockResolvedValue({ data: {} }), put: vi.fn(), post: (...a: unknown[]) => postMock(...a) },
}));
vi.mock('../components/settings/NotificationPreferences', () => ({ default: () => <div /> }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const setFlag = (on: boolean) =>
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, email_account_save_enabled: on } }));

function renderAs(hasPassword: boolean | undefined) {
  useAuthStore.setState({
    user: { user_id: 'u1', username: 'commander', is_guest: false, has_password: hasPassword } as never,
    isAuthenticated: true,
    refreshUser: vi.fn().mockResolvedValue(undefined),
  } as never);
  render(<MemoryRouter><SettingsPage /></MemoryRouter>);
}

describe('SettingsPage — set a password', () => {
  beforeEach(() => {
    postMock.mockReset().mockResolvedValue({ data: {} });
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    setFlag(true);
  });
  afterEach(() => setFlag(false));

  it('sets a first password without asking for a current one', async () => {
    renderAs(false);
    fireEvent.click(screen.getByRole('button', { name: /Set a password/ }));
    expect(screen.queryByPlaceholderText('Current password')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('New password (min 8 characters)'), { target: { value: 'Fortress!Wall72' } });
    fireEvent.change(screen.getByPlaceholderText('Confirm new password'), { target: { value: 'Fortress!Wall72' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set password' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/auth/set-password', { new_password: 'Fortress!Wall72' }));
  });

  it('keeps Change password for an account that has one', () => {
    renderAs(undefined);
    fireEvent.click(screen.getByRole('button', { name: /Change password/ }));
    expect(screen.getByPlaceholderText('Current password')).toBeInTheDocument();
  });
});
