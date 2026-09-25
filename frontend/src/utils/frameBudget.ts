/**
 * The phone's frame budget (docs/MOBILE_UX_PLAN.md M-13).
 *
 * A turn-based board does not need 60 or 120 rendered frames a second, and on
 * a phone every one of them is heat: the GPU fills the screen, the compositor
 * re-blends every layer over it, and the main thread re-projects every globe
 * label. Neither renderer offers a frame-rate setting that covers everything
 * it drives: react-globe.gl runs its render loop, its HTML label layer, its
 * camera tweens and three-globe's ring and arc tickers each on
 * `requestAnimationFrame`, and PixiJS runs its app ticker plus the 2D map's
 * standalone effect tickers the same way. Capping one of them alone would
 * leave the others at full rate, or, worse, draw the globe's labels out of
 * step with its polygons.
 *
 * So the cap sits under all of them: while the game page is open on a phone,
 * `requestAnimationFrame` hands out at most `fps` frames a second. Every
 * callback due in a frame runs in one batch with the same timestamp, exactly
 * as the browser would run them, so everything that draws stays in step.
 * Between frames nothing wakes the main thread on every vsync: a timer sleeps
 * until just before the next frame is due, then asks the browser for it.
 * Anything time-based (tweens, OrbitControls auto-rotate, three-globe's
 * tickers, PixiJS's delta) keeps its speed; it simply takes fewer steps.
 */

/** Frames a second on phones. Half a 60 Hz display, a quarter of a 120 Hz one. */
export const PHONE_FRAME_CAP_FPS = 30;

/** A frame counts as due this much early, so vsync jitter never costs a whole frame. */
const DUE_TOLERANCE_MS = 4;
/** The sleep between frames ends this long before the frame is due, leaving time for one vsync. */
const WAKE_MARGIN_MS = 6;
/**
 * Ids handed out by caps start far above any the browser will reach, and the
 * counter is shared, so neither a native id nor another cap's id can collide
 * (two caps can overlap briefly while one releases and the next installs).
 */
const ID_BASE = 1_000_000_000;
let nextCapId = ID_BASE;

const CAP_MARK = Symbol.for('borderfall.frameCap');

