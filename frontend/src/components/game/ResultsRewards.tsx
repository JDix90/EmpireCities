import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { Coins, Flame, Medal } from 'lucide-react';
import { prefersReducedMotion } from '../../utils/device';

/** A total's level and the XP it starts and ends at (backend statsManager `levelBand`). */
export interface LevelBand {
  xp: number;
  level: number;
  floor: number;
  next: number;
}

/** What a game added to the player's XP (game_over `progression[id].xp`). */
export interface ResultsXpSummary {
  game: number;
  medals: Array<{ id: string; xp: number }>;
  before: LevelBand;
  after: LevelBand;
}

const fractionIn = (band: LevelBand) =>
  band.next > band.floor ? Math.min(1, Math.max(0, (band.xp - band.floor) / (band.next - band.floor))) : 1;

/**
 * Where the level bar starts and ends. Within one level it fills from the old
 * total to the new; across a level-up it fills the old level to the end, then
 * starts the new level from empty.
 */
export function levelBarPlan(summary: ResultsXpSummary): {
  levelled: boolean;
  start: number;
  /** Where the first fill stops: the new total, or the end of the old level. */
  firstStop: number;
  end: number;
} {
  const levelled = summary.after.level > summary.before.level;
  return {
    levelled,
    start: fractionIn(summary.before),
    firstStop: levelled ? 1 : fractionIn(summary.after),
    end: fractionIn(summary.after),
  };
}

const FILL_MS = 700;

/**
 * The results screen's rewards, first after the outcome (results_rewards_first_enabled):
 * a level bar that fills and levels up, the XP the game and each medal paid,
 * the gold, and the medals themselves. It used to say "+105 XP" for a game
 * whose medals paid 1,000 more and took the player from Level 1 to 3, a
 * level-up the screen never showed, with the medals as text chips at the bottom.
 */
export default function ResultsRewards({
  xp,
  xpEarned,
  medalIds,
  medalName,
  gold,
  className,
}: {
  /** From the server; absent from an older server or a play-on game. */
  xp?: ResultsXpSummary;
  /** The game's XP alone, shown when `xp` is absent. */
  xpEarned?: number;
  medalIds: string[];
  medalName: (id: string) => string;
  gold?: { awarded: number; multiplier: number; winStreak: number };
  className?: string;
}) {
  const plan = xp ? levelBarPlan(xp) : null;
  const still = prefersReducedMotion();
  // stage 0: the old total; 1: filled to firstStop; 2: the new level, empty;
  // 3: the new total. A reduced-motion viewer sees the new total at once.
  const [stage, setStage] = useState(() => (plan && !still ? 0 : 3));
  useEffect(() => {
    if (!plan || still) return;
    const timers = [window.setTimeout(() => setStage(1), 350)];
    if (plan.levelled) {
      timers.push(window.setTimeout(() => setStage(2), 350 + FILL_MS + 250));
      timers.push(window.setTimeout(() => setStage(3), 350 + FILL_MS + 300));
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
    // The plan is fixed for the screen's life: run once.
  }, []);

  const shownLevel = !plan || !xp ? null : stage >= 2 || !plan.levelled ? xp.after.level : xp.before.level;
  const width = !plan
    ? 0
    : stage === 0
      ? plan.start
      : stage === 1
        ? plan.firstStop
        : stage === 2
          ? 0
          : plan.end;
  const medalXp = new Map((xp?.medals ?? []).map((m) => [m.id, m.xp]));
  const medalTotal = xp ? xp.medals.reduce((sum, m) => sum + m.xp, 0) : 0;

  return (
    <div className={clsx('text-left', className)} data-testid="results-rewards">
      {xp && plan && shownLevel != null ? (
        <div className="rounded-xl bg-white/[0.04] border border-white/[0.08] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <p className="font-display text-lg text-bf-text" data-testid="results-level">Level {shownLevel}</p>
            {plan.levelled && stage >= 2 && (
              <span
                className="text-xs font-semibold uppercase tracking-wide px-2 py-1 rounded-md bg-bf-gold/15 border border-bf-gold/40 text-bf-gold animate-fade-in"
                data-testid="results-level-up"
              >
                Level up{xp.after.level - xp.before.level > 1 ? ` · ${xp.before.level} → ${xp.after.level}` : '!'}
              </span>
            )}
          </div>
          <div
            className="mt-2 h-2.5 rounded-full bg-white/10 overflow-hidden"
            role="progressbar"
            aria-label={`Level ${xp.after.level} progress`}
            aria-valuemin={xp.after.floor}
            aria-valuemax={xp.after.next}
            aria-valuenow={xp.after.xp}
          >
            <div
              className="h-full rounded-full bg-bf-gold"
              style={{
                width: `${Math.round(width * 1000) / 10}%`,
                transition: stage === 2 || still ? 'none' : `width ${FILL_MS}ms ease-out`,
              }}
              data-testid="results-level-fill"
            />
          </div>
          <p className="mt-1.5 text-xs text-white/50 tabular-nums">
            {xp.after.xp.toLocaleString()} / {xp.after.next.toLocaleString()} XP
            {' · '}
            {(xp.after.next - xp.after.xp).toLocaleString()} to Level {xp.after.level + 1}
          </p>
          <p className="mt-2 text-sm text-bf-gold/90 font-medium" data-testid="results-xp-breakdown">
            +{(xp.game + medalTotal).toLocaleString()} XP
            {medalTotal > 0 && (
              <span className="text-white/50 font-normal">
                {' '}({xp.game.toLocaleString()} from the game, {medalTotal.toLocaleString()} from medals)
              </span>
            )}
          </p>
        </div>
      ) : (
        xpEarned != null && xpEarned > 0 && (
          <p className="text-bf-gold/90 text-sm font-medium text-center">+{xpEarned} XP</p>
        )
      )}

      {gold && gold.awarded > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
          <span className="inline-flex items-center gap-1 text-sm text-bf-gold font-medium">
            <Coins size={14} /> +{gold.awarded} Gold
          </span>
          {gold.multiplier > 1 && (
            <span className="inline-flex items-center gap-1 text-xs text-orange-400 font-bold bg-orange-400/10 border border-orange-400/30 rounded-md px-2 py-0.5">
              <Flame size={12} /> {gold.multiplier}× streak bonus
            </span>
          )}
          {gold.winStreak >= 3 && (
            <span className="inline-flex items-center gap-1 text-xs text-orange-300">🔥 {gold.winStreak} win streak</span>
          )}
        </div>
      )}

      {medalIds.length > 0 && (
        <div className="mt-4" data-testid="results-medals">
          <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-2 text-center">Medals earned</p>
          <ul className="space-y-1.5">
            {medalIds.map((id) => (
              <li
                key={id}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20 animate-fade-in"
              >
                <Medal className="w-4 h-4 text-yellow-300 shrink-0" aria-hidden />
                <span className="flex-1 min-w-0 truncate text-sm font-medium text-yellow-200">{medalName(id)}</span>
                {(medalXp.get(id) ?? 0) > 0 && (
                  <span className="shrink-0 text-xs font-semibold text-bf-gold tabular-nums">+{medalXp.get(id)} XP</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
