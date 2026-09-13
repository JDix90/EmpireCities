import type { MatchResult } from '@borderfall/warfront-sim';

/**
 * The final standings.
 *
 * Scoring is "the format, not a rule to learn", so this says what happened in the terms
 * the format is written in: majority, the clock, or the last seat standing, and then the
 * province-minutes that broke any tie.
 */

export interface WarfrontResultProps {
  result: MatchResult;
  seatNames: Record<number, string>;
  playerSeat: number;
  onRestart: () => void;
}

const REASON: Record<string, string> = {
  majority: 'won outright on a majority of provinces',
  cap: 'the clock ran out',
  'last-standing': 'last seat standing',
};

export default function WarfrontResult({ result, seatNames, playerSeat, onRestart }: WarfrontResultProps) {
  const you = result.standings.find((s) => s.seat === playerSeat);
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-bf-dark/85 px-6">
      <div data-testid="warfront-result" className="w-full max-w-md rounded-xl border border-bf-border bg-cc-panel p-5">
        <div className="text-sm font-semibold text-bf-text">
          {result.winner === playerSeat
            ? 'You won'
            : result.winner === 0
              ? 'A draw'
              : `${seatNames[result.winner] ?? `Seat ${result.winner}`} won`}
        </div>
        <div className="mt-0.5 text-[11px] text-bf-muted">
          {REASON[result.reason ?? ''] ?? 'the match ended'}
          {you ? ` · you placed ${you.place} of ${result.standings.length}` : ''}
        </div>

        <table className="mt-4 w-full text-[11px]">
          <thead className="text-bf-muted">
            <tr>
              <th className="text-left font-normal">Seat</th>
              <th className="text-right font-normal">Provinces</th>
              <th className="text-right font-normal">Province-minutes</th>
            </tr>
          </thead>
          <tbody>
            {result.standings.map((s) => (
              <tr key={s.seat} className={s.seat === playerSeat ? 'text-bf-gold' : 'text-bf-text'}>
                <td className="py-0.5">
                  {s.place}. {seatNames[s.seat] ?? `Seat ${s.seat}`}
                  {s.eliminated ? <span className="ml-1 text-red-300">eliminated</span> : null}
                </td>
                <td className="text-right font-mono">{s.provinces}</td>
                <td className="text-right font-mono">{s.provinceMinutes}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <button
          type="button"
          onClick={onRestart}
          className="mt-5 w-full rounded border border-bf-gold/60 bg-bf-gold/10 px-3 py-2 text-[12px] text-bf-gold hover:bg-bf-gold/20"
        >
          Play again
        </button>
      </div>
    </div>
  );
}
