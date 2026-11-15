/**
 * Chat safety (`chat_safety_enabled`): blocks and reports.
 *
 * A block hides the blocked player's chat from the blocker: the chat handler
 * asks `blockersOf(sender)` for each message and leaves those players' sockets
 * out (sockets/handlers/chatHandler.ts). A report files a chat message to
 * Admin → Reports. Chat is not stored, so the handler keeps the last messages
 * of each game in Redis for a few hours (`rememberChatMessage`); a report that
 * names one of them is filed with the server's copy (`message_verified`), not
 * whatever the reporter's client sent.
 */
import { query, queryOne } from '../../db/postgres';
import { redis } from '../../db/redis';

export const CHAT_CHANNELS = ['game', 'lobby', 'spectator'] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];

export const CHAT_REPORT_REASONS = ['harassment', 'hate', 'sexual', 'spam', 'name', 'other'] as const;
export type ChatReportReason = (typeof CHAT_REPORT_REASONS)[number];

export const CHAT_REPORT_STATUSES = ['open', 'actioned', 'dismissed'] as const;
export type ChatReportStatus = (typeof CHAT_REPORT_STATUSES)[number];

export const REPORT_DETAILS_MAX = 500;
export const REPORT_MESSAGE_MAX = 600;

// ── Recent chat, for checking reports ───────────────────────────────────────

/** What the server sent, as a report will quote it. */
export interface RememberedChatMessage {
  id: string;
  channel: ChatChannel;
  senderId: string;
  username: string;
  message: string;
  at: number;
}

/** Messages kept per game, and for how long after the last one. */
export const RECENT_CHAT_KEEP = 200;
export const RECENT_CHAT_TTL_SECONDS = 6 * 60 * 60;

const recentKey = (gameId: string) => `chat:recent:${gameId}`;

/** Keep a sent message so a report can quote the server's copy. Never throws: chat must not wait on it. */
export async function rememberChatMessage(gameId: string, msg: RememberedChatMessage): Promise<void> {
  try {
    const key = recentKey(gameId);
    await redis.multi()
      .lpush(key, JSON.stringify(msg))
      .ltrim(key, 0, RECENT_CHAT_KEEP - 1)
      .expire(key, RECENT_CHAT_TTL_SECONDS)
      .exec();
  } catch (err) {
    console.warn('[chat-safety] could not keep a chat message for reports:', (err as Error).message);
  }
}

/** The server's copy of a message, while it is still kept. */
export async function findChatMessage(gameId: string, messageId: string): Promise<RememberedChatMessage | null> {
  try {
    const rows = await redis.lrange(recentKey(gameId), 0, RECENT_CHAT_KEEP - 1);
    for (const raw of rows) {
      const msg = JSON.parse(raw) as RememberedChatMessage;
      if (msg.id === messageId) return msg;
    }
  } catch (err) {
    console.warn('[chat-safety] could not read kept chat:', (err as Error).message);
  }
  return null;
}

// ── Blocks ──────────────────────────────────────────────────────────────────

export interface BlockedPlayer {
  user_id: string;
  username: string;
  blocked_at: string;
}

/** The players someone has blocked, most recent first. */
export async function listBlocks(blockerId: string): Promise<BlockedPlayer[]> {
  return query<BlockedPlayer>(
    `SELECT b.blocked_id AS user_id, u.username, b.created_at AS blocked_at
     FROM user_blocks b
     JOIN users u ON u.user_id = b.blocked_id
     WHERE b.blocker_id = $1
     ORDER BY b.created_at DESC`,
    [blockerId],
  );
}

