import { describe, it, expect } from 'vitest';
import { evaluateEraMapCompatibility } from './lobbyEraMapCompatibility';

const hasCustomPairingNote = (warnings: Array<{ message: string }>) =>
  warnings.some((w) => w.message.startsWith('Custom pairing'));

/**
 * Regression guard: the warning condition used to compare the ERA id against
 * its MAP id ('ancient' !== 'era_ancient', true for every era), so every game
 * — including the defaults a brand-new player creates — carried a "Custom
 * pairing" note implying they had configured something nonstandard.
 */
describe('evaluateEraMapCompatibility — custom pairing note', () => {
  it('does NOT warn for an era on its own bundled map', () => {
    const result = evaluateEraMapCompatibility({
      era_id: 'ancient',
      map_id: 'era_ancient',
      settings: {},
    });
    expect(result.allowed).toBe(true);
    expect(hasCustomPairingNote(result.warnings)).toBe(false);
  });

  it('warns when rules era and theater map genuinely differ', () => {
    const result = evaluateEraMapCompatibility({
      era_id: 'ww2',
      map_id: 'era_ancient',
      settings: {},
    });
    expect(hasCustomPairingNote(result.warnings)).toBe(true);
  });
});
