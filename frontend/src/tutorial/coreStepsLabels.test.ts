import { describe, it, expect } from 'vitest';
import { CORE_TUTORIAL_STEPS } from './modules/coreSteps';
import { phaseAdvanceLabel } from '../constants/phaseLabels';

/**
 * Drift guard: the tutorial must reference the EXACT labels the phase button
 * renders, on every viewport. Desktop and mobile previously used different
 * labels ("Begin Attack Phase →" vs "End Draft"), and the tutorial named the
 * desktop one — stranding phone players at step 4 hunting for a button that
 * wasn't on their screen.
 */
describe('core tutorial step copy', () => {
  const text = (id: string) => {
    const step = CORE_TUTORIAL_STEPS.find((s) => s.id === id);
    return `${step?.message ?? ''} ${step?.hint ?? ''}`;
  };

  it('references the shared phase-advance labels', () => {
    expect(text('advance_draft')).toContain(phaseAdvanceLabel('draft'));
    expect(text('attack_do')).toContain(phaseAdvanceLabel('attack'));
    expect(text('fortify_explain')).toContain(phaseAdvanceLabel('fortify'));
  });

  it('never references a sidebar location as the only guidance', () => {
    for (const step of CORE_TUTORIAL_STEPS) {
      const t = `${step.message} ${step.hint ?? ''}`;
      expect(t).not.toMatch(/right-hand sidebar/);
      expect(t).not.toMatch(/sidebar on the right/);
    }
  });

  it('tells the draft step which color is the player', () => {
    expect(text('draft_do')).toContain('{playerColor}');
  });
});
