import React, { useState } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { useBottomSheetSnap } from '../../hooks/useBottomSheetSnap';
import { hapticNotification, NotificationType } from '../../utils/haptics';
import { useCardSetsExplainEnabled } from '../../store/featureFlagsStore';
import { cardPickView, CARD_SET_RULE } from '../../utils/cardSets';

interface MobileCardsTrayProps {
  cards: Array<{ card_id: string; symbol: string }>;
  isMyTurn: boolean;
  isDraftPhase: boolean;
  onRedeemCards: (cardIds: string[]) => void;
  onClose: () => void;
  /** Units the next set pays (card_sets_explain_enabled). */
  nextSetBonus?: number;
}

function MobileCardsTray({
  cards,
  isMyTurn,
  isDraftPhase,
  onRedeemCards,
  onClose,
  nextSetBonus,
}: MobileCardsTrayProps) {
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  // card_sets_explain_enabled: which cards make a set, what the pick is, and
  // what the next set pays. Off, the tray is exactly as before.
  const explain = useCardSetsExplainEnabled();
  const view = explain ? cardPickView(cards, selectedCards) : null;
  const canTrade = isMyTurn && isDraftPhase;
  const payout = nextSetBonus != null ? `+${nextSetBonus} units` : 'bonus units';
  const [snap, setSnap] = useState<'peek' | 'half' | 'full'>('half');
  const { sheetRef, handleProps, snapClassName } = useBottomSheetSnap({
    snap,
    onSnapChange: setSnap,
    onDismiss: onClose,
  });

  const toggleCard = (cardId: string) => {
    setSelectedCards((prev) =>
      prev.includes(cardId)
        ? prev.filter((id) => id !== cardId)
        : prev.length < 3
          ? [...prev, cardId]
          : prev,
    );
  };

  const handleRedeem = () => {
    if (selectedCards.length === 3) {
      hapticNotification(NotificationType.Success);
      onRedeemCards(selectedCards);
      setSelectedCards([]);
      onClose();
    }
  };

  /** One tap: the set the server would pick first, as the bots trade. */
  const handleTradeFirst = () => {
    if (!view?.firstSet) return;
    hapticNotification(NotificationType.Success);
    onRedeemCards(view.firstSet);
    setSelectedCards([]);
    onClose();
  };

  return (
    <div ref={sheetRef} className={clsx('fixed mobile-sheet-above-nav inset-x-0 overflow-y-auto rounded-t-2xl border-t border-bf-border z-30 animate-slide-up bg-bf-surface pb-safe', snapClassName)}>
      {/* Drag handle (swipe-to-dismiss) */}
      <div {...handleProps} className="sticky top-0 flex justify-center py-2.5 bg-bf-surface z-10 cursor-grab">
        <div className="w-8 h-1 rounded-full bg-bf-border" />
      </div>

      <div className="px-4 pb-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-sm text-bf-gold">
            Your Cards ({cards.length})
            {view && nextSetBonus != null && (
              <span className="ml-2 font-sans text-xs font-medium text-bf-muted" data-testid="cards-next-bonus">
                Next set {payout}
              </span>
            )}
          </h3>
          <button
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-bf-muted hover:text-bf-text transition-colors -mr-2 -mt-1 shrink-0"
            aria-label="Close cards"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* What a set is and where this pick stands (card_sets_explain_enabled). */}
        {view && (
          <p className="text-xs text-bf-muted mb-3" data-testid="cards-guidance" role="status">
            {!canTrade
              ? view.firstSet
                ? `You have a set ready for ${payout}. Trade it during your reinforcement phase.`
                : `Trade a set during your reinforcement phase. ${CARD_SET_RULE}`
              : view.pick === 'valid'
                ? `That's a set: ${payout}.`
                : view.pick === 'invalid'
                  ? `Not a set. ${CARD_SET_RULE}`
                  : view.pick === 'partial' && view.firstSet
                    ? `Pick ${3 - selectedCards.length} more. Cards that can't finish a set are dimmed.`
                    : view.firstSet
                      ? `You have a set. Trade it, or pick three yourself. ${CARD_SET_RULE}`
                      : `No set yet. ${CARD_SET_RULE}`}
          </p>
        )}
        {/* Selection guidance */}
        {!view && isDraftPhase && isMyTurn && (
          <p className="text-xs text-bf-muted mb-3">
            {selectedCards.length === 0
              ? 'Select 3 cards to redeem for bonus units'
              : selectedCards.length < 3
                ? `Select ${3 - selectedCards.length} more card${3 - selectedCards.length > 1 ? 's' : ''}`
                : 'Ready to redeem!'}
          </p>
        )}
        {!view && (!isDraftPhase || !isMyTurn) && (
          <p className="text-xs text-bf-muted mb-3">
            Cards can be redeemed during your reinforcement phase.
          </p>
        )}

        {/* Card grid */}
        <div className="flex flex-wrap gap-2">
          {cards.map((card) => {
            const isSelected = selectedCards.includes(card.card_id);
            const inSet = !!view?.inSet.has(card.card_id);
            // Dimmed: with a pick under way, this card can't finish a set with it.
            const blocked = !!view?.firstSet && canTrade && selectedCards.length > 0 && !view.canJoin(card.card_id);
            return (
              <button
                key={card.card_id}
                onClick={() => toggleCard(card.card_id)}
                disabled={blocked}
                aria-pressed={view ? isSelected : undefined}
                aria-label={view ? `${card.symbol}${inSet ? ', part of a set' : ''}${blocked ? ", can't finish this set" : ''}` : undefined}
                data-in-set={view ? String(inSet) : undefined}
                className={clsx(
                  'min-h-[44px] min-w-[44px] px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
                  isSelected
                    ? 'border-bf-gold bg-bf-gold/10 text-bf-gold'
                    : 'border-bf-border text-bf-text hover:border-bf-gold/50',
                  view && 'relative',
                  blocked && 'opacity-40 cursor-not-allowed',
                )}
              >
                <span className="capitalize">{card.symbol}</span>
                {inSet && !isSelected && (
                  <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-bf-gold" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>

        {/* Redeem button */}
        {view ? (
          canTrade && (
            selectedCards.length === 3 ? (
              <button
                onClick={handleRedeem}
                disabled={view.pick !== 'valid'}
                className={clsx('btn-primary w-full text-sm py-3 mt-4', view.pick !== 'valid' && 'opacity-50 cursor-not-allowed')}
                data-testid="cards-redeem"
              >
                {view.pick === 'valid' ? `Redeem for ${payout}` : 'Not a set'}
              </button>
            ) : selectedCards.length === 0 && view.firstSet ? (
              <button onClick={handleTradeFirst} className="btn-primary w-full text-sm py-3 mt-4" data-testid="cards-trade-first">
                Trade a set for {payout}
              </button>
            ) : null
          )
        ) : selectedCards.length === 3 && isMyTurn && isDraftPhase && (
          <button
            onClick={handleRedeem}
            className="btn-primary w-full text-sm py-3 mt-4"
          >
            Redeem Set
          </button>
        )}
      </div>
    </div>
  );
}


export default React.memo(MobileCardsTray);
