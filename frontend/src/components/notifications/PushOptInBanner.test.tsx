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
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';

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

describe('PushOptInBanner with Add to Home Screen (home_screen_install_enabled)', () => {
  const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
  const setFlag = (on: boolean) =>
    useFeatureFlagsStore.setState((st) => ({ flags: { ...st.flags, home_screen_install_enabled: on } }));
  const iphone = (standalone: boolean) =>
    vi.stubGlobal('navigator', { ...navigator, userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5, standalone });

  beforeEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    push.status = 'default';
    push.homeScreen = false;
    push.enable.mockReset().mockResolvedValue('granted');
    signIn();
    setFlag(true);
  });

  it('asks a player who has opened the installed app, whatever games they have', async () => {
    iphone(true);
    render(<PushOptInBanner hasAsyncGames={false} />);
    expect(screen.getByText('Turn on notifications')).toBeInTheDocument();
    expect(screen.getByText(/Borderfall is on your home screen/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(push.enable).toHaveBeenCalledTimes(1));
  });

  it('keeps the turn-alert wording for an installed player who has an async game', () => {
    iphone(true);
    render(<PushOptInBanner hasAsyncGames />);
    expect(screen.getByText("Know when it's your turn")).toBeInTheDocument();
  });

  it('still asks nobody in a browser tab with no async game', () => {
    iphone(false);
    const { container } = render(<PushOptInBanner hasAsyncGames={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('does not ask the installed app with the flag off: the banner is as it was', () => {
    setFlag(false);
    iphone(true);
    const { container } = render(<PushOptInBanner hasAsyncGames={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('gives an iPhone tab a button that shows how, beside the advice', () => {
    iphone(false);
    push.status = 'unsupported';
    push.homeScreen = true;
    render(<PushOptInBanner hasAsyncGames />);
    expect(screen.getByRole('button', { name: 'Show me how' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull();
  });

  it('gives it only the advice with the flag off', () => {
    setFlag(false);
    iphone(false);
    push.status = 'unsupported';
    push.homeScreen = true;
    render(<PushOptInBanner hasAsyncGames />);
    expect(screen.queryByRole('button', { name: 'Show me how' })).toBeNull();
    expect(screen.getByText(/Share → Add to Home Screen/)).toBeInTheDocument();
  });
});

