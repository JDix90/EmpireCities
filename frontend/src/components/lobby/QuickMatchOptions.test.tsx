import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import QuickMatchOptions from './QuickMatchOptions';
import type { QuickMatchPrefs } from '../../utils/quickMatchPrefs';

const basePrefs: QuickMatchPrefs = { aiCount: 3, aiDifficulty: 'medium', victory: 'majority' };

describe('QuickMatchOptions', () => {
  it('renders all opponent counts and difficulties with the current prefs pressed', () => {
    render(<QuickMatchOptions prefs={basePrefs} onChange={vi.fn()} onStart={vi.fn()} starting={false} />);

    for (const count of ['1', '2', '3', '4', '5', '6', '7']) {
      expect(screen.getByRole('button', { name: count })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: '3' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Medium' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Expert' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports opponent-count changes without mutating difficulty', () => {
    const onChange = vi.fn();
    render(<QuickMatchOptions prefs={basePrefs} onChange={onChange} onStart={vi.fn()} starting={false} />);

    fireEvent.click(screen.getByRole('button', { name: '7' }));
    expect(onChange).toHaveBeenCalledWith({ aiCount: 7, aiDifficulty: 'medium', victory: 'majority' });
  });

  it('reports difficulty changes without mutating count', () => {
    const onChange = vi.fn();
    render(<QuickMatchOptions prefs={basePrefs} onChange={onChange} onStart={vi.fn()} starting={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Expert' }));
    expect(onChange).toHaveBeenCalledWith({ aiCount: 3, aiDifficulty: 'expert', victory: 'majority' });
  });

  it('starts with the chosen setup and disables while starting', () => {
    const onStart = vi.fn();
    const { rerender } = render(
      <QuickMatchOptions prefs={{ aiCount: 5, aiDifficulty: 'hard', victory: 'majority' }} onChange={vi.fn()} onStart={onStart} starting={false} />,
    );

    const startButton = screen.getByRole('button', { name: /Start vs 5 Hard/ });
    fireEvent.click(startButton);
    expect(onStart).toHaveBeenCalledTimes(1);

    rerender(
      <QuickMatchOptions prefs={{ aiCount: 5, aiDifficulty: 'hard', victory: 'majority' }} onChange={vi.fn()} onStart={onStart} starting />,
    );
    expect(screen.getByRole('button', { name: /Starting…/ })).toBeDisabled();
  });

  it('shows the hint for the selected difficulty', () => {
    render(
      <QuickMatchOptions prefs={{ aiCount: 3, aiDifficulty: 'expert', victory: 'majority' }} onChange={vi.fn()} onStart={vi.fn()} starting={false} />,
    );
    expect(screen.getByText(/Ruthless/)).toBeInTheDocument();
  });

  it('renders every win condition with the current one pressed', () => {
    render(<QuickMatchOptions prefs={basePrefs} onChange={vi.fn()} onStart={vi.fn()} starting={false} />);

    for (const label of ['Blitz', 'Majority', 'Capitals', 'Conquest']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Majority' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Conquest' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports win-condition changes without mutating the AI setup', () => {
    const onChange = vi.fn();
    render(<QuickMatchOptions prefs={basePrefs} onChange={onChange} onStart={vi.fn()} starting={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Conquest' }));
    expect(onChange).toHaveBeenCalledWith({ aiCount: 3, aiDifficulty: 'medium', victory: 'conquest' });
  });

  it('spells out what ends the match — the point of the picker', () => {
    // The old panel said nothing about the 65% ending, so a match stopping with
    // a third of the map still contested read as a bug.
    const { rerender } = render(
      <QuickMatchOptions prefs={basePrefs} onChange={vi.fn()} onStart={vi.fn()} starting={false} />,
    );
    expect(screen.getByText(/Hold 65% of the map/)).toBeInTheDocument();

    rerender(
      <QuickMatchOptions
        prefs={{ ...basePrefs, victory: 'conquest' }}
        onChange={vi.fn()}
        onStart={vi.fn()}
        starting={false}
      />,
    );
    expect(screen.getByText(/Hold every territory on the map/)).toBeInTheDocument();
  });
});
