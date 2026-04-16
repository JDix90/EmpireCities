import React, { useState, useEffect } from 'react';
import { useGameStore, type PlayerState, type SecretMissionPayload } from '../../store/gameStore';
import { useAuthStore } from '../../store/authStore';
import { Shield, Sword, ArrowRight, Clock, Users, CreditCard, Flag, Save, Zap } from 'lucide-react';
import clsx from 'clsx';
import { computeDraftPool } from '../../utils/draftPool';
import GameChat from './GameChat';
import EraModifierBadge from './EraModifierBadge';
import { getSocket } from '../../services/socket';

interface GameHUDProps {
  onAdvancePhase: () => void;
  onRedeemCards: (cardIds: string[]) => void;
  onResign?: () => void;
  onSaveAndLeave?: () => void;
  onOpenTechTree?: () => void;
  onOpenBonuses?: () => void;
  lastCombatLog: string[];
  /** When set (in-progress game), chat renders at the bottom of this sidebar — never over the map. */
  gameId?: string;
  activeInteractionLabel?: string | null;
  /** When true, renders as a full-height flex column for the mobile drawer (skips hidden/md breakpoint). */
  mobile?: boolean;
}

const PHASE_LABELS: Record<string, string> = {
  territory_select: 'Territory Draft',
  draft:     'Reinforcement',
  attack:    'Attack',
  fortify:   'Fortify',
  game_over: 'Game Over',
};

const PHASE_ICONS: Record<string, React.ReactNode> = {
  territory_select: <Flag className="w-4 h-4" />,
  draft:   <Shield className="w-4 h-4" />,
  attack:  <Sword className="w-4 h-4" />,
  fortify: <ArrowRight className="w-4 h-4" />,
};

function describeSecretMission(mission: SecretMissionPayload, players: PlayerState[]): string {
  if (mission.kind === 'capture_territories' && mission.territory_ids) {
    return `Own: ${mission.territory_ids.join(' & ')}`;
  }
  if (mission.kind === 'eliminate_player' && mission.target_player_id) {
    const t = players.find((p) => p.player_id === mission.target_player_id);
    return `Eliminate ${t?.username ?? mission.target_player_id}`;
  }
  if (mission.kind === 'control_regions' && mission.region_ids?.length) {
    return `Control regions: ${mission.region_ids.join(', ')}`;
  }
  return 'Secret objective';
}

