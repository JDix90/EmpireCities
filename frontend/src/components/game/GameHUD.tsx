import React, { useState, useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useAuthStore } from '../../store/authStore';
import { Shield, Sword, ArrowRight, Clock, Users, CreditCard, Flag, Save, Zap } from 'lucide-react';
import clsx from 'clsx';
import { computeDraftPool } from '../../utils/draftPool';
import EraModifierBadge from './EraModifierBadge';
import AdvanceEraPanel from './AdvanceEraPanel';
import { ERA_LABELS } from '../../constants/gameLobbyLabels';
import { getEraIdForAdvancementIndex } from '../../utils/eraAdvancement';
import { AiBadge } from '../ui/AiBadge';
import { getSocket } from '../../services/socket';
import { ARMED_BUFF_LABELS, getAbilityUiDef } from '../../utils/abilityActivationFeedback';
import { getPlayerGlobalAbilities } from '../../utils/playerAbilities';
import {
  describeSecretMission,
  resolveTerritoryName,
  type MapNameLookup,
} from '../../utils/mapDisplayNames';
import ConnectionHintsSetting from './ConnectionHintsSetting';
import type { ConnectionHintPreference } from '../../utils/connectionHints';
import {
  getFastCombatPreference,
  setFastCombatPreference,
  subscribeUserPreferences,
} from '../../utils/userPreferences';
import { Link } from 'react-router-dom';

