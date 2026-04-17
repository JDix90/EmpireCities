import { z } from 'zod';
import type { SocketContext } from './types';

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

  socket.on('game:chat', (raw: unknown) => {
    const parsed = ChatPayload.safeParse(raw);
    if (!parsed.success) return;
    const { gameId, message } = parsed.data;

    const room = ctx.activeGames.get(gameId);
    if (!room) return;
    if (room.connectedSockets.get(socket.id) !== userId) return;

    const text = message.trim().slice(0, 500);
    if (!text) return;

    const gifMatch = text.match(/^\[gif:(https:\/\/media1?\.tenor\.com\/[^\]]+)\]$/);
    const clean = gifMatch
      ? text
      : text.slice(0, 200).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (!clean) return;

    const player = room.state.players.find((p) => p.player_id === userId);
    io.to(gameId).emit('game:chat_message', {
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

    const text = message.trim().slice(0, 200).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (!text) return;

    io.to(`${gameId}:spectators`).emit('game:spectator_chat_message', {
      gameId,
      username: socket.data?.username ?? ctx.username,
      message: text,
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

    const text = message.trim().slice(0, 500);
    if (!text) return;

    const gifMatch = text.match(/^\[gif:(https:\/\/media1?\.tenor\.com\/[^\]]+)\]$/);
    const clean = gifMatch
      ? text
      : text.slice(0, 200).replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (!clean) return;

    io.to(gameId).emit('game:lobby_chat_message', {
      gameId,
      playerId: userId,
      username: socket.data?.username ?? ctx.username,
      color: socket.data?.color ?? '#888',
      message: clean,
      timestamp: Date.now(),
    });
  });
}
