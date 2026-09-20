/**
 * The child half of the embed handshake.
 *
 * The shell cannot tell a loaded cross-origin frame from a browser error page,
 * so the app has to assert that it booted. These tests pin the two things that
 * would break that silently: aiming at the wrong window, and the payload shape
 * a shell validates against.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectParentOrigin, notifyEmbedderReady } from './embedContext';

/** Pretend this document is framed, with the given ancestor chain (nearest first). */
function frameAs(opts: { ancestors?: string[]; referrer?: string }) {
  const parent = { postMessage: vi.fn() };
  Object.defineProperty(window, 'parent', { value: parent, configurable: true });
  if (opts.ancestors) {
    Object.defineProperty(window.location, 'ancestorOrigins', {
      value: Object.assign([...opts.ancestors], { contains: () => false, item: (i: number) => opts.ancestors![i] }),
      configurable: true,
    });
  } else {
    Object.defineProperty(window.location, 'ancestorOrigins', { value: undefined, configurable: true });
  }
  Object.defineProperty(document, 'referrer', { value: opts.referrer ?? '', configurable: true });
  return parent;
}

afterEach(() => {
  Object.defineProperty(window, 'parent', { value: window, configurable: true });
  Object.defineProperty(window.location, 'ancestorOrigins', { value: undefined, configurable: true });
  Object.defineProperty(document, 'referrer', { value: '', configurable: true });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('detectParentOrigin', () => {
  it('is undefined when nothing is framing us', () => {
    expect(detectParentOrigin()).toBeUndefined();
  });

  it('is the IMMEDIATE parent, not the top-level page', () => {
    // The real Newgrounds chain: the shell is served from uploads.ungrounded.net
    // and it, not the newgrounds.com page, is the window listening for us.
    frameAs({ ancestors: ['https://uploads.ungrounded.net', 'https://www.newgrounds.com'] });
    expect(detectParentOrigin()).toBe('https://uploads.ungrounded.net');
  });

  it('falls back to the referrer where ancestorOrigins is unsupported (Firefox)', () => {
    frameAs({ referrer: 'https://html-classic.itch.zone/html/1234/index.html' });
    expect(detectParentOrigin()).toBe('https://html-classic.itch.zone');
  });

  it('is undefined rather than throwing when the referrer is unusable', () => {
    frameAs({ referrer: 'not a url' });
    expect(detectParentOrigin()).toBeUndefined();
  });
});

describe('notifyEmbedderReady', () => {
  it('says nothing when the app is not framed', () => {
    const spy = vi.spyOn(window, 'postMessage');
    notifyEmbedderReady();
    expect(spy).not.toHaveBeenCalled();
  });

  it('posts a versioned message addressed to the parent origin', () => {
    const parent = frameAs({ ancestors: ['https://uploads.ungrounded.net', 'https://www.newgrounds.com'] });
    notifyEmbedderReady();
    expect(parent.postMessage).toHaveBeenCalledWith(
      { source: 'borderfall', type: 'embed-ready', version: 1 },
      'https://uploads.ungrounded.net',
    );
  });

  it('re-announces, so a listener attached a tick late still hears it', () => {
    vi.useFakeTimers();
    const parent = frameAs({ ancestors: ['https://uploads.ungrounded.net'] });
    notifyEmbedderReady();
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2500);
    expect(parent.postMessage).toHaveBeenCalledTimes(3);
    // …and then stops, rather than chattering at the parent forever.
    vi.advanceTimersByTime(60_000);
    expect(parent.postMessage).toHaveBeenCalledTimes(3);
  });

  it('falls back to * when the parent origin cannot be determined', () => {
    // Staying silent here would let the shell show an error over a working game.
    const parent = frameAs({});
    notifyEmbedderReady();
    expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ source: 'borderfall' }), '*');
  });

  it('never lets a failing postMessage escape into the app', () => {
    const parent = frameAs({ ancestors: ['https://uploads.ungrounded.net'] });
    parent.postMessage.mockImplementation(() => { throw new Error('parent went away'); });
    expect(() => notifyEmbedderReady()).not.toThrow();
  });
});
