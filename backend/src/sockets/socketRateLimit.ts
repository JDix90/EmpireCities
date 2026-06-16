import type { Socket } from 'socket.io';
import { rateLimit } from '../utils/socketLimiter';
import { GameErrorCode } from './socketErrors';

/**
 * Per-user, per-category rate limiting for inbound socket events.
 *
 * Socket.io has no built-in throttle, and our handlers each cost a Redis lock
 * and/or a Postgres query — and chat/lobby events *broadcast* to every other
 * socket in the room, so an unthrottled client can amplify traffic across the
 * whole game. We install a single `socket.use` middleware that classifies each
 * inbound packet and checks the shared Redis limiter before the handler runs.
 *
 * Events are grouped into buckets so a client cannot dodge a limit by rotating
 * between sibling events (e.g. spamming attack/draft/build in turn). Limits are
 * deliberately generous — well above what real play or a laggy retry loop
 * produces — so legitimate users never see them while scripted floods are cut
 * off cheaply.
 */

interface Bucket {
  /** Stable key segment so sibling events share one counter. */
  name: string;
  max: number;
  windowMs: number;
}

const CHAT: Bucket = { name: 'chat', max: 5, windowMs: 5_000 };
const GAMEPLAY: Bucket = { name: 'gameplay', max: 30, windowMs: 10_000 };
const SOCIAL: Bucket = { name: 'social', max: 15, windowMs: 10_000 };
const JOIN: Bucket = { name: 'join', max: 15, windowMs: 60_000 };
/** Safety net for any event not explicitly classified below. */
const DEFAULT: Bucket = { name: 'default', max: 60, windowMs: 10_000 };

const EVENT_BUCKETS: Record<string, Bucket> = {
  // Chat / emotes — these broadcast to the room, so amplification is the risk.
  'game:chat': CHAT,
  'game:lobby_chat': CHAT,
  'game:spectator_chat': CHAT,
  'game:spectator_emote': CHAT,

  // High-frequency turn actions.
  'game:draft': GAMEPLAY,
  'game:select_territory': GAMEPLAY,
  'game:attack': GAMEPLAY,
  'game:advance_phase': GAMEPLAY,
  'game:turn_ready': GAMEPLAY,
  'game:fortify': GAMEPLAY,
  'game:redeem_cards': GAMEPLAY,
  'game:build': GAMEPLAY,
  'game:naval_move': GAMEPLAY,
  'game:naval_attack': GAMEPLAY,
  'game:advance_era': GAMEPLAY,
  'game:research_tech': GAMEPLAY,
  'game:use_ability': GAMEPLAY,
  'game:influence': GAMEPLAY,
  'game:event_choice': GAMEPLAY,

  // Lobby / social / diplomacy — lower frequency, several broadcast.
  'game:lobby_propose': SOCIAL,
  'game:lobby_vote': SOCIAL,
  'game:propose_truce': SOCIAL,
  'game:truce_response': SOCIAL,
  'game:set_coaching': SOCIAL,
  'game:tutorial_apply_settings': SOCIAL,
  'game:resign': SOCIAL,
  'game:leave': SOCIAL,

  // Joins / matchmaking — each runs SQL or mutates a queue.
  'game:join': JOIN,
  'game:start': JOIN,
  'game:spectate_join': JOIN,
  'game:spectate_leave': JOIN,
  'matchmaking:join': JOIN,
  'matchmaking:leave': JOIN,
};

/** Emit a throttle notice at most this often, so blocked floods don't amplify. */
const NOTICE_COOLDOWN_MS = 2_000;

/**
 * Install the inbound rate-limit middleware on a freshly connected socket.
 * Must be called once per connection, keyed by the authenticated user id.
 */
export function registerSocketRateLimit(socket: Socket, userId: string): void {
  socket.use((packet, next) => {
    const event = Array.isArray(packet) ? (packet[0] as string | undefined) : undefined;
    if (!event) return next();

    const bucket = EVENT_BUCKETS[event] ?? DEFAULT;
    const key = `sock:${userId}:${bucket.name}`;

    void rateLimit(key, { max: bucket.max, windowMs: bucket.windowMs })
      .then((allowed) => {
        if (allowed) return next();

        // Drop the packet (handler never runs) and surface a coded notice no
        // more than once per cooldown so a flood can't loop us into amplifying.
        const now = Date.now();
        const lastNoticeAt = (socket.data?.rateLimitNoticeAt as number | undefined) ?? 0;
        if (now - lastNoticeAt >= NOTICE_COOLDOWN_MS) {
          socket.data.rateLimitNoticeAt = now;
          socket.emit('error', {
            code: GameErrorCode.RATE_LIMITED,
            message: 'You are sending actions too quickly. Please slow down.',
          });
        }
        // Intentionally do NOT call next(): the event is silently dropped.
      })
      .catch(() => {
        // rateLimit already falls open on Redis errors; this guards against any
        // unexpected rejection so a limiter fault never wedges the socket.
        next();
      });
  });
}
