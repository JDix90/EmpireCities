/**
 * Sign in with an emailed link (email_account_save_enabled). Without a token
 * the page sends a link; with one it redeems it once and goes to the lobby.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SignInLinkPage from './SignInLinkPage';
import { useAuthStore } from '../store/authStore';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

const postMock = vi.fn();
vi.mock('../services/api', () => ({ api: { post: (...a: unknown[]) => postMock(...a), get: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const signInWithLink = vi.fn();

function setFlag(on: boolean) {
  useFeatureFlagsStore.setState((s) => ({ loaded: true, flags: { ...s.flags, email_account_save_enabled: on } }));
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sign-in-link" element={<SignInLinkPage />} />
        <Route path="/lobby" element={<p>Lobby</p>} />
        <Route path="/login" element={<p>Password sign-in</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** An axios-shaped rejection: `axios.isAxiosError` keys off this flag. */
function axiosError(status: number, data: unknown) {
  return Object.assign(new Error('request failed'), { isAxiosError: true, response: { status, data } });
}

describe('SignInLinkPage', () => {
  beforeEach(() => {
    postMock.mockReset().mockResolvedValue({ data: {} });
    signInWithLink.mockReset().mockResolvedValue(undefined);
    useAuthStore.setState({ signInWithLink } as never);
    setFlag(true);
  });
  afterEach(() => setFlag(false));

  it('emails a sign-in link for the address given', async () => {
    renderAt('/sign-in-link');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: ' Ada@Example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/auth/sign-in-link', { email: 'ada@example.com' }));
    expect(await screen.findByTestId('sign-in-link-sent')).toHaveTextContent('expires in 30 minutes');
  });

  it('redeems the link once and goes to the lobby', async () => {
    renderAt('/sign-in-link?token=abc123');
    expect(await screen.findByText('Lobby')).toBeInTheDocument();
    expect(signInWithLink).toHaveBeenCalledTimes(1);
    expect(signInWithLink).toHaveBeenCalledWith('abc123');
  });

  it('says a spent link is spent and offers a new one', async () => {
    signInWithLink.mockRejectedValueOnce(
      axiosError(400, { error: 'This sign-in link has expired or was already used. Request a new one.' }),
    );
    renderAt('/sign-in-link?token=spent');
    expect(await screen.findByRole('alert')).toHaveTextContent('expired or was already used');
    expect(screen.getByRole('button', { name: 'Email me a sign-in link' })).toBeInTheDocument();
  });

  it('is the password sign-in with the flag off', async () => {
    setFlag(false);
    renderAt('/sign-in-link?token=abc123');
    expect(await screen.findByText('Password sign-in')).toBeInTheDocument();
    expect(signInWithLink).not.toHaveBeenCalled();
  });
});
