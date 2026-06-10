import { Crown, Swords } from 'lucide-react';
import clsx from 'clsx';
import Modal from '../ui/Modal';
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
}: {
  open: boolean;
  onClose: () => void;
  gameState: GameState;
  viewerPlayerId: string | null;
}) {
  const order = turnOrderFrom(gameState.players, gameState.starting_player_index ?? 0);
  const positionLine = describeViewerPosition(order, viewerPlayerId);
  const viewer = gameState.players.find((p) => p.player_id === viewerPlayerId);
  const showGold = !!gameState.settings.economy_enabled;
  const showTech = !!gameState.settings.tech_trees_enabled;

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
