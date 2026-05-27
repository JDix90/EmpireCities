import { describe, it, expect } from 'vitest';
import {
  shouldEmitAbilityStrikeVisuals,
  shouldEmitFullScreenStrike,
  shouldEmitMapOnlyStrike,
  shouldEmitStrikeAnimation,
} from './strikeAnimation';

describe('strikeAnimation', () => {
  it('emits for atom bomb detonation', () => {
    expect(shouldEmitStrikeAnimation('atom_bomb', 'atom_bomb_detonated')).toBe(true);
    expect(shouldEmitFullScreenStrike('atom_bomb', 'atom_bomb_detonated')).toBe(true);
  });

  it('emits for nuclear strike unit reduction', () => {
    expect(shouldEmitStrikeAnimation('nuclear_strike', 'unit_reduction')).toBe(true);
  });

  it('emits for modern-era orbital and hypersonic strikes', () => {
    expect(shouldEmitStrikeAnimation('orbital_strike', 'unit_reduction')).toBe(true);
    expect(shouldEmitStrikeAnimation('hypersonic_strike', 'unit_reduction')).toBe(true);
  });

  it('emits full-screen for swarm and dyson beam', () => {
    expect(shouldEmitFullScreenStrike('swarm_strike', 'unit_reduction')).toBe(true);
    expect(shouldEmitFullScreenStrike('dyson_beam', 'unit_reduction')).toBe(true);
  });

  it('emits map-only for air strike, cyber, data breach, and river blockade', () => {
    expect(shouldEmitMapOnlyStrike('air_strike', 'unit_reduction')).toBe(true);
    expect(shouldEmitMapOnlyStrike('cyber_attack', 'unit_reduction')).toBe(true);
    expect(shouldEmitMapOnlyStrike('data_breach', 'unit_reduction')).toBe(true);
    expect(shouldEmitMapOnlyStrike('river_blockade', 'unit_reduction')).toBe(true);
    expect(shouldEmitFullScreenStrike('air_strike', 'unit_reduction')).toBe(false);
    expect(shouldEmitFullScreenStrike('cyber_attack', 'unit_reduction')).toBe(false);
  });

  it('shouldEmitAbilityStrikeVisuals covers full-screen and map-only', () => {
    expect(shouldEmitAbilityStrikeVisuals('swarm_strike', 'unit_reduction')).toBe(true);
    expect(shouldEmitAbilityStrikeVisuals('cyber_attack', 'unit_reduction')).toBe(true);
    expect(shouldEmitAbilityStrikeVisuals('air_strike', 'unit_reduction')).toBe(true);
    expect(shouldEmitAbilityStrikeVisuals('air_strike', 'pre_attack_damage_ready')).toBe(false);
  });
});