/** 'blocked' (or already was), or 'no_such_player'. */
export async function blockPlayer(blockerId: string, blockedId: string): Promise<'blocked' | 'no_such_player'> {
  const target = await queryOne<{ user_id: string }>('SELECT user_id FROM users WHERE user_id = $1', [blockedId]);
  if (!target) return 'no_such_player';
  await query(
    `INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1, $2)
     ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
    [blockerId, blockedId],
  );
  return 'blocked';
}

export async function unblockPlayer(blockerId: string, blockedId: string): Promise<void> {
  await query('DELETE FROM user_blocks WHERE blocker_id = $1 AND blocked_id = $2', [blockerId, blockedId]);
}

/** Everyone who has blocked this player: their sockets do not get this player's chat. */
export async function blockersOf(userId: string): Promise<string[]> {
  const rows = await query<{ blocker_id: string }>(
    'SELECT blocker_id FROM user_blocks WHERE blocked_id = $1',
    [userId],
  );
  return rows.map((r) => r.blocker_id);
}

// ── Reports ─────────────────────────────────────────────────────────────────

export interface NewChatReport {
  reporterId: string;
  reportedId: string;
  reportedUsername: string;
  gameId: string | null;
  channel: ChatChannel;
  messageId: string | null;
  message: string | null;
  messageVerified: boolean;
  reason: ChatReportReason;
  details: string | null;
}

/** File a report. A second report of the same message by the same player files nothing new. */
export async function recordChatReport(r: NewChatReport): Promise<void> {
  await query(
    `INSERT INTO chat_reports
       (reporter_id, reported_id, reported_username, game_id, channel, message_id, message, message_verified, reason, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (reporter_id, message_id) WHERE message_id IS NOT NULL DO NOTHING`,
    [
      r.reporterId, r.reportedId, r.reportedUsername.slice(0, 64), r.gameId, r.channel, r.messageId,
      r.message ? r.message.slice(0, REPORT_MESSAGE_MAX) : null, r.messageVerified, r.reason, r.details,
    ],
  );
}

export interface ChatReportRow {
  report_id: string;
  created_at: string;
  status: ChatReportStatus;
  reason: ChatReportReason;
  details: string | null;
  channel: ChatChannel;
  game_id: string | null;
  message: string | null;
  message_verified: boolean;
  reported_id: string | null;
  reported_username: string;
  reported_is_banned: boolean | null;
  /** Open reports against the same player, this one included. */
  reported_open_reports: number;
  reporter_id: string | null;
  reporter_username: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  resolved_by_username: string | null;
}

export interface ChatReportList {
  open: number;
  items: ChatReportRow[];
}

/** How many reports wait on an admin: the badge on Admin in the top bar. */
export async function countOpenChatReports(): Promise<number> {
  const [row] = await query<{ open: number }>(`SELECT COUNT(*)::int AS open FROM chat_reports WHERE status = 'open'`);
  return row?.open ?? 0;
}

/** Admin → Reports: the open count, and reports of one status (or all), newest first. */
export async function loadChatReports(status: ChatReportStatus | 'all', limit = 100): Promise<ChatReportList> {
  const [counts] = await query<{ open: number }>(
    `SELECT COUNT(*) FILTER (WHERE status = 'open')::int AS open FROM chat_reports`,
  );
  const items = await query<ChatReportRow>(
    `SELECT r.report_id, r.created_at, r.status, r.reason, r.details, r.channel, r.game_id,
            r.message, r.message_verified, r.reported_id, r.reported_username,
            reported.is_banned AS reported_is_banned,
            (SELECT COUNT(*)::int FROM chat_reports o
              WHERE o.reported_id = r.reported_id AND o.status = 'open') AS reported_open_reports,
            r.reporter_id, reporter.username AS reporter_username,
            r.resolution_note, r.resolved_at, resolver.username AS resolved_by_username
     FROM chat_reports r
     LEFT JOIN users reported ON reported.user_id = r.reported_id
     LEFT JOIN users reporter ON reporter.user_id = r.reporter_id
     LEFT JOIN users resolver ON resolver.user_id = r.resolved_by
     WHERE ($1::text = 'all' OR r.status = $1::text)
     ORDER BY r.created_at DESC
     LIMIT $2`,
    [status, Math.max(1, Math.min(limit, 500))],
  );
  return { open: counts?.open ?? 0, items };
}

/** Close (or reopen) a report. False when there is no such report. */
export async function setChatReportStatus(
  reportId: string,
  status: ChatReportStatus,
  note: string | null,
  adminId: string,
): Promise<boolean> {
  const rows = await query<{ report_id: string }>(
    `UPDATE chat_reports
     SET status = $2::text,
         resolution_note = $3,
         resolved_by = CASE WHEN $2::text = 'open' THEN NULL ELSE $4::uuid END,
         resolved_at = CASE WHEN $2::text = 'open' THEN NULL ELSE NOW() END
     WHERE report_id = $1
     RETURNING report_id`,
    [reportId, status, note, adminId],
  );
  return rows.length > 0;
}
