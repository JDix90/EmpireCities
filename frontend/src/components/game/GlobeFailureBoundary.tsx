import React from 'react';
import { captureException } from '@sentry/react';
import { Map as MapIcon, RotateCcw } from 'lucide-react';

/**
 * Catches the globe failing to get a WebGL context, and only that.
 *
 * The page's WebGL probe (utils/webglSupport.ts) passed, but three.js could not
 * create its own context: "Error creating WebGL context." in Sentry, from an
 * iPhone. iOS refuses a new context when the page already holds too many or
 * the GPU is short of memory, which a player builds up moving between the
 * lobby and games. That error reached the map's panel boundary, whose "Try
 * again" and "Reload page" mostly meet the same refusal.
 *
 * Here the globe gets one more try a moment later, once the contexts it and
 * earlier globes gave back are freed (GlobeMap releases its context on
 * unmount). If that fails too, the map area says so and offers the 2D map,
 * which needs far less. Any other error goes on to the panel boundary above.
 */

/** three.js throws this when the browser hands it no context. */
export function isWebGLContextError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /creating WebGL context|WebGL context could not be created|WebGL is not supported/i.test(message);
}

/** How long before the one automatic retry. */
export const GLOBE_RETRY_DELAY_MS = 1500;

interface Props {
  children: React.ReactNode;
  width?: number;
  height?: number;
  /** Switches this view to the 2D map. Without it, only "Try again" is offered. */
  onUseFlatMap?: () => void;
}

interface State {
  error: Error | null;
  failures: number;
  /** Bumped to mount the globe afresh. */
  attempt: number;
}

export default class GlobeFailureBoundary extends React.Component<Props, State> {
  state: State = { error: null, failures: 0, attempt: 0 };
  private retryTimer: number | null = null;

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (!isWebGLContextError(error)) return;
    const failures = this.state.failures + 1;
    this.setState({ failures });
    if (failures === 1) {
      this.retryTimer = window.setTimeout(this.retry, GLOBE_RETRY_DELAY_MS);
      return;
    }
    // Shown the fallback: worth knowing how often, but it is handled.
    captureException(error, { level: 'warning', tags: { globe_fallback: 'webgl_context' } });
  }

  componentWillUnmount() {
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
  }

  private retry = () => {
    this.retryTimer = null;
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
  };

  render() {
    const { error, failures, attempt } = this.state;
    if (!error) return <React.Fragment key={attempt}>{this.props.children}</React.Fragment>;
    // Not ours: the panel boundary above shows its notice and reports it.
    if (!isWebGLContextError(error)) throw error;
    // Waiting for the automatic retry.
    if (failures < 2) return null;

    const { width, height, onUseFlatMap } = this.props;
    return (
      <div
        role="alert"
        data-testid="globe-unavailable"
        className="flex h-full w-full items-center justify-center rounded-lg border border-bf-border bg-bf-dark p-6 text-center"
        style={{ width, height }}
      >
        <div className="max-w-sm space-y-3">
          <p className="font-display text-bf-gold">The 3D globe couldn&apos;t start</p>
          <p className="text-sm text-bf-muted">
            This device has no graphics memory left for it right now. The 2D map needs much less, and the match carries on either way.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {onUseFlatMap && (
              <button
                type="button"
                onClick={onUseFlatMap}
                className="tap-min inline-flex items-center gap-1.5 rounded-lg border border-bf-gold/40 bg-bf-gold/10 px-3 py-1.5 text-sm font-medium text-bf-gold hover:bg-bf-gold/20"
              >
                <MapIcon className="w-4 h-4" aria-hidden="true" />
                <span>Use the 2D map</span>
              </button>
            )}
            <button
              type="button"
              onClick={this.retry}
              className="tap-min inline-flex items-center gap-1.5 rounded-lg border border-bf-border px-3 py-1.5 text-sm text-bf-muted hover:text-bf-text"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
              <span>Try again</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
