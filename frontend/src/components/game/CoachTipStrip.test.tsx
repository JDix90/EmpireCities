import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CoachTipStrip from './CoachTipStrip';

describe('CoachTipStrip (coach_tips_enabled)', () => {
  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
  });

  it('says the step in one line, with the player\u2019s colour, and hides tips on request', () => {
    const onHide = vi.fn();
    render(<CoachTipStrip tip={{ id: 'attack', text: 'Tap your biggest stack.' }} playerColor="#e74c3c" onHide={onHide} />);
    const strip = screen.getByTestId('coach-tip-strip');
    expect(strip.getAttribute('role')).toBe('status');
    expect(strip.dataset.tip).toBe('attack');
    expect(strip.textContent).toContain('Tap your biggest stack.');
    expect(screen.getByTitle('Your colour')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide tips' }));
    expect(onHide).toHaveBeenCalledTimes(1);
  });
});
