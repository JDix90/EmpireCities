/**
 * Adding Borderfall to a phone's home screen (home_screen_install_enabled).
 *
 * A player on the home screen comes back: the icon is where their games are,
 * and on an iPhone it is the only place a website may send notifications from
 * at all. Until now nothing on the site offered it. The one mention was a line
 * of text, "Share → Add to Home Screen", shown to iPhone players at the
 * moment they tried to turn notifications on.
 *
 * What a website can do differs by browser, and this file is where that is
 * decided:
 *
 *   prompt      Chrome, Edge and Samsung Internet (Android and desktop) hand
 *               the page a `beforeinstallprompt` event. Holding it lets our
 *               own button open the browser's install dialog: one tap, one
 *               confirmation. The browser decides when to offer it, offers it
 *               once per page load, and never once the app is installed.
 *   ios_share   iPhone and iPad. Apple gives a page no way to do it: the
 *               player must tap Share, then "Add to Home Screen". The most a
 *               button can do is show where those are.
 *   ios_in_app  A link opened inside another app (Instagram, Facebook, …) on
 *               an iPhone: that browser has no "Add to Home Screen" at all,
 *               so the first step is to open the page in Safari.
 *   manual      Any other phone browser (Firefox on Android; Chrome before it
 *               has made its offer, or after the player declined it): the
 *               browser's own menu has the entry.
 *   installed   Already running from the home screen, or inside the native app.
 *   none        Nothing to offer: a desktop browser that made no offer.
 *
 * Only `prompt` and `ios_share` are worth interrupting a player for; the rest
 * are for Settings and for the moment a player asks for notifications.
 */
import { create } from 'zustand';
import { Capacitor } from '@capacitor/core';
import { trackFunnel, type InstallOfferSurface } from '../utils/funnelEvents';

/** The event Chromium hands a page it is willing to install; not in lib.dom. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallPath = 'prompt' | 'ios_share' | 'ios_in_app' | 'manual' | 'installed' | 'none';

/** Where the Share button sits on an iPhone or iPad, for the guide's arrow. */
export type IosSharePlacement = 'bottom' | 'top';

export interface InstallEnvironment {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  /** Running from the home screen (display-mode: standalone, or iOS navigator.standalone). */
  standalone: boolean;
  /** Inside the Capacitor native app. */
  native: boolean;
  /** The browser has handed us an install prompt to show. */
  hasPrompt: boolean;
}

/** Apps whose links open in their own browser, which cannot add a site to the home screen. */
const IN_APP_BROWSER = /FBAN|FBAV|FB_IAB|Instagram|Line\/|TikTok|musical_ly|Bytedance|Twitter|LinkedInApp|Snapchat|Pinterest|GSA\/|MicroMessenger|WhatsApp/i;

export function isIosDevice(env: Pick<InstallEnvironment, 'userAgent' | 'platform' | 'maxTouchPoints'>): boolean {
  // An iPad asks for the desktop site by default and calls itself a Mac; no Mac has a touch screen.
  return /iPhone|iPad|iPod/.test(env.userAgent) || (env.platform === 'MacIntel' && env.maxTouchPoints > 1);
}

/** Which way, if any, this browser can put Borderfall on the home screen. */
export function detectInstallPath(env: InstallEnvironment): InstallPath {
  if (env.native || env.standalone) return 'installed';
  if (isIosDevice(env)) return IN_APP_BROWSER.test(env.userAgent) ? 'ios_in_app' : 'ios_share';
  if (env.hasPrompt) return 'prompt';
  return /Android/i.test(env.userAgent) ? 'manual' : 'none';
}

/**
 * Where Share is: the bottom bar in Safari on an iPhone; the top right on an
 * iPad and in Chrome, Edge and Firefox on either. Newer Safari layouts can
 * tuck it behind a "more" button, so the guide also says where to look then.
 */
export function iosSharePlacement(env: Pick<InstallEnvironment, 'userAgent' | 'platform' | 'maxTouchPoints'>): IosSharePlacement {
  const otherBrowser = /CriOS|FxiOS|EdgiOS/.test(env.userAgent);
  const ipad = /iPad/.test(env.userAgent) || (env.platform === 'MacIntel' && env.maxTouchPoints > 1);
  return otherBrowser || ipad ? 'top' : 'bottom';
}

