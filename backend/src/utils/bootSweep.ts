/**
 * When each periodic sweep first runs after the backend starts.
 *
 * These sweeps used to run once the instant the backend booted, all together.
 * A boot is almost always a deploy (scripts/deploy-production.sh), and the
 * deploy is still working the same machine then: its image build has just
 * pushed Postgres's pages out of the page cache, and it goes on to re-seed the
 * maps table and prune old images. On 5 October 2026 the orphaned-game
 * sweep's first query got no reply in that window and failed with "Query read
 * timeout". So each sweep's first run now waits BOOT_SWEEP_DELAY_MS, and they
 * go one at a time, BOOT_SWEEP_STAGGER_MS apart, with the heaviest last. Their
 * regular intervals are unchanged.
 */
export const BOOT_SWEEP_DELAY_MS = 2 * 60 * 1000;
export const BOOT_SWEEP_STAGGER_MS = 30 * 1000;

/**
 * The first runs, in order: the cheap checks first, and last the orphaned-game
 * sweep, which scans game history and drains expired replay snapshots.
 */
export const BOOT_SWEEPS = ['season', 'monthly-challenges', 'indexnow', 'guest-cleanup', 'orphaned-games'] as const;
export type BootSweep = (typeof BOOT_SWEEPS)[number];

/** How long after boot `sweep` first runs. */
export function bootSweepDelayMs(sweep: BootSweep): number {
  return BOOT_SWEEP_DELAY_MS + BOOT_SWEEPS.indexOf(sweep) * BOOT_SWEEP_STAGGER_MS;
}

/**
 * Run `sweep`'s first pass at its time after boot. Returns a cancel for the
 * sweep's stop function, so a shutdown before then runs nothing.
 */
export function scheduleBootSweep(sweep: BootSweep, run: () => void): () => void {
  const timer = setTimeout(run, bootSweepDelayMs(sweep));
  timer.unref();
  return () => clearTimeout(timer);
}
