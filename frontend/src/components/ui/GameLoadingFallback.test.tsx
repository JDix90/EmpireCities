/**
 * Game loading: Play Free Now goes to /tutorial, then /game/:id, and each
 * page's code downloads first. On a phone line that was 8 seconds of grey
 * boxes and the wordmark.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GameLoadingFallback, { SLOW_LOAD_MS, useGameLoadingKind } from './GameLoadingFallback';

function Kind() {
  return <span data-testid="kind">{String(useGameLoadingKind())}</span>;
}
const kindAt = (entry: string | { pathname: string; state?: unknown }) => {
  const { unmount } = render(<MemoryRouter initialEntries={[entry]}><Kind /></MemoryRouter>);
  const kind = screen.getByTestId('kind').textContent;
  unmount();
  return kind;
};

describe('game loading label', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('names the tutorial and the game routes, and no other', () => {
    expect(kindAt('/tutorial?start=1')).toBe('practice');
    expect(kindAt({ pathname: '/game/g1', state: { practiceMatch: true } })).toBe('practice');
    expect(kindAt('/game/g1')).toBe('match');
    expect(kindAt('/lobby')).toBe('null');
  });

  it('says what is loading, then owns up to a slow connection', () => {
    vi.useFakeTimers();
    render(<GameLoadingFallback practice />);
    expect(screen.getByText('Setting up your practice match')).toBeTruthy();
    expect(screen.getByText('Loading the board and your opponents.')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(SLOW_LOAD_MS); });
    expect(screen.getByText(/A slow connection can take a few more seconds/)).toBeTruthy();
  });

  it('reads "your match" outside the tutorial', () => {
    render(<GameLoadingFallback practice={false} />);
    expect(screen.getByText('Setting up your match')).toBeTruthy();
  });
});
