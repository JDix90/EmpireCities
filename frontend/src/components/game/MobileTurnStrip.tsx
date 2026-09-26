import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, ChevronUp, History, Shield, Sword, Swords, X } from 'lucide-react';
import clsx from 'clsx';
import type { CombatResult } from '../../store/gameStore';
import { diceLook } from '@borderfall/shared';
import SkinnedMiniDie from '../cosmetics/SkinnedMiniDie';
import { usePlayerCosmetics } from '../cosmetics/useCosmetics';
import { RecapEntryList, type TurnRecapEntry } from './AiTurnRecapPanel';
import type { NotificationData } from './ActionModal';
import { combatInvolves, lostTerritoryIds, pickStripSlot, summarizeRecapsForViewer, type RecapRound } from '../../utils/mobileOverlays';

/** How long a fresh battle against the viewer holds the line before the summary returns. */
const LIVE_LINE_MS = 6000;
/** How long the viewer's own move feedback holds the line: the desktop toast's 1.8 s plus its fade. */
const NOTICE_LINE_MS = 2200;

/** One of the viewer's own move notices, as GamePage keys them; a new key is a new notice. */
export interface StripNotice {
  data: NotificationData;
  key: number;
}

const NO_HISTORY: RecapRound[] = [];

const NOTICE_ICONS = {
  shield: <Shield className="w-3.5 h-3.5" aria-hidden />,
  arrow: <ArrowRight className="w-3.5 h-3.5" aria-hidden />,
  sword: <Sword className="w-3.5 h-3.5" aria-hidden />,
} as const;

/**
 * The phone's one channel for what other players did (docs/MOBILE_UX_PLAN.md
 * M-12): a single line above the bottom bar, never a panel over the map.
 *
 * - Watching (not the viewer's turn): a battle against the viewer holds the
 *   line for a few seconds, dice and all; otherwise a running count.
 * - Acting, before the first move: one line naming what was lost.
 * - Acting, after the first move: a pill in the corner, so the recap stays
 *   one tap away without asking to be dismissed.
 * - The viewer's own move feedback (a placement, a fortify, the phase turning
 *   over; the toasts a desktop floats top-centre) takes the line for two
 *   seconds, the newest replacing the last, then gives it back.
 *
 * `pickStripSlot` decides which of those the one line shows. Tapping the
 * recap line or the pill opens a half sheet with the same per-player rows the
 * desktop panel shows; with a `history` of finished rounds the sheet gains a
 * scrubber, oldest round at the left and Now at the right, and reports the
 * scrubbed round's losses through `onScrub` for the map to pulse. Nothing here
 * ever opens on its own: a lost territory is named in the line and pulsed on
 * the map instead.
 */
