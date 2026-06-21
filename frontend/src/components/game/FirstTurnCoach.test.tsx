import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
});

import FirstTurnCoach from './FirstTurnCoach';

describe('FirstTurnCoach', () => {
  it('renders the reinforcement prompt with the bolded unit count', () => {
    render(<FirstTurnCoach phase="reinforcement" unitsToPlace={5} onDismiss={() => {}} />);
    expect(screen.getByText('Place your reinforcements')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
  });

  it('renders the attack prompt', () => {
    render(<FirstTurnCoach phase="attack" onDismiss={() => {}} />);
    expect(screen.getByText('Attack a neighbor')).toBeTruthy();
  });

  it('renders the fortify prompt', () => {
    render(<FirstTurnCoach phase="fortify" onDismiss={() => {}} />);
    expect(screen.getByText('Move your troops')).toBeTruthy();
  });

  it('calls onDismiss from the close (X) button', () => {
    const onDismiss = vi.fn();
    render(<FirstTurnCoach phase="attack" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByTestId('first-turn-coach-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('calls onDismiss from the "Got it" button', () => {
    const onDismiss = vi.fn();
    render(<FirstTurnCoach phase="reinforcement" unitsToPlace={3} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByText('Got it'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('does not block pointer events on the overlay wrapper', () => {
    render(<FirstTurnCoach phase="attack" onDismiss={() => {}} />);
    const wrapper = screen.getByTestId('first-turn-coach');
    expect(wrapper.className).toContain('pointer-events-none');
  });
});