interface GameHUDProps {
  onAdvancePhase: () => void;
  onRedeemCards: (cardIds: string[]) => void;
  onResign?: () => void;
  onSaveAndLeave?: () => void;
  onExitTutorial?: () => void;
  isTutorial?: boolean;
  onOpenTechTree?: () => void;
  onOpenBonuses?: () => void;
  onAdvanceEra?: () => void;
  onUseAbility?: (abilityId: string, targetId?: string) => void;
  techTree?: Array<{ tech_id: string; unlocks_ability?: string }>;
  lastCombatLog: string[];
  /** When set (in-progress game), chat renders at the bottom of this sidebar — never over the map. */
  gameId?: string;
  activeInteractionLabel?: string | null;
  /** When true, renders as a full-height flex column for the mobile drawer (skips hidden/md breakpoint). */
  mobile?: boolean;
  /** From `game:joined` playerIndex — matches TerritoryPanel when auth.user loads late */
  resolvedViewerPlayerId?: string | null;
  /** Labels of optional rules enabled via the Advanced Settings tutorial lab. */
  tutorialActiveSettings?: string[];
  /** Labels for capital / secret-mission objectives (from loaded map JSON). */
  mapNameLookup?: MapNameLookup | null;
  connectionHintPreference?: ConnectionHintPreference;
  onConnectionHintPreferenceChange?: (value: ConnectionHintPreference) => void;
  denseMap?: boolean;
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

export default function GameHUD({
  onAdvancePhase,
  onRedeemCards,
  onResign,
  onSaveAndLeave,
  onExitTutorial,
  isTutorial,
  onOpenTechTree,
  onOpenBonuses,
  onAdvanceEra,
  onUseAbility,
  techTree = [],
  lastCombatLog,
  gameId,
  activeInteractionLabel,
  mobile = false,
  resolvedViewerPlayerId,
  tutorialActiveSettings,
  mapNameLookup,
  connectionHintPreference,
  onConnectionHintPreferenceChange,
  denseMap = false,
}: GameHUDProps) {
  const { gameState, draftUnitsRemaining, lastCombatResult } = useGameStore();
  const { user } = useAuthStore();
  const [showCards, setShowCards] = useState(false);
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [spectatorCount, setSpectatorCount] = useState(0);
  const [fastCombat, setFastCombat] = useState(getFastCombatPreference);

  useEffect(() => subscribeUserPreferences(() => {
    setFastCombat(getFastCombatPreference());
  }), []);

  const currentPlayer = gameState?.players[gameState?.current_player_index ?? 0];
  const myPlayer = resolvedViewerPlayerId
    ? gameState?.players.find((p) => p.player_id === resolvedViewerPlayerId)
    : gameState?.players.find(
        (p) => p.player_id === user?.user_id || (!!user?.username && p.username === user.username),
      );
  const isMyTurn = !!currentPlayer && !!myPlayer && currentPlayer.player_id === myPlayer.player_id;
  const draftPool = computeDraftPool(
    gameState,
    user?.user_id,
    user?.username,
    draftUnitsRemaining,
    resolvedViewerPlayerId ?? null,
  );
  const attackerFactionBonus = lastCombatResult?.attacker_bonus_breakdown?.faction ?? 0;
  const defenderFactionBonus = lastCombatResult?.defender_bonus_breakdown?.faction ?? 0;
  const myFactionTriggeredAsAttacker =
    !!myPlayer &&
    !!lastCombatResult &&
    (lastCombatResult.attackerId === myPlayer.player_id) &&
    attackerFactionBonus > 0;
  const myFactionTriggeredAsDefender =
    !!myPlayer &&
    !!lastCombatResult &&
    (lastCombatResult.defenderId === myPlayer.player_id) &&
    defenderFactionBonus > 0;

  // Turn timer countdown. Prefers the server-authoritative phase deadline
  // (re-armed on every phase, including timeout auto-advances) and recomputes
  // from the clock each tick so the display can't drift or go stale at 0:00.
  // Falls back to turn_started_at math against older servers.
  useEffect(() => {
    if (!gameState?.settings.turn_timer_seconds || gameState.settings.turn_timer_seconds === 0) {
      setTimeLeft(null);
      return;
    }
    const deadline =
      gameState.phase_deadline_at ??
      gameState.turn_started_at + gameState.settings.turn_timer_seconds * 1000;
    const compute = () => Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    setTimeLeft(compute());

    const interval = setInterval(() => {
      setTimeLeft(compute());
    }, 1000);
    return () => clearInterval(interval);
  }, [gameState?.turn_started_at, gameState?.phase_deadline_at, gameState?.settings.turn_timer_seconds]);

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
      'flex flex-col min-h-0 bg-bf-surface',
      mobile
        ? 'flex-1 overflow-y-auto'
        : 'flex flex-1 min-h-0 h-full',
    )}>
      {/* Phase Indicator — exposed as a polite live region so screen-reader
          users hear "Turn 4, attack phase, your turn" each time it changes,
          not just on first focus. `aria-current="step"` flags the active
          phase semantically (matches Risk-style turn step semantics). */}
      <div
        className={clsx(
          'p-4 border-b border-bf-border',
          isMyTurn ? 'bg-bf-gold/10' : 'bg-bf-dark/50',
        )}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="flex items-center gap-2 mb-1" aria-current="step">
          {PHASE_ICONS[gameState.phase]}
          <span className="font-display text-sm text-bf-gold">
            {PHASE_LABELS[gameState.phase] ?? gameState.phase}
          </span>
        </div>
        <p className="text-xs text-bf-muted">
          Turn {gameState.turn_number} · {isMyTurn ? 'Your turn' : `${currentPlayer?.username}'s turn`}
        </p>
        {timeLeft !== null && !gameState.settings.async_mode && (
          <div className={clsx(
            'flex items-center gap-1 mt-2 text-sm font-mono',
            timeLeft < 30 ? 'text-red-400' : 'text-bf-muted'
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
              {!isMyTurn && <span className="text-bf-muted ml-1">· Waiting for {currentPlayer?.username}</span>}
            </div>
          );
        })()}
        {gameState.phase === 'draft' && isMyTurn && (
          <p className="text-bf-gold text-sm mt-2 font-medium">
            {draftPool} units to place
          </p>
        )}
        {spectatorCount > 0 && (
          <p className="text-xs text-sky-300 mt-2 font-medium">{spectatorCount} watching</p>
        )}
        {gameState.phase === 'territory_select' && (() => {
          const unclaimed = Object.values(gameState.territories).filter((t) => t.owner_id === null).length;
          return (
            <p className="text-bf-gold text-sm mt-2 font-medium">
              {unclaimed} territories remaining · {isMyTurn ? 'Pick a territory' : 'Waiting...'}
            </p>
          );
        })()}
        {/* Era modifier badges */}
        <EraModifierBadge gameState={gameState} className="mt-2" />
        {myPlayer && onAdvanceEra && gameState.settings.era_advancement_enabled && (
          <div className="mt-3 -mx-1">
            <AdvanceEraPanel
              gameState={gameState}
              myPlayer={myPlayer}
              isMyTurn={isMyTurn}
              onAdvanceEra={onAdvanceEra}
            />
          </div>
        )}
        {tutorialActiveSettings && tutorialActiveSettings.length > 0 && (
          <div
            className="mt-3 rounded-lg border border-emerald-700/50 bg-emerald-950/40 px-3 py-2"
            data-testid="tutorial-active-settings"
          >
            <p className="text-[10px] uppercase tracking-widest text-emerald-400/90 mb-1">
              Tutorial settings active
            </p>
            <div className="flex flex-wrap gap-1">
              {tutorialActiveSettings.map((label) => (
                <span
                  key={label}
                  className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-900/60 text-emerald-200 border border-emerald-700/40"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}
        {activeInteractionLabel && (
          <div className="mt-2 px-2.5 py-1 rounded-full text-xs font-medium bg-yellow-900/40 border border-yellow-700/50 text-yellow-200 inline-flex items-center gap-1.5">
            {activeInteractionLabel}
          </div>
        )}
      </div>

      {/* ── Scrollable body — all info between the phase header and action footer ── */}
      <div className="flex-1 overflow-y-auto min-h-0">

      {myPlayer && (myPlayer.capital_territory_id || myPlayer.secret_mission) && (
        <div className="px-4 py-3 border-b border-bf-border bg-bf-dark/40">
          <h3 className="text-xs font-medium text-bf-muted uppercase tracking-wider mb-2">Objectives</h3>
          {myPlayer.capital_territory_id && (
            <p className="text-xs text-bf-text">
              <span className="text-bf-muted">Your capital: </span>
              <span>{resolveTerritoryName(myPlayer.capital_territory_id, mapNameLookup)}</span>
            </p>
          )}
          {myPlayer.secret_mission && (
            <p className="text-xs text-bf-text mt-1">
              <span className="text-bf-muted">Mission: </span>
              {describeSecretMission(myPlayer.secret_mission, gameState.players, mapNameLookup)}
            </p>
          )}
        </div>
      )}

      {/* Resources */}
      {myPlayer && (gameState.settings.economy_enabled || gameState.settings.tech_trees_enabled) && (
        <div className="px-4 py-3 border-b border-bf-border bg-bf-dark/40">
          <h3 className="text-xs font-medium text-bf-muted uppercase tracking-wider mb-2">Resources</h3>
          <div className="flex gap-3">
            {gameState.settings.economy_enabled && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-bf-dark border border-amber-800/40 text-amber-300 text-xs font-mono">
                <span>⚙</span>
                <span>{myPlayer.special_resource ?? 0} PP</span>
              </div>
            )}
            {gameState.settings.tech_trees_enabled && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-bf-dark border border-blue-800/40 text-blue-300 text-xs font-mono">
                <span>⚡</span>
                <span>{myPlayer.tech_points ?? 0} TP</span>
              </div>
            )}
          </div>
          {myPlayer.temporary_modifiers && myPlayer.temporary_modifiers.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {myPlayer.temporary_modifiers.map((mod, i) => (
                <span key={i} className="px-1.5 py-0.5 rounded text-xs bg-bf-dark border border-bf-border text-bf-muted">
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
      <div className="p-4 border-b border-bf-border">
        <h3 className="text-xs font-medium text-bf-muted uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" /> Players
        </h3>
        <div className="space-y-2">
          {gameState.players.map((player, idx) => (
            <div
              key={player.player_id}
              className={clsx(
                'flex items-center gap-2 p-2 rounded-lg text-sm transition-colors',
                idx === gameState.current_player_index && 'bg-bf-dark ring-1 ring-bf-gold/40',
                player.is_eliminated && 'opacity-40'
              )}
            >
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: player.color }}
              />
              <span className={clsx(
                'flex-1 flex items-center gap-1.5 min-w-0',
                player.player_id === user?.user_id ? 'text-bf-gold font-medium' : 'text-bf-text'
              )}>
                <span className="truncate">{player.username}</span>
                {player.is_ai && <AiBadge difficulty={player.ai_difficulty} size="xs" showLabel={false} />}
              </span>
              <span className="text-bf-muted text-xs">{player.territory_count}T</span>
              {gameState.settings.era_advancement_enabled && !player.is_eliminated && (
                <span className="text-[10px] px-1 py-0.5 rounded bg-bf-dark border border-bf-border text-bf-muted shrink-0">
                  {ERA_LABELS[getEraIdForAdvancementIndex(player.current_era_index ?? 0)] ?? 'Ancient'}
                </span>
              )}
              {gameState.settings.era_advancement_enabled
                && (player.era_transition_turns_remaining ?? 0) > 0 && (
                <span className="text-[10px] px-1 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-400 shrink-0">
                  Vuln
                </span>
              )}
              {player.is_eliminated && (
                <span className="text-red-500 text-xs">✗</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* My Cards */}
      {myPlayer && myPlayer.cards.length > 0 && (
        <div className="p-4 border-b border-bf-border">
          <button
            className="w-full flex items-center justify-between text-xs font-medium text-bf-muted uppercase tracking-wider hover:text-bf-gold transition-colors"
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
                      ? 'border-bf-gold bg-bf-gold/10 text-bf-gold'
                      : 'border-bf-border text-bf-text hover:border-bf-gold/50'
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
                <p className="text-xs text-bf-muted">Select {3 - selectedCards.length} more</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Combat Log */}
      <div className="p-4">
        <h3 className="text-xs font-medium text-bf-muted uppercase tracking-wider mb-3">Combat Log</h3>
        {gameState.phase === 'attack' && isMyTurn && !lastCombatResult && (
          <p className="text-xs text-bf-muted/70 mb-3 italic">Each attack is one battle round — repeat to keep fighting.</p>
        )}
        {lastCombatResult && (
          <div className="mb-3 p-3 bg-bf-dark rounded-lg border border-bf-border text-xs space-y-2">
            {lastCombatResult.fromName && lastCombatResult.toName && (
              <p className="text-bf-text font-medium">
                {lastCombatResult.fromName} → {lastCombatResult.toName}
              </p>
            )}
            <div className="flex gap-3">
              <div className="flex-1">
                <p className="text-bf-muted mb-0.5">{lastCombatResult.attackerName ?? 'Attacker'}</p>
                <div className="flex gap-1">
                  {lastCombatResult.attacker_rolls.map((roll, i) => (
                    <span key={i} className="inline-flex items-center justify-center w-5 h-5 rounded bg-red-500/20 text-red-400 font-mono text-xs font-bold">{roll}</span>
                  ))}
                </div>
                {lastCombatResult.attacker_losses > 0 && (
                  <p className="text-red-400 mt-1">Lost {lastCombatResult.attacker_losses} troop{lastCombatResult.attacker_losses > 1 ? 's' : ''}</p>
                )}
              </div>
              <div className="w-px bg-bf-border" />
              <div className="flex-1">
                <p className="text-bf-muted mb-0.5">{lastCombatResult.defenderName ?? 'Defender'}</p>
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
              <p className="text-bf-gold font-medium pt-1 border-t border-bf-border">
                Territory Captured!
              </p>
            )}
            {(attackerFactionBonus > 0 || defenderFactionBonus > 0) && (
              <div className="pt-1.5 border-t border-bf-border/80 space-y-1">
                {attackerFactionBonus > 0 && (
                  <p className={clsx(
                    'text-xs px-2 py-1 rounded-md border animate-pulse',
                    myFactionTriggeredAsAttacker
                      ? 'border-red-400/70 bg-red-500/15 text-red-200'
                      : 'border-red-500/40 bg-red-900/20 text-red-300',
                  )}>
                    ⚔️ Faction attack bonus activated (+{attackerFactionBonus} die)
                  </p>
                )}
                {defenderFactionBonus > 0 && (
                  <p className={clsx(
                    'text-xs px-2 py-1 rounded-md border animate-pulse',
                    myFactionTriggeredAsDefender
                      ? 'border-blue-300/70 bg-blue-500/15 text-blue-100'
                      : 'border-blue-500/40 bg-blue-900/20 text-blue-300',
                  )}>
                    🛡️ Faction defense bonus activated (+{defenderFactionBonus} die)
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        <div className="space-y-1.5">
          {lastCombatLog.slice(-8).reverse().map((entry, i) => (
            <p key={i} className={clsx(
              'text-xs leading-relaxed',
              i === 0 ? 'text-bf-text' : 'text-bf-muted'
            )}>{entry}</p>
          ))}
        </div>
      </div>

      </div>{/* end scrollable body */}

      {/* Armed attack buffs (Knights Charge, Siege Assault, Testudo, etc.) */}
      {isMyTurn && gameState.phase === 'attack' && myPlayer
        && ARMED_BUFF_LABELS.some((entry) => entry.isActive(myPlayer)) && (
        <div className="px-4 pt-2 space-y-1.5">
          {ARMED_BUFF_LABELS.filter((entry) => entry.isActive(myPlayer)).map((entry) => (
            <div
              key={entry.label}
              className="w-full text-center text-xs rounded border border-amber-500/55 bg-amber-950/45 text-amber-200 py-1.5 animate-pulse"
            >
              {entry.emoji} {entry.label}
            </div>
          ))}
        </div>
      )}

      {isMyTurn && gameState.phase === 'attack' && gameState.blitzkrieg_active && (
        <div className="px-4 pt-2">
          <div className="w-full text-center text-xs rounded border border-amber-500/55 bg-amber-950/45 text-amber-200 py-1.5 animate-pulse">
            ⚡ Blitz doctrine active
            <span className="opacity-60">
              {' '}— {gameState.blitzkrieg_bonus_attacks_remaining ?? 1} bonus attack
              {(gameState.blitzkrieg_bonus_attacks_remaining ?? 1) === 1 ? '' : 's'} remaining
            </span>
          </div>
        </div>
      )}

      {/* March to the Sea chain indicator (ACW Total War) */}
      {isMyTurn && gameState.phase === 'attack' && myPlayer?.march_to_sea_active && (
        <div className="px-4 pt-2">
          <div className="w-full text-center text-xs rounded border border-amber-600/50 bg-amber-950/40 text-amber-300 py-1.5">
            ⚔️ March to the Sea — chain {Math.min(myPlayer.march_to_sea_hops_used ?? 0, 3)}/3
            <span className="opacity-60"> (+1 attack die)</span>
          </div>
        </div>
      )}

      {isMyTurn && gameState.phase === 'fortify' && (myPlayer?.bonus_fortify_moves ?? 0) > 0 && (
        <div className="px-4 pt-2">
          <div className="w-full text-center text-xs rounded border border-blue-500/55 bg-blue-950/45 text-blue-200 py-1.5">
            🚜 +{myPlayer?.bonus_fortify_moves} bonus fortify move
            {(myPlayer?.bonus_fortify_moves ?? 0) === 1 ? '' : 's'} this turn
          </div>
        </div>
      )}

      {/* Phase Advance Button */}
      {isMyTurn && gameState.phase !== 'game_over' && gameState.phase !== 'territory_select' && (
        <div className="p-4 border-t border-bf-border">
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
          {/* Global faction abilities (no territory target — e.g. blitzkrieg self-buff) */}
          {onUseAbility && gameState && myPlayer && (() => {
            const globalAbils = getPlayerGlobalAbilities(gameState, myPlayer, techTree);
            if (globalAbils.length === 0) return null;
            return globalAbils.map((abilityId) => {
              const def = getAbilityUiDef(abilityId);
              if (!def) return null;
              const styleClass =
                def.style === 'warning'
                  ? 'border border-amber-600/70 bg-amber-950/50 text-amber-300 hover:bg-amber-900/50'
                  : def.style === 'success'
                    ? 'border border-emerald-600/70 bg-emerald-950/50 text-emerald-300 hover:bg-emerald-900/50'
                    : 'border border-blue-600/70 bg-blue-950/50 text-blue-300 hover:bg-blue-900/50';
              return (
                <button
                  key={abilityId}
                  data-testid={`ability-btn-${abilityId}`}
                  onClick={() => onUseAbility(abilityId)}
                  className={clsx(
                    'w-full py-1.5 text-xs transition-colors flex flex-col items-center justify-center gap-0.5 rounded',
                    styleClass,
                  )}
                >
                  <span>{def.emoji} {def.label} <span className="opacity-60">({def.scope === 'game' ? 'once/game' : 'once/turn'})</span></span>
                  {def.hint && <span className="opacity-50 text-[10px]">{def.hint}</span>}
                </button>
              );
            });
          })()}
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
              className="w-full py-1.5 text-xs text-bf-muted hover:text-bf-gold transition-colors
                         flex items-center justify-center gap-1.5 rounded border border-transparent hover:border-bf-gold/20"
            >
              <Save className="w-3 h-3" /> Save & Leave
            </button>
          )}
          {connectionHintPreference && onConnectionHintPreferenceChange && (
            <div className="px-1 py-1">
              <ConnectionHintsSetting
                value={connectionHintPreference}
                onChange={onConnectionHintPreferenceChange}
                denseMap={denseMap}
                compact
              />
            </div>
          )}
          <label
            className="flex items-center gap-2 px-1 py-1 text-xs text-bf-muted cursor-pointer select-none"
            title="Shorten dice-roll animations so battles resolve almost instantly."
          >
            <input
              type="checkbox"
              checked={fastCombat}
              onChange={(e) => {
                setFastCombat(e.target.checked);
                setFastCombatPreference(e.target.checked);
              }}
              className="accent-bf-gold w-3 h-3"
            />
            Fast combat
          </label>
          <Link
            to="/settings"
            className="block px-1 py-1 text-[11px] text-bf-muted hover:text-bf-gold transition-colors"
          >
            More in Settings →
          </Link>
          {gameState.coaching_eligible && gameId && (
            <label className="flex items-center gap-2 px-1 py-1 text-xs text-bf-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={!!gameState.settings.coaching_enabled}
                onChange={(e) => {
                  getSocket().emit('game:set_coaching', { gameId, enabled: e.target.checked });
                }}
                className="accent-bf-gold w-3 h-3"
              />
              In-turn coaching
            </label>
          )}
          {isTutorial && onExitTutorial ? (
            <button
              onClick={onExitTutorial}
              className="w-full py-1.5 text-xs text-bf-muted hover:text-red-400 transition-colors
                         flex items-center justify-center gap-1.5 rounded border border-transparent hover:border-red-500/20"
            >
              <Flag className="w-3 h-3" /> Exit Tutorial
            </button>
          ) : onResign ? (
            <button
              onClick={onResign}
              className="w-full py-1.5 text-xs text-bf-muted hover:text-red-400 transition-colors
                         flex items-center justify-center gap-1.5 rounded border border-transparent hover:border-red-500/20"
            >
              <Flag className="w-3 h-3" /> Resign
            </button>
          ) : null}
        </div>
      )}

    </div>
  );
}
