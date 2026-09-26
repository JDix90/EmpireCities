import { useEffect, useState } from 'react';
import { ArrowLeft, BookOpen, Crown, Swords, Trophy, Target, Shield } from 'lucide-react';
import clsx from 'clsx';
import Modal from '../ui/Modal';
import { api } from '../../services/api';
import { describeSecretMission, type MapNameLookup } from '../../utils/mapDisplayNames';
import { hegemonyTurnsFor } from '../../utils/lunarHegemony';
import { describeSpaceAgeEra, spaceAgeGuideInput } from '../../utils/spaceAgeGuide';
import { SpaceAgeGuideSections } from './SpaceAgeGuide';
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

/**
 * Whether a state is a game's opening — the moment this briefing is for.
 *
 * Phase is not a proxy for it. A daily puzzle can start in the attack phase
 * (`starting_phase`), and then the first draft-phase state of turn 1 belongs
 * to the OPPONENT: gating on the phase alone opened the briefing there,
 * announcing "You go first" to a player who had just finished their turn.
 * The opening is the first seat still being on its first turn.
 */
export function isOpeningState(gameState: Pick<GameState, 'turn_number' | 'current_player_index' | 'starting_player_index'>): boolean {
  if (gameState.turn_number !== 1) return false;
  return (gameState.current_player_index ?? 0) === (gameState.starting_player_index ?? 0);
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
      case 'lunar_hegemony':
        // Without this case the raw enum name reached players, which is what a
        // Moon Race game shows on its very first screen.
        return `Hold every lunar territory for ${hegemonyTurnsFor(settings)} turns of your own in a row`;
      case 'lane_sovereignty':
        return 'Hold both gateways of 5 hyperspace lanes for 3 turns running';
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
 *
 * A Space Age game adds an "In this era" section, and a second page — "How
 * the Space Age works" — behind a link in it. On the player's first Space Age
 * game (`guideFirst`) the primary button turns the page instead of closing, so
 * the guide opens by itself exactly once without ever being a second modal
 * stacked on this one (docs/MOBILE_UX_PLAN.md M-12).
 */
export default function GameStartModal({
  open,
  onClose,
  gameState,
  viewerPlayerId,
  mapNameLookup,
  moonTiles = 0,
  guideFirst = false,
  onGuideShown,
}: {
  open: boolean;
  onClose: () => void;
  gameState: GameState;
  viewerPlayerId: string | null;
  mapNameLookup?: MapNameLookup | null;
  /** Lunar tiles on the board; the Space Age section needs a Moon to describe. */
  moonTiles?: number;
  /** The viewer has not seen the Space Age guide: lead into it before battle. */
  guideFirst?: boolean;
  /** The guide page was shown — by the first-time `'next'` or by the link. */
  onGuideShown?: (via: 'next' | 'link') => void;
}) {
  const [page, setPage] = useState<'briefing' | 'guide'>('briefing');
  useEffect(() => {
    if (open) setPage('briefing');
  }, [open]);

  const order = turnOrderFrom(gameState.players, gameState.starting_player_index ?? 0);
  const positionLine = describeViewerPosition(order, viewerPlayerId);
  const viewer = gameState.players.find((p) => p.player_id === viewerPlayerId);
  const showGold = !!gameState.settings.economy_enabled;
  const showTech = !!gameState.settings.tech_trees_enabled;
  const { conditions, turnCap } = describeWinConditions(gameState.settings);
  // The Moon counts toward every condition above and sits behind an orbit
  // gate, and the Moon Race changes what it is FOR. This modal is the one
  // moment every player is guaranteed to read before their first turn, so the
  // era's rules get a few lines of their own, written from this game's settings.
  const guideInput = spaceAgeGuideInput(gameState, viewerPlayerId, moonTiles);
  const eraLines = describeSpaceAgeEra(guideInput);
  const leadsIntoGuide = guideFirst && eraLines.length > 0;

  const showGuide = (via: 'next' | 'link') => {
    setPage('guide');
    onGuideShown?.(via);
  };

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

  // Keyed per page so turning it remounts the dialog: its scroll box would
  // otherwise open the guide at the depth of the briefing's bottom button.
  if (page === 'guide') {
    return (
      <Modal key="guide" open={open} onClose={onClose} title="How the Space Age works" showCloseButton={false}>
        <button
          type="button"
          onClick={() => setPage('briefing')}
          className="-mt-2 mb-3 inline-flex items-center gap-1 text-xs text-bf-muted hover:text-bf-text"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden />
          Back to the briefing
        </button>
        <SpaceAgeGuideSections input={guideInput} />
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full flex items-center justify-center gap-2 bg-bf-gold text-bf-dark font-display py-2.5 rounded-lg hover:bg-bf-gold/90 transition-colors"
        >
          <Swords className="w-4 h-4" aria-hidden />
          To battle
        </button>
      </Modal>
    );
  }

  return (
    <Modal key="briefing" open={open} onClose={onClose} title="The battle begins" showCloseButton={false}>
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
      {turnCap && <p className="text-xs text-bf-muted mb-1.5 pl-[22px]">{turnCap}.</p>}
      <div className={turnCap ? 'mb-2.5' : 'mb-4'} />

      {eraLines.length > 0 && (
        <section className="mb-4" data-testid="start-era-section">
          <h4 className="text-xs font-medium text-bf-muted uppercase tracking-wider mb-2">In this era</h4>
          <ul className="space-y-1.5">
            {eraLines.map((line) => (
              <li key={line.id} className="flex items-start gap-2 text-sm text-bf-text">
                <span className="w-3.5 shrink-0 text-center leading-5" aria-hidden>{line.icon}</span>
                <span>{line.text}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => showGuide('link')}
            className="mt-2 ml-[22px] inline-flex items-center gap-1 text-xs text-violet-300 underline underline-offset-2 hover:text-violet-100"
          >
            <BookOpen className="w-3.5 h-3.5 shrink-0" aria-hidden />
            How the Space Age works
          </button>
        </section>
      )}

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

      {leadsIntoGuide ? (
        <button
          type="button"
          onClick={() => showGuide('next')}
          className="w-full flex items-center justify-center gap-2 bg-bf-gold text-bf-dark font-display py-2.5 rounded-lg hover:bg-bf-gold/90 transition-colors"
        >
          <BookOpen className="w-4 h-4" aria-hidden />
          Next: how the Space Age works
        </button>
      ) : (
        <button
          type="button"
          onClick={onClose}
          className="w-full flex items-center justify-center gap-2 bg-bf-gold text-bf-dark font-display py-2.5 rounded-lg hover:bg-bf-gold/90 transition-colors"
        >
          <Swords className="w-4 h-4" aria-hidden />
          To battle
        </button>
      )}
    </Modal>
  );
}
