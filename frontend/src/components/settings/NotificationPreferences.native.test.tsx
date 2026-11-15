/**
 * Settings → Notifications in the native app. The row that is "This browser"
 * on the website is the device's own permission there: it reads once the app
 * has checked, asks through the system's prompt, and points at the Settings
 * app when the player has refused.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const getMock = vi.fn();
const putMock = vi.fn();
vi.mock('../../services/api', () => ({
  api: { get: (...a: unknown[]) => getMock(...a), put: (...a: unknown[]) => putMock(...a), post: vi.fn() },
}));
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toastMock }));

const push = vi.hoisted(() => ({
  status: 'unsupported' as string,
  enable: vi.fn(),
  listeners: new Set<() => void>(),
}));
vi.mock('../../services/pushNotifications', () => ({
  getWebPushStatus: () => push.status,
  // Never a Home Screen matter in the installed app.
  needsHomeScreenInstall: () => false,
  enableWebPush: () => push.enable(),
  isNativePush: () => true,
  pushBlockedMessage: () => 'Notifications are off for Borderfall. Turn them on in the Settings app, under Notifications.',
  subscribePushStatus: (cb: () => void) => {
    push.listeners.add(cb);
    return () => push.listeners.delete(cb);
  },
}));

import NotificationPreferences from './NotificationPreferences';

/** The app finishing its check of the system's permission. */
function learn(status: string) {
  act(() => {
    push.status = status;
    for (const cb of push.listeners) cb();
  });
}

async function renderPrefs() {
  render(<NotificationPreferences />);
  await screen.findByText('Push Notifications');
}

beforeEach(() => {
  getMock.mockReset().mockResolvedValue({ data: { push_enabled: true, email_notifications: false, turn_emails_enabled: true } });
  putMock.mockReset().mockResolvedValue({ data: {} });
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  push.status = 'unsupported';
  push.enable.mockReset();
  push.listeners.clear();
});

describe('NotificationPreferences in the native app', () => {
  it('offers nothing until the permission is known, and never Home Screen advice', async () => {
    await renderPrefs();
    expect(screen.queryByText('This device')).toBeNull();
    expect(screen.queryByText(/Home Screen/)).toBeNull();
    expect(screen.queryByText('This browser')).toBeNull();
  });

  it('shows the device row once the app has checked, even though it drew first', async () => {
    await renderPrefs();
    learn('default');
    expect(screen.getByText('This device')).toBeInTheDocument();
    expect(screen.getByText(/even with the app closed/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeInTheDocument();
    expect(screen.queryByText('This browser')).toBeNull();
  });

  it('turns on through the system prompt and says so in the app\'s words', async () => {
    push.enable.mockResolvedValue('granted');
    await renderPrefs();
    learn('default');
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByText('On')).toBeInTheDocument();
    expect(toastMock.success).toHaveBeenCalledWith('Notifications are on for this device');
  });

  it('points at the Settings app when the player refused', async () => {
    await renderPrefs();
    learn('denied');
    expect(screen.getByText('Off. Turn notifications on for Borderfall in the Settings app, under Notifications.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull();
  });
});
