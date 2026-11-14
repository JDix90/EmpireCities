import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { SocketContext } from './types';
import { maskMessage } from '../../utils/profanity';
import { featureFlags } from '../../config/featureFlags';
import { blockersOf, rememberChatMessage, type ChatChannel } from '../../modules/safety/chatSafety.service';

const SPECTATOR_CHAT_COOLDOWN_MS = 2_000;

const ChatPayload = z.object({
  gameId: z.string().min(1),
  message: z.string().min(1).max(500),
});

const EmotePayload = z.object({
  gameId: z.string().min(1),
  emote: z.string().min(1).max(4),
});

/**
 * Register all chat-related socket handlers: game:chat, game:spectator_chat,
 * game:spectator_emote, and game:lobby_chat.
 */
export function registerChatHandlers(ctx: SocketContext): void {
  const { io, socket, userId } = ctx;

  /**
   * Send a chat message to a room. Every message carries a `messageId`, which
   * is what a report names. With chat_safety_enabled the server keeps a copy
   * for reports (modules/safety) and leaves out the sockets of everyone who
   * has blocked the sender: each socket joins `user:<id>` on connect. A
   * failed block lookup sends to everyone rather than losing the message.
   * This player's messages go out one after another, in the order sent.
   */
  let sending: Promise<void> = Promise.resolve();
  const deliver = (
    gameId: string,
    roomName: string,
    event: string,
    channel: ChatChannel,
    payload: { message: string; username: string } & Record<string, unknown>,
  ): void => {
    const messageId = randomUUID();
    const full = { ...payload, messageId };
    if (!featureFlags.chatSafetyEnabled) {
      io.to(roomName).emit(event, full);
      return;
    }
    void rememberChatMessage(gameId, {
      id: messageId, channel, senderId: userId, username: payload.username, message: payload.message, at: Date.now(),
    });
    sending = sending.then(async () => {
      let blockers: string[] = [];
      try {
        blockers = await blockersOf(userId);
      } catch (err) {
        console.warn('[chat] block lookup failed; sending to everyone:', (err as Error).message);
      }
      const target = blockers.length ? io.to(roomName).except(blockers.map((id) => `user:${id}`)) : io.to(roomName);
      target.emit(event, full);
    }).catch(() => {});
  };

  // Note on chat sanitisation:
  // Chat messages are rendered as TEXT by the React client (no
  // dangerouslySetInnerHTML), which already escapes HTML entities for us. We
  // intentionally do NOT pre-escape `<` / `>` server-side any more — that
  // double-escaped real text (`<3`, `<rant>`, etc.) into `&lt;3`. The
  // server-side discipline is: length, the GIF embed pattern, and a basic
  // profanity mask (maskMessage) on non-GIF text for launch brand safety.
  socket.on('game:chat', (raw: unknown) => {
    const parsed = ChatPayload.safeParse(raw);
    if (!parsed.success) return;
    const { gameId, message } = parsed.data;

    const room = ctx.getRoom(gameId);
    if (!room) return;
    if (room.connectedSockets.get(socket.id) !== userId) return;

    const text = message.trim().slice(0, 500);
    if (!text) return;

    const gifMatch = text.match(/^\[gif:(https:\/\/media1?\.tenor\.com\/[^\]]+)\]$/);
    const clean = gifMatch ? text : maskMessage(text.slice(0, 200));
    if (!clean) return;

    const player = room.state.players.find((p) => p.player_id === userId);
    deliver(gameId, gameId, 'game:chat_message', 'game', {
      gameId,
      playerId: userId,
      username: player?.username ?? 'Unknown',
      color: player?.color ?? '#888',
      message: clean,
      timestamp: Date.now(),
    });
  });

  socket.on('game:spectator_chat', (raw: unknown) => {
    const parsed = ChatPayload.safeParse(raw);
    if (!parsed.success) return;
    const { gameId, message } = parsed.data;

    const spectatingGameId = socket.data?.spectating as string | undefined;
    if (spectatingGameId !== gameId) return;

    const now = Date.now();
    const lastMessageAt = (socket.data?.spectatorChatLastAt as number | undefined) ?? 0;
    if (now - lastMessageAt < SPECTATOR_CHAT_COOLDOWN_MS) return;
    socket.data.spectatorChatLastAt = now;

    const text = message.trim().slice(0, 200);
    if (!text) return;

    deliver(gameId, `${gameId}:spectators`, 'game:spectator_chat_message', 'spectator', {
      gameId,
      // Who sent it, so a spectator can report or block them.
      playerId: userId,
      username: socket.data?.username ?? ctx.username,
      message: maskMessage(text),
      timestamp: now,
    });
  });

  socket.on('game:spectator_emote', (raw: unknown) => {
    const parsed = EmotePayload.safeParse(raw);
    if (!parsed.success) return;
    const { gameId, emote } = parsed.data;

    const spectatingGameId = socket.data?.spectating as string | undefined;
    if (spectatingGameId !== gameId) return;

    io.to(`${gameId}:spectators`).emit('game:spectator_emote', {
      gameId,
      emote,
      username: socket.data?.username ?? ctx.username,
      timestamp: Date.now(),
    });
  });

  socket.on('game:lobby_chat', (raw: unknown) => {
    const parsed = ChatPayload.safeParse(raw);
    if (!parsed.success) return;
    const { gameId, message } = parsed.data;

    // Membership check: the only path that adds a socket to the `gameId`
    // Socket.io room is the `game:join` handler, which verifies the user
    // exists in `game_players`. Without this guard, any authenticated user
    // (including guests) could broadcast to any lobby just by knowing its id.
    if (!socket.rooms.has(gameId)) return;

    const text = message.trim().slice(0, 500);
    if (!text) return;

    const gifMatch = text.match(/^\[gif:(https:\/\/media1?\.tenor\.com\/[^\]]+)\]$/);
    const clean = gifMatch ? text : maskMessage(text.slice(0, 200));
    if (!clean) return;

    deliver(gameId, gameId, 'game:lobby_chat_message', 'lobby', {
      gameId,
      playerId: userId,
      username: socket.data?.username ?? ctx.username,
      color: socket.data?.color ?? '#888',
      message: clean,
      timestamp: Date.now(),
    });
  });
}
