/**
 * NotificationPreferences: turn reminders and marketing are separate switches.
 *
 * One toggle used to drive `email_notifications` while describing itself as
 * "Receive an email when it's your turn in async games" — the same column the
 * signup checkbox ("streak reminders and comeback bonuses") writes. Declining
 * marketing at signup therefore silently declined turn alerts. Migration 041
 * split them; this pins that the UI shows both honestly and saves each on its
 * own.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NotificationPreferences from './NotificationPreferences';

const apiGet = vi.fn();
const apiPut = vi.fn();
vi.mock('../../services/api', () => ({
  api: {
    get: (...args: unknown[]) => apiGet(...args),
    put: (...args: unknown[]) => apiPut(...args),
  },
}));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn() }) }));

const checkbox = (name: string) => screen.findByRole('checkbox', { name }) as Promise<HTMLInputElement>;

describe('NotificationPreferences', () => {
  beforeEach(() => {
    apiGet.mockReset().mockResolvedValue({
      data: { push_enabled: true, email_notifications: false, turn_emails_enabled: true },
    });
    apiPut.mockReset().mockResolvedValue({ data: { ok: true } });
  });

  it('shows turn reminders and marketing as two switches, each reflecting its own preference', async () => {
    render(<NotificationPreferences embedded />);
    const turn = await checkbox('Turn reminders');
    const marketing = await checkbox('Streak reminders & comeback bonuses');
    // A fresh account: transactional on, marketing off — the column defaults.
    expect(turn.checked).toBe(true);
    expect(marketing.checked).toBe(false);
  });

  it('turning turn reminders off saves only that switch', async () => {
    render(<NotificationPreferences embedded />);
    fireEvent.click(await checkbox('Turn reminders'));
    await waitFor(() =>
      expect(apiPut).toHaveBeenCalledWith('/users/me/preferences', { turn_emails_enabled: false }),
    );
    expect(apiPut).not.toHaveBeenCalledWith(
      '/users/me/preferences',
      expect.objectContaining({ email_notifications: expect.anything() }),
    );
  });

  it('opting into marketing does not touch turn reminders', async () => {
    render(<NotificationPreferences embedded />);
    fireEvent.click(await checkbox('Streak reminders & comeback bonuses'));
    await waitFor(() =>
      expect(apiPut).toHaveBeenCalledWith('/users/me/preferences', { email_notifications: true }),
    );
    expect(apiPut).toHaveBeenCalledTimes(1);
  });

  it('reads a server that predates the column as turn reminders on', async () => {
    apiGet.mockResolvedValue({ data: { push_enabled: true, email_notifications: false } });
    render(<NotificationPreferences embedded />);
    expect((await checkbox('Turn reminders')).checked).toBe(true);
  });
});
