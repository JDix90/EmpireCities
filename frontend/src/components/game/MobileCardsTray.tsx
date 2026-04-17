import React, { useState } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { useSwipeToDismiss } from '../../hooks/useSwipeToDismiss';
import { hapticNotification, NotificationType } from '../../utils/haptics';

interface MobileCardsTrayProps {
  cards: Array<{ card_id: string; symbol: string }>;
  isMyTurn: boolean;
  isDraftPhase: boolean;
  onRedeemCards: (cardIds: string[]) => void;
  onClose: () => void;
}

function MobileCardsTray({
  cards,
  isMyTurn,
  isDraftPhase,
  onRedeemCards,
  onClose,
}: MobileCardsTrayProps) {
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const { sheetRef, handleProps } = useSwipeToDismiss({ onDismiss: onClose });

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

  return (
    <div ref={sheetRef} className="fixed bottom-16 inset-x-0 max-h-[60vh] mobile-bottom-sheet overflow-y-auto rounded-t-2xl border-t border-cc-border z-30 animate-slide-up bg-cc-surface pb-safe">
      {/* Drag handle (swipe-to-dismiss) */}
      <div {...handleProps} className="sticky top-0 flex justify-center py-2.5 bg-cc-surface z-10 cursor-grab">
        <div className="w-8 h-1 rounded-full bg-cc-border" />
      </div>

      <div className="px-4 pb-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display text-sm text-cc-gold">
            Your Cards ({cards.length})
          </h3>
          <button
            onClick={onClose}
            className="text-cc-muted hover:text-cc-text transition-colors"
            aria-label="Close cards"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Selection guidance */}
        {isDraftPhase && isMyTurn && (
          <p className="text-xs text-cc-muted mb-3">
            {selectedCards.length === 0
              ? 'Select 3 cards to redeem for bonus units'
              : selectedCards.length < 3
                ? `Select ${3 - selectedCards.length} more card${3 - selectedCards.length > 1 ? 's' : ''}`
                : 'Ready to redeem!'}
          </p>
        )}
        {(!isDraftPhase || !isMyTurn) && (
          <p className="text-xs text-cc-muted mb-3">
            Cards can be redeemed during your reinforcement phase.
          </p>
        )}

        {/* Card grid */}
        <div className="flex flex-wrap gap-2">
          {cards.map((card) => {
            const isSelected = selectedCards.includes(card.card_id);
            return (
              <button
                key={card.card_id}
                onClick={() => toggleCard(card.card_id)}
                className={clsx(
                  'min-h-[44px] min-w-[44px] px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
                  isSelected
                    ? 'border-cc-gold bg-cc-gold/10 text-cc-gold'
                    : 'border-cc-border text-cc-text hover:border-cc-gold/50',
                )}
              >
                <span className="capitalize">{card.symbol}</span>
              </button>
            );
          })}
        </div>

        {/* Redeem button */}
        {selectedCards.length === 3 && isMyTurn && isDraftPhase && (
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
