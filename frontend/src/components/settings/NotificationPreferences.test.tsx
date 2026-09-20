/**
 * NotificationPreferences: turn reminders and marketing are separate switches.
 *
 * One toggle used to drive `email_notifications` while describing itself as
 * "Receive an email when it's your turn in async games" — the same column the
 * signup checkbox ("streak reminders and comeback bonuses") writes. Declining
 * marketing at signup therefore silently declined turn alerts. Migration 041
 * split them; this pins that the UI shows both honestly and saves each on its
 * own.
 *
 * The "This browser" row is the browser's own permission, distinct from the
 * account-level push toggle: it appears only on a build with Firebase, asks
 * inside the click (enableWebPush), and on an iPhone tab gives Home Screen
 * advice instead of a button that could not work there.
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
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
const push = vi.hoisted(() => ({
  status: 'unconfigured' as string,
  homeScreen: false,
  enable: vi.fn(),
}));
vi.mock('../../services/pushNotifications', () => ({
  getWebPushStatus: () => push.status,
  needsHomeScreenInstall: () => push.homeScreen,
  enableWebPush: () => push.enable(),
}));

const checkbox = (name: string) => screen.findByRole('checkbox', { name }) as Promise<HTMLInputElement>;

describe('NotificationPreferences', () => {
  beforeEach(() => {
    apiGet.mockReset().mockResolvedValue({
      data: { push_enabled: true, email_notifications: false, turn_emails_enabled: true },
    });
    apiPut.mockReset().mockResolvedValue({ data: { ok: true } });
    push.status = 'unconfigured';
    push.homeScreen = false;
    push.enable.mockReset().mockResolvedValue('granted');
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

  describe('the "This browser" row', () => {
    const row = () => screen.queryByText('This browser');

    it('does not exist on a build without Firebase', async () => {
      render(<NotificationPreferences embedded />);
      await checkbox('Turn reminders');
      expect(row()).not.toBeInTheDocument();
    });

    it('offers a Turn on button that asks inside the click and then reads On', async () => {
      push.status = 'default';
      render(<NotificationPreferences embedded />);
      fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
      expect(push.enable).toHaveBeenCalledTimes(1);
      expect(await screen.findByText('On')).toBeInTheDocument();
      // Account-level push was already on: nothing to save.
      expect(apiPut).not.toHaveBeenCalled();
    });

    it('turns the account-level switch back on when a browser opts in while it is off', async () => {
      push.status = 'default';
      apiGet.mockResolvedValue({ data: { push_enabled: false, email_notifications: false, turn_emails_enabled: true } });
      render(<NotificationPreferences embedded />);
      fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
      await waitFor(() => expect(apiPut).toHaveBeenCalledWith('/users/me/preferences', { push_enabled: true }));
      expect((await checkbox('Push Notifications')).checked).toBe(true);
    });

    it('shows Blocked with no button once the player has refused', async () => {
      push.status = 'denied';
      render(<NotificationPreferences embedded />);
      expect(await screen.findByText('Blocked')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Turn on' })).not.toBeInTheDocument();
    });

    it('reads a refusal from the prompt itself as Blocked', async () => {
      push.status = 'default';
      push.enable.mockResolvedValue('denied');
      render(<NotificationPreferences embedded />);
      fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
      expect(await screen.findByText('Blocked')).toBeInTheDocument();
    });

    it('gives Home Screen advice on an iPhone tab and nothing on other unsupported browsers', async () => {
      push.status = 'unsupported';
      push.homeScreen = true;
      const { unmount } = render(<NotificationPreferences embedded />);
      expect(await screen.findByText('This iPhone or iPad')).toBeInTheDocument();
      unmount();
      push.homeScreen = false;
      render(<NotificationPreferences embedded />);
      await checkbox('Turn reminders');
      expect(screen.queryByText('This iPhone or iPad')).not.toBeInTheDocument();
      expect(row()).not.toBeInTheDocument();
    });
  });
});

