/**
 * The native app names its build on every API request, and stops at an
 * "update required" screen when the server refuses that build. The website
 * does neither.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios, { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';

const native = vi.hoisted(() => ({ on: false, platform: 'ios' }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.on, getPlatform: () => (native.on ? native.platform : 'web') },
}));
const getInfo = vi.fn();
vi.mock('@capacitor/app', () => ({ App: { getInfo: () => getInfo() } }));

import {
  APP_PLATFORM_HEADER,
  APP_VERSION_HEADER,
  attachNativeAppVersion,
  checkNativeAppVersion,
  loadNativeAppInfo,
  nativeAppHeaders,
  noteUpdateRequired,
  resetNativeAppVersionForTests,
  storeDeepLink,
  useUpdateRequiredStore,
} from './nativeAppVersion';

const REFUSAL = {
  error: 'This version of the app is no longer supported. Update it to keep playing.',
  code: 'UPDATE_REQUIRED',
  platform: 'ios',
  min_version: '1.2.0',
  store_url: 'https://apps.apple.com/app/id0000000000',
};

/** An axios instance whose requests are answered by `respond`, with what it was sent recorded. */
function client(respond: (config: InternalAxiosRequestConfig) => { status: number; data: unknown }) {
  const sent: InternalAxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = async (config) => {
    sent.push(config);
    const { status, data } = respond(config);
    const response = { status, data, statusText: '', headers: {}, config };
    if (status >= 400) throw new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, null, response);
    return response;
  };
  const instance = axios.create({ adapter });
  attachNativeAppVersion(instance);
  return { instance, sent };
}

beforeEach(() => {
  native.on = false;
  native.platform = 'ios';
  getInfo.mockReset().mockResolvedValue({ name: 'Borderfall', id: 'com.borderfall.app', version: '1.0', build: '7' });
  resetNativeAppVersionForTests();
});

describe('on the website', () => {
  it('sends no app headers and never asks the shell for a version', async () => {
    await loadNativeAppInfo();
    expect(getInfo).not.toHaveBeenCalled();
    expect(nativeAppHeaders()).toEqual({});
    const { instance, sent } = client(() => ({ status: 200, data: {} }));
    await instance.get('/feature-flags');
    expect(sent[0].headers.get(APP_PLATFORM_HEADER)).toBeUndefined();
    expect(sent[0].headers.get(APP_VERSION_HEADER)).toBeUndefined();
  });

  it('makes no launch check', async () => {
    const get = vi.spyOn(axios.Axios.prototype, 'get');
    await checkNativeAppVersion();
    expect(get).not.toHaveBeenCalled();
    get.mockRestore();
  });
});

describe('in the native app', () => {
  beforeEach(() => {
    native.on = true;
  });

  it('names its platform and version on every request, asking the shell once', async () => {
    await Promise.all([loadNativeAppInfo(), loadNativeAppInfo()]);
    expect(getInfo).toHaveBeenCalledTimes(1);
    expect(nativeAppHeaders()).toEqual({ [APP_PLATFORM_HEADER]: 'ios', [APP_VERSION_HEADER]: '1.0' });
    const { instance, sent } = client(() => ({ status: 200, data: {} }));
    await instance.post('/auth/guest', {});
    expect(sent[0].headers.get(APP_PLATFORM_HEADER)).toBe('ios');
    expect(sent[0].headers.get(APP_VERSION_HEADER)).toBe('1.0');
  });

  it('sends nothing when the shell cannot say which build this is', async () => {
    getInfo.mockRejectedValue(new Error('"App" plugin is not implemented on ios'));
    await expect(loadNativeAppInfo()).resolves.toBeUndefined();
    expect(nativeAppHeaders()).toEqual({});
  });

  it('records the server refusing this build, from any request', async () => {
    await loadNativeAppInfo();
    const { instance } = client(() => ({ status: 426, data: REFUSAL }));
    await expect(instance.get('/users/me')).rejects.toMatchObject({ response: { status: 426 } });
    expect(useUpdateRequiredStore.getState().required).toEqual({
      platform: 'ios',
      minVersion: '1.2.0',
      storeUrl: 'https://apps.apple.com/app/id0000000000',
    });
  });

  it('does not mistake other failures for a refusal', async () => {
    const { instance } = client((config) =>
      config.url === '/a' ? { status: 426, data: { error: 'Upgrade Required' } } : { status: 401, data: REFUSAL });
    await expect(instance.get('/a')).rejects.toBeTruthy();
    await expect(instance.get('/b')).rejects.toBeTruthy();
    expect(useUpdateRequiredStore.getState().required).toBeNull();
    expect(noteUpdateRequired(426, 'UPDATE_REQUIRED')).toBe(false);
    expect(noteUpdateRequired(undefined, undefined)).toBe(false);
  });
});

describe('storeDeepLink', () => {
  it('opens the App Store app on its listing', () => {
    expect(storeDeepLink('https://apps.apple.com/us/app/borderfall/id0000000000')).toBe(
      'itms-apps://apps.apple.com/us/app/borderfall/id0000000000',
    );
  });

  it('opens Google Play on its listing', () => {
    expect(storeDeepLink('https://play.google.com/store/apps/details?id=com.borderfall.app&hl=en')).toBe(
      'market://details?id=com.borderfall.app',
    );
  });

  it('keeps any other https link, and gives nothing for anything else', () => {
    expect(storeDeepLink('https://borderfall.gg/update')).toBe('https://borderfall.gg/update');
    expect(storeDeepLink('')).toBe('');
    expect(storeDeepLink('javascript:alert(1)')).toBe('');
    expect(storeDeepLink('http://apps.apple.com/app/id1')).toBe('');
  });
});