export interface FrameCapNatives {
  requestAnimationFrame: (cb: FrameRequestCallback) => number;
  cancelAnimationFrame: (id: number) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface FrameCap {
  requestAnimationFrame: (cb: FrameRequestCallback) => number;
  cancelAnimationFrame: (id: number) => void;
  /** Stop capping: whatever is queued runs on the next native frame. */
  release: () => void;
  /** Callbacks waiting for a frame. */
  pending: () => number;
  /** Called once the cap is released and its queue has drained. */
  onDrained?: () => void;
}

/**
 * A frame scheduler that runs at most `fps` batches a second on top of the
 * native one. Pure apart from the natives it is given, so it can be tested
 * against a fake clock.
 */
export function createFrameCap(fps: number, natives: FrameCapNatives): FrameCap {
  const minInterval = 1000 / fps;
  const queue = new Map<number, FrameRequestCallback>();
  let lastFrameAt = -Infinity;
  let capped = true;
  let rafHandle: number | null = null;
  let timerHandle: unknown = null;

  const cap: FrameCap = {
    requestAnimationFrame(cb) {
      const id = nextCapId++;
      queue.set(id, cb);
      schedule();
      return id;
    },
    cancelAnimationFrame(id) {
      if (queue.delete(id)) {
        if (queue.size === 0) {
          unschedule();
          if (!capped) cap.onDrained?.();
        }
        return;
      }
      // Not one of ours: a native id from before the cap, or another cap's id
      // while one releases and the next installs. Whatever this cap wraps
      // knows what to do with it.
      natives.cancelAnimationFrame(id);
    },
    release() {
      capped = false;
      if (queue.size === 0) {
        unschedule();
        cap.onDrained?.();
        return;
      }
      // Anything still waiting runs at the very next frame.
      if (timerHandle !== null) {
        natives.clearTimeout(timerHandle);
        timerHandle = null;
        schedule();
      }
    },
    pending: () => queue.size,
  };

  function schedule() {
    if (rafHandle !== null || timerHandle !== null || queue.size === 0) return;
    rafHandle = natives.requestAnimationFrame(onFrame);
  }

  function unschedule() {
    if (rafHandle !== null) natives.cancelAnimationFrame(rafHandle);
    if (timerHandle !== null) natives.clearTimeout(timerHandle);
    rafHandle = null;
    timerHandle = null;
  }

  function onFrame(t: number) {
    rafHandle = null;
    if (queue.size === 0) return;
    const elapsed = t - lastFrameAt;
    if (capped && elapsed < minInterval - DUE_TOLERANCE_MS) {
      // Not due yet. Sleep until just before it is, instead of waking on
      // every vsync to find out.
      const wait = minInterval - elapsed - WAKE_MARGIN_MS;
      if (wait > 1) {
        timerHandle = natives.setTimeout(() => {
          timerHandle = null;
          schedule();
        }, wait);
      } else {
        schedule();
      }
      return;
    }
    lastFrameAt = t;
    // One batch per frame, like the browser: callbacks registered while it
    // runs wait for the next frame.
    const batch = Array.from(queue);
    queue.clear();
    let firstError: unknown = null;
    for (const [, cb] of batch) {
      try {
        cb(t);
      } catch (err) {
        if (firstError === null) firstError = err;
      }
    }
    if (queue.size > 0) schedule();
    else if (!capped) cap.onDrained?.();
    // A throwing callback must not starve the rest of its frame; report it
    // the way an uncaught rAF error is reported, after the batch.
    if (firstError !== null) natives.setTimeout(() => { throw firstError; }, 0);
  }

  return cap;
}

/**
 * Caps `requestAnimationFrame` on `win` until the returned function is
 * called. Installing twice is a no-op for the second caller. On release the
 * native `requestAnimationFrame` comes back at once; `cancelAnimationFrame`
 * keeps routing the cap's ids until everything it queued has run, so a
 * component that cancels its loop while unmounting never cancels the wrong
 * native frame.
 */
export function installFrameCap(fps: number, win: Window & typeof globalThis = window): () => void {
  if ((win.requestAnimationFrame as unknown as Record<symbol, unknown>)[CAP_MARK]) return () => {};
  const nativeRaf = win.requestAnimationFrame;
  const nativeCaf = win.cancelAnimationFrame;
  const cap = createFrameCap(fps, {
    requestAnimationFrame: (cb) => nativeRaf.call(win, cb),
    cancelAnimationFrame: (id) => nativeCaf.call(win, id),
    setTimeout: (fn, ms) => win.setTimeout(fn, ms),
    clearTimeout: (h) => win.clearTimeout(h as number),
  });
  const raf = (cb: FrameRequestCallback) => cap.requestAnimationFrame(cb);
  const caf = (id: number) => cap.cancelAnimationFrame(id);
  (raf as unknown as Record<symbol, unknown>)[CAP_MARK] = true;
  win.requestAnimationFrame = raf;
  win.cancelAnimationFrame = caf;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (win.requestAnimationFrame === raf) win.requestAnimationFrame = nativeRaf;
    cap.onDrained = () => {
      if (win.cancelAnimationFrame === caf) win.cancelAnimationFrame = nativeCaf;
    };
    cap.release();
  };
}

/**
 * OrbitControls damps per update, not per second: each update keeps
 * `1 - dampingFactor` of the remaining motion. At a lower frame rate the
 * same factor would let a fling coast for longer, so the factor is raised to
 * keep the per-second decay the library was tuned for at 60 Hz.
 */
export function dampingFactorForFrameRate(baseFactor: number, fps: number, tunedHz = 60): number {
  return 1 - Math.pow(1 - baseFactor, tunedHz / fps);
}

/** The attribute on `<html>` that phone-only frame-budget CSS keys off (index.css). */
export const FRAME_BUDGET_ATTR = 'data-frame-budget';

/**
 * Turns the phone frame budget on for the document: the frame cap, and the
 * attribute the stylesheet uses to drop backdrop blur and endless CSS loops.
 * Returns the function that turns it off.
 */
export function applyPhoneFrameBudget(win: Window & typeof globalThis = window): () => void {
  const root = win.document.documentElement;
  root.setAttribute(FRAME_BUDGET_ATTR, 'phone');
  const releaseCap = installFrameCap(PHONE_FRAME_CAP_FPS, win);
  return () => {
    releaseCap();
    if (root.getAttribute(FRAME_BUDGET_ATTR) === 'phone') root.removeAttribute(FRAME_BUDGET_ATTR);
  };
}
