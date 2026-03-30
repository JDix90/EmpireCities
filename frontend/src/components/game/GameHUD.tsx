import React, { useState, useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useAuthStore } from '../../store/authStore';
import { Shield, Sword, ArrowRight, Clock, Users, CreditCard, Flag } from 'lucide-react';
import clsx from 'clsx';

interface GameHUDProps {
  onAdvancePhase: () => void;
  onRedeemCards: (cardIds: string[]) => void;
  onResign?: () => void;
  lastCombatLog: string[];
}

const PHASE_LABELS: Record<string, string> = {
  draft:     'Reinforcement',
  attack:    'Attack',
  fortify:   'Fortify',
  game_over: 'Game Over',
};

const PHASE_ICONS: Record<string, React.ReactNode> = {
  draft:   <Shield className="w-4 h-4" />,
  attack:  <Sword className="w-4 h-4" />,
  fortify: <ArrowRight className="w-4 h-4" />,
};

export default function GameHUD({ onAdvancePhase, onRedeemCards, onResign, lastCombatLog }: GameHUDProps) {
  const { gameState, draftUnitsRemaining, lastCombatResult } = useGameStore();
  const { user } = useAuthStore();
  const [showCards, setShowCards] = useState(false);
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);

  const isMyTurn = gameState?.players[gameState.current_player_index]?.player_id === user?.user_id;
  const currentPlayer = gameState?.players[gameState?.current_player_index ?? 0];
  const myPlayer = gameState?.players.find((p) => p.player_id === user?.user_id);

  // Turn timer countdown
  useEffect(() => {
    if (!gameState?.settings.turn_timer_seconds || gameState.settings.turn_timer_seconds === 0) {
      setTimeLeft(null);
      return;
    }
    const elapsed = Math.floor((Date.now() - gameState.turn_started_at) / 1000);
    const remaining = gameState.settings.turn_timer_seconds - elapsed;
    setTimeLeft(Math.max(0, remaining));

    const interval = setInterval(() => {
      setTimeLeft((prev) => (prev !== null && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [gameState?.turn_started_at, gameState?.settings.turn_timer_seconds]);

  const toggleCardSelection = (cardId: string) => {
    setSelectedCards((prev) =>
      prev.includes(cardId) ? prev.filter((id) => id !== cardId) : prev.length < 3 ? [...prev, cardId] : prev
    );
  };

  const handleRedeemCards = () => {
    if (selectedCards.length === 3) {
      onRedeemCards(selectedCards);
      setSelectedCards([]);
      setShowCards(false);
    }
  };

  if (!gameState) return null;

  return (
    <div className="flex flex-col h-full bg-cc-surface border-l border-cc-border w-72 shrink-0">
      {/* Phase Indicator */}
      <div className={clsx(
        'p-4 border-b border-cc-border',
        isMyTurn ? 'bg-cc-gold/10' : 'bg-cc-dark/50'
      )}>
        <div className="flex items-center gap-2 mb-1">
          {PHASE_ICONS[gameState.phase]}
          <span className="font-display text-sm text-cc-gold">
            {PHASE_LABELS[gameState.phase] ?? gameState.phase}
          </span>
        </div>
        <p className="text-xs text-cc-muted">
          Turn {gameState.turn_number} · {isMyTurn ? 'Your turn' : `${currentPlayer?.username}'s turn`}
        </p>
        {timeLeft !== null && (
          <div className={clsx(
            'flex items-center gap-1 mt-2 text-sm font-mono',
            timeLeft < 30 ? 'text-red-400' : 'text-cc-muted'
          )}>
            <Clock className="w-3.5 h-3.5" />
            {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
          </div>
        )}
        {gameState.phase === 'draft' && isMyTurn && (
          <p className="text-cc-gold text-sm mt-2 font-medium">
            {draftUnitsRemaining} units to place
          </p>
        )}
      </div>

      {/* Players List */}
      <div className="p-4 border-b border-cc-border">
        <h3 className="text-xs font-medium text-cc-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" /> Players
        </h3>
        <div className="space-y-2">
          {gameState.players.map((player, idx) => (
            <div
              key={player.player_id}
              className={clsx(
                'flex items-center gap-2 p-2 rounded-lg text-sm transition-colors',
                idx === gameState.current_player_index && 'bg-cc-dark ring-1 ring-cc-gold/40',
                player.is_eliminated && 'opacity-40'
              )}
            >
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: player.color }}
              />
              <span className={clsx(
                'flex-1 truncate',
                player.player_id === user?.user_id ? 'text-cc-gold font-medium' : 'text-cc-text'
              )}>
                {player.username}
                {player.is_ai && <span className="text-cc-muted text-xs ml-1">(AI)</span>}
              </span>
              <span className="text-cc-muted text-xs">{player.territory_count}T</span>
              {player.is_eliminated && (
                <span className="text-red-500 text-xs">✗</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* My Cards */}
      {myPlayer && myPlayer.cards.length > 0 && (
        <div className="p-4 border-b border-cc-border">
          <button
            className="w-full flex items-center justify-between text-xs font-medium text-cc-muted uppercase tracking-wider hover:text-cc-gold transition-colors"
            onClick={() => setShowCards(!showCards)}
          >
            <span className="flex items-center gap-1.5">
              <CreditCard className="w-3.5 h-3.5" /> Cards ({myPlayer.cards.length})
            </span>
            <span>{showCards ? '▲' : '▼'}</span>
          </button>

          {showCards && (
            <div className="mt-3 space-y-2">
              {myPlayer.cards.map((card) => (
                <button
                  key={card.card_id}
                  onClick={() => toggleCardSelection(card.card_id)}
                  className={clsx(
                    'w-full text-left p-2 rounded border text-sm transition-colors',
                    selectedCards.includes(card.card_id)
                      ? 'border-cc-gold bg-cc-gold/10 text-cc-gold'
                      : 'border-cc-border text-cc-text hover:border-cc-gold/50'
                  )}
                >
                  <span className="capitalize">{card.symbol}</span>
                </button>
              ))}
              {selectedCards.length === 3 && isMyTurn && gameState.phase === 'draft' && (
                <button onClick={handleRedeemCards} className="btn-primary w-full text-sm py-1.5 mt-2">
                  Redeem Set
                </button>
              )}
              {selectedCards.length > 0 && selectedCards.length < 3 && (
                <p className="text-xs text-cc-muted">Select {3 - selectedCards.length} more</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Combat Log */}
      <div className="p-4 flex-1 overflow-y-auto">
        <h3 className="text-xs font-medium text-cc-muted uppercase tracking-wider mb-3">Combat Log</h3>
        {lastCombatResult && (
          <div className="mb-3 p-3 bg-cc-dark rounded-lg border border-cc-border text-xs space-y-2">
            {lastCombatResult.fromName && lastCombatResult.toName && (
              <p className="text-cc-text font-medium">
                {lastCombatResult.fromName} → {lastCombatResult.toName}
              </p>
            )}
            <div className="flex gap-3">
              <div className="flex-1">
                <p className="text-cc-muted mb-0.5">{lastCombatResult.attackerName ?? 'Attacker'}</p>
                <div className="flex gap-1">
                  {lastCombatResult.attacker_rolls.map((roll, i) => (
                    <span key={i} className="inline-flex items-center justify-center w-5 h-5 rounded bg-red-500/20 text-red-400 font-mono text-xs font-bold">{roll}</span>
                  ))}
                </div>
                {lastCombatResult.attacker_losses > 0 && (
                  <p className="text-red-400 mt-1">Lost {lastCombatResult.attacker_losses} troop{lastCombatResult.attacker_losses > 1 ? 's' : ''}</p>
                )}
              </div>
              <div className="w-px bg-cc-border" />
              <div className="flex-1">
                <p className="text-cc-muted mb-0.5">{lastCombatResult.defenderName ?? 'Defender'}</p>
                <div className="flex gap-1">
                  {lastCombatResult.defender_rolls.map((roll, i) => (
                    <span key={i} className="inline-flex items-center justify-center w-5 h-5 rounded bg-blue-500/20 text-blue-400 font-mono text-xs font-bold">{roll}</span>
                  ))}
                </div>
                {lastCombatResult.defender_losses > 0 && (
                  <p className="text-blue-400 mt-1">Lost {lastCombatResult.defender_losses} troop{lastCombatResult.defender_losses > 1 ? 's' : ''}</p>
                )}
              </div>
            </div>
            {lastCombatResult.territory_captured && (
              <p className="text-cc-gold font-medium pt-1 border-t border-cc-border">
                Territory Captured!
              </p>
            )}
          </div>
        )}
        <div className="space-y-1.5">
          {lastCombatLog.slice(-8).reverse().map((entry, i) => (
            <p key={i} className={clsx(
              'text-xs leading-relaxed',
              i === 0 ? 'text-cc-text' : 'text-cc-muted'
            )}>{entry}</p>
          ))}
        </div>
      </div>

      {/* Phase Advance Button */}
      {isMyTurn && gameState.phase !== 'game_over' && (
        <div className="p-4 border-t border-cc-border">
          <button onClick={onAdvancePhase} className="btn-primary w-full">
            {gameState.phase === 'draft' && 'Begin Attack Phase →'}
            {gameState.phase === 'attack' && 'Begin Fortify Phase →'}
            {gameState.phase === 'fortify' && 'End Turn →'}
          </button>
        </div>
      )}

      {/* Resign Button */}
      {gameState.phase !== 'game_over' && myPlayer && !myPlayer.is_eliminated && onResign && (
        <div className="px-4 pb-3">
          <button
            onClick={onResign}
            className="w-full py-1.5 text-xs text-cc-muted hover:text-red-400 transition-colors
                       flex items-center justify-center gap-1.5 rounded border border-transparent hover:border-red-500/20"
          >
            <Flag className="w-3 h-3" /> Resign
          </button>
        </div>
      )}
    </div>
  );
}
