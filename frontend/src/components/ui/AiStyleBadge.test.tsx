import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AiStyleBadge } from './AiStyleBadge';

describe('AiStyleBadge', () => {
  it('names the style and says how it plays', () => {
    render(<AiStyleBadge style="defender" />);
    const badge = screen.getByLabelText('Defender: Picks its fights, attacking only at good odds.');
    expect(badge).toHaveTextContent('Defender');
    expect(badge).toHaveAttribute('title', 'Defender: Picks its fights, attacking only at good odds.');
  });

  it('shows only its icon in a tight row, and still says what it is', () => {
    render(<AiStyleBadge style="conqueror" showLabel={false} />);
    const badge = screen.getByLabelText(/^Conqueror:/);
    expect(badge).not.toHaveTextContent('Conqueror');
  });
});
