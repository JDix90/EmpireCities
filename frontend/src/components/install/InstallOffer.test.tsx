/**
 * The offer to add Borderfall to the home screen, and the guide behind it
 * (home_screen_install_enabled): shown only where it can lead somewhere, the
 * browser's dialog where there is one, the three steps on an iPhone, and gone
 * for 30 days after "Not now".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import InstallOffer, { INSTALL_OFFER_SNOOZE_MS, InstallButton } from './InstallOffer';
import InstallGuideHost from './InstallGuide';
import HomeScreenSettingsRow from './HomeScreenSettingsRow';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';
import { resetInstallStateForTests, useInstallStore, type BeforeInstallPromptEvent } from '../../services/homeScreenInstall';
import { getInstallOfferDismissedAt, markInstallOfferDismissed } from '../../utils/userPreferences';

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: toastMock }));

const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPHONE_INSTAGRAM = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 336.0.0.27.90';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const ANDROID_FIREFOX = 'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0';
const DESKTOP_FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0';

function browser(userAgent: string, platform = 'Linux armv81', maxTouchPoints = 5) {
  vi.stubGlobal('navigator', { ...navigator, userAgent, platform, maxTouchPoints });
}
function setFlag(on: boolean) {
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, home_screen_install_enabled: on } }));
}
function browserOffer(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt') as BeforeInstallPromptEvent;
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome });
  useInstallStore.setState({ deferred: event });
  return event;
}

beforeEach(() => {
  // Each test stubs its own browser; one test's home-screen marker must not reach the next.
  vi.unstubAllGlobals();
  localStorage.clear();
  resetInstallStateForTests();
  toastMock.mockReset();
  toastMock.success.mockReset();
  setFlag(true);
  browser(ANDROID_CHROME);
});

describe('InstallOffer', () => {
  it('shows nothing with the flag off, whatever the browser offers', () => {
    setFlag(false);
    browserOffer();
    const { container } = render(<InstallOffer surface="lobby" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('where the browser has made an offer, one press opens its dialog', async () => {
    const offer = browserOffer('accepted');
    render(<><InstallOffer surface="lobby" /><InstallGuideHost /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Install Borderfall' }));
    await waitFor(() => expect(offer.prompt).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Borderfall is on your home screen'));
    expect(screen.queryByTestId('install-guide')).toBeNull();
  });

  it('on an iPhone, says why it matters there and opens the three steps, with an arrow to Share', async () => {
    browser(IPHONE_SAFARI, 'iPhone');
    render(<><InstallOffer surface="results" /><InstallGuideHost /></>);
    expect(screen.getByTestId('install-offer-results')).toHaveTextContent('the only way an iPhone lets us tell you when it is your turn');
    fireEvent.click(screen.getByRole('button', { name: 'Add to Home Screen' }));
    const guide = await screen.findByTestId('install-guide');
    expect(guide).toHaveAttribute('data-path', 'ios_share');
    expect(guide).toHaveTextContent('in the bar at the bottom of the screen');
    expect(guide).toHaveTextContent('Add to Home Screen');
    expect(guide).toHaveTextContent('turn on notifications when it asks');
    expect(screen.getByTestId('install-guide-arrow')).toHaveAttribute('data-placement', 'bottom');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByTestId('install-guide')).toBeNull();
  });

  it('does not interrupt where the player would have to hunt for it: another app\'s browser, a browser menu, a desktop with no offer', () => {
    for (const [ua, platform, touch] of [[IPHONE_INSTAGRAM, 'iPhone', 5], [ANDROID_FIREFOX, 'Linux armv81', 5], [DESKTOP_FIREFOX, 'Win32', 0]] as const) {
      browser(ua, platform, touch);
      const { container, unmount } = render(<InstallOffer surface="lobby" />);
      expect(container, ua).toBeEmptyDOMElement();
      unmount();
    }
  });

  it('"Not now" hides it on both surfaces for 30 days', () => {
    browserOffer();
    const { unmount } = render(<InstallOffer surface="lobby" />);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByTestId('install-offer-lobby')).toBeNull();
    expect(getInstallOfferDismissedAt()).not.toBeNull();
    unmount();
    const { container } = render(<InstallOffer surface="results" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('comes back once the 30 days are up', () => {
    browserOffer();
    markInstallOfferDismissed(Date.now() - INSTALL_OFFER_SNOOZE_MS - 1000);
    render(<InstallOffer surface="lobby" />);
    expect(screen.getByTestId('install-offer-lobby')).toBeInTheDocument();
  });

  it('is gone from the home-screen app itself', () => {
    browser(IPHONE_SAFARI, 'iPhone');
    vi.stubGlobal('navigator', { ...navigator, standalone: true });
    const { container } = render(<InstallOffer surface="lobby" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the guide, where no button of ours can do it', () => {
  it('in an app\'s built-in browser, says to open Safari and offers the link', async () => {
    browser(IPHONE_INSTAGRAM, 'iPhone');
    render(<><InstallButton surface="push_ask" label="Show me how" /><InstallGuideHost /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Show me how' }));
    const guide = await screen.findByTestId('install-guide');
    expect(guide).toHaveAttribute('data-path', 'ios_in_app');
    expect(guide).toHaveTextContent('Open in Safari');
    expect(screen.getByTestId('install-guide-link')).toHaveTextContent(window.location.origin);
    expect(screen.queryByTestId('install-guide-arrow')).toBeNull();
  });

  it('in a phone browser that made no offer, names the entry in its menu', async () => {
    browser(ANDROID_FIREFOX);
    render(<><InstallButton surface="settings" /><InstallGuideHost /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Add to Home Screen' }));
    const guide = await screen.findByTestId('install-guide');
    expect(guide).toHaveAttribute('data-path', 'manual');
    expect(guide).toHaveTextContent('Install app');
  });
});

describe('Settings row', () => {
  it('is always available, a "Not now" elsewhere notwithstanding', () => {
    browserOffer();
    markInstallOfferDismissed();
    render(<HomeScreenSettingsRow />);
    expect(screen.getByRole('button', { name: 'Install Borderfall' })).toBeInTheDocument();
  });

  it('says so when the player is already in the installed app', () => {
    browser(IPHONE_SAFARI, 'iPhone');
    vi.stubGlobal('navigator', { ...navigator, standalone: true });
    render(<HomeScreenSettingsRow />);
    expect(screen.getByText('Installed')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows nothing with the flag off, or in a desktop browser with nothing to offer', () => {
    setFlag(false);
    const { container, unmount } = render(<HomeScreenSettingsRow />);
    expect(container).toBeEmptyDOMElement();
    unmount();
    setFlag(true);
    browser(DESKTOP_FIREFOX, 'Win32', 0);
    expect(render(<HomeScreenSettingsRow />).container).toBeEmptyDOMElement();
  });
});
