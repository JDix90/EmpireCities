/**
 * Safari on iOS zoomed the whole app in by about 1.14× when a 14px text box
 * gained focus (the feedback note, the chat box, a faction picker) and left it
 * zoomed, so every screen after slid sideways with its left edge cut off.
 * `maximum-scale=1` stops that on iOS only: Safari still lets the player pinch,
 * but every other browser would take it as a zoom lock.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { isAppleTouchDevice, stopIosInputZoom } from './iosZoom';

const IPHONE = {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  platform: 'iPhone',
  maxTouchPoints: 5,
};
const IPAD_DESKTOP_MODE = {
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  platform: 'MacIntel',
  maxTouchPoints: 5,
};
const MAC = { ...IPAD_DESKTOP_MODE, maxTouchPoints: 0 };
const ANDROID = {
  userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36',
  platform: 'Linux armv8l',
  maxTouchPoints: 5,
};

const VIEWPORT = 'width=device-width, initial-scale=1.0, viewport-fit=cover';

describe('isAppleTouchDevice', () => {
  it('knows an iPhone, and an iPad that asks for the desktop site', () => {
    expect(isAppleTouchDevice(IPHONE)).toBe(true);
    expect(isAppleTouchDevice(IPAD_DESKTOP_MODE)).toBe(true);
  });

  it('leaves out a Mac and an Android phone', () => {
    expect(isAppleTouchDevice(MAC)).toBe(false);
    expect(isAppleTouchDevice(ANDROID)).toBe(false);
  });
});

describe('stopIosInputZoom', () => {
  beforeEach(() => {
    document.head.innerHTML = `<meta name="viewport" content="${VIEWPORT}">`;
  });
  const viewport = () => document.querySelector<HTMLMetaElement>('meta[name="viewport"]')!.content;

  it('caps the zoom on an iPhone, once', () => {
    expect(stopIosInputZoom(document, IPHONE)).toBe(true);
    expect(viewport()).toBe(`${VIEWPORT}, maximum-scale=1`);
    expect(stopIosInputZoom(document, IPHONE)).toBe(false);
    expect(viewport()).toBe(`${VIEWPORT}, maximum-scale=1`);
  });

  it('caps it on an iPad in desktop mode too', () => {
    expect(stopIosInputZoom(document, IPAD_DESKTOP_MODE)).toBe(true);
  });

  it('leaves the viewport alone where the cap would lock zoom', () => {
    expect(stopIosInputZoom(document, ANDROID)).toBe(false);
    expect(stopIosInputZoom(document, MAC)).toBe(false);
    expect(viewport()).toBe(VIEWPORT);
  });
});
