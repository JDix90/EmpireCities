import React from 'react';
import { captureReactException } from '@sentry/react';
import { RotateCcw } from 'lucide-react';

/**
 * Keeps a crash in one part of the game screen inside that part.
 *
 * The app's only other boundary sits at its root with no fallback, so a render
 * crash anywhere in a match (a HUD button on a page the browser had translated,
 * once) replaced the whole game with "Something went wrong". Wrapped in this,
 * the panel that crashed is swapped for a small notice with "Try again", and
 * the map, the clock and the rest of the match carry on.
 *
 * - `panel` fills the space the panel had (the sidebar, the map, chat).
 * - `overlay` floats a small card over the board, for a modal or an overlay
 *   that has no space of its own; with `onClose` it also offers Close.
 * - `silent` shows nothing: for something the match does not need, like the
 *   AI turn recap, where any notice would be more in the way than the gap.
 *
 * `resetKey` gives the panel another try when it changes (the turn, the
 * territory selected, the next modal), so one bad state does not leave it
 * blank for the rest of the game. Each crash goes to Sentry as handled, tagged
 * with the panel's name.
 */
interface Props {
  /** Names the panel in Sentry (tag `game_panel`) and in the console. */
  name: string;
  children: React.ReactNode;
  variant?: 'panel' | 'overlay' | 'silent';
  /** Closes what crashed. Offered as a button by the overlay variant. */
  onClose?: () => void;
  /** When this changes after a crash, the panel renders again. */
  resetKey?: unknown;
}

interface State {
  error: Error | null;
}

export default class GamePanelBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[GamePanelBoundary] ${this.props.name} crashed:`, error, info.componentStack);
    captureReactException(error, info, {
      mechanism: { type: 'auto.function.react.error_boundary', handled: true },
      captureContext: { tags: { game_panel: this.props.name } },
    });
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && !Object.is(prev.resetKey, this.props.resetKey)) {
      this.setState({ error: null });
    }
  }

  private retry = () => this.setState({ error: null });

  private close = () => {
    this.setState({ error: null });
    this.props.onClose?.();
  };

  render() {
    if (!this.state.error) return this.props.children;
    const { variant = 'panel', onClose } = this.props;
    if (variant === 'silent') return null;

    const notice = (
      <>
        <p className="text-sm text-bf-text">This part of the game hit a problem.</p>
        <p className="text-xs text-bf-muted">The match is still running.</p>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          <button
            type="button"
            onClick={this.retry}
            className="tap-min inline-flex items-center gap-1.5 rounded-lg border border-bf-gold/40 bg-bf-gold/10 px-3 py-1.5 text-xs font-medium text-bf-gold hover:bg-bf-gold/20"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Try again</span>
          </button>
          {variant === 'overlay' && onClose ? (
            <button
              type="button"
              onClick={this.close}
              className="tap-min inline-flex items-center rounded-lg border border-bf-border px-3 py-1.5 text-xs text-bf-muted hover:text-bf-text"
            >
              <span>Close</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="tap-min inline-flex items-center rounded-lg border border-bf-border px-3 py-1.5 text-xs text-bf-muted hover:text-bf-text"
            >
              <span>Reload page</span>
            </button>
          )}
        </div>
      </>
    );

    if (variant === 'overlay') {
      return (
        <div
          role="alert"
          data-testid={`game-panel-error-${this.props.name}`}
          className="fixed bottom-24 left-1/2 z-[60] w-[min(20rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-bf-border bg-bf-surface/95 p-4 text-center shadow-xl backdrop-blur-sm space-y-1"
        >
          {notice}
        </div>
      );
    }
    return (
      <div
        role="alert"
        data-testid={`game-panel-error-${this.props.name}`}
        className="flex h-full min-h-[8rem] w-full flex-col items-center justify-center gap-1 p-4 text-center"
      >
        {notice}
      </div>
    );
  }
}
