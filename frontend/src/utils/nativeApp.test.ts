import { describe, it, expect, vi, afterEach } from 'vitest';
import { Capacitor } from '@capacitor/core';

const browserOpen = vi.fn();
vi.mock('@capacitor/browser', () => ({ Browser: { open: (...a: unknown[]) => browserOpen(...a) } }));

import { inThisBrowserOrOnThisDevice, isNativeApp, nativeLinkAction, openExternal, thisBrowserOrDevice } from './nativeApp';

const APP = 'capacitor://localhost';

afterEach(() => {
  vi.restoreAllMocks();
  browserOpen.mockReset();
});

describe('isNativeApp', () => {
  it('is false in a browser and true inside the Capacitor shell', () => {
    expect(isNativeApp()).toBe(false);
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    expect(isNativeApp()).toBe(true);
  });

  it('reads as the website when detection throws', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockImplementation(() => {
      throw new Error('no bridge');
    });
    expect(isNativeApp()).toBe(false);
  });
});

describe('thisBrowserOrDevice', () => {
  it('names the browser on the website and the device in the app', () => {
    expect(thisBrowserOrDevice()).toBe('this browser');
    expect(inThisBrowserOrOnThisDevice()).toBe('in this browser');
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    expect(thisBrowserOrDevice()).toBe('this device');
    // "Saved on this device", not "saved in this device".
    expect(inThisBrowserOrOnThisDevice()).toBe('on this device');
  });
});

describe('nativeLinkAction', () => {
  it('sends another site to the in-app browser, whatever its target', () => {
    expect(nativeLinkAction('https://www.reddit.com/r/borderfall', '_blank', APP)).toEqual({
      kind: 'external',
      url: 'https://www.reddit.com/r/borderfall',
    });
    expect(nativeLinkAction('https://media.tenor.com/x.gif', null, APP)).toEqual({
      kind: 'external',
      url: 'https://media.tenor.com/x.gif',
    });
    expect(nativeLinkAction('http://example.com/a?b=1#c', null, APP).kind).toBe('external');
  });

  it('leaves the app\'s own links to the router', () => {
    expect(nativeLinkAction('/lobby', null, APP)).toEqual({ kind: 'default' });
    expect(nativeLinkAction('capacitor://localhost/settings', null, APP)).toEqual({ kind: 'default' });
  });

  it('opens one of our own pages in place when it asked for a new tab', () => {
    expect(nativeLinkAction('/how-to-play?x=1#rules', '_blank', APP)).toEqual({
      kind: 'in_app',
      path: '/how-to-play?x=1#rules',
    });
  });

  it('leaves mail, phone and other schemes to the system', () => {
    expect(nativeLinkAction('mailto:support@borderfall.gg', null, APP)).toEqual({ kind: 'default' });
    expect(nativeLinkAction('tel:+15550100', '_blank', APP)).toEqual({ kind: 'default' });
    expect(nativeLinkAction('javascript:alert(1)', null, APP)).toEqual({ kind: 'default' });
    expect(nativeLinkAction('blob:capacitor://localhost/abc', null, APP)).toEqual({ kind: 'default' });
  });

  it('works for the Android shell and for the website origin', () => {
    expect(nativeLinkAction('/lobby', '_blank', 'https://localhost')).toEqual({ kind: 'in_app', path: '/lobby' });
    expect(nativeLinkAction('https://borderfall.gg/privacy', null, 'https://localhost').kind).toBe('external');
  });

  it('leaves alone what it cannot parse', () => {
    expect(nativeLinkAction('http://[bad', null, APP)).toEqual({ kind: 'default' });
  });
});

describe('openExternal', () => {
  it('is a new tab on the website', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await openExternal('https://discord.com/app');
    expect(open).toHaveBeenCalledWith('https://discord.com/app', '_blank', 'noopener,noreferrer');
    expect(browserOpen).not.toHaveBeenCalled();
  });

  it('is the in-app browser sheet in the native app', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    browserOpen.mockResolvedValue(undefined);
    await openExternal('https://twitter.com/intent/tweet?text=hi');
    expect(browserOpen).toHaveBeenCalledWith({ url: 'https://twitter.com/intent/tweet?text=hi' });
    expect(open).not.toHaveBeenCalled();
  });

  it('falls back to the web view when the plugin is missing from a build', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    browserOpen.mockRejectedValue(new Error('"Browser" plugin is not implemented on ios'));
    await openExternal('https://discord.com/app');
    expect(open).toHaveBeenCalledWith('https://discord.com/app', '_blank', 'noopener,noreferrer');
  });

  it('opens nothing that is not a web page', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await openExternal('javascript:alert(1)');
    await openExternal('mailto:a@b.c');
    await openExternal('/lobby');
    expect(open).not.toHaveBeenCalled();
    expect(browserOpen).not.toHaveBeenCalled();
  });
});
