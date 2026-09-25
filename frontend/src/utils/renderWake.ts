/**
 * When the globe's render loop runs (docs/MOBILE_UX_PLAN.md M-13).
 *
 * react-globe.gl renders on every animation frame for as long as its loop is
 * running, whether or not anything on screen changed. The globe therefore
 * pauses the loop whenever nothing needs drawing and wakes it for as long as
 * something does: a finger on the globe, a queued animation, a camera tween,
 * a board change. A wake is a deadline, and a wake only ever moves the
 * deadline later, so a short wake (a board change: a few frames) never cuts
 * a long one (a pointer: four seconds) short. Past the deadline the loop
 * keeps running only while something is still moving, re-checking on a poll.
 */
export interface RenderWakeDeps {
  resume: () => void;
  pause: () => void;
  /** Something is moving on its own: a spin, a queued or playing animation, a finger down. */
  busy: () => boolean;
  /** The page is hidden: never render. */
  hidden: () => boolean;
  /** How often a loop kept running by `busy` re-checks whether it can stop. */
  pollMs: () => number;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface RenderWake {
  /** Keep the loop running for at least `ms` from now. */
  wake: (ms: number) => void;
  /** Pause the loop if nothing needs it any more; used by the poll and on visibility changes. */
  check: () => void;
  dispose: () => void;
}

export function createRenderWake(deps: RenderWakeDeps): RenderWake {
  const now = deps.now ?? (() => Date.now());
  const setT = deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms));
  const clearT = deps.clearTimeout ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let awakeUntil = 0;
  let timer: unknown = null;

  function clearTimer() {
    if (timer !== null) clearT(timer);
    timer = null;
  }

  function evaluate() {
    clearTimer();
    if (deps.hidden()) {
      awakeUntil = 0;
      deps.pause();
      return;
    }
    const remaining = awakeUntil - now();
    if (remaining > 0 || deps.busy()) {
      deps.resume();
      timer = setT(evaluate, remaining > 0 ? remaining : deps.pollMs());
      return;
    }
    deps.pause();
  }

  return {
    wake(ms) {
      awakeUntil = Math.max(awakeUntil, now() + ms);
      evaluate();
    },
    check: evaluate,
    dispose: clearTimer,
  };
}
