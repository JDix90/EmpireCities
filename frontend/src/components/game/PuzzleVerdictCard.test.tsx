import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import PuzzleVerdictCard from './PuzzleVerdictCard';
import type { PuzzleProposal, PuzzleVerdict } from '../../utils/dailyPuzzleV2';

const nameOf = (id: string) => ({ korea_cw: 'Korea', north_china_cw: 'North China' })[id] ?? id;

function show(proposal: PuzzleProposal, verdict: Partial<PuzzleVerdict> = {}) {
  const full: PuzzleVerdict = {
    decision: true,
    silent: false,
    equity: 0.51,
    best_equity: 0.7,
    loss: 19,
    grade: 'blunder',
    takebacks: 0,
    ...verdict,
  };
  render(
    <PuzzleVerdictCard proposal={proposal} verdict={full} nameOf={nameOf} onRoll={vi.fn()} onTakeBack={vi.fn()} />,
  );
}

describe('PuzzleVerdictCard', () => {
  it('asks to roll only when the held move actually rolls dice', () => {
    show({ kind: 'attack', from: 'north_china_cw', to: 'korea_cw' });
    expect(screen.getByRole('button', { name: /Roll anyway/ })).toBeInTheDocument();
  });

  it('names a fortify as a move, not a roll', () => {
    // A fortify has no dice; "Roll anyway" read as a different move entirely.
    show({ kind: 'fortify', from: 'north_china_cw', to: 'korea_cw', units: 4 });
    expect(screen.getByRole('button', { name: /Move anyway/ })).toBeInTheDocument();
    expect(screen.queryByText(/Roll/)).not.toBeInTheDocument();
    expect(screen.getByText('Move 4 units from North China into Korea?')).toBeInTheDocument();
  });

  it('confirms the best move without daring the player to do it anyway', () => {
    show({ kind: 'end_attack' }, { grade: 'best', equity: 0.7, best_equity: 0.7, loss: 0 });
    expect(screen.getByRole('button', { name: /Stop attacking/ })).toBeInTheDocument();
    expect(screen.queryByText(/anyway/)).not.toBeInTheDocument();
  });
});
