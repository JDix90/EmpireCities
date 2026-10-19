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

  it('names the links players hand each other, which carry no utm tags', () => {
    for (const [url, source] of [
      ['/replay/0b7c1c9e-3f0e-4d55-9c55-1c1d2f3a4b5c?source=share', 'share'],
      ['/join/ABC123', 'invite'],
      ['/?ref=K7Q2PX', 'player_referral'],
    ] as const) {
      window.localStorage.clear();
      setUrl(url);
      captureAttribution();
      expect(getAttribution()).toEqual({ utm_source: source, landing_path: url.split('?')[0] });
    }
  });

  it("keeps a player link's referrer, and lets the link's own utm tags win", () => {
    setReferrer('https://discord.com/channels/1/2');
    setUrl('/join/ABC123');
    captureAttribution();
    expect(getAttribution()).toEqual({ utm_source: 'invite', referrer: 'discord.com', landing_path: '/join/ABC123' });

    window.localStorage.clear();
    setReferrer('');
    setUrl('/replay/abc?source=share&utm_source=newsletter');
    captureAttribution();
    expect(getAttribution()?.utm_source).toBe('newsletter');
  });

  it('does not take another source= value for a share', () => {
    setUrl('/replay/abc?source=lobby');
    captureAttribution();
    expect(getAttribution()).toBeUndefined();
  });
});