export default function MobileTurnStrip({
  recaps,
  viewerPlayerId,
  liveCombat,
  isMyTurn,
  acted,
  notice = null,
  history = NO_HISTORY,
  onScrub,
  onOpenFullLog,
}: {
  recaps: TurnRecapEntry[];
  viewerPlayerId: string | null;
  /** The latest combat in the game, whoever fought it; the strip picks what to show. */
  liveCombat: CombatResult | null;
  isMyTurn: boolean;
  /** The viewer has made their first move this turn. */
  acted: boolean;
  /** The viewer's latest own-move notice; the line shows it briefly, newest first. */
  notice?: StripNotice | null;
  /** Finished rounds, oldest first, to scrub back through (M-12 phase 3). */
  history?: RecapRound[];
  /** The territories the viewer lost in the round being scrubbed, for the map; null when not scrubbing. */
  onScrub?: (lostIds: string[] | null) => void;
  onOpenFullLog: () => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  /** Position on the scrubber: an index into `history`, or `history.length` for Now. */
  const [scrubPos, setScrubPos] = useState(0);
  const [openEntries, setOpenEntries] = useState<Record<string, boolean>>({});
  const [live, setLive] = useState<CombatResult | null>(null);
  // The live battle's dice, each side in its player's skin (store_v2_enabled).
  const cosmeticsOf = usePlayerCosmetics();
  const attackerDiceSkin = diceLook(cosmeticsOf(live?.attackerId)?.dice);
  const defenderDiceSkin = diceLook(cosmeticsOf(live?.defenderId)?.dice);
  const liveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenLiveRef = useRef<CombatResult | null>(null);
  const [shownNotice, setShownNotice] = useState<StripNotice | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // The viewer's own move feedback holds the line briefly. A newer notice
  // replaces the one showing and restarts the clock, so quick placements read
  // as one line updating, never a queue the player waits out.
  useEffect(() => {
    if (!notice) return;
    setShownNotice(notice);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setShownNotice(null), NOTICE_LINE_MS);
  }, [notice]);

  useEffect(() => () => {
    if (liveTimerRef.current) clearTimeout(liveTimerRef.current);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
  }, []);

  // The batch clears when the viewer's turn ends; the sheet and its open rows go with it.
  useEffect(() => {
    if (recaps.length === 0) {
      setSheetOpen(false);
      setOpenEntries({});
    }
  }, [recaps.length]);

  // Opens on Now when there is something current, else on the latest round.
  const openSheet = () => {
    setScrubPos(recaps.length > 0 || history.length === 0 ? history.length : history.length - 1);
    setSheetOpen(true);
  };

  const nowPos = history.length;
  const viewingNow = scrubPos >= nowPos;
  const shownRound = viewingNow ? null : history[scrubPos];
  const shownRecaps = shownRound ? shownRound.entries : recaps;

  // While a past round is on the sheet, the map pulses what the viewer lost
  // in it; Now and a closed sheet hand the map back to its own rule.
  useEffect(() => {
    if (!onScrub) return;
    onScrub(sheetOpen && shownRound ? lostTerritoryIds(shownRound.entries, viewerPlayerId) : null);
  }, [onScrub, sheetOpen, shownRound, viewerPlayerId]);
  const onScrubRef = useRef(onScrub);
  onScrubRef.current = onScrub;
  useEffect(() => () => onScrubRef.current?.(null), []);

  const summary = summarizeRecapsForViewer(recaps, viewerPlayerId);
  const slot = pickStripSlot({ live: !!live, notice: !!shownNotice, recaps: recaps.length > 0, isMyTurn, acted, history: history.length > 0 });
  if (slot === 'none') return null;

  const turnsAgo = nowPos - scrubPos;
  const sheetTitle = shownRound
    ? `Turn ${shownRound.turnNumber} · ${turnsAgo} ${turnsAgo === 1 ? 'turn' : 'turns'} ago`
    : recaps.length > 0
      ? `While you were away (${summary.turns} ${summary.turns === 1 ? 'turn' : 'turns'})`
      : 'Nothing new this turn yet';

  const sheet = sheetOpen && (recaps.length > 0 || history.length > 0) && (
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
          <span className="font-display text-sm text-bf-gold flex-1 truncate" data-testid="turn-strip-sheet-title">
            {sheetTitle}
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
        {history.length > 0 && (
          <div className="px-2 pt-1 border-b border-bf-border shrink-0">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setScrubPos((p) => Math.max(0, p - 1))}
                disabled={scrubPos <= 0}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded text-bf-muted hover:text-bf-text disabled:opacity-30"
                aria-label="Earlier turn"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <input
                type="range"
                min={0}
                max={nowPos}
                step={1}
                value={scrubPos}
                onChange={(e) => setScrubPos(Number(e.target.value))}
                className="flex-1 h-8 accent-amber-400"
                aria-label="Turn history"
                aria-valuetext={sheetTitle}
                data-testid="turn-strip-scrubber"
              />
              <button
                type="button"
                onClick={() => setScrubPos((p) => Math.min(nowPos, p + 1))}
                disabled={scrubPos >= nowPos}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded text-bf-muted hover:text-bf-text disabled:opacity-30"
                aria-label="Later turn"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <div className="flex justify-between px-9 pb-1 -mt-1 text-[10px] text-bf-muted" aria-hidden>
              <span>Turn {history[0].turnNumber}</span>
              <span>Now</span>
            </div>
          </div>
        )}
        <div className="overflow-y-auto divide-y divide-bf-border/50 text-sm">
          {shownRecaps.length === 0 && (
            <p className="px-3 py-3 text-xs text-bf-muted">No battles yet this turn.</p>
          )}
          <RecapEntryList
            recaps={shownRecaps}
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
  if (slot === 'pill') {
    return (
      <>
        <button
          type="button"
          data-testid="turn-strip-pill"
          onClick={openSheet}
          className={clsx(
            'absolute bottom-2 right-2 z-20 inline-flex items-center gap-1 px-2.5 h-9 rounded-full border text-xs font-medium shadow-lg',
            // Solid backgrounds, no blur: blur over a live map is re-rendered
            // every frame on a phone (M-13).
            summary.lost.length > 0
              ? 'bg-bf-surface/95 border-red-500/50 text-red-300'
              : 'bg-bf-surface/95 border-bf-border text-bf-muted',
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
        {slot === 'notice' && shownNotice ? (
          <div
            data-testid="turn-strip-notice"
            className={clsx(
              'flex items-center gap-2 px-3 py-2 rounded-lg border bg-bf-surface/95 shadow-lg text-xs',
              shownNotice.data.accentBorder,
            )}
            role="status"
            aria-live="polite"
          >
            <span className={clsx('shrink-0', shownNotice.data.accentText)}>{NOTICE_ICONS[shownNotice.data.icon]}</span>
            <span className="truncate flex-1 text-bf-text font-medium">{shownNotice.data.text}</span>
            {shownNotice.data.subtext && (
              <span className="shrink-0 text-bf-muted">{shownNotice.data.subtext}</span>
            )}
          </div>
        ) : live ? (
          <div
            data-testid="turn-strip-live"
            className={clsx(
              'flex items-center gap-2 px-3 py-2 rounded-lg border bg-bf-surface/95 shadow-lg text-xs',
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
                attackerDiceSkin
                  ? <SkinnedMiniDie key={`a${i}`} value={r} look={attackerDiceSkin} side="attacker" className="w-4 h-4 text-[10px]" />
                  : <span key={`a${i}`} className="inline-flex items-center justify-center w-4 h-4 rounded bg-red-500/20 text-red-400 font-mono text-[10px] font-bold">{r}</span>
              ))}
              <span className="text-bf-muted mx-0.5">·</span>
              {live.defender_rolls.map((r, i) => (
                defenderDiceSkin
                  ? <SkinnedMiniDie key={`d${i}`} value={r} look={defenderDiceSkin} side="defender" className="w-4 h-4 text-[10px]" />
                  : <span key={`d${i}`} className="inline-flex items-center justify-center w-4 h-4 rounded bg-blue-500/20 text-blue-400 font-mono text-[10px] font-bold">{r}</span>
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
            onClick={openSheet}
            className={clsx(
              'w-full flex items-center gap-2 px-3 py-2 rounded-lg border bg-bf-surface/95 shadow-lg text-xs text-left',
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
