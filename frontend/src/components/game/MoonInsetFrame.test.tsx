import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MoonInsetFrame from './MoonInsetFrame';
import { setMoonInsetCollapsed } from '../../utils/userPreferences';

/**
 * The Space Age board is two worlds, so the Earth map carries a Moon inset in
 * the corner. On a phone it cost real screen area from turn one, long before a
 * player had the Space Program tech to go there, and there was no way to put it
 * away.
 */

describe('MoonInsetFrame', () => {
  beforeEach(() => {
    localStorage.clear();
    setMoonInsetCollapsed(false);
  });

  it('shows the inset expanded by default', () => {
    render(<MoonInsetFrame><div data-testid="moon-canvas" /></MoonInsetFrame>);
    expect(screen.getByTestId('moon-inset')).toBeInTheDocument();
    expect(screen.getByTestId('moon-canvas')).toBeInTheDocument();
  });

  it('folds down to a pill and unmounts the nested renderer', () => {
    render(<MoonInsetFrame><div data-testid="moon-canvas" /></MoonInsetFrame>);
    fireEvent.click(screen.getByRole('button', { name: 'Minimize the Moon map' }));

    expect(screen.queryByTestId('moon-inset')).not.toBeInTheDocument();
    // Not merely hidden: each inset is a whole second renderer, so leaving it
    // mounted would keep a render loop and GPU context alive for a map nobody
    // is looking at — the cost minimizing exists to avoid.
    expect(screen.queryByTestId('moon-canvas')).not.toBeInTheDocument();
    expect(screen.getByTestId('moon-inset-expand')).toBeInTheDocument();
  });

  it('comes back from the pill', () => {
    render(<MoonInsetFrame><div data-testid="moon-canvas" /></MoonInsetFrame>);
    fireEvent.click(screen.getByRole('button', { name: 'Minimize the Moon map' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show the Moon map' }));

    expect(screen.getByTestId('moon-inset')).toBeInTheDocument();
    expect(screen.getByTestId('moon-canvas')).toBeInTheDocument();
  });

  it('remembers the choice for the next game', () => {
    const first = render(<MoonInsetFrame><div /></MoonInsetFrame>);
    fireEvent.click(screen.getByRole('button', { name: 'Minimize the Moon map' }));
    first.unmount();

    render(<MoonInsetFrame><div data-testid="moon-canvas" /></MoonInsetFrame>);
    expect(screen.getByTestId('moon-inset-expand')).toBeInTheDocument();
    expect(screen.queryByTestId('moon-canvas')).not.toBeInTheDocument();
  });

  it('carries the sizing its host gives it, since the two views size differently', () => {
    // The 2D inset is pinned to exact canvas pixels (a mismatch clips the Moon);
    // the globe inset is a percentage of its container.
    const { rerender } = render(
      <MoonInsetFrame style={{ width: 320, height: 240 }}><div /></MoonInsetFrame>,
    );
    expect(screen.getByTestId('moon-inset')).toHaveStyle({ width: '320px', height: '240px' });

    rerender(<MoonInsetFrame className="w-[34%] h-[34%]"><div /></MoonInsetFrame>);
    expect(screen.getByTestId('moon-inset').className).toContain('w-[34%]');
  });
});
