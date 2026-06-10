import { useEffect, useState } from 'react';
import { Crown, Swords, Trophy, Target, Shield } from 'lucide-react';
import clsx from 'clsx';
import Modal from '../ui/Modal';
import { api } from '../../services/api';
import { describeSecretMission, type MapNameLookup } from '../../utils/mapDisplayNames';
import type { GameState, PlayerState } from '../../store/gameStore';

/**
 * Seats in the order they will act, starting from the randomized first
 * player. `players` is indexed by player_index, so turn order is a rotation.
 */
export function turnOrderFrom(players: PlayerState[], startingIndex: number): PlayerState[] {
  if (players.length === 0) return [];
  const start = ((startingIndex % players.length) + players.length) % players.length;
  return [...players.slice(start), ...players.slice(0, start)];
}

/** Human-readable position ("You go first" / "You go 3rd of 4"). */
export function describeViewerPosition(order: PlayerState[], viewerPlayerId: string | null): string | null {
  if (!viewerPlayerId) return null;
  const position = order.findIndex((p) => p.player_id === viewerPlayerId);
  if (position === -1) return null;
  if (position === 0) return 'You go first';
  const ordinals = ['first', '2nd', '3rd', '4th', '5th', '6th'];
  const label = ordinals[position] ?? `${position + 1}th`;
  return `You go ${label} of ${order.length}`;
}

function difficultyLabel(difficulty?: string | null): string {
  if (!difficulty) return 'AI';
  return `${difficulty.charAt(0).toUpperCase()}${difficulty.slice(1)} AI`;
}

/**
 * Player-facing win-condition phrases from the game settings. Mirrors the
 * server's resolution order in normalizeGameSettings (allowed list → single
 * victory_type → domination default; OR semantics between conditions).
 */
export function describeWinConditions(settings: GameState['settings']): {
  conditions: string[];
  turnCap: string | null;
} {
  const raw =
    Array.isArray(settings.allowed_victory_conditions) && settings.allowed_victory_conditions.length > 0
      ? settings.allowed_victory_conditions
      : typeof settings.victory_type === 'string' && settings.victory_type
        ? [settings.victory_type]
        : ['domination'];
  const conditions = raw.map((kind) => {
    switch (kind) {
      case 'domination':
        return 'Control every territory';
      case 'threshold':
        return typeof settings.victory_threshold === 'number'
          ? `Control ${settings.victory_threshold}% of the map`
          : 'Control most of the map';
      case 'capital':
        return 'Hold your capital and capture every enemy capital';
      case 'secret_mission':
        return 'Complete your secret mission';
      default:
        return kind;
    }
  });
  const turnCap =
    typeof settings.max_turns === 'number' && settings.max_turns > 0
      ? `Most territory when turn ${settings.max_turns} ends also wins`
      : null;
  return { conditions, turnCap };
}

interface FactionInfo {
  faction_id: string;
  name: string;
  description?: string;
  ability_description?: string;
}

/**
 * Shown once when a game begins: turn order (the first player is randomized,
 * so without this players could be mid-combat before they had any idea who
 * acts when) and the viewer's starting resources. Purely informational —
 * the server does not wait on it; dismissing realigns the turn clock via
 * the existing game:turn_ready ack (wired in GamePage).
 */
