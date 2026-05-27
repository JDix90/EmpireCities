import { describe, it, expect } from 'vitest';
import { shouldShowFullScreenStrike } from './strikePresentation';

describe('shouldShowFullScreenStrike', () => {
  it('returns false for map-only strikes', () => {
    expect(shouldShowFullScreenStrike({
      abilityId: 'river_blockade',
      prefersReducedMotion: false,
    })).toBe(false);
  });

  it('returns true for full-screen strikes with normal motion', () => {
    expect(shouldShowFullScreenStrike({
      abilityId: 'dyson_beam',
      prefersReducedMotion: false,
    })).toBe(true);
    expect(shouldShowFullScreenStrike({
      abilityId: 'nuclear_strike',
      prefersReducedMotion: false,
    })).toBe(true);
  });

  it('returns false when reduced motion is preferred', () => {
    expect(shouldShowFullScreenStrike({
      abilityId: 'dyson_beam',
      prefersReducedMotion: true,
    })).toBe(false);
  });

  it('returns false in lite mode', () => {
    expect(shouldShowFullScreenStrike({
      abilityId: 'swarm_strike',
      prefersReducedMotion: false,
      liteMode: true,
    })).toBe(false);
  });

  it('returns false for map-only air strike', () => {
    expect(shouldShowFullScreenStrike({
      abilityId: 'air_strike',
      prefersReducedMotion: false,
    })).toBe(false);
  });
});
