import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import EventCardModal, { type EventCard } from './EventCardModal';

const baseCard: EventCard = {
  card_id: 'ancient_barbarian_horde',
  title: 'Barbarian Horde',
  description: 'Nomadic raiders sweep across the frontier. Lose 2 units from your largest territories.',
  category: 'player_targeted',
  era_id: 'ancient',
  effect: { type: 'units_removed', target: 'player', value: 2 },
};

const noop = () => {};

describe('EventCardModal — era impact scaling (#2)', () => {
  it('shows the era-impact badge when a card is scaled', () => {
    render(
      <EventCardModal
        card={{ ...baseCard, effect: { ...baseCard.effect!, value: 6 }, magnitude_scale: 3 }}
        isMyTurn
        onChoice={noop}
        onDismiss={noop}
      />,
    );
    expect(screen.getByText(/Era impact ×3/)).toBeInTheDocument();
  });

  it('renders the scaled magnitude in the mechanical effect line', () => {
    // The broadcast effect value is already scaled server-side, so the "Effect:"
    // line reflects what will actually happen, not the card's flavor number.
    render(
      <EventCardModal
        card={{ ...baseCard, effect: { ...baseCard.effect!, value: 6 }, magnitude_scale: 3 }}
        isMyTurn
        onChoice={noop}
        onDismiss={noop}
      />,
    );
    expect(screen.getByText(/lose up to 6 units/i)).toBeInTheDocument();
  });

  it('shows no badge for an unscaled card', () => {
    render(<EventCardModal card={baseCard} isMyTurn onChoice={noop} onDismiss={noop} />);
    expect(screen.queryByText(/Era impact/)).toBeNull();
    expect(screen.getByText(/lose up to 2 units/i)).toBeInTheDocument();
  });

  it('formats a half-step multiplier as ×2.5', () => {
    render(
      <EventCardModal
        card={{ ...baseCard, effect: { ...baseCard.effect!, value: 5 }, magnitude_scale: 2.5 }}
        isMyTurn
        onChoice={noop}
        onDismiss={noop}
      />,
    );
    expect(screen.getByText(/Era impact ×2\.5/)).toBeInTheDocument();
  });
});
