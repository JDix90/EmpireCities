import React from 'react';
import clsx from 'clsx';
import type { GameOverModalData } from './ActionModal';

function EfficiencyBar({ pct }: { pct: number }) {
  return (
    <div className="h-1 w-20 rounded-full bg-white/10 overflow-hidden">
      <div
        className={clsx(
          'h-full rounded-full transition-all',
          pct >= 60 ? 'bg-emerald-400' : pct >= 40 ? 'bg-yellow-400' : 'bg-red-400',
        )}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  );
}

/**
 * Inline SVG sparkline of the player's win-probability series. Scaled to a
 * fixed 0–100% Y range so different players' sparklines are directly
 * comparable across rows.
 */
function ProbabilitySparkline({
  values,
  color,
  width = 80,
  height = 16,
}: {
  values: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (values.length < 2) {
    return <div className="text-white/20 text-[10px]">—</div>;
  }
  const xStep = width / Math.max(1, values.length - 1);
  const points = values
    .map((v, i) => `${(i * xStep).toFixed(2)},${(height - v * height).toFixed(2)}`)
    .join(' ');
  // Endpoint marker so the player can tell where they ended up.
  const lastX = (values.length - 1) * xStep;
  const lastY = height - values[values.length - 1] * height;
  return (
    <svg width={width} height={height} aria-hidden="true" className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.85}
      />
      <circle cx={lastX} cy={lastY} r={1.6} fill={color} />
    </svg>
  );
}

