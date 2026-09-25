import { useEffect, useRef, useState } from 'react';
import { ChevronUp, History, Shield, Swords, X } from 'lucide-react';
import clsx from 'clsx';
import type { CombatResult } from '../../store/gameStore';
import { RecapEntryList, type TurnRecapEntry } from './AiTurnRecapPanel';
import { combatInvolves, summarizeRecapsForViewer } from '../../utils/mobileOverlays';

/** How long a fresh battle against the viewer holds the line before the summary returns. */
const LIVE_LINE_MS = 6000;

/**
 * The phone's one channel for what other players did (docs/MOBILE_UX_PLAN.md
 * M-12): a single line above the bottom bar, never a panel over the map.
 *
 * - Watching (not the viewer's turn): a battle against the viewer holds the
 *   line for a few seconds, dice and all; otherwise a running count.
 * - Acting, before the first move: one line naming what was lost.
 * - Acting, after the first move: a pill in the corner, so the recap stays
 *   one tap away without asking to be dismissed.
 *
 * Tapping the line or the pill opens a half sheet with the same per-player
 * rows the desktop panel shows. Nothing here ever opens on its own: a lost
 * territory is named in the line and pulsed on the map instead.
 */
export default function MobileTurnStrip({
  recaps,
  viewerPlayerId,
  liveCombat,
  isMyTurn,
  acted,
  onOpenFullLog,
}: {
  recaps: TurnRecapEntry[];
  viewerPlayerId: string | null;
  /** The latest combat in the game, whoever fought it; the strip picks what to show. */
  liveCombat: CombatResult | null;
  isMyTurn: boolean;
  /** The viewer has made their first move this turn. */
  acted: boolean;
  onOpenFullLog: () => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [openEntries, setOpenEntries] = useState<Record<string, boolean>>({});
  const [live, setLive] = useState<CombatResult | null>(null);
  const liveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenLiveRef = useRef<CombatResult | null>(null);

  // A battle against the viewer, during someone else's turn, holds the line
  // briefly. The viewer's own attacks have their modal; other players' fights
  // with each other are the summary's business, not the line's.
  useEffect(() => {
    if (!liveCombat || liveCombat === seenLiveRef.current) return;
    seenLiveRef.current = liveCombat;
    if (isMyTurn || !combatInvolves(liveCombat, viewerPlayerId)) return;
    setLive(liveCombat);
    if (liveTimerRef.current) clearTimeout(liveTimerRef.current);
    liveTimerRef.current = setTimeout(() => setLive(null), LIVE_LINE_MS);
  }, [liveCombat, isMyTurn, viewerPlayerId]);

  // The viewer's turn starting ends the live line; the summary takes over.
  useEffect(() => {
    if (!isMyTurn) return;
    setLive(null);
    if (liveTimerRef.current) clearTimeout(liveTimerRef.current);
  }, [isMyTurn]);

  useEffect(() => () => { if (liveTimerRef.current) clearTimeout(liveTimerRef.current); }, []);

  // The batch clears when the viewer's turn ends; the sheet and its open rows go with it.
  useEffect(() => {
    if (recaps.length === 0) {
      setSheetOpen(false);
      setOpenEntries({});
    }
  }, [recaps.length]);

  const summary = summarizeRecapsForViewer(recaps, viewerPlayerId);
  if (recaps.length === 0 && !live) return null;

  const sheet = sheetOpen && recaps.length > 0 && (
    <>
      <button
        type="button"
        className="fixed inset-0 z-[37] bg-black/30"
        aria-label="Close recap"
        onClick={() => setSheetOpen(false)}
      />
      <div
        data-testid="turn-strip-sheet"
        className="fixed mobile-sheet-above-nav inset-x-0 z-[38] max-h-[45vh] rounded-t-2xl border-t border-bf-border bg-bf-surface shadow-2xl flex flex-col animate-slide-up"
        role="dialog"
        aria-label="While you were away"
      >
        <div className="flex items-center gap-2 px-3 py-2 border-b border-bf-border shrink-0">
          <History className="w-4 h-4 text-bf-gold shrink-0" aria-hidden />
          <span className="font-display text-sm text-bf-gold flex-1 truncate">
            While you were away ({summary.turns} {summary.turns === 1 ? 'turn' : 'turns'})
          </span>
          <button
            type="button"
            onClick={() => setSheetOpen(false)}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center text-bf-muted hover:text-bf-text"
            aria-label="Close recap"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto divide-y divide-bf-border/50 text-sm">
          <RecapEntryList
            recaps={recaps}
            viewerPlayerId={viewerPlayerId}
            openEntries={openEntries}
            onToggle={(key) => setOpenEntries((m) => ({ ...m, [key]: !m[key] }))}
          />
        </div>
        <button
          type="button"
          onClick={() => { setSheetOpen(false); onOpenFullLog(); }}
          className="min-h-[44px] px-3 text-left text-xs text-bf-muted hover:text-bf-gold border-t border-bf-border shrink-0 pb-safe"
        >
          View full log →
        </button>
      </div>
    </>
  );

  // Acting and already moving: the corner pill keeps the recap a tap away.
  if (isMyTurn && acted) {
    return (
      <>
        <button
          type="button"
          data-testid="turn-strip-pill"
          onClick={() => setSheetOpen(true)}
          className={clsx(
            'absolute bottom-2 right-2 z-20 inline-flex items-center gap-1 px-2.5 h-9 rounded-full border text-xs font-medium shadow-lg backdrop-blur-sm',
            summary.lost.length > 0
              ? 'bg-red-500/15 border-red-500/40 text-red-300'
              : 'bg-bf-surface/90 border-bf-border text-bf-muted',
          )}
          aria-label={`While you were away: ${summary.turns} turns`}
        >
          <History className="w-3.5 h-3.5" aria-hidden />
          <span className="tabular-nums">{summary.turns}</span>
        </button>
        {sheet}
      </>
    );
  }

  const lostNames = summary.lost.map((l) => l.name);

  return (
    <>
      <div className="absolute bottom-2 inset-x-2 z-20" data-testid="turn-strip">
        {live ? (
          <div
            data-testid="turn-strip-live"
            className={clsx(
              'flex items-center gap-2 px-3 py-2 rounded-lg border bg-bf-surface/95 backdrop-blur-sm shadow-lg text-xs',
              live.territory_captured ? 'border-red-500/50' : 'border-bf-border',
            )}
            role="status"
            aria-live="polite"
          >
            <Shield className={clsx('w-3.5 h-3.5 shrink-0', live.territory_captured ? 'text-red-400' : 'text-bf-gold')} aria-hidden />
            <span className="truncate flex-1 text-bf-text">
              {live.attackerName ?? 'Attacker'} → {live.toName ?? '?'}
              <span className="text-red-400/80"> (you)</span>
            </span>
            <span className="flex items-center gap-0.5 shrink-0" aria-label="Dice">
              {live.attacker_rolls.map((r, i) => (
                <span key={`a${i}`} className="inline-flex items-center justify-center w-4 h-4 rounded bg-red-500/20 text-red-400 font-mono text-[10px] font-bold">{r}</span>
              ))}
              <span className="text-bf-muted mx-0.5">·</span>
              {live.defender_rolls.map((r, i) => (
                <span key={`d${i}`} className="inline-flex items-center justify-center w-4 h-4 rounded bg-blue-500/20 text-blue-400 font-mono text-[10px] font-bold">{r}</span>
              ))}
            </span>
            <span className={clsx('shrink-0 font-medium', live.territory_captured ? 'text-red-400' : 'text-bf-text')}>
              {live.territory_captured
                ? 'Lost!'
                : live.defender_losses > 0
                  ? `held, −${live.defender_losses}`
                  : 'held'}
            </span>
          </div>
        ) : (
          <button
            type="button"
            data-testid="turn-strip-line"
            onClick={() => setSheetOpen(true)}
            className={clsx(
              'w-full flex items-center gap-2 px-3 py-2 rounded-lg border bg-bf-surface/95 backdrop-blur-sm shadow-lg text-xs text-left',
              lostNames.length > 0 ? 'border-red-500/40' : 'border-bf-border',
            )}
            aria-expanded={sheetOpen}
          >
            <History className="w-3.5 h-3.5 text-bf-gold shrink-0" aria-hidden />
            <span className="truncate flex-1 text-bf-text">
              {lostNames.length > 0 ? (
                <>
                  <span className="text-red-400 font-medium">Lost {lostNames.join(', ')}</span>
                  <span className="text-bf-muted"> · {summary.battles} {summary.battles === 1 ? 'battle' : 'battles'}</span>
                </>
              ) : isMyTurn ? (
                <>
                  While you were away
                  <span className="text-bf-muted"> · {summary.battles} {summary.battles === 1 ? 'battle' : 'battles'}</span>
                  {summary.captures > 0 && (
                    <span className="text-bf-muted"> · {summary.captures} {summary.captures === 1 ? 'capture' : 'captures'}</span>
                  )}
                </>
              ) : (
                <>
                  <Swords className="inline w-3 h-3 mr-1 -mt-0.5 text-bf-muted" aria-hidden />
                  {summary.turns} {summary.turns === 1 ? 'turn' : 'turns'}
                  <span className="text-bf-muted"> · {summary.battles} {summary.battles === 1 ? 'battle' : 'battles'}</span>
                  {summary.captures > 0 && (
                    <span className="text-bf-muted"> · {summary.captures} {summary.captures === 1 ? 'capture' : 'captures'}</span>
                  )}
                </>
              )}
            </span>
            {summary.attacksOnViewer > 0 && lostNames.length === 0 && (
              <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-300 text-[10px] font-medium">
                <Shield className="w-2.5 h-2.5" aria-hidden />
                {summary.attacksOnViewer}
              </span>
            )}
            <ChevronUp className="w-3.5 h-3.5 text-bf-muted shrink-0" aria-hidden />
          </button>
        )}
      </div>
      {sheet}
    </>
  );
}
