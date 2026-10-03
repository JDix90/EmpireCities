import React from 'react';
import { dailyClockLabel, type DailyClockSpec } from '../../utils/dailyClock';

/**
 * "Turn 4 of 5" for the Daily challenge banner. Renders nothing on a day
 * without a clock (utils/dailyClock).
 */
export default function DailyClock({
  spec,
  turn,
}: {
  spec: DailyClockSpec | null | undefined;
  turn: number | null | undefined;
}) {
  const label = dailyClockLabel(spec, turn);
  if (!label) return null;
  return (
    <span className="text-amber-300/90 text-xs tabular-nums shrink-0" data-testid="daily-clock">
      {label}
    </span>
  );
}