export default function GameStartModal({
  open,
  onClose,
  gameState,
  viewerPlayerId,
  mapNameLookup,
}: {
  open: boolean;
  onClose: () => void;
  gameState: GameState;
  viewerPlayerId: string | null;
  mapNameLookup?: MapNameLookup | null;
}) {
  const order = turnOrderFrom(gameState.players, gameState.starting_player_index ?? 0);
  const positionLine = describeViewerPosition(order, viewerPlayerId);
  const viewer = gameState.players.find((p) => p.player_id === viewerPlayerId);
  const showGold = !!gameState.settings.economy_enabled;
  const showTech = !!gameState.settings.tech_trees_enabled;
  const { conditions, turnCap } = describeWinConditions(gameState.settings);

  // Faction name + ability come from the era endpoint (same source the
  // in-game Bonuses modal uses). Best-effort: the section simply doesn't
  // render until/unless the fetch succeeds.
  const [faction, setFaction] = useState<FactionInfo | null>(null);
  const factionId = gameState.settings.factions_enabled ? viewer?.faction_id ?? null : null;
  useEffect(() => {
    if (!open || !factionId) return;
    let cancelled = false;
    api
      .get(`/eras/${gameState.era}/factions`)
      .then((res) => {
        if (cancelled) return;
        const all: FactionInfo[] = res.data?.factions ?? [];
        setFaction(all.find((f) => f.faction_id === factionId) ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, factionId, gameState.era]);

  return (
    <Modal open={open} onClose={onClose} title="The battle begins" showCloseButton={false}>
      {positionLine && (
        <p className="text-bf-text mb-3 -mt-1">
          {positionLine}
          {positionLine === 'You go first' ? ' — make it count.' : '.'}
        </p>
      )}

      <h4 className="text-xs font-medium text-bf-muted uppercase tracking-wider mb-2">Turn order</h4>
      <ol className="space-y-1.5 mb-4">
        {order.map((p, i) => {
          const isViewer = p.player_id === viewerPlayerId;
          return (
            <li
              key={p.player_id}
              className={clsx(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 border',
                isViewer ? 'border-bf-gold/50 bg-bf-gold/5' : 'border-bf-border/60 bg-bf-dark/40',
              )}
            >
              <span className="w-5 text-center text-xs font-mono text-bf-muted tabular-nums">{i + 1}</span>
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: p.color }}
                aria-hidden
              />
              <span className="text-sm text-bf-text truncate flex-1">
                {p.username}
                {isViewer && <span className="text-bf-gold"> (you)</span>}
              </span>
              {p.is_ai && (
                <span className="text-[10px] uppercase tracking-wide text-bf-muted border border-bf-border rounded px-1.5 py-0.5 shrink-0">
                  {difficultyLabel(p.ai_difficulty)}
                </span>
              )}
              {i === 0 && <Crown className="w-3.5 h-3.5 text-bf-gold shrink-0" aria-label="Goes first" />}
            </li>
          );
        })}
      </ol>

      <h4 className="text-xs font-medium text-bf-muted uppercase tracking-wider mb-2">How to win</h4>
      <ul className="space-y-1 mb-1.5">
        {conditions.map((line) => (
          <li key={line} className="flex items-start gap-2 text-sm text-bf-text">
            <Trophy className="w-3.5 h-3.5 text-bf-gold shrink-0 mt-0.5" aria-hidden />
            <span>{line}</span>
          </li>
        ))}
      </ul>
      {turnCap && <p className="text-xs text-bf-muted mb-4 pl-[22px]">{turnCap}.</p>}
      {!turnCap && <div className="mb-4" />}

      {viewer?.secret_mission && (
        <>
          <h4 className="text-xs font-medium text-bf-muted uppercase tracking-wider mb-2">Your secret mission</h4>
          <p className="flex items-start gap-2 text-sm text-bf-text mb-4">
            <Target className="w-3.5 h-3.5 text-bf-gold shrink-0 mt-0.5" aria-hidden />
            <span>{describeSecretMission(viewer.secret_mission, gameState.players, mapNameLookup)}</span>
          </p>
        </>
      )}

      {faction && (
        <>
          <h4 className="text-xs font-medium text-bf-muted uppercase tracking-wider mb-2">Your faction</h4>
          <p className="flex items-start gap-2 text-sm text-bf-text mb-4">
            <Shield className="w-3.5 h-3.5 text-bf-gold shrink-0 mt-0.5" aria-hidden />
            <span>
              <span className="font-medium">{faction.name}</span>
              {(faction.ability_description || faction.description) && (
                <span className="text-bf-muted"> — {faction.ability_description ?? faction.description}</span>
              )}
            </span>
          </p>
        </>
      )}

      {viewer && (showGold || showTech) && (
        <>
          <h4 className="text-xs font-medium text-bf-muted uppercase tracking-wider mb-2">Your starting resources</h4>
          <div className="flex gap-3 mb-4">
            {showGold && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-bf-dark border border-amber-800/40 text-amber-300 text-xs font-mono">
                <span aria-hidden>⚙</span>
                <span>{viewer.special_resource ?? 0} PP</span>
              </div>
            )}
            {showTech && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-bf-dark border border-blue-800/40 text-blue-300 text-xs font-mono">
                <span aria-hidden>⚡</span>
                <span>{viewer.tech_points ?? 0} TP</span>
              </div>
            )}
          </div>
        </>
      )}

      <button
        type="button"
        onClick={onClose}
        className="w-full flex items-center justify-center gap-2 bg-bf-gold text-bf-dark font-display py-2.5 rounded-lg hover:bg-bf-gold/90 transition-colors"
      >
        <Swords className="w-4 h-4" aria-hidden />
        To battle
      </button>
    </Modal>
  );
}
