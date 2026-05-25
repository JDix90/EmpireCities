import { describe, it, expect } from 'vitest';
import { shouldEmitStrikeAnimation } from './strikeAnimation';

describe('strikeAnimation', () => {
  it('emits for atom bomb detonation', () => {
    expect(shouldEmitStrikeAnimation('atom_bomb', 'atom_bomb_detonated')).toBe(true);
  });

  it('emits for nuclear strike unit reduction', () => {
    expect(shouldEmitStrikeAnimation('nuclear_strike', 'unit_reduction')).toBe(true);
  });

  it('does not emit for unrelated abilities', () => {
    expect(shouldEmitStrikeAnimation('cyber_attack', 'unit_reduction')).toBe(false);
  });
});