/** Whether this page is running from the home screen. */
export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.('(display-mode: standalone)').matches === true || nav.standalone === true;
}

/** Read the browser as it stands now. */
export function readInstallEnvironment(hasPrompt: boolean): InstallEnvironment {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { userAgent: '', platform: '', maxTouchPoints: 0, standalone: false, native: false, hasPrompt: false };
  }
  return {
    userAgent: navigator.userAgent ?? '',
    platform: navigator.platform ?? '',
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone: isStandaloneDisplay(),
    native: Capacitor.isNativePlatform(),
    hasPrompt,
  };
}

interface InstallState {
  /** The browser's install offer, held until a player presses our button. */
  deferred: BeforeInstallPromptEvent | null;
  /** The browser reported the install, on this page load. */
  installedNow: boolean;
  /** The how-to guide on screen, and the path it explains. */
  guide: { path: Exclude<InstallPath, 'prompt' | 'installed' | 'none'>; surface: InstallOfferSurface } | null;
}

export const useInstallStore = create<InstallState>(() => ({ deferred: null, installedNow: false, guide: null }));

let listening = false;

/**
 * Start holding the browser's install offer. Called once as the app boots,
 * whatever the flag says: the event comes once per page load, usually before
 * the flags have arrived, and a held event that nobody shows costs nothing.
 * Holding it also stops Chrome's own mini-bar, so with the flag off we do not
 * call preventDefault and Chrome behaves as it always has.
 */
export function listenForInstallPrompt(isEnabled: () => boolean): void {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  window.addEventListener('beforeinstallprompt', (event) => {
    if (isEnabled()) event.preventDefault();
    useInstallStore.setState({ deferred: event as BeforeInstallPromptEvent });
  });
  window.addEventListener('appinstalled', () => {
    useInstallStore.setState({ deferred: null, installedNow: true, guide: null });
  });
}

/** The path open to this browser now. */
export function currentInstallPath(): InstallPath {
  const { deferred, installedNow } = useInstallStore.getState();
  if (installedNow) return 'installed';
  return detectInstallPath(readInstallEnvironment(deferred !== null));
}

/** A hook for the path: re-reads when the browser makes or withdraws its offer. */
export function useInstallPath(): InstallPath {
  const hasPrompt = useInstallStore((s) => s.deferred !== null);
  const installedNow = useInstallStore((s) => s.installedNow);
  if (installedNow) return 'installed';
  return detectInstallPath(readInstallEnvironment(hasPrompt));
}

/** Whether a path is worth offering unasked: the browser can do it, or one clear gesture can. */
export function isProactiveInstallPath(path: InstallPath): boolean {
  return path === 'prompt' || path === 'ios_share';
}

export type InstallAttempt = 'accepted' | 'dismissed' | 'guide' | 'unavailable';

/**
 * A player pressed an install button on `surface`. Where the browser made an
 * offer, show its dialog (it must be opened from a click, and each offer can
 * be shown once); otherwise open the guide for this browser.
 */
export async function startInstall(surface: InstallOfferSurface): Promise<InstallAttempt> {
  const path = currentInstallPath();
  trackFunnel({ event: 'install_offer_clicked', surface }, { path });
  if (path === 'installed' || path === 'none') return 'unavailable';
  const { deferred } = useInstallStore.getState();
  if (path === 'prompt' && deferred) {
    // One use per event: drop it before waiting, so a second press cannot reuse it.
    useInstallStore.setState({ deferred: null });
    try {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      trackFunnel({ event: 'install_prompt_answered', surface }, { result: outcome });
      return outcome;
    } catch {
      return 'unavailable';
    }
  }
  if (path === 'prompt') return 'unavailable';
  useInstallStore.setState({ guide: { path, surface } });
  return 'guide';
}

export function closeInstallGuide(): void {
  useInstallStore.setState({ guide: null });
}

/** For tests: forget the held offer and the listener. */
export function resetInstallStateForTests(): void {
  useInstallStore.setState({ deferred: null, installedNow: false, guide: null });
}
