/**
 * Decides how the client reacts to a mid-game GAME_NOT_FOUND error.
 *
 * Background: the server's room can transiently fail to load (backend restart,
 * Redis flush) while the game itself is safe in Postgres. The repair is to
 * re-emit `game:join`, which reloads and re-warms the room. Two traps make a
 * naive "two strikes and eject" dangerous:
 *   1. socket.io buffers actions emitted while disconnected and flushes them
 *      on reconnect — a single outage can produce several misses back to back,
 *      none of which mean the game is gone.
 *   2. Telling the user to "try again" invites a retry that lands before the
 *      rejoin repair has finished, manufacturing the second strike.
 *
 * So: the first miss triggers a silent rejoin (`resync`); further misses while
 * that repair is pending are ignored (`swallow`); only a miss after the repair
 * window — i.e. we already fixed the room once and it broke again, or the
 * rejoin itself failed — gives up (`eject`). A `GAME_DELETED` error (the games
 * row is gone) ejects immediately; no rejoin can repair that.
 */

export type GameNotFoundDecision = 'resync' | 'swallow' | 'eject';

/** How long after emitting game:join we attribute further misses to the same outage. */
export const RESYNC_GRACE_MS = 10_000;
/** A second outage this soon after a completed repair means the game is unrecoverable. */
export const REPEAT_WINDOW_MS = 30_000;

export class GameNotFoundTracker {
  private lastMissAt = 0;
  private resyncStartedAt = 0;

  /**
   * Classify one GAME_NOT_FOUND error. `fatal` marks errors that no rejoin
   * can repair (GAME_DELETED). Returns what the caller should do.
   */
  decide(now: number, opts: { fatal?: boolean } = {}): GameNotFoundDecision {
    if (opts.fatal) return 'eject';
    if (this.resyncStartedAt && now - this.resyncStartedAt < RESYNC_GRACE_MS) {
      return 'swallow';
    }
    if (this.lastMissAt && now - this.lastMissAt < REPEAT_WINDOW_MS) {
      return 'eject';
    }
    this.lastMissAt = now;
    this.resyncStartedAt = now;
    return 'resync';
  }

  /** The rejoin completed (game:joined arrived) — stop attributing misses to it. */
  onRejoined(): void {
    this.resyncStartedAt = 0;
  }

  /** Forget history (e.g. when navigating to a different game). */
  reset(): void {
    this.lastMissAt = 0;
    this.resyncStartedAt = 0;
  }
}
