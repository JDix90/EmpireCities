/**
 * Which way a browser can put Borderfall on the home screen, and what a press
 * of the install button does about it (home_screen_install_enabled).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  detectInstallPath,
  iosSharePlacement,
  isProactiveInstallPath,
  listenForInstallPrompt,
  resetInstallStateForTests,
  startInstall,
  useInstallStore,
  type BeforeInstallPromptEvent,
  type InstallEnvironment,
} from './homeScreenInstall';

const track = vi.hoisted(() => vi.fn());
vi.mock('../utils/funnelEvents', () => ({ trackFunnel: track }));

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 336.0.0.27.90',
  iphoneFacebook: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.31.105]',
  ipadDesktopSite: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0',
  desktopChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
};

const env = (over: Partial<InstallEnvironment>): InstallEnvironment => ({
  userAgent: UA.desktopChrome,
  platform: 'Win32',
  maxTouchPoints: 0,
  standalone: false,
  native: false,
  hasPrompt: false,
  ...over,
});

describe('detectInstallPath', () => {
  it('is the browser\'s own dialog wherever the browser has offered one', () => {
    expect(detectInstallPath(env({ userAgent: UA.androidChrome, hasPrompt: true }))).toBe('prompt');
    expect(detectInstallPath(env({ hasPrompt: true }))).toBe('prompt');
  });

  it('is the Share menu on an iPhone or iPad, in Safari and in Chrome, whatever the browser offered', () => {
    expect(detectInstallPath(env({ userAgent: UA.iphoneSafari, platform: 'iPhone', maxTouchPoints: 5 }))).toBe('ios_share');
    expect(detectInstallPath(env({ userAgent: UA.iphoneChrome, platform: 'iPhone', maxTouchPoints: 5 }))).toBe('ios_share');
    // An iPad asks for the desktop site and calls itself a Mac; only its touch screen gives it away.
    expect(detectInstallPath(env({ userAgent: UA.ipadDesktopSite, platform: 'MacIntel', maxTouchPoints: 5 }))).toBe('ios_share');
  });

  it('says to leave an app\'s built-in browser first, where there is no Add to Home Screen', () => {
    expect(detectInstallPath(env({ userAgent: UA.iphoneInstagram, platform: 'iPhone', maxTouchPoints: 5 }))).toBe('ios_in_app');
    expect(detectInstallPath(env({ userAgent: UA.iphoneFacebook, platform: 'iPhone', maxTouchPoints: 5 }))).toBe('ios_in_app');
  });

  it('points an Android browser that made no offer at its own menu', () => {
    expect(detectInstallPath(env({ userAgent: UA.androidFirefox, platform: 'Linux armv81', maxTouchPoints: 5 }))).toBe('manual');
    expect(detectInstallPath(env({ userAgent: UA.androidChrome, platform: 'Linux armv81', maxTouchPoints: 5 }))).toBe('manual');
  });

  it('offers nothing on a desktop browser that made no offer, a real Mac included', () => {
    expect(detectInstallPath(env({}))).toBe('none');
    expect(detectInstallPath(env({ userAgent: UA.macSafari, platform: 'MacIntel', maxTouchPoints: 0 }))).toBe('none');
  });

  it('is already installed when running from the home screen or inside the native app', () => {
    expect(detectInstallPath(env({ userAgent: UA.iphoneSafari, platform: 'iPhone', maxTouchPoints: 5, standalone: true }))).toBe('installed');
    expect(detectInstallPath(env({ userAgent: UA.androidChrome, hasPrompt: true, native: true }))).toBe('installed');
  });

  it('interrupts a player only where one tap or one clear gesture gets it done', () => {
    expect(isProactiveInstallPath('prompt')).toBe(true);
    expect(isProactiveInstallPath('ios_share')).toBe(true);
    for (const path of ['ios_in_app', 'manual', 'installed', 'none'] as const) expect(isProactiveInstallPath(path)).toBe(false);
  });
});

describe('iosSharePlacement', () => {
  it('is the bottom bar in Safari on an iPhone, and the top right on an iPad and in other browsers', () => {
    expect(iosSharePlacement(env({ userAgent: UA.iphoneSafari, platform: 'iPhone', maxTouchPoints: 5 }))).toBe('bottom');
    expect(iosSharePlacement(env({ userAgent: UA.iphoneChrome, platform: 'iPhone', maxTouchPoints: 5 }))).toBe('top');
    expect(iosSharePlacement(env({ userAgent: UA.ipadDesktopSite, platform: 'MacIntel', maxTouchPoints: 5 }))).toBe('top');
  });
});

/** A stand-in for the event Chromium dispatches. */
function installEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as BeforeInstallPromptEvent;
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

describe('the browser\'s offer, held for our button', () => {
  let flagOn = false;
  listenForInstallPrompt(() => flagOn);

  beforeEach(() => {
    vi.unstubAllGlobals();
    flagOn = false;
    track.mockReset();
    resetInstallStateForTests();
    vi.stubGlobal('navigator', { ...navigator, userAgent: UA.androidChrome, platform: 'Linux armv81', maxTouchPoints: 5 });
  });

  it('keeps the offer, and leaves Chrome\'s own banner alone while the flag is off', () => {
    const event = installEvent();
    window.dispatchEvent(event);
    expect(useInstallStore.getState().deferred).toBe(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('takes the offer over with the flag on, so it comes at our moment', () => {
    flagOn = true;
    const event = installEvent();
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('opens the browser\'s dialog on a press, reports its answer, and never shows one offer twice', async () => {
    const event = installEvent('accepted');
    window.dispatchEvent(event);
    await expect(startInstall('lobby')).resolves.toBe('accepted');
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(useInstallStore.getState().deferred).toBeNull();
    expect(track).toHaveBeenCalledWith({ event: 'install_offer_clicked', surface: 'lobby' }, { path: 'prompt' });
    expect(track).toHaveBeenCalledWith({ event: 'install_prompt_answered', surface: 'lobby' }, { result: 'accepted' });
    // The offer is spent: a second press has the browser's menu to point at, not a dialog.
    await expect(startInstall('lobby')).resolves.toBe('guide');
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it('reports a declined dialog as dismissed', async () => {
    window.dispatchEvent(installEvent('dismissed'));
    await expect(startInstall('results')).resolves.toBe('dismissed');
  });

  it('opens the guide where no dialog exists, for the path this browser has', async () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: UA.iphoneSafari, platform: 'iPhone', maxTouchPoints: 5 });
    await expect(startInstall('push_ask')).resolves.toBe('guide');
    expect(useInstallStore.getState().guide).toEqual({ path: 'ios_share', surface: 'push_ask' });
  });

  it('does nothing in a browser with no way to do it', async () => {
    vi.stubGlobal('navigator', { ...navigator, userAgent: UA.desktopChrome, platform: 'Win32', maxTouchPoints: 0 });
    await expect(startInstall('settings')).resolves.toBe('unavailable');
    expect(useInstallStore.getState().guide).toBeNull();
  });

  it('closes the guide and forgets the offer once the browser reports the install', () => {
    window.dispatchEvent(installEvent());
    useInstallStore.setState({ guide: { path: 'manual', surface: 'settings' } });
    window.dispatchEvent(new Event('appinstalled'));
    expect(useInstallStore.getState()).toMatchObject({ deferred: null, installedNow: true, guide: null });
  });
});