export default function GameHUD({
  onAdvancePhase,
  onRedeemCards,
  onResign,
  onSaveAndLeave,
  onOpenTechTree,
  onOpenBonuses,
  lastCombatLog,
  gameId,
  activeInteractionLabel,
  mobile = false,
}: GameHUDProps) {
  const { gameState, draftUnitsRemaining, lastCombatResult } = useGameStore();
  const { user } = useAuthStore();
  const [showCards, setShowCards] = useState(false);
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [spectatorCount, setSpectatorCount] = useState(0);

  const currentPlayer = gameState?.players[gameState?.current_player_index ?? 0];
  const myPlayer = gameState?.players.find(
    (p) => p.player_id === user?.user_id || (!!user?.username && p.username === user.username),
  );
  const isMyTurn = !!currentPlayer && !!myPlayer && currentPlayer.player_id === myPlayer.player_id;
  const draftPool = computeDraftPool(gameState, user?.user_id, user?.username, draftUnitsRemaining);

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

  useEffect(() => {
    if (!gameId) return;
    const socket = getSocket();
    const onSpectatorCount = ({ count }: { count: number }) => setSpectatorCount(count);
    socket.on('game:spectator_count', onSpectatorCount);
    return () => {
      socket.off('game:spectator_count', onSpectatorCount);
    };
  }, [gameId]);

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
    <div className={clsx(
      'flex flex-col min-h-0 bg-cc-surface',
      mobile
        ? 'flex-1 overflow-y-auto'
        : 'hidden md:flex h-full border-l border-cc-border w-72 shrink-0',
    )}>
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
        {timeLeft !== null && !gameState.settings.async_mode && (
          <div className={clsx(
            'flex items-center gap-1 mt-2 text-sm font-mono',
            timeLeft < 30 ? 'text-red-400' : 'text-cc-muted'
          )}>
            <Clock className="w-3.5 h-3.5" />
            {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
          </div>
        )}
        {gameState.settings.async_mode && (() => {
          const deadlineSec = gameState.settings.async_turn_deadline_seconds ?? 86400;
          const elapsed = (Date.now() - gameState.turn_started_at) / 1000;
          const remaining = Math.max(0, deadlineSec - elapsed);
          const hours = Math.floor(remaining / 3600);
          const mins = Math.floor((remaining % 3600) / 60);
          const ratio = remaining / deadlineSec;
          const color = ratio > 0.5 ? 'text-green-400' : ratio > 0.25 ? 'text-yellow-400' : 'text-red-400';
          return (
            <div className={clsx('flex items-center gap-1 mt-2 text-sm font-mono', color)}>
              <Clock className="w-3.5 h-3.5" />
              {hours > 0 ? `${hours}h ${mins}m` : `${mins}m`} remaining
              {!isMyTurn && <span className="text-cc-muted ml-1">· Waiting for {currentPlayer?.username}</span>}
            </div>
          );
        })()}
        {gameState.phase === 'draft' && isMyTurn && (
          <p className="text-cc-gold text-sm mt-2 font-medium">
            {draftPool} units to place
          </p>
        )}
        {spectatorCount > 0 && (
          <p className="text-xs text-sky-300 mt-2 font-medium">{spectatorCount} watching</p>
        )}
        {gameState.phase === 'territory_select' && (() => {
          const unclaimed = Object.values(gameState.territories).filter((t) => t.owner_id === null).length;
          return (
            <p className="text-cc-gold text-sm mt-2 font-medium">
              {unclaimed} territories remaining · {isMyTurn ? 'Pick a territory' : 'Waiting...'}
            </p>
          );
        })()}
        {/* Era modifier badges */}
        <EraModifierBadge gameState={gameState} className="mt-2" />
        {activeInteractionLabel && (
          <div className="mt-2 px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-900/40 border border-yellow-700/50 text-yellow-200 inline-flex items-center gap-1.5">
            {activeInteractionLabel}
          </div>
        )}
      </div>

      {/* ── Scrollable body — all info between the phase header and action footer ── */}
      <div className="flex-1 overflow-y-auto min-h-0">

      {myPlayer && (myPlayer.capital_territory_id || myPlayer.secret_mission) && (
        <div className="px-4 py-3 border-b border-cc-border bg-cc-dark/40">
          <h3 className="text-xs font-medium text-cc-muted uppercase tracking-wider mb-2">Objectives</h3>
          {myPlayer.capital_territory_id && (
            <p className="text-xs text-cc-text">
              <span className="text-cc-muted">Your capital: </span>
              <span className="font-mono">{myPlayer.capital_territory_id}</span>
            </p>
          )}
          {myPlayer.secret_mission && (
            <p className="text-xs text-cc-text mt-1">
              <span className="text-cc-muted">Mission: </span>
              {describeSecretMission(myPlayer.secret_mission, gameState.players)}
            </p>
          )}
        </div>
      )}

      {/* Resources */}
      {myPlayer && (gameState.settings.economy_enabled || gameState.settings.tech_trees_enabled) && (
        <div className="px-4 py-3 border-b border-cc-border bg-cc-dark/40">
          <h3 className="text-xs font-medium text-cc-muted uppercase tracking-wider mb-2">Resources</h3>
          <div className="flex gap-3">
            {gameState.settings.economy_enabled && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cc-dark border border-amber-800/40 text-amber-300 text-xs font-mono">
                <span>⚙</span>
                <span>{myPlayer.special_resource ?? 0} PP</span>
              </div>
            )}
            {gameState.settings.tech_trees_enabled && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cc-dark border border-blue-800/40 text-blue-300 text-xs font-mono">
                <span>⚡</span>
                <span>{myPlayer.tech_points ?? 0} TP</span>
              </div>
            )}
          </div>
          {myPlayer.temporary_modifiers && myPlayer.temporary_modifiers.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {myPlayer.temporary_modifiers.map((mod, i) => (
                <span key={i} className="px-1.5 py-0.5 rounded text-xs bg-cc-dark border border-cc-border text-cc-muted">
                  {mod.type === 'attack_modifier' && `+${mod.value} ATK`}
                  {mod.type === 'defense_modifier' && `+${mod.value} DEF`}
                  {mod.type === 'production_bonus' && `+${mod.value} PP`}
                  {mod.turns_remaining != null && ` · ${mod.turns_remaining}t`}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

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
      <div className="p-4">
        <h3 className="text-xs font-medium text-cc-muted uppercase tracking-wider mb-3">Combat Log</h3>
        {gameState.phase === 'attack' && isMyTurn && !lastCombatResult && (
          <p className="text-xs text-cc-muted/70 mb-3 italic">Each attack is one battle round — repeat to keep fighting.</p>
        )}
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

      </div>{/* end scrollable body */}

      {/* Phase Advance Button */}
      {isMyTurn && gameState.phase !== 'game_over' && gameState.phase !== 'territory_select' && (
        <div className="p-4 border-t border-cc-border">
          <button onClick={onAdvancePhase} className="btn-primary w-full">
            {gameState.phase === 'draft' && 'Begin Attack Phase →'}
            {gameState.phase === 'attack' && 'Begin Fortify Phase →'}
            {gameState.phase === 'fortify' && 'End Turn →'}
          </button>
        </div>
      )}

      {/* Save & Leave / Resign */}
      {gameState.phase !== 'game_over' && myPlayer && !myPlayer.is_eliminated && (
        <div className="px-4 pb-3 flex flex-col gap-1.5">
          {/* Tech tree shortcut */}
          {onOpenTechTree && (
            <button
              onClick={onOpenTechTree}
              className="w-full py-1.5 text-xs text-blue-300 hover:text-blue-200 transition-colors
                         flex items-center justify-center gap-1.5 rounded border border-blue-800/40 hover:border-blue-600/60 bg-blue-900/20"
            >
              <Zap className="w-3 h-3" />
              Tech Tree
              {(myPlayer.tech_points ?? 0) > 0 && (
                <span className="ml-1 px-1.5 rounded-full bg-blue-800 text-blue-200 font-mono">
                  {myPlayer.tech_points} TP
                </span>
              )}
            </button>
          )}
          {/* Bonuses guide */}
          {onOpenBonuses && (() => {
            const bonusCount =
              (myPlayer.temporary_modifiers?.length ?? 0) +
              (myPlayer.unlocked_techs?.length ?? 0) +
              (myPlayer.faction_id ? 1 : 0);
            return (
              <button
                onClick={onOpenBonuses}
                className="w-full py-1.5 text-xs text-amber-300 hover:text-amber-200 transition-colors
                           flex items-center justify-center gap-1.5 rounded border border-amber-800/40 hover:border-amber-600/60 bg-amber-900/20"
              >
                <Shield className="w-3 h-3" />
                Bonuses
                {bonusCount > 0 && (
                  <span className="ml-1 px-1.5 rounded-full bg-amber-800/60 text-amber-200 font-mono">
                    {bonusCount}
                  </span>
                )}
              </button>
            );
          })()}
          {onSaveAndLeave && (
            <button
              onClick={onSaveAndLeave}
              className="w-full py-1.5 text-xs text-cc-muted hover:text-cc-gold transition-colors
                         flex items-center justify-center gap-1.5 rounded border border-transparent hover:border-cc-gold/20"
            >
              <Save className="w-3 h-3" /> Save & Leave
            </button>
          )}
          {onResign && (
            <button
              onClick={onResign}
              className="w-full py-1.5 text-xs text-cc-muted hover:text-red-400 transition-colors
                         flex items-center justify-center gap-1.5 rounded border border-transparent hover:border-red-500/20"
            >
              <Flag className="w-3 h-3" /> Resign
            </button>
          )}
        </div>
      )}

      {gameId && <GameChat gameId={gameId} embedded />}
    </div>
  );
}
