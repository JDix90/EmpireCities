import { describe, it, expect } from 'vitest';
import { parseAttribution } from './attribution';

describe('parseAttribution', () => {
  it('extracts known utm + referrer fields from the body.attribution object', () => {
    expect(
      parseAttribution({
        username: 'x',
        attribution: {
          utm_source: 'reddit',
          utm_medium: 'cpc',
          utm_campaign: 'launch',
          referrer: 'reddit.com',
          landing_path: '/',
        },
      }),
    ).toEqual({
      utm_source: 'reddit',
      utm_medium: 'cpc',
      utm_campaign: 'launch',
      referrer: 'reddit.com',
      landing_path: '/',
    });
  });

  it('drops unknown keys and keeps only the whitelisted ones', () => {
    expect(
      parseAttribution({ attribution: { utm_source: 'x', evil: 'drop', nested: { a: 1 } } }),
    ).toEqual({ utm_source: 'x' });
  });

  it('trims whitespace and caps each value at 200 chars', () => {
    const long = 'a'.repeat(500);
    const out = parseAttribution({ attribution: { utm_campaign: '  spaced  ', utm_term: long } });
    expect(out.utm_campaign).toBe('spaced');
    expect(out.utm_term).toHaveLength(200);
  });

  it('returns {} for missing / non-object / malformed bodies (never throws)', () => {
    expect(parseAttribution(undefined)).toEqual({});
    expect(parseAttribution(null)).toEqual({});
    expect(parseAttribution('nope')).toEqual({});
    expect(parseAttribution({})).toEqual({});
    expect(parseAttribution({ attribution: 'not-an-object' })).toEqual({});
    expect(parseAttribution({ attribution: { utm_source: 123 } })).toEqual({});
  });
});
