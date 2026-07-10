import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PhaseProgressBar } from './PhaseProgressBar';
import { PHASE_SHORT_LABELS, TURN_PHASE_ORDER } from '../../constants/phaseLabels';

describe('PhaseProgressBar', () => {
  it('renders nothing outside the per-turn cycle', () => {
    const { container: a } = render(<PhaseProgressBar phase="territory_select" />);
    expect(a.querySelector('ol')).toBeNull();
    const { container: b } = render(<PhaseProgressBar phase="game_over" />);
    expect(b.querySelector('ol')).toBeNull();
  });

  it('renders the three turn phases plus a terminal End Turn step', () => {
    render(<PhaseProgressBar phase="draft" />);
    const items = screen.getAllByRole('listitem');
    // draft/attack/fortify + End Turn
    expect(items).toHaveLength(TURN_PHASE_ORDER.length + 1);
    expect(screen.getByText(PHASE_SHORT_LABELS.draft)).toBeTruthy();
    expect(screen.getByText('End Turn')).toBeTruthy();
  });

  it('marks exactly the current phase with aria-current="step"', () => {
    render(<PhaseProgressBar phase="attack" />);
    const current = document.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain(PHASE_SHORT_LABELS.attack);
  });

  it('flags earlier phases as done (non-color cue present)', () => {
    render(<PhaseProgressBar phase="fortify" />);
    // draft and attack precede fortify → two "(done)" status cues.
    const done = screen.getAllByText(/\(done\)/);
    expect(done).toHaveLength(2);
  });

  it('compact variant shows only the active phase label', () => {
    render(<PhaseProgressBar phase="attack" variant="compact" />);
    // Active label visible…
    expect(screen.getByText(PHASE_SHORT_LABELS.attack)).toBeTruthy();
    // …but an upcoming label (fortify) is icon-only in compact mode.
    expect(screen.queryByText(PHASE_SHORT_LABELS.fortify)).toBeNull();
  });
});
