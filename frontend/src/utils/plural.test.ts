import { describe, it, expect } from 'vitest';
import { plural } from './plural';

describe('plural', () => {
  it('singularizes count of 1', () => {
    expect(plural(1, 'troop')).toBe('1 troop');
  });

  it('pluralizes other counts', () => {
    expect(plural(0, 'troop')).toBe('0 troops');
    expect(plural(3, 'troop')).toBe('3 troops');
  });

  it('supports irregular plural forms', () => {
    expect(plural(2, 'territory', 'territories')).toBe('2 territories');
  });
});
