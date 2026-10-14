import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AiTurnRecapPanel, { appendRecap, ownTurnDigest, summarizeRecap, type TurnRecapEntry } from './AiTurnRecapPanel';
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

  it('keeps a turn with no battles that its digest reports, such as a region taken by influence', () => {
    const list = appendRecap([], { ...entry('AI 1', []), digestLine: 'Took The West' });
    expect(list.map((r) => r.digestLine)).toEqual(['Took The West']);
  });
});

describe('the digest line', () => {
  it('shows under the bot\'s row once the panel is open', () => {
    render(
      <AiTurnRecapPanel
        recaps={[{ ...entry('Rome', [combat({ territory_captured: true })]), digestLine: 'Took The West \u00b7 Pushing into Gaul' }]}
        onDismiss={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /while you were away/i }));
    expect(screen.getByText('Took The West \u00b7 Pushing into Gaul')).toBeTruthy();
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

  it('shows an attacked badge and red row when the viewer was the defender', () => {
    const recaps = [entry('AI Bot 1', [combat({ defenderId: 'me', fromName: 'Gaul', toName: 'Italia' })])];
    render(<AiTurnRecapPanel recaps={recaps} onDismiss={() => {}} viewerPlayerId="me" />);
    // Header badge counts attacks on the viewer.
    expect(screen.getByText('1')).toBeTruthy();
    fireEvent.click(screen.getByText(/While you were away/)); // expand panel
    fireEvent.click(screen.getByText('AI Bot 1')); // expand the entry detail
    expect(screen.getByText('(you)')).toBeTruthy();
  });

  it('auto-expands when the viewer lost a territory', () => {
    const recaps = [
      entry('AI Bot 1', [combat({ defenderId: 'me', territory_captured: true, fromName: 'Gaul', toName: 'Italia' })]),
    ];
    render(<AiTurnRecapPanel recaps={recaps} onDismiss={() => {}} viewerPlayerId="me" />);
    // No click needed: the panel and the entry open themselves, marked "Lost!".
    expect(screen.getByText('Lost!')).toBeTruthy();
  });

  it('stays collapsed for routine chip damage against the viewer', () => {
    const recaps = [entry('AI Bot 1', [combat({ defenderId: 'me', territory_captured: false })])];
    render(<AiTurnRecapPanel recaps={recaps} onDismiss={() => {}} viewerPlayerId="me" />);
    expect(screen.queryByText('AI Bot 1')).toBeNull(); // detail list not rendered
  });
});

describe('the own-turn row (turn_recap_panel_enabled)', () => {
  it('sums what was placed and moved into one line', () => {
    expect(ownTurnDigest([{ units: 3 }, { units: 2 }], [{ units: 4 }])).toBe('Placed 5 units, moved 4');
    expect(ownTurnDigest([{ units: 1 }], [])).toBe('Placed 1 unit');
    expect(ownTurnDigest([], [{ units: 2 }])).toBe('Moved 2');
    expect(ownTurnDigest([], [])).toBeUndefined();
  });

  it('lists the viewer\'s turn as "Your turn" and heads the panel "Since your last turn"', () => {
    const own: TurnRecapEntry = { ...entry('Guest_ab12', [combat({ territory_captured: true })]), ownTurn: true, digestLine: 'Placed 4 units' };
    render(<AiTurnRecapPanel recaps={[own, entry('AI 1', [combat()])]} onDismiss={() => {}} viewerPlayerId="me" />);
    expect(screen.getByText(/Since your last turn \(2 turns, 1 capture\)/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Since your last turn/));
    expect(screen.getByText('Your turn')).toBeTruthy();
    expect(screen.queryByText('Guest_ab12')).toBeNull();
    expect(screen.getByText('AI 1')).toBeTruthy();
    expect(screen.getByText('Placed 4 units')).toBeTruthy();
  });

  it('keeps "While you were away" when only other players\' turns are listed', () => {
    render(<AiTurnRecapPanel recaps={[entry('AI 1', [combat()])]} onDismiss={() => {}} viewerPlayerId="me" />);
    expect(screen.getByText(/While you were away/)).toBeTruthy();
  });
});
