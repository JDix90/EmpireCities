import { describe, expect, it } from 'vitest';
import { resolveConnectionHintMode } from './connectionHints';

describe('resolveConnectionHintMode', () => {
  it('honors explicit off and borders preferences', () => {
    expect(resolveConnectionHintMode({ preference: 'off', isDenseMap: false })).toBe('off');
    expect(resolveConnectionHintMode({ preference: 'borders', isDenseMap: false })).toBe('borders');
    expect(resolveConnectionHintMode({ preference: 'full', isDenseMap: true })).toBe('full');
  });

  it('auto mode uses borders on dense maps', () => {
    expect(resolveConnectionHintMode({ preference: 'auto', isDenseMap: true })).toBe('borders');
    expect(resolveConnectionHintMode({ preference: 'auto', isDenseMap: false })).toBe('full');
  });

  it('auto mode uses borders when reduced effects are enabled', () => {
    expect(resolveConnectionHintMode({
      preference: 'auto',
      isDenseMap: false,
      reducedEffects: true,
    })).toBe('borders');
  });

  it('auto mode uses borders on globe view', () => {
    expect(resolveConnectionHintMode({
      preference: 'auto',
      isDenseMap: false,
      globeView: true,
    })).toBe('borders');
  });
});
