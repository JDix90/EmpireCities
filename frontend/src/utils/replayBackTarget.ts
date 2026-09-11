/**
 * Where the replay's Back button goes, and what it says.
 *
 * Kept out of the JSX because the rule is not obvious and got a player stuck:
 * the game-over "Clip" CTA used to deep-link with `source=share` — the param
 * meant for a stranger arriving from a shared link — so Back fell through to
 * `history.back()` and returned the player who had just finished a match to
 * `/game/:id`, a game with no board left. The label and the destination have to
 * agree, and both have to be derived from the same facts.
 */

export interface ReplayBackContext {
  /** `?source=daily` — the daily challenge, which owns its own page. */
  fromDaily: boolean;
  /** `?source=match` — the player's own match, including the clip deep-link. */
  fromMatch: boolean;
  /** A public replay opened by someone who is not signed in. */
  loadedPublic: boolean;
  isAuthenticated: boolean;
  /**
   * Nothing in-app is behind this entry (React Router's 'default' key): a
   * pasted link, a fresh tab, a hard refresh. `history.back()` there either
   * does nothing or leaves the site.
   */
  isFirstAppEntry: boolean;
}

export interface ReplayBackTarget {
  label: string;
  /** A route to push, or 'back' to step through history. */
  to: string | 'back';
}

export function replayBackTarget(ctx: ReplayBackContext): ReplayBackTarget {
  if (ctx.fromDaily) return { label: 'Back to Daily', to: '/daily' };
  if (ctx.fromMatch) return { label: 'Back to Lobby', to: '/lobby' };
  // A signed-out viewer has no lobby to return to; the marketing home is the
  // only destination that means anything to them.
  if (!ctx.isAuthenticated && (ctx.loadedPublic || ctx.isFirstAppEntry)) {
    return { label: 'Home', to: '/' };
  }
  if (ctx.isFirstAppEntry) return { label: 'Back to Lobby', to: '/lobby' };
  return { label: 'Back', to: 'back' };
}
