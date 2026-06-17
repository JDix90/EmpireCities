import { monitorEventLoopDelay, type IntervalHistogram } from 'perf_hooks';

/**
 * Passive event-loop delay monitor. Event-loop lag is the earliest, clearest
 * signal that the Node process is CPU-saturated (e.g. too many AI worker turns
 * or a heavy query path blocking the loop) — it climbs before requests visibly
 * fail. Enabled once at import; read into GET /metrics/json so it's watchable
 * during a load burst.
 */
const histogram: IntervalHistogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();

const toMs = (nanos: number): number => (Number.isFinite(nanos) ? +(nanos / 1e6).toFixed(2) : 0);

/** Event-loop lag in milliseconds (mean / p99 / max) over the monitor's window. */
export function getEventLoopLagMs(): { mean: number; p99: number; max: number } {
  return {
    mean: toMs(histogram.mean),
    p99: toMs(histogram.percentile(99)),
    max: toMs(histogram.max),
  };
}
