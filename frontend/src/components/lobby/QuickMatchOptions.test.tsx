import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import QuickMatchOptions from './QuickMatchOptions';
import type { QuickMatchPrefs } from '../../utils/quickMatchPrefs';

const basePrefs: QuickMatchPrefs = { aiCount: 3, aiDifficulty: 'medium' };

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
    expect(onChange).toHaveBeenCalledWith({ aiCount: 7, aiDifficulty: 'medium' });
  });

  it('reports difficulty changes without mutating count', () => {
    const onChange = vi.fn();
    render(<QuickMatchOptions prefs={basePrefs} onChange={onChange} onStart={vi.fn()} starting={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Expert' }));
    expect(onChange).toHaveBeenCalledWith({ aiCount: 3, aiDifficulty: 'expert' });
  });

  it('starts with the chosen setup and disables while starting', () => {
    const onStart = vi.fn();
    const { rerender } = render(
      <QuickMatchOptions prefs={{ aiCount: 5, aiDifficulty: 'hard' }} onChange={vi.fn()} onStart={onStart} starting={false} />,
    );

    const startButton = screen.getByRole('button', { name: /Start vs 5 Hard/ });
    fireEvent.click(startButton);
    expect(onStart).toHaveBeenCalledTimes(1);

    rerender(
      <QuickMatchOptions prefs={{ aiCount: 5, aiDifficulty: 'hard' }} onChange={vi.fn()} onStart={onStart} starting />,
    );
    expect(screen.getByRole('button', { name: /Starting…/ })).toBeDisabled();
  });

  it('shows the hint for the selected difficulty', () => {
    render(
      <QuickMatchOptions prefs={{ aiCount: 3, aiDifficulty: 'expert' }} onChange={vi.fn()} onStart={vi.fn()} starting={false} />,
    );
    expect(screen.getByText(/Ruthless/)).toBeInTheDocument();
  });
});