function formatDuration(ms: number | null | undefined): string | null {
  if (ms == null || ms < 0) return null;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 1) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins.toString().padStart(2, '0')}m`;
}

function formatDifficulty(d: GameOverModalData['ai_difficulty']): string | null {
  if (!d) return null;
  return d.charAt(0).toUpperCase() + d.slice(1);
}

function formatProbDelta(delta: number): string {
  const pts = Math.round(delta * 100);
  return pts >= 0 ? `+${pts} pts` : `${pts} pts`;
}

/** Per-player win-probability series, oldest → newest. Returns [] if absent. */
function extractProbSeries(
  history: GameOverModalData['win_probability_history'],
  playerId: string,
): number[] {
  if (!history || history.length === 0) return [];
  return history
    .map((snap) => snap.probabilities[playerId])
    .filter((v): v is number => typeof v === 'number');
}

export default function MatchStatsTab({
  data,
  myId,
}: {
  data: GameOverModalData;
  myId: string | null;
}) {
  const sortedPlayers = [...data.players].sort((a, b) => b.territory_count - a.territory_count);
  const myStats = myId ? data.combat_stats?.[myId] : undefined;

  const atkEff = myStats && myStats.attacks > 0
    ? Math.round((myStats.attack_wins / myStats.attacks) * 100)
    : null;
  const defEff = myStats && myStats.defenses > 0
    ? Math.round((myStats.defense_wins / myStats.defenses) * 100)
    : null;

  // Combat exchange ratio: units I destroyed / units I lost. Only meaningful
  // when at least one of each happened; otherwise the ratio is undefined.
  const unitsLost = myStats?.units_lost ?? 0;
  const unitsDestroyed = myStats?.units_destroyed ?? 0;
  const exchangeRatio = unitsLost > 0
    ? unitsDestroyed / unitsLost
    : unitsDestroyed > 0 ? Infinity : null;

  // Whether *any* player accrued cards / wonders / etc. — drives whether to
  // even render the column to avoid all-zero noise on short games.
  const anyCardsRedeemed = data.players.some((p) => (p.cards_redeemed_count ?? 0) > 0);
  const anyTechsResearched = data.players.some((p) => (p.unlocked_techs_count ?? 0) > 0);
  const anyBuildings = data.players.some((p) => (p.buildings_built_count ?? 0) > 0);
  const anySparkline = (data.win_probability_history?.length ?? 0) >= 2;
  const showsExtras = anyCardsRedeemed || anyTechsResearched || anyBuildings;

  const durationLabel = formatDuration(data.duration_ms);
  const difficultyLabel = formatDifficulty(data.ai_difficulty);

  const summary = data.decision_summary;
  const bigSwing = summary?.biggest_swing;
  const bestMove = summary?.best;
  const worstMove = summary?.worst;
  // Hide "worst" if it's the same row as best (small games can produce that).
  const distinctWorst = worstMove && bestMove && worstMove.step !== bestMove.step ? worstMove : null;

  return (
    <div className="space-y-5 text-left">

      {/* Header summary chip — turn count, game length, AI difficulty */}
      <div className="flex flex-wrap gap-2 text-[11px] text-white/50">
        <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10">
          {data.turnCount} turn{data.turnCount === 1 ? '' : 's'}
        </span>
        {durationLabel && (
          <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10">
            {durationLabel}
          </span>
        )}
        {difficultyLabel && (
          <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10">
            vs {difficultyLabel} AI
          </span>
        )}
        {data.is_ranked && (
          <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300/80">
            Ranked
          </span>
        )}
      </div>

      {/* Per-player leaderboard table */}
      <div>
        <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">Final Standings</p>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-white/30 text-xs">
              <th className="text-left pb-2 font-medium">Player</th>
              {anySparkline && <th className="text-center pb-2 font-medium">Arc</th>}
              <th className="text-right pb-2 font-medium">Terr.</th>
              {showsExtras && anyCardsRedeemed && <th className="text-right pb-2 font-medium">Cards</th>}
              <th className="text-right pb-2 font-medium">XP</th>
              <th className="text-right pb-2 font-medium">MMR</th>
            </tr>
          </thead>
          <tbody>
            {sortedPlayers.map((p, i) => {
              const isMe = p.player_id === myId;
              const mmrDelta = data.rating_deltas?.[p.player_id];
              const xp = data.xp_earned_by_player?.[p.player_id] ?? 0;
              const series = extractProbSeries(data.win_probability_history, p.player_id);
              const peakNote = p.peak_territory_count != null && p.peak_territory_count > p.territory_count
                ? ` (peak ${p.peak_territory_count})`
                : '';
              return (
                <tr
                  key={p.player_id}
                  className={clsx(
                    'border-t border-white/5',
                    isMe ? 'text-cc-gold' : i === 0 ? 'text-yellow-300' : 'text-white/60',
                    p.is_eliminated && 'opacity-40',
                  )}
                >
                  <td className="py-2 pr-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                      <span className="truncate">{p.username}</span>
                      {p.is_ai && <span className="text-white/25 text-[10px] shrink-0">(AI)</span>}
                      {isMe && <span className="text-cc-gold/60 text-[10px] shrink-0">you</span>}
                    </div>
                  </td>
                  {anySparkline && (
                    <td className="py-2 px-2 align-middle">
                      <div className="flex justify-center">
                        <ProbabilitySparkline values={series} color={p.color} />
                      </div>
                    </td>
                  )}
                  <td className="text-right py-2 tabular-nums">
                    {p.territory_count}
                    {peakNote && <span className="text-white/30 text-[10px] ml-1">{peakNote}</span>}
                  </td>
                  {showsExtras && anyCardsRedeemed && (
                    <td className="text-right py-2 tabular-nums text-white/60">
                      {(p.cards_redeemed_count ?? 0) > 0 ? p.cards_redeemed_count : '—'}
                    </td>
                  )}
                  <td className="text-right py-2 tabular-nums text-emerald-400/80">
                    {xp > 0 ? `+${xp}` : '—'}
                  </td>
                  <td className={clsx(
                    'text-right py-2 tabular-nums',
                    mmrDelta == null ? 'text-white/25'
                      : mmrDelta > 0 ? 'text-emerald-400'
                      : mmrDelta < 0 ? 'text-red-400' : 'text-white/40',
                  )}>
                    {mmrDelta == null ? '—' : mmrDelta > 0 ? `+${mmrDelta}` : mmrDelta}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* My combat efficiency (only shown to the local player) */}
      {myStats ? (
        <div className="bg-white/[0.04] rounded-xl p-4 space-y-3 border border-white/8">
          <p className="text-white/40 text-xs font-semibold uppercase tracking-wider">Your Combat</p>

          <div className="space-y-3">
            {/* Attack efficiency */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-white/70 text-sm">Attack efficiency</p>
                <p className="text-white/30 text-[11px]">
                  {myStats.attacks > 0
                    ? `${myStats.attack_wins} wins / ${myStats.attacks} exchanges`
                    : 'No attacks launched'}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="text-white/80 text-sm font-medium tabular-nums">
                  {atkEff !== null ? `${atkEff}%` : '—'}
                </span>
                {atkEff !== null && <EfficiencyBar pct={atkEff} />}
              </div>
            </div>

            {/* Defence efficiency */}
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-white/70 text-sm">Defence efficiency</p>
                <p className="text-white/30 text-[11px]">
                  {myStats.defenses > 0
                    ? `${myStats.defense_wins} holds / ${myStats.defenses} exchanges`
                    : 'Untouched — no enemy reached you'}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="text-white/80 text-sm font-medium tabular-nums">
                  {defEff !== null ? `${defEff}%` : '—'}
                </span>
                {defEff !== null && <EfficiencyBar pct={defEff} />}
              </div>
            </div>

            {/* Combat exchange ratio (units destroyed / units lost) */}
            {(unitsLost > 0 || unitsDestroyed > 0) && (
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-white/70 text-sm">Exchange ratio</p>
                  <p className="text-white/30 text-[11px]">
                    {unitsDestroyed} destroyed / {unitsLost} lost
                  </p>
                </div>
                <span className={clsx(
                  'text-sm font-medium tabular-nums',
                  exchangeRatio === null ? 'text-white/40'
                    : exchangeRatio === Infinity ? 'text-emerald-400'
                    : exchangeRatio >= 1.2 ? 'text-emerald-400'
                    : exchangeRatio >= 0.8 ? 'text-yellow-400'
                    : 'text-red-400',
                )}>
                  {exchangeRatio === null ? '—'
                    : exchangeRatio === Infinity ? '∞'
                    : `${exchangeRatio.toFixed(2)} : 1`}
                </span>
              </div>
            )}

            {/* Territories captured */}
            <div className="flex items-center justify-between">
              <p className="text-white/70 text-sm">Territories captured</p>
              <span className="text-white/80 text-sm font-medium tabular-nums">
                {myStats.territories_captured}
              </span>
            </div>

            {/* Eliminations dealt — only show when non-zero */}
            {(myStats.eliminations_dealt ?? 0) > 0 && (
              <div className="flex items-center justify-between">
                <p className="text-white/70 text-sm">Players eliminated</p>
                <span className="text-white/80 text-sm font-medium tabular-nums">
                  {myStats.eliminations_dealt}
                </span>
              </div>
            )}

            {/* Sea attacks — only meaningful when there were any */}
            {(myStats.sea_attacks ?? 0) > 0 && (
              <div className="flex items-center justify-between">
                <p className="text-white/70 text-sm">Sea-lane attacks</p>
                <span className="text-white/80 text-sm font-medium tabular-nums">
                  {myStats.sea_attacks}
                </span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="text-white/25 text-xs text-center py-2">
          Combat data not available for this game.
        </p>
      )}

      {/* Best / worst single move from the decision log */}
      {(bestMove || distinctWorst || bigSwing) && (
        <div className="bg-white/[0.04] rounded-xl p-4 space-y-2.5 border border-white/8">
          <p className="text-white/40 text-xs font-semibold uppercase tracking-wider">Decision Highlights</p>
          {bestMove && (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-white/70 text-sm">Best move</p>
                <p className="text-white/40 text-[11px]">
                  Turn {bestMove.turn} · {bestMove.summary}
                </p>
              </div>
              <span className="text-emerald-400 text-sm font-medium tabular-nums shrink-0">
                {formatProbDelta(bestMove.prob_delta)}
              </span>
            </div>
          )}
          {distinctWorst && (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-white/70 text-sm">Worst move</p>
                <p className="text-white/40 text-[11px]">
                  Turn {distinctWorst.turn} · {distinctWorst.summary}
                </p>
              </div>
              <span className="text-red-400 text-sm font-medium tabular-nums shrink-0">
                {formatProbDelta(distinctWorst.prob_delta)}
              </span>
            </div>
          )}
          {bigSwing && (!bestMove || bigSwing.step !== bestMove.step) && (!distinctWorst || bigSwing.step !== distinctWorst.step) && (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-white/70 text-sm">Biggest swing</p>
                <p className="text-white/40 text-[11px]">
                  Turn {bigSwing.turn} · {bigSwing.summary}
                </p>
              </div>
              <span className={clsx(
                'text-sm font-medium tabular-nums shrink-0',
                bigSwing.prob_delta >= 0 ? 'text-emerald-400' : 'text-red-400',
              )}>
                {formatProbDelta(bigSwing.prob_delta)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Strategy summary (only shows the metrics that actually moved) */}
      {showsExtras && myId && (() => {
        const me = data.players.find((p) => p.player_id === myId);
        if (!me) return null;
        const cards = me.cards_redeemed_count ?? 0;
        const cardBonus = me.card_set_bonus_units ?? 0;
        const techs = me.unlocked_techs_count ?? 0;
        const builds = me.buildings_built_count ?? 0;
        if (cards === 0 && techs === 0 && builds === 0) return null;
        return (
          <div className="bg-white/[0.04] rounded-xl p-4 space-y-2.5 border border-white/8">
            <p className="text-white/40 text-xs font-semibold uppercase tracking-wider">Your Strategy</p>
            {cards > 0 && (
              <div className="flex items-center justify-between">
                <p className="text-white/70 text-sm">Card sets redeemed</p>
                <span className="text-white/80 text-sm font-medium tabular-nums">
                  {cards}
                  {cardBonus > 0 && <span className="text-white/40 text-[11px] ml-1">(+{cardBonus} units)</span>}
                </span>
              </div>
            )}
            {builds > 0 && (
              <div className="flex items-center justify-between">
                <p className="text-white/70 text-sm">Buildings constructed</p>
                <span className="text-white/80 text-sm font-medium tabular-nums">{builds}</span>
              </div>
            )}
            {techs > 0 && (
              <div className="flex items-center justify-between">
                <p className="text-white/70 text-sm">Techs researched</p>
                <span className="text-white/80 text-sm font-medium tabular-nums">{techs}</span>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
