import { describe, it, expect } from 'vitest';
import { classifyAcquisitionSource } from './acquisitionChannel';
import { foldAcquisitionByChannel, type AcquisitionRow } from './analyticsQueries';

describe('classifyAcquisitionSource', () => {
  it('buckets assistants as llm, by host or by utm token', () => {
    for (const s of [
      'chatgpt.com', 'chat.openai.com', 'chatgpt', 'openai',
      'perplexity.ai', 'www.perplexity.ai', 'claude.ai',
      'gemini.google.com', 'copilot.microsoft.com', 'poe.com', 'grok.com',
    ]) {
      expect(classifyAcquisitionSource(s), s).toBe('llm');
    }
  });

  it('buckets search engines as search', () => {
    for (const s of ['google.com', 'www.google.com', 'bing.com', 'duckduckgo.com', 'search.brave.com', 'ecosia.org']) {
      expect(classifyAcquisitionSource(s), s).toBe('search');
    }
  });

  it('keeps gemini.google.com out of search even though it ends in google.com', () => {
    // Order matters: the llm list is consulted first. If search won here, the
    // assistant channel would silently lose Gemini to the search row.
    expect(classifyAcquisitionSource('gemini.google.com')).toBe('llm');
    expect(classifyAcquisitionSource('bard.google.com')).toBe('llm');
  });

  it('buckets community and social as social', () => {
    for (const s of ['reddit.com', 'old.reddit.com', 'news.ycombinator.com', 'x.com', 't.co', 'youtube.com']) {
      expect(classifyAcquisitionSource(s), s).toBe('social');
    }
  });

  it('treats missing attribution as direct', () => {
    for (const s of ['direct', '', '   ', 'none', '(direct)']) {
      expect(classifyAcquisitionSource(s), JSON.stringify(s)).toBe('direct');
    }
  });

  it('falls back to referral for a real but unknown site', () => {
    expect(classifyAcquisitionSource('itch.io')).toBe('referral');
    expect(classifyAcquisitionSource('crazygames.com')).toBe('referral');
  });

  it('matches on a dot boundary, so a lookalike domain cannot claim a channel', () => {
    // The whole point of not using substring matching: an attacker-controlled
    // host that merely CONTAINS a known one must not be credited to it.
    expect(classifyAcquisitionSource('chatgpt.com.evil.test')).toBe('referral');
    expect(classifyAcquisitionSource('notchatgpt.com')).toBe('referral');
    expect(classifyAcquisitionSource('reddit.com.phish.example')).toBe('referral');
  });

  it('is case- and www-insensitive', () => {
    expect(classifyAcquisitionSource('ChatGPT.com')).toBe('llm');
    expect(classifyAcquisitionSource('WWW.Google.COM')).toBe('search');
  });
});

describe('foldAcquisitionByChannel', () => {
  const rows: AcquisitionRow[] = [
    { source: 'chatgpt.com', channel: 'llm', signups: 12, accounts: 2, activated: 6 },
    { source: 'perplexity.ai', channel: 'llm', signups: 3, accounts: 1, activated: 1 },
    { source: 'direct', channel: 'direct', signups: 10, accounts: 2, activated: 5 },
    { source: 'bing.com', channel: 'search', signups: 2, accounts: 0, activated: 0 },
    { source: 'google.com', channel: 'search', signups: 1, accounts: 0, activated: 0 },
  ];

  it('sums each channel across its sources', () => {
    const folded = foldAcquisitionByChannel(rows);
    const llm = folded.find((c) => c.channel === 'llm');
    expect(llm).toMatchObject({ signups: 15, accounts: 3, activated: 7 });
    const search = folded.find((c) => c.channel === 'search');
    expect(search).toMatchObject({ signups: 3, accounts: 0, activated: 0 });
  });

  it('conserves the totals — every signup lands in exactly one channel', () => {
    const folded = foldAcquisitionByChannel(rows);
    const sum = (k: 'signups' | 'accounts' | 'activated') =>
      folded.reduce((n, c) => n + c[k], 0);
    expect(sum('signups')).toBe(rows.reduce((n, r) => n + r.signups, 0));
    expect(sum('accounts')).toBe(rows.reduce((n, r) => n + r.accounts, 0));
    expect(sum('activated')).toBe(rows.reduce((n, r) => n + r.activated, 0));
  });

  it('lists each channel’s sources biggest first', () => {
    const folded = foldAcquisitionByChannel(rows);
    expect(folded.find((c) => c.channel === 'llm')?.sources).toEqual(['chatgpt.com', 'perplexity.ai']);
  });

  it('drops empty channels and leads with llm', () => {
    const folded = foldAcquisitionByChannel(rows);
    expect(folded.map((c) => c.channel)).toEqual(['llm', 'search', 'direct']);
  });

  it('returns nothing for no signups', () => {
    expect(foldAcquisitionByChannel([])).toEqual([]);
  });
});
