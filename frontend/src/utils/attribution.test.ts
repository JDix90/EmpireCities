import { describe, it, expect, beforeEach } from 'vitest';
import { captureAttribution, getAttribution } from './attribution';

function setReferrer(value: string): void {
  Object.defineProperty(document, 'referrer', { value, configurable: true });
}

function setUrl(path: string): void {
  // jsdom default origin is http://localhost — pushState updates location.search/pathname.
  window.history.pushState({}, '', path);
}

describe('attribution (first-touch)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setReferrer('');
    setUrl('/');
  });

  it('captures utm params + external referrer host + landing path', () => {
    setReferrer('https://www.reddit.com/r/WebGames/comments/abc');
    setUrl('/eras?utm_source=reddit&utm_medium=cpc&utm_campaign=launch');
    captureAttribution();
    expect(getAttribution()).toEqual({
      utm_source: 'reddit',
      utm_medium: 'cpc',
      utm_campaign: 'launch',
      referrer: 'www.reddit.com',
      landing_path: '/eras',
    });
  });

  it('stores nothing for an organic/direct visit (no utm, no external referrer)', () => {
    setUrl('/');
    captureAttribution();
    expect(getAttribution()).toBeUndefined();
  });

  it('ignores a same-host (internal) referrer', () => {
    setReferrer(`${window.location.origin}/lobby`);
    setUrl('/game'); // no utm
    captureAttribution();
    expect(getAttribution()).toBeUndefined();
  });

  it('is first-touch: a later visit does not overwrite the original snapshot', () => {
    setUrl('/?utm_source=reddit');
    captureAttribution();
    setUrl('/?utm_source=twitter');
    captureAttribution();
    expect(getAttribution()?.utm_source).toBe('reddit');
  });

  it('caps an oversized utm value at 200 chars', () => {
    setUrl(`/?utm_campaign=${'a'.repeat(500)}`);
    captureAttribution();
    expect(getAttribution()?.utm_campaign).toHaveLength(200);
  });
});
