/**
 * Signing in when one email holds several accounts.
 *
 * The server refuses to guess when the submitted password opens more than one
 * account on the address (409 + `code: 'choose_account'`), so the page has to
 * turn that refusal into a choice. The picker re-runs an ordinary login with a
 * username — no ticket, no second credential type — which is what these tests
 * pin down.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from './LoginPage';

const login = vi.fn();
vi.mock('../store/authStore', () => ({
  useAuthStore: () => ({ login, isLoading: false }),
}));

const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...args: unknown[]) => toastError(...args) },
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

/** An axios-shaped rejection: `axios.isAxiosError` keys off this flag. */
function axiosError(status: number, data: unknown) {
  return Object.assign(new Error('request failed'), {
    isAxiosError: true,
    response: { status, data },
  });
}

const identifierField = () => screen.getByPlaceholderText(/commander@example.com/i);

function signIn(identifier: string, password: string) {
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
  fireEvent.change(identifierField(), { target: { value: identifier } });
  fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
}

describe('LoginPage account picker', () => {
  beforeEach(() => {
    login.mockReset();
    toastError.mockReset();
    navigate.mockReset();
  });

  it('offers the accounts the password unlocked instead of an error toast', async () => {
    login.mockRejectedValueOnce(
      axiosError(409, {
        code: 'choose_account',
        error: 'That email has more than one account with this password.',
        usernames: ['first_run', 'second_run'],
      }),
    );

    signIn('commander@example.com', 'Fortress!Wall72');

    await waitFor(() => expect(screen.getByText('Choose an account')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Continue as first_run' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue as second_run' })).toBeInTheDocument();
    // The 409 is a question, not a failure — no red toast for it.
    expect(toastError).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('signs in with the chosen username and the password already entered', async () => {
    login.mockRejectedValueOnce(
      axiosError(409, { code: 'choose_account', usernames: ['first_run', 'second_run'] }),
    );
    login.mockResolvedValueOnce(undefined);

    signIn('commander@example.com', 'Fortress!Wall72');
    await waitFor(() => expect(screen.getByText('Choose an account')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Continue as second_run' }));

    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(login).toHaveBeenLastCalledWith('second_run', 'Fortress!Wall72');
  });

  it('still surfaces an ordinary rejection as an error', async () => {
    login.mockRejectedValueOnce(axiosError(401, { error: 'Invalid email or password' }));

    signIn('commander@example.com', 'wrong-password');

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Invalid email or password'));
    expect(screen.queryByText('Choose an account')).not.toBeInTheDocument();
  });

  it('drops the picker when the credentials change under it', async () => {
    login.mockRejectedValueOnce(
      axiosError(409, { code: 'choose_account', usernames: ['first_run', 'second_run'] }),
    );

    signIn('commander@example.com', 'Fortress!Wall72');
    await waitFor(() => expect(screen.getByText('Choose an account')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Use different details/ }));
    fireEvent.change(identifierField(), { target: { value: 'commander@example.co' } });
    expect(screen.queryByText('Choose an account')).not.toBeInTheDocument();
  });
});
