import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({ values: new Map<string, string>(), counts: new Map<string, number>(), expires: new Map<string, number>() }));
vi.mock('../../db/redis', () => ({
  redis: {
    set: async (key: string, value: string) => { store.values.set(key, value); return 'OK'; },
    get: async (key: string) => store.values.get(key) ?? null,
    del: async (key: string) => (store.values.delete(key) ? 1 : 0),
    incr: async (key: string) => {
      const n = (store.counts.get(key) ?? 0) + 1;
      store.counts.set(key, n);
      return n;
    },
    expire: async (key: string, seconds: number) => { store.expires.set(key, seconds); return 1; },
  },
}));

import {
  SIGN_IN_CODE_ALPHABET,
  SIGN_IN_CODE_MAX_TRIES,
  formatSignInCode,
  generateSignInCode,
  normalizeSignInCode,
  redeemSignInCode,
  rememberSignInCode,
} from './signInCode';

beforeEach(() => {
  store.values.clear();
  store.counts.clear();
  store.expires.clear();
});

describe('sign-in codes', () => {
  it('are eight characters with nothing that reads as something else', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateSignInCode();
      expect(code).toHaveLength(8);
      for (const ch of code) expect(SIGN_IN_CODE_ALPHABET).toContain(ch);
    }
    for (const confusable of ['I', 'L', 'O', '0', '1']) expect(SIGN_IN_CODE_ALPHABET).not.toContain(confusable);
  });

  it('are shown in two groups', () => {
    expect(formatSignInCode('ABCDEFGH')).toBe('ABCD-EFGH');
  });

  it('are read however they are typed, and nothing else is a code', () => {
    expect(normalizeSignInCode('ABCD-EFGH')).toBe('ABCDEFGH');
    expect(normalizeSignInCode(' abcd efgh ')).toBe('ABCDEFGH');
    expect(normalizeSignInCode('abcdefgh')).toBe('ABCDEFGH');
    expect(normalizeSignInCode('ABCD-EFG')).toBeNull();
    expect(normalizeSignInCode('ABCD-EFGHJ')).toBeNull();
    // I, L, O, 0 and 1 are never in a code.
    expect(normalizeSignInCode('ABCD-EFG0')).toBeNull();
    expect(normalizeSignInCode('ABCD-EFGI')).toBeNull();
    expect(normalizeSignInCode('')).toBeNull();
    expect(normalizeSignInCode(12345678)).toBeNull();
    expect(normalizeSignInCode(undefined)).toBeNull();
  });
});

describe('spending a code', () => {
  it('works once, for the address it was sent to, whatever the case of the address', async () => {
    await rememberSignInCode('Player@Example.com', 'ABCDEFGH', 'link-1', 1_800_000);
    expect(await redeemSignInCode('other@example.com', 'ABCDEFGH')).toEqual({ status: 'wrong' });
    expect(await redeemSignInCode(' player@example.COM ', 'ABCDEFGH')).toEqual({ status: 'ok', linkId: 'link-1' });
    expect(await redeemSignInCode('player@example.com', 'ABCDEFGH')).toEqual({ status: 'wrong' });
  });

  it('keeps no code in the clear', async () => {
    await rememberSignInCode('player@example.com', 'ABCDEFGH', 'link-1', 1_800_000);
    const everything = JSON.stringify([...store.values.entries()]);
    expect(everything).not.toContain('ABCDEFGH');
    expect(everything).not.toContain('player@example.com');
  });

  it('gives an address ten tries per half hour, right or wrong, then refuses even the right code', async () => {
    await rememberSignInCode('player@example.com', 'ABCDEFGH', 'link-1', 1_800_000);
    for (let i = 0; i < SIGN_IN_CODE_MAX_TRIES; i += 1) {
      expect(await redeemSignInCode('player@example.com', 'ZZZZZZZZ')).toEqual({ status: 'wrong' });
    }
    expect(await redeemSignInCode('player@example.com', 'ABCDEFGH')).toEqual({ status: 'locked' });
    // The window is set once, on the first try, so it cannot be pushed back by trying again.
    expect([...store.expires.values()]).toEqual([1800]);
    // Another address is not held up by this one.
    await rememberSignInCode('someone@example.com', 'ABCDEFGH', 'link-2', 1_800_000);
    expect(await redeemSignInCode('someone@example.com', 'ABCDEFGH')).toEqual({ status: 'ok', linkId: 'link-2' });
  });
});
