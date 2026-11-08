import { describe, it, expect } from 'vitest';
import { formatMapAuthor, isAccountId } from './mapAuthor';

const ACCOUNT = '11111111-2222-4333-8444-555555555555';

describe('formatMapAuthor', () => {
  it('prefers the username the server sent', () => {
    expect(formatMapAuthor(ACCOUNT, 'cartographer')).toBe('cartographer');
    expect(formatMapAuthor('jmd', 'Jamie')).toBe('Jamie');
  });

  it('makes a seeded creator id presentable instead of calling it a community author', () => {
    expect(formatMapAuthor('jmd', null)).toBe('JMD');
    expect(formatMapAuthor('ab')).toBe('AB');
    expect(formatMapAuthor('system')).toBe('Borderfall');
    expect(formatMapAuthor('cartography-club')).toBe('cartography-club');
  });

  it('keeps a neutral name for an account whose username did not come through', () => {
    expect(formatMapAuthor(ACCOUNT, null)).toBe('a community author');
    expect(formatMapAuthor(ACCOUNT, '')).toBe('a community author');
  });
});

describe('isAccountId', () => {
  it('is true for an account id only', () => {
    expect(isAccountId(ACCOUNT)).toBe(true);
    expect(isAccountId('jmd')).toBe(false);
    expect(isAccountId('system')).toBe(false);
  });
});
