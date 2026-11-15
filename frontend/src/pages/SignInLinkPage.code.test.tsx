/**
 * The code in a sign-in email (sign_in_code_enabled): once a link has been
 * requested, the page also takes the code the email shows. For a player whose
 * link opens somewhere other than where they are playing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SignInLinkPage from './SignInLinkPage';
import { useAuthStore } from '../store/authStore';
import { useFeatureFlagsStore } from '../store/featureFlagsStore';

const postMock = vi.fn();
vi.mock('../services/api', () => ({ api: { post: (...a: unknown[]) => postMock(...a), get: vi.fn() } }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const signInWithCode = vi.fn();

function setFlags(codes: boolean) {
  useFeatureFlagsStore.setState((s) => ({
    loaded: true,
    flags: { ...s.flags, email_account_save_enabled: true, sign_in_code_enabled: codes },
  }));
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/sign-in-link']}>
      <Routes>
        <Route path="/sign-in-link" element={<SignInLinkPage />} />
        <Route path="/lobby" element={<p>Lobby</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function requestLink(email = ' Player@Example.com ') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
  await screen.findByTestId('sign-in-link-sent');
}

function axiosError(status: number, data: unknown) {
  return Object.assign(new Error('request failed'), { isAxiosError: true, response: { status, data } });
}

describe('SignInLinkPage: the code', () => {
  beforeEach(() => {
    postMock.mockReset().mockResolvedValue({ data: {} });
    signInWithCode.mockReset().mockResolvedValue(undefined);
    useAuthStore.setState({ signInWithCode } as never);
  });

  it('is not asked for before a link has been requested', async () => {
    setFlags(true);
    renderPage();
    expect(screen.queryByTestId('sign-in-code-form')).toBeNull();
  });

  it('with the flag off, the page after requesting a link is what it was', async () => {
    setFlags(false);
    renderPage();
    await requestLink();
    expect(screen.queryByTestId('sign-in-code-form')).toBeNull();
    expect(screen.getByTestId('sign-in-link-sent')).toHaveTextContent('we sent a sign-in link');
  });

  it('signs in with the address the link was sent to and the code typed', async () => {
    setFlags(true);
    renderPage();
    await requestLink();
    const submit = screen.getByRole('button', { name: 'Sign in with the code' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Code from the email'), { target: { value: 'abcd-efgh' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await screen.findByText('Lobby');
    // The same address, normalized the same way as the request for the link.
    expect(postMock).toHaveBeenCalledWith('/auth/sign-in-link', { email: 'player@example.com' });
    expect(signInWithCode).toHaveBeenCalledWith('player@example.com', 'abcd-efgh');
  });

  it('says what the server says when the code is wrong, and stays on the page', async () => {
    setFlags(true);
    signInWithCode.mockRejectedValue(axiosError(400, { error: 'That code did not work. Check it against the email, or request a new one.' }));
    renderPage();
    await requestLink();
    fireEvent.change(screen.getByLabelText('Code from the email'), { target: { value: 'ZZZZ-ZZZZ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with the code' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code did not work');
    expect(screen.queryByText('Lobby')).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in with the code' })).toBeEnabled());
  });

  it('offers to send a new email, which goes back to the address form', async () => {
    setFlags(true);
    renderPage();
    await requestLink();
    fireEvent.click(screen.getByRole('button', { name: 'Send a new email' }));
    expect(screen.getByRole('button', { name: 'Email me a sign-in link' })).toBeInTheDocument();
    // The address is still there to send to again.
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('Player@Example.com');
  });
});
