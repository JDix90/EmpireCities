import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AiTurnRecapPanel, { appendRecap, summarizeRecap, type TurnRecapEntry } from './AiTurnRecapPanel';
import type { CombatResult } from '../../store/gameStore';

function combat(overrides: Partial<CombatResult> = {}): CombatResult {
  return {
    attacker_rolls: [6],
    defender_rolls: [3],
    attacker_losses: 0,
    defender_losses: 1,
    territory_captured: false,
    ...overrides,
  } as CombatResult;
}

function entry(name: string, combats: CombatResult[]): TurnRecapEntry {
  return { playerName: name, playerColor: '#f00', turnNumber: 3, combats };
}

describe('appendRecap', () => {
  it('appends recaps in order', () => {
    const list = appendRecap(appendRecap([], entry('AI 1', [combat()])), entry('AI 2', [combat()]));
    expect(list.map((r) => r.playerName)).toEqual(['AI 1', 'AI 2']);
  });

  it('skips quiet turns with no battles', () => {
    expect(appendRecap([], entry('AI 1', []))).toEqual([]);
  });
});

describe('summarizeRecap', () => {
  it('counts battles, captures, and destroyed units', () => {
    const stats = summarizeRecap([
      combat({ territory_captured: true, defender_losses: 2 }),
      combat({ defender_losses: 1 }),
    ]);
    expect(stats).toEqual({ battles: 2, captures: 1, destroyed: 3 });
  });
});

describe('AiTurnRecapPanel', () => {
  it('renders nothing when there are no recaps', () => {
    const { container } = render(<AiTurnRecapPanel recaps={[]} onDismiss={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('summarizes accumulated turns and expands to per-player detail', () => {
    const recaps = [
      entry('AI Bot 1', [combat({ territory_captured: true })]),
      entry('AI Bot 2', [combat(), combat()]),
    ];
    render(<AiTurnRecapPanel recaps={recaps} onDismiss={() => {}} />);
    expect(screen.getByText(/While you were away \(2 turns, 1 capture\)/)).toBeTruthy();

    fireEvent.click(screen.getByText(/While you were away/));
    expect(screen.getByText('AI Bot 1')).toBeTruthy();
    expect(screen.getByText('AI Bot 2')).toBeTruthy();
  });

  it('invokes onDismiss from the close button', () => {
    let dismissed = false;
    render(
      <AiTurnRecapPanel recaps={[entry('AI Bot 1', [combat()])]} onDismiss={() => { dismissed = true; }} />,
    );
    fireEvent.click(screen.getByLabelText('Dismiss recap'));
    expect(dismissed).toBe(true);
  });
});
