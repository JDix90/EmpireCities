/**
 * Unit tests for notifyTurnChange (no DB, no FCM, no SMTP): the in-app socket
 * alert, its position relative to the push/email throttle, and the seat
 * checks. The db layer is mocked; FCM and email are unconfigured in tests, so
 * their internals no-op after the preference reads — we assert on the QUERIES
 * made and on what was emitted.
 *
 * Reported from testing: players in an async game were "not notified in any
 * way" when their turn came. The push and email channels here were dead for
 * infrastructure reasons, and there was no in-app channel at all — the lobby's
 * "Your turn!" badge loaded once and never refreshed. The socket emit is the
 * channel that needs no external service, so it must fire on every turn change
 * regardless of the throttle that protects the outbound ones.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GameState } from '../types';

const queryMock = vi.fn();
const queryOneMock = vi.fn();

vi.mock('../db/postgres', () => ({
  query: (...args: unknown[]) => queryMock(...args),
  queryOne: (...args: unknown[]) => queryOneMock(...args),
}));

function state(over: Partial<GameState> = {}): GameState {
  return {
    players: [
      { player_id: 'u1', is_ai: false, username: 'human' },
      { player_id: 'ai_1', is_ai: true, username: 'bot' },
    ],
    era: 'ancient',
    turn_number: 4,
    phase_deadline_at: 1_700_000_000_000,
    settings: { async_mode: true, async_turn_deadline_seconds: 86_400 },
    ...over,
  } as unknown as GameState;
}

function fakeIo() {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  return { io: { to }, to, emit };
}

async function load() {
  const mod = await import('./notificationService');
  return mod.notifyTurnChange;
}

describe('notifyTurnChange — in-app alert', () => {
  beforeEach(() => {
    queryMock.mockReset().mockResolvedValue([]);
    queryOneMock.mockReset().mockResolvedValue(null);
  });

  it("emits lobby:your_turn to the player's own room with what the toast needs", async () => {
    const { io, to, emit } = fakeIo();
    const notifyTurnChange = await load();
    await notifyTurnChange('g1', 'u1', state(), io);

    expect(to).toHaveBeenCalledWith('user:u1');
    expect(emit).toHaveBeenCalledWith('lobby:your_turn', {
      game_id: 'g1',
      era_id: 'ancient',
      turn_number: 4,
      deadline_at: 1_700_000_000_000,
    });
  });

  it('emits even when push/email are throttled — a rejoin must still refresh the lobby', async () => {
    // A notification went out seconds ago: the outbound channels are throttled.
    queryOneMock.mockResolvedValueOnce({ sent_at: new Date() });
    const { io, emit } = fakeIo();
    const notifyTurnChange = await load();
    await notifyTurnChange('g1', 'u1', state(), io);

    expect(emit).toHaveBeenCalledWith('lobby:your_turn', expect.objectContaining({ game_id: 'g1' }));
    // …and the throttle held: no preferences read, nothing logged.
    expect(queryOneMock).not.toHaveBeenCalledWith(expect.stringContaining('user_preferences'), expect.anything());
    expect(queryMock).not.toHaveBeenCalledWith(expect.stringContaining('async_notifications'), expect.anything());
  });

  it('sends nothing for an AI seat', async () => {
    const { io, emit } = fakeIo();
    const notifyTurnChange = await load();
    await notifyTurnChange('g1', 'ai_1', state(), io);
    expect(emit).not.toHaveBeenCalled();
    expect(queryOneMock).not.toHaveBeenCalled();
  });

  it('works without an emitter — the outbound channels do not depend on the socket', async () => {
    queryOneMock
      .mockResolvedValueOnce(null) // throttle: nothing recent
      .mockResolvedValueOnce({ push_enabled: true, turn_emails_enabled: false });
    const notifyTurnChange = await load();
    await expect(notifyTurnChange('g1', 'u1', state())).resolves.toBeUndefined();
    // Reached the outbound stage and logged the attempt.
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining('async_notifications'),
      expect.arrayContaining(['g1', 'u1']),
    );
  });

  it('never lets a broken emitter take the outbound channels down with it', async () => {
    const io = { to: () => ({ emit: () => { throw new Error('socket gone'); } }) };
    queryOneMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ push_enabled: true, turn_emails_enabled: false });
    const notifyTurnChange = await load();
    await expect(notifyTurnChange('g1', 'u1', state(), io)).resolves.toBeUndefined();
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('async_notifications'), expect.anything());
  });

  it('sends a deadline of null for an untimed seat rather than a stale number', async () => {
    const { io, emit } = fakeIo();
    const notifyTurnChange = await load();
    await notifyTurnChange('g1', 'u1', state({ phase_deadline_at: undefined } as never), io);
    expect(emit).toHaveBeenCalledWith('lobby:your_turn', expect.objectContaining({ deadline_at: null }));
  });
});

describe('notifyTurnChange — the email gate', () => {
  beforeEach(() => {
    queryMock.mockReset().mockResolvedValue([]);
    queryOneMock.mockReset().mockResolvedValue(null);
  });

  /** The channel string the throttle row records — what was actually attempted. */
  function loggedChannel(): string | undefined {
    const call = queryMock.mock.calls.find(([sql]) => String(sql).includes('async_notifications'));
    return call ? (call[1] as unknown[])[2] as string : undefined;
  }

  it('emails a registered player who has turn emails on', async () => {
    queryOneMock
      .mockResolvedValueOnce(null) // throttle
      .mockResolvedValueOnce({ push_enabled: true, turn_emails_enabled: true })
      .mockResolvedValueOnce({ email: 'a@b.c', is_guest: false });
    const notifyTurnChange = await load();
    await notifyTurnChange('g1', 'u1', state());
    expect(loggedChannel()).toBe('push,email');
  });

  it('defaults turn emails ON when there is no preferences row — it is transactional', async () => {
    queryOneMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null) // no user_preferences row at all
      .mockResolvedValueOnce({ email: 'a@b.c', is_guest: false });
    const notifyTurnChange = await load();
    await notifyTurnChange('g1', 'u1', state());
    expect(loggedChannel()).toBe('push,email');
  });

  it('does not consult the marketing opt-in: turn emails off means off, whatever the signup box said', async () => {
    queryOneMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ push_enabled: true, turn_emails_enabled: false, email_notifications: true });
    const notifyTurnChange = await load();
    await notifyTurnChange('g1', 'u1', state());
    // Never even looked the address up.
    expect(queryOneMock).not.toHaveBeenCalledWith(expect.stringContaining('FROM users'), expect.anything());
    expect(loggedChannel()).toBe('push');
  });

  it('never emails a guest — the address is the synthetic <uuid>@guest.local', async () => {
    queryOneMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null) // guests have no preferences row: default-on is exactly the trap
      .mockResolvedValueOnce({ email: 'deadbeef@guest.local', is_guest: true });
    const notifyTurnChange = await load();
    await notifyTurnChange('g1', 'u1', state());
    expect(loggedChannel()).toBe('push');
  });

  it("records 'none' when the player has turned both outbound channels off", async () => {
    queryOneMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ push_enabled: false, turn_emails_enabled: false });
    const notifyTurnChange = await load();
    await notifyTurnChange('g1', 'u1', state());
    expect(loggedChannel()).toBe('none');
  });
});
