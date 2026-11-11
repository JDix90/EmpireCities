/**
 * The phone's cards tray (card_sets_explain_enabled): what the next set pays,
 * what a set is, which cards make one, which cannot finish the pick, and a
 * one-tap trade. Off, the tray is the bare symbols as before.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MobileCardsTray from './MobileCardsTray';
import { useFeatureFlagsStore } from '../../store/featureFlagsStore';

vi.mock('../../utils/haptics', () => ({ hapticNotification: vi.fn(), NotificationType: { Success: 'success' } }));

const hand = [
  { card_id: 'c1', symbol: 'infantry' },
  { card_id: 'c2', symbol: 'infantry' },
  { card_id: 'c3', symbol: 'cavalry' },
  { card_id: 'c4', symbol: 'artillery' },
];

const setFlag = (on: boolean) =>
  useFeatureFlagsStore.setState((s) => ({ flags: { ...s.flags, card_sets_explain_enabled: on } }));

function renderTray(props: Partial<React.ComponentProps<typeof MobileCardsTray>> = {}) {
  const onRedeemCards = vi.fn();
  const onClose = vi.fn();
  render(
    <MobileCardsTray
      cards={hand}
      isMyTurn
      isDraftPhase
      onRedeemCards={onRedeemCards}
      onClose={onClose}
      nextSetBonus={6}
      {...props}
    />,
  );
  return { onRedeemCards, onClose };
}

const cardButton = (label: RegExp) => screen.getByRole('button', { name: label });

describe('cards tray, sets explained', () => {
  afterEach(() => setFlag(false));

  it('says what the next set pays and trades the first set in one tap', () => {
    setFlag(true);
    const { onRedeemCards, onClose } = renderTray();
    expect(screen.getByTestId('cards-next-bonus')).toHaveTextContent('Next set +6 units');
    expect(screen.getByTestId('cards-guidance')).toHaveTextContent('You have a set');
    expect(screen.getAllByRole('button', { name: /part of a set/ })).toHaveLength(4);
    fireEvent.click(screen.getByTestId('cards-trade-first'));
    expect(onRedeemCards).toHaveBeenCalledWith(['c1', 'c3', 'c4']);
    expect(onClose).toHaveBeenCalled();
  });

  it('dims a card that cannot finish the pick, and says when three are a set', () => {
    setFlag(true);
    renderTray();
    fireEvent.click(screen.getAllByRole('button', { name: /^infantry/ })[0]);
    expect(screen.getByTestId('cards-guidance')).toHaveTextContent("Pick 2 more. Cards that can't finish a set are dimmed.");
    expect(cardButton(/^infantry, part of a set, can't finish this set/)).toBeDisabled();
    fireEvent.click(cardButton(/^cavalry/));
    fireEvent.click(cardButton(/^artillery/));
    expect(screen.getByTestId('cards-guidance')).toHaveTextContent("That's a set: +6 units.");
    expect(screen.getByTestId('cards-redeem')).toHaveTextContent('Redeem for +6 units');
    expect(screen.getByTestId('cards-redeem')).toBeEnabled();
  });

  it('says when there is no set yet, and what one is', () => {
    setFlag(true);
    renderTray({ cards: hand.slice(0, 3) });
    expect(screen.getByTestId('cards-guidance')).toHaveTextContent('No set yet. Three of a kind, one of each, or a pair plus a wild.');
    expect(screen.queryByTestId('cards-trade-first')).toBeNull();
  });

  it('outside the draft, says a set is ready and offers no trade', () => {
    setFlag(true);
    renderTray({ isDraftPhase: false });
    expect(screen.getByTestId('cards-guidance')).toHaveTextContent('You have a set ready for +6 units. Trade it during your reinforcement phase.');
    expect(screen.queryByTestId('cards-trade-first')).toBeNull();
  });

  it('is the tray as before with the flag off', () => {
    setFlag(false);
    renderTray();
    expect(screen.getByText('Select 3 cards to redeem for bonus units')).toBeInTheDocument();
    expect(screen.queryByTestId('cards-next-bonus')).toBeNull();
    expect(screen.queryByTestId('cards-trade-first')).toBeNull();
    expect(screen.queryByRole('button', { name: /part of a set/ })).toBeNull();
  });
});
