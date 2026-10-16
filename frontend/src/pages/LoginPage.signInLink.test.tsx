/**
 * The way back in for an account saved with just an email: with
 * email_account_save_enabled the sign-in page offers an emailed link.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from './LoginPage';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

vi.mock('../store/authStore', () => ({
  useAuthStore: () => ({ login: vi.fn(), isLoading: false }),
}));

const setFlag = (on: boolean) =>
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, email_account_save_enabled: on } }));

const renderPage = () => render(<MemoryRouter><LoginPage /></MemoryRouter>);

describe('LoginPage sign-in link', () => {
  afterEach(() => setFlag(true));

  it('offers an emailed sign-in link with the flag on', () => {
    setFlag(true);
    renderPage();
    expect(screen.getByRole('link', { name: 'Email me a sign-in link' })).toHaveAttribute('href', '/sign-in-link');
  });

  it('does not with the flag off', () => {
    setFlag(false);
    renderPage();
    expect(screen.queryByRole('link', { name: 'Email me a sign-in link' })).toBeNull();
  });
});
