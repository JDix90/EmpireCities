/**
 * Save your account with just an email (email_account_save_enabled): the email
 * is all a guest must give. Their name is filled in and kept unless changed,
 * and a password is optional.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SaveWithEmailForm from './SaveWithEmailForm';
import { useAuthStore } from '../../store/authStore';

const toastSuccess = vi.hoisted(() => vi.fn());
vi.mock('react-hot-toast', () => ({ default: { success: toastSuccess, error: vi.fn() } }));

const upgradeAccount = vi.fn();

function renderForm(onDone = vi.fn()) {
  render(
    <MemoryRouter>
      <SaveWithEmailForm onDone={onDone} />
    </MemoryRouter>,
  );
  return onDone;
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Save my account' }));

/** An axios-shaped rejection: `axios.isAxiosError` keys off this flag. */
function axiosError(status: number, data: unknown) {
  return Object.assign(new Error('request failed'), { isAxiosError: true, response: { status, data } });
}

describe('SaveWithEmailForm', () => {
  beforeEach(() => {
    upgradeAccount.mockReset().mockResolvedValue(undefined);
    toastSuccess.mockReset();
    useAuthStore.setState({
      user: { user_id: 'g1', username: 'SwiftFalcon_48213', is_guest: true } as never,
      upgradeAccount,
      isLoading: false,
    } as never);
  });

  it('saves with just an email, keeping the guest\'s name, and says where it lives', async () => {
    const onDone = renderForm();
    expect(screen.getByLabelText('Commander name')).toHaveValue('SwiftFalcon_48213');
    expect(screen.queryByLabelText('Password')).toBeNull();

    type('Email address', ' Ada@Example.com ');
    submit();

    await waitFor(() => expect(upgradeAccount).toHaveBeenCalledWith(undefined, 'ada@example.com', undefined, false));
    // The page leaves at once (the account is no longer a guest's), so a toast says where it lives.
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith(
      'Account saved to ada@example.com. To play on another device, choose “Email me a sign-in link” when you sign in.',
      // overflowWrap: a long address must wrap inside a phone-width toast.
      { duration: 8000, style: { overflowWrap: 'anywhere' } },
    );
  });

  it('sends a changed name and an optional password', async () => {
    renderForm();
    type('Email address', 'ada@example.com');
    type('Commander name', 'Ada_Lovelace');
    fireEvent.click(screen.getByRole('button', { name: /Add a password/ }));
    type('Password', 'Fortress!Wall72');
    type('Confirm password', 'Fortress!Wall72');
    submit();

    await waitFor(() =>
      expect(upgradeAccount).toHaveBeenCalledWith('Ada_Lovelace', 'ada@example.com', 'Fortress!Wall72', false));
  });

  it('asks for an email, and for matching passwords when one is given', () => {
    renderForm();
    submit();
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument();

    type('Email address', 'ada@example.com');
    fireEvent.click(screen.getByRole('button', { name: /Add a password/ }));
    type('Password', 'Fortress!Wall72');
    type('Confirm password', 'Fortress!Wall73');
    submit();
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    expect(upgradeAccount).not.toHaveBeenCalled();
  });

  it('puts an address at its account limit under the email field', async () => {
    upgradeAccount.mockRejectedValueOnce(axiosError(409, { error: 'That email address already has 5 accounts.' }));
    renderForm();
    type('Email address', 'ada@example.com');
    submit();
    expect(await screen.findByText('That email address already has 5 accounts.')).toBeInTheDocument();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
