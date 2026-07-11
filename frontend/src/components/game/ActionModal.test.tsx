import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ActionModal, { type EraAdvanceModalData } from './ActionModal';

function eraAdvance(overrides: Partial<EraAdvanceModalData> = {}): EraAdvanceModalData {
  return {
    type: 'era_advance',
    eraId: 'medieval',
    signatureName: 'Levy of Knights',
    signatureDescription: '+1 attack die on your next attack',
    legacyLabel: 'Atom Bomb',
    vulnerable: true,
    ...overrides,
  };
}

describe('ActionModal — era advance payoff', () => {
  it('leads with the era entered and its flavor', () => {
    render(<ActionModal data={eraAdvance()} onDismiss={() => {}} />);
    expect(screen.getByText('Medieval Era')).toBeTruthy();
    expect(screen.getByText('Civilization Ascends')).toBeTruthy();
  });

  it('spotlights the newly-unlocked signature ability', () => {
    render(<ActionModal data={eraAdvance()} onDismiss={() => {}} />);
    expect(screen.getByText('New power unlocked')).toBeTruthy();
    expect(screen.getByText('Levy of Knights')).toBeTruthy();
    expect(screen.getByText('+1 attack die on your next attack')).toBeTruthy();
  });

  it('shows the legacy carry and the vulnerability warning', () => {
    render(<ActionModal data={eraAdvance()} onDismiss={() => {}} />);
    expect(screen.getByText('Atom Bomb')).toBeTruthy();
    expect(screen.getByText(/Vulnerable window/)).toBeTruthy();
  });

  it('omits the new-power and vulnerability sections when absent', () => {
    render(
      <ActionModal
        data={eraAdvance({ signatureName: undefined, signatureDescription: undefined, legacyLabel: undefined, vulnerable: false })}
        onDismiss={() => {}}
      />,
    );
    expect(screen.queryByText('New power unlocked')).toBeNull();
    expect(screen.queryByText(/Vulnerable window/)).toBeNull();
    // The era + tech-tree line still render.
    expect(screen.getByText('Medieval Era')).toBeTruthy();
  });

  it('dismisses via the Onward button', () => {
    const onDismiss = vi.fn();
    render(<ActionModal data={eraAdvance()} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByText('Onward →'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
