/**
 * PushOptInBanner: the lobby's one-click offer of browser notifications.
 *
 * It must appear only when a click can lead somewhere (registered account,
 * configured build, permission never asked, an async game to announce), do
 * the asking inside the click, and stay away for 30 days after "Not now".
 * The iPhone-tab variant gives Home Screen advice instead of a button that
 * could not work there.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PushOptInBanner, { PUSH_NUDGE_SNOOZE_MS } from './PushOptInBanner';
import { useAuthStore } from '../../store/authStore';
import { getPushNudgeDismissedAt, markPushNudgeDismissed } from '../../utils/userPreferences';

const push = vi.hoisted(() => ({
  status: 'default' as string,
  homeScreen: false,
  enable: vi.fn(),
}));
vi.mock('../../services/pushNotifications', () => ({
  getWebPushStatus: () => push.status,
  needsHomeScreenInstall: () => push.homeScreen,
  enableWebPush: () => push.enable(),
}));
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toastMock }));

function signIn(isGuest = false) {
  useAuthStore.setState({
    isAuthenticated: true,
    user: { user_id: 'u1', username: 'u1', is_guest: isGuest } as never,
  });
}

describe('PushOptInBanner', () => {
  beforeEach(() => {
    localStorage.clear();
    push.status = 'default';
    push.homeScreen = false;
    push.enable.mockReset().mockResolvedValue('granted');
    toastMock.success.mockReset();
    toastMock.error.mockReset();
    signIn();
  });

  it('offers to turn on notifications to a registered player with an async game', () => {
    render(<PushOptInBanner hasAsyncGames />);
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeInTheDocument();
  });

  it('asks inside the click and thanks the player once granted', async () => {
    render(<PushOptInBanner hasAsyncGames />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(push.enable).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    expect(screen.queryByRole('region', { name: 'Turn notifications' })).not.toBeInTheDocument();
  });

  it('explains a refusal and goes away — the browser will not ask twice', async () => {
    push.enable.mockResolvedValue('denied');
    render(<PushOptInBanner hasAsyncGames />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Turn on' })).not.toBeInTheDocument();
  });

  it('stays after a dismissed prompt, so it can be asked again', async () => {
    push.enable.mockResolvedValue('default');
    render(<PushOptInBanner hasAsyncGames />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(push.enable).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: 'Turn on' })).toBeInTheDocument();
  });

  it('"Not now" hides it and remembers that for 30 days', () => {
    const { unmount } = render(<PushOptInBanner hasAsyncGames />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('region', { name: 'Turn notifications' })).not.toBeInTheDocument();
    unmount();

    render(<PushOptInBanner hasAsyncGames />);
    expect(screen.queryByRole('region', { name: 'Turn notifications' })).not.toBeInTheDocument();

    // The snooze expires.
    markPushNudgeDismissed(Date.now() - PUSH_NUDGE_SNOOZE_MS - 1);
    render(<PushOptInBanner hasAsyncGames />);
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeInTheDocument();
  });

  it('reads a corrupted or future dismissal as never dismissed', () => {
    localStorage.setItem('cc-push-nudge-dismissed-at', 'yesterday');
    expect(getPushNudgeDismissedAt()).toBeNull();
    localStorage.setItem('cc-push-nudge-dismissed-at', String(Date.now() + 3_600_000));
    expect(getPushNudgeDismissedAt()).toBeNull();
    render(<PushOptInBanner hasAsyncGames />);
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeInTheDocument();
  });

  it.each([
    ['no async game', () => {}, false],
    ['permission already granted', () => { push.status = 'granted'; }, true],
    ['permission already refused', () => { push.status = 'denied'; }, true],
    ['a build without Firebase', () => { push.status = 'unconfigured'; }, true],
    ['a browser without push that is not an iPhone tab', () => { push.status = 'unsupported'; }, true],
  ])('renders nothing for %s', (_label, arrange, hasAsyncGames) => {
    arrange();
    render(<PushOptInBanner hasAsyncGames={hasAsyncGames} />);
    expect(screen.queryByRole('region', { name: 'Turn notifications' })).not.toBeInTheDocument();
  });

  it('offers it to a guest as well — a browser token needs no email', () => {
    signIn(true);
    render(<PushOptInBanner hasAsyncGames />);
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeInTheDocument();
  });

  it('gives Home Screen advice instead of a button in an iPhone browser tab', () => {
    push.status = 'unsupported';
    push.homeScreen = true;
    render(<PushOptInBanner hasAsyncGames />);
    expect(screen.getByText(/Add Borderfall to your Home Screen/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('region', { name: 'Turn notifications' })).not.toBeInTheDocument();
  });
});
