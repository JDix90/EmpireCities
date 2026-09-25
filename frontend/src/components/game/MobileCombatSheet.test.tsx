import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import MobileCombatSheet from './MobileCombatSheet';
import type { CombatModalData } from './ActionModal';
import type { CombatResult } from '../../store/gameStore';

function result(over: Partial<CombatResult> = {}): CombatResult {
  return {
    attacker_rolls: [6, 5, 2],
    defender_rolls: [3, 1],
    attacker_losses: 0,
    defender_losses: 2,
    territory_captured: false,
    attackerId: 'me',
    defenderId: 'ai_1',
    attackerName: 'Darth_Jefe',
    defenderName: 'Admiral Chen',
    fromId: 'gaul',
    toId: 'hispania',
    fromName: 'Gaul',
    toName: 'Hispania',
    ...over,
  } as CombatResult;
}

function card(over: Partial<CombatModalData> = {}): CombatModalData {
  return { type: 'combat', result: result(), perspective: 'attacker', ...over };
}

describe('MobileCombatSheet', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom has no matchMedia; the dice view consults it for reduced motion.
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as typeof window.matchMedia;
  });
  afterEach(() => { vi.useRealTimers(); });

  it('renders nothing without a result', () => {
    const { container } = render(<MobileCombatSheet data={null} onDismiss={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the viewer's attack anchored above the bar, not as a backdrop over the map", () => {
    render(<MobileCombatSheet data={card()} onDismiss={() => {}} />);
    const sheet = screen.getByTestId('combat-sheet');
    expect(sheet.className).toContain('mobile-sheet-above-nav');
    expect(sheet.className).not.toContain('inset-0');
    expect(sheet.textContent).toContain('Your Attack');
    expect(sheet.textContent).toContain('Gaul');
    expect(sheet.textContent).toContain('Hispania');
  });

  it('closes from its Done button as a plain dismissal, and carries no Continue of its own', () => {
    const onDismiss = vi.fn();
    render(<MobileCombatSheet data={card()} onDismiss={onDismiss} />);
    act(() => { vi.advanceTimersByTime(3000); }); // dice settle
    expect(screen.queryByRole('button', { name: /Continue/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onDismiss.mock.calls[0][0]).toBeUndefined();
  });

  it('keeps Attack again and Blitz, closing as an action rather than a tap', () => {
    const onDismiss = vi.fn();
    const onRepeatCombat = vi.fn();
    const onBlitzCombat = vi.fn();
    render(
      <MobileCombatSheet
        data={card({ repeatAttack: { fromId: 'gaul', toId: 'hispania', blitzEligible: true } })}
        onDismiss={onDismiss}
        onRepeatCombat={onRepeatCombat}
        onBlitzCombat={onBlitzCombat}
      />,
    );
    act(() => { vi.advanceTimersByTime(3000); });
    fireEvent.click(screen.getByRole('button', { name: /Attack again/ }));
    expect(onRepeatCombat).toHaveBeenCalledWith('gaul', 'hispania');
    expect(onDismiss).toHaveBeenCalledWith('action');
    fireEvent.click(screen.getByRole('button', { name: /Blitz/ }));
    expect(onBlitzCombat).toHaveBeenCalledWith('gaul', 'hispania');
  });

  it('offers no repeat after a capture', () => {
    render(
      <MobileCombatSheet
        data={card({ result: result({ territory_captured: true }) })}
        onDismiss={() => {}}
        onRepeatCombat={() => {}}
      />,
    );
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByTestId('combat-sheet').textContent).toContain('Territory Captured!');
    expect(screen.queryByRole('button', { name: /Attack again/ })).toBeNull();
  });

  it('closes itself in lite mode without a tap to count', () => {
    const onDismiss = vi.fn();
    render(<MobileCombatSheet data={card({ autoAdvance: true })} onDismiss={onDismiss} />);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(onDismiss).toHaveBeenCalledWith('auto');
    expect(screen.queryByText(/press Enter to skip/)).toBeNull();
  });
});
