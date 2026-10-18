/**
 * Frame tickers that nobody listens to stop asking for frames.
 *
 * three-globe's arcs and paths layers each start a `frame-ticker` in their
 * constructor (`stateInit`), and a FrameTicker starts looping the moment it is
 * built. three-globe and globe.gl also build a throwaway instance of their
 * components when their module loads, only to read the props they expose
 * (`linkKapsule`, `fromKapsule`). Those instances are never mounted, so their
 * tickers never get a listener, never hear the globe's `pauseAnimation`, and
 * are never disposed: from the moment the globe code loads, several tickers
 * ask for an animation frame every frame for as long as the tab is open, on
 * every page. Under the phone frame budget that kept a 30-a-second frame and timer
 * loop running on an idle board; on a desktop it ran at the display's rate.
 *
 * The fix is on the shared FrameTicker prototype (the frontend depends on the
 * same `frame-ticker` copy three-globe imports): a ticker that reaches a frame
 * with no listener on either tick signal pauses there instead of asking for
 * the next one. Construction is untouched, so a mounted layer, which attaches
 * its listener in the same task it is built, runs exactly as before, and the
 * globe's own tickers are paused and resumed by `pauseAnimation` and
 * `resumeAnimation` as they always were. A throwaway instance asks for one
 * frame and stops. In the rare case a frame lands between a layer being built
 * and mounted, that ticker starts again on the globe's next
 * `resumeAnimation`, which every wake from idle calls.
 */
import FrameTickerModule from 'frame-ticker';

interface TickSignal {
  readonly numItems: number;
}

/** The parts of a FrameTicker this patch reads; the rest of its prototype is private. */
interface FrameTickerLike {
  readonly onTick: TickSignal;
  readonly onTickOncePerFrame: TickSignal;
  pause(): void;
}

interface FrameTickerPrototype {
  onFrame(this: FrameTickerLike): void;
}

const PATCHED = Symbol.for('borderfall.idleFrameTickers');

/** The FrameTicker class whether the bundler hands over the CommonJS module or its default export. */
function frameTickerClass(mod: unknown): { prototype: FrameTickerPrototype } | null {
  const candidate = (mod as { default?: unknown })?.default ?? mod;
  return typeof candidate === 'function' ? (candidate as { prototype: FrameTickerPrototype }) : null;
}

/**
 * Patch a FrameTicker class so a ticker pauses on any frame nobody listens to.
 * Safe to call more than once. Returns false when the class is not there.
 */
export function pauseUnheardFrameTickers(Ticker: unknown = FrameTickerModule): boolean {
  const cls = frameTickerClass(Ticker);
  if (!cls) return false;
  const proto = cls.prototype as FrameTickerPrototype & { [PATCHED]?: true };
  if (proto[PATCHED]) return true;
  const onFrame = proto.onFrame;
  if (typeof onFrame !== 'function') return false;
  proto.onFrame = function onFrameIfHeard(this: FrameTickerLike) {
    if (this.onTick.numItems === 0 && this.onTickOncePerFrame.numItems === 0) {
      this.pause();
      return;
    }
    onFrame.call(this);
  };
  proto[PATCHED] = true;
  return true;
}

pauseUnheardFrameTickers();
