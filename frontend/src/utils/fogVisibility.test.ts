import { describe, it, expect } from 'vitest';
import { isFogHidden } from './fogVisibility';

describe('isFogHidden', () => {
  it('treats the -1 unit_count sentinel as hidden', () => {
    expect(isFogHidden({ unit_count: -1 })).toBe(true);
  });

  it('treats a real unit count as visible', () => {
    expect(isFogHidden({ unit_count: 0 })).toBe(false);
    expect(isFogHidden({ unit_count: 5 })).toBe(false);
  });

  it('is safe for null / undefined territory state', () => {
    expect(isFogHidden(null)).toBe(false);
    expect(isFogHidden(undefined)).toBe(false);
  });
});
