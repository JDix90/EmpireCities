import { describe, it, expect, vi, afterEach } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { clientPlatform } from './platform';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('clientPlatform', () => {
  it('is the web in a browser', () => {
    expect(clientPlatform()).toBe('web');
  });

  it('is ios or android inside the Capacitor shell', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    const getPlatform = vi.spyOn(Capacitor, 'getPlatform');
    getPlatform.mockReturnValue('ios');
    expect(clientPlatform()).toBe('ios');
    getPlatform.mockReturnValue('android');
    expect(clientPlatform()).toBe('android');
  });

  it('never reports a platform outside the three', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('electron');
    expect(clientPlatform()).toBe('web');
  });

  it('falls back to the web when detection throws', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockImplementation(() => {
      throw new Error('no bridge');
    });
    expect(clientPlatform()).toBe('web');
  });
});
