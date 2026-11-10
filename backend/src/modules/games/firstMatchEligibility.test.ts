import { describe, it, expect } from 'vitest';
import { eligibleFirstMatchTag } from './firstMatchEligibility';

describe('eligibleFirstMatchTag', () => {
  it('keeps the tag for a player who has not finished a game', () => {
    expect(eligibleFirstMatchTag(true, false)).toBe(true);
  });

  it('drops it once they have, so a later game cannot claim the fair start', () => {
    expect(eligibleFirstMatchTag(true, true)).toBeUndefined();
  });

  it('never adds a tag that was not asked for', () => {
    expect(eligibleFirstMatchTag(undefined, false)).toBeUndefined();
  });
});
