import { describe, it, expect, vi, afterEach } from 'vitest';

const refuse = vi.hoisted(() => ({ next: 0 }));
vi.mock('../../utils/profanity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/profanity')>();
  return {
    ...actual,
    // Refuse the next `refuse.next` names, then defer to the real filter.
    isDisallowedUsername: (name: string) => (refuse.next > 0 ? (refuse.next--, true) : actual.isDisallowedUsername(name)),
  };
});

import { friendlyGuestName, GUEST_ADJECTIVES, GUEST_ANIMALS } from './guestNames';
import { isDisallowedUsername } from '../../utils/profanity';

const USERNAME = /^[a-zA-Z0-9_]{3,32}$/;

describe('friendlyGuestName', () => {
  afterEach(() => { refuse.next = 0; });

  it('is an adjective, an animal and five digits', () => {
    const picks = [0, 1, 42];
    expect(friendlyGuestName(() => picks.shift()!)).toBe(`${GUEST_ADJECTIVES[0]}${GUEST_ANIMALS[1]}_00042`);
  });

  it('is always a valid, allowed username', () => {
    const longest = Math.max(...GUEST_ADJECTIVES.map((a) => a.length)) + Math.max(...GUEST_ANIMALS.map((a) => a.length)) + 6;
    expect(longest).toBeLessThanOrEqual(32);
    for (const adjective of GUEST_ADJECTIVES) {
      for (const animal of GUEST_ANIMALS) {
        expect(isDisallowedUsername(`${adjective}${animal}`), `${adjective}${animal}`).toBe(false);
      }
    }
    for (let i = 0; i < 5_000; i++) {
      const name = friendlyGuestName();
      expect(name).toMatch(USERNAME);
      expect(isDisallowedUsername(name), name).toBe(false);
    }
  });

  it('draws again when the username filter refuses a name', () => {
    refuse.next = 2;
    const picks = [0, 0, 1, 1, 1, 2, 2, 2, 3];
    // The first two draws are refused; the third is kept.
    expect(friendlyGuestName(() => picks.shift()!)).toBe(`${GUEST_ADJECTIVES[2]}${GUEST_ANIMALS[2]}_00003`);
  });

  it('gives up loudly rather than looping when every draw is refused', () => {
    refuse.next = 1_000;
    expect(() => friendlyGuestName(() => 0)).toThrow(/no allowed name/);
  });
});
