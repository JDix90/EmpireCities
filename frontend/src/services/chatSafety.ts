/**
 * Chat safety (`chat_safety_enabled`): block a player, so their chat no longer
 * reaches you, and report a chat message to the moderators. Backend:
 * modules/safety (POST /api/safety/blocks, /api/safety/reports).
 */
import { api } from './api';

export type ChatChannel = 'game' | 'lobby' | 'spectator';

export type ChatReportReason = 'harassment' | 'hate' | 'sexual' | 'spam' | 'name' | 'other';

export const CHAT_REPORT_REASONS: Array<{ id: ChatReportReason; label: string }> = [
  { id: 'harassment', label: 'Harassment or bullying' },
  { id: 'hate', label: 'Hate speech' },
  { id: 'sexual', label: 'Sexual content' },
  { id: 'spam', label: 'Spam or advertising' },
  { id: 'name', label: 'Offensive name' },
  { id: 'other', label: 'Something else' },
];

export interface BlockedPlayer {
  user_id: string;
  username: string;
  blocked_at: string;
}

export interface ChatMessageToReport {
  gameId: string;
  channel: ChatChannel;
  messageId?: string;
  playerId: string;
  username: string;
  message: string;
}

export async function blockPlayer(userId: string): Promise<void> {
  await api.post('/safety/blocks', { user_id: userId });
}

export async function unblockPlayer(userId: string): Promise<void> {
  await api.delete(`/safety/blocks/${encodeURIComponent(userId)}`);
}

export async function listBlockedPlayers(): Promise<BlockedPlayer[]> {
  const res = await api.get<{ blocks: BlockedPlayer[] }>('/safety/blocks');
  return res.data?.blocks ?? [];
}

export async function reportChatMessage(
  target: ChatMessageToReport,
  reason: ChatReportReason,
  details: string,
): Promise<void> {
  await api.post('/safety/reports', {
    game_id: target.gameId,
    channel: target.channel,
    ...(target.messageId ? { message_id: target.messageId } : {}),
    reported_user_id: target.playerId,
    reason,
    ...(details.trim() ? { details: details.trim().slice(0, 500) } : {}),
    // Used only if the server no longer holds its own copy of the message.
    message: target.message.slice(0, 600),
  });
}
