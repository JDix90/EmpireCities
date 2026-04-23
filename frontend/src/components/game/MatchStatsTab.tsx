import React from 'react';
import clsx from 'clsx';
import type { GameOverModalData } from './ActionModal';

function StatRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-white/50 text-sm">{label}</span>
      <div className="text-right">
        <span className="text-white/85 text-sm font-medium tabular-nums">{value}</span>
        {sub && <p className="text-white/30 text-[10px] leading-tight">{sub}</p>}
      </div>
    </div>
  );
}

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

  return (
    <div className="space-y-5 text-left">

      {/* Per-player leaderboard table */}
      <div>
        <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-3">Final Standings</p>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-white/30 text-xs">
              <th className="text-left pb-2 font-medium">Player</th>
              <th className="text-right pb-2 font-medium">Terr.</th>
              <th className="text-right pb-2 font-medium">XP</th>
              <th className="text-right pb-2 font-medium">MMR</th>
            </tr>
          </thead>
          <tbody>
            {sortedPlayers.map((p, i) => {
              const isMe = p.player_id === myId;
              const mmrDelta = data.rating_deltas?.[p.player_id];
              const xp = data.xp_earned_by_player?.[p.player_id] ?? 0;
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
                  <td className="text-right py-2 tabular-nums">{p.territory_count}</td>
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
                  {myStats.attack_wins} wins / {myStats.attacks} exchanges
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
                  {myStats.defense_wins} holds / {myStats.defenses} exchanges
                </p>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <span className="text-white/80 text-sm font-medium tabular-nums">
                  {defEff !== null ? `${defEff}%` : '—'}
                </span>
                {defEff !== null && <EfficiencyBar pct={defEff} />}
              </div>
            </div>

            {/* Territories captured */}
            <div className="flex items-center justify-between">
              <p className="text-white/70 text-sm">Territories captured</p>
              <span className="text-white/80 text-sm font-medium tabular-nums">
                {myStats.territories_captured}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-white/25 text-xs text-center py-2">
          Combat data not available for this game.
        </p>
      )}
    </div>
  );
}
