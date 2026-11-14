/**
 * Chat delivery with chat_safety_enabled: a blocked player's messages skip the
 * sockets of whoever blocked them, every message carries an id a report can
 * name, and the server keeps its copy for reports. Off, chat goes to the whole
 * room as before.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const flags = vi.hoisted(() => ({ chatSafety: true }));
const blockersOfMock = vi.hoisted(() => vi.fn(async (_id: string): Promise<string[]> => []));
const rememberMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('../../config/featureFlags', () => ({
  featureFlags: { get chatSafetyEnabled() { return flags.chatSafety; } },
}));
vi.mock('../../modules/safety/chatSafety.service', () => ({
  blockersOf: blockersOfMock,
  rememberChatMessage: rememberMock,
}));

import { registerChatHandlers } from './chatHandler';

type Sent = { room: string; except: string[]; event: string; payload: Record<string, unknown> };

function harness(opts: { userId?: string; rooms?: string[]; spectating?: string } = {}) {
  const sent: Sent[] = [];
  const handlers = new Map<string, (raw: unknown) => void>();
  const operator = (room: string, except: string[] = []) => ({
    except: (rooms: string[] | string) => operator(room, [...except, ...(Array.isArray(rooms) ? rooms : [rooms])]),
    emit: (event: string, payload: Record<string, unknown>) => { sent.push({ room, except, event, payload }); },
  });
  const userId = opts.userId ?? 'sender';
  const socket = {
    id: 'sock-1',
    data: { username: 'Sender', spectating: opts.spectating },
    rooms: new Set(opts.rooms ?? ['g1']),
    on: (event: string, fn: (raw: unknown) => void) => { handlers.set(event, fn); },
  };
  const room = {
    connectedSockets: new Map([['sock-1', userId]]),
    state: { players: [{ player_id: userId, username: 'Sender', color: '#f00' }] },
  };
  registerChatHandlers({
    io: { to: (r: string) => operator(r) },
    socket,
    userId,
    username: 'Sender',
    getRoom: (id: string) => (id === 'g1' ? room : undefined),
  } as never);
  const say = async (event: string, message: string, gameId = 'g1') => {
    handlers.get(event)!({ gameId, message });
    // Let the per-sender queue run.
    await new Promise((r) => setTimeout(r, 0));
  };
  return { sent, say };
}

describe('chat delivery and blocks (chat_safety_enabled)', () => {
  beforeEach(() => {
    flags.chatSafety = true;
    blockersOfMock.mockReset().mockResolvedValue([]);
    rememberMock.mockReset();
  });

  it('leaves out everyone who blocked the sender, in game, lobby and spectator chat', async () => {
    blockersOfMock.mockResolvedValue(['alice', 'bob']);
    const { sent, say } = harness({ rooms: ['g1'], spectating: 'g1' });
    await say('game:chat', 'gg');
    await say('game:lobby_chat', 'ready?');
    await say('game:spectator_chat', 'nice move');
    expect(sent.map((s) => [s.event, s.room, s.except])).toEqual([
      ['game:chat_message', 'g1', ['user:alice', 'user:bob']],
      ['game:lobby_chat_message', 'g1', ['user:alice', 'user:bob']],
      ['game:spectator_chat_message', 'g1:spectators', ['user:alice', 'user:bob']],
    ]);
    expect(blockersOfMock).toHaveBeenCalledWith('sender');
    // A spectator's message now says who sent it, so it can be reported or blocked.
    expect(sent[2].payload.playerId).toBe('sender');
  });

  it('gives every message an id and keeps the server copy a report will quote', async () => {
    const { sent, say } = harness();
    await say('game:chat', 'hello');
    const { messageId } = sent[0].payload;
    expect(messageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(rememberMock).toHaveBeenCalledWith('g1', expect.objectContaining({
      id: messageId, channel: 'game', senderId: 'sender', username: 'Sender', message: 'hello',
    }));
  });

  it('keeps a player\'s messages in the order sent, even when a lookup is slow', async () => {
    let release: () => void = () => {};
    blockersOfMock.mockImplementationOnce(() => new Promise<string[]>((r) => { release = () => r([]); }));
    const { sent, say } = harness();
    const first = say('game:chat', 'one');
    await say('game:chat', 'two');
    expect(sent).toHaveLength(0);
    release();
    await first;
    await new Promise((r) => setTimeout(r, 0));
    expect(sent.map((s) => s.payload.message)).toEqual(['one', 'two']);
  });

  it('sends to everyone when the block lookup fails, rather than losing the message', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    blockersOfMock.mockRejectedValue(new Error('db down'));
    const { sent, say } = harness();
    await say('game:chat', 'still here');
    expect(sent).toHaveLength(1);
    expect(sent[0].except).toEqual([]);
    warn.mockRestore();
  });

  it('with the switch off, sends to the whole room at once and keeps nothing', async () => {
    flags.chatSafety = false;
    blockersOfMock.mockResolvedValue(['alice']);
    const { sent, say } = harness();
    await say('game:chat', 'hi');
    expect(sent).toHaveLength(1);
    expect(sent[0].except).toEqual([]);
    expect(blockersOfMock).not.toHaveBeenCalled();
    expect(rememberMock).not.toHaveBeenCalled();
  });
});
