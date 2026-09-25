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
 *
 * A wake can also ask for frames (M-14): a board change is drawn by the frames
 * after it reaches the scene, and one slow frame must not use up a short wake
 * before that happens. Owed frames keep the loop running past the deadline,
 * for at most OWED_FRAMES_MAX_MS, so a renderer that stops drawing cannot keep
 * it awake.
 */

/** The longest owed frames can hold the loop past a wake's own deadline. */
export const OWED_FRAMES_MAX_MS = 1000;
/** How soon a loop held by owed frames re-checks: a frame at 20 a second. */
const OWED_FRAMES_RECHECK_MS = 50;

export interface RenderWakeDeps {
  resume: () => void;
  pause: () => void;
  /** Something is moving on its own: a spin, a queued or playing animation, a finger down. */
  busy: () => boolean;
  /** The page is hidden: never render. */
  hidden: () => boolean;
  /** How often a loop kept running by `busy` re-checks whether it can stop. */
  pollMs: () => number;
  /** Frames drawn so far, or null when the renderer cannot count them (then wakes are time only). */
  framesDrawn?: () => number | null;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface RenderWake {
  /** Keep the loop running for at least `ms` from now, and until `frames` more frames are drawn. */
  wake: (ms: number, frames?: number) => void;
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
  // The frame count the loop must reach, and when to stop waiting for it.
  let framesTarget = 0;
  let framesGiveUpAt = 0;

  function clearTimer() {
    if (timer !== null) clearT(timer);
    timer = null;
  }

  function framesOwed(): boolean {
    if (framesTarget === 0) return false;
    const drawn = deps.framesDrawn?.() ?? null;
    if (drawn === null || drawn >= framesTarget || now() >= framesGiveUpAt) {
      framesTarget = 0;
      framesGiveUpAt = 0;
      return false;
    }
    return true;
  }

  function evaluate() {
    clearTimer();
    if (deps.hidden()) {
      awakeUntil = 0;
      framesTarget = 0;
      framesGiveUpAt = 0;
      deps.pause();
      return;
    }
    const remaining = awakeUntil - now();
    const owed = framesOwed();
    if (remaining > 0 || owed || deps.busy()) {
      deps.resume();
      timer = setT(evaluate, remaining > 0 ? remaining : owed ? OWED_FRAMES_RECHECK_MS : deps.pollMs());
      return;
    }
    deps.pause();
  }

  return {
    wake(ms, frames = 0) {
      const t = now();
      awakeUntil = Math.max(awakeUntil, t + ms);
      const drawn = frames > 0 ? (deps.framesDrawn?.() ?? null) : null;
      if (drawn !== null) {
        framesTarget = Math.max(framesTarget, drawn + frames);
        framesGiveUpAt = Math.max(framesGiveUpAt, t + ms + OWED_FRAMES_MAX_MS);
      }
      evaluate();
    },
    check: evaluate,
    dispose: clearTimer,
  };
}
