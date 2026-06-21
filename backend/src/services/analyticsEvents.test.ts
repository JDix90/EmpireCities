import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('../db/postgres', () => ({ query: (...a: unknown[]) => queryMock(...a) }));
vi.mock('../config/featureFlags', () => ({ featureFlags: { analyticsEventsEnabled: true } }));

import { recordServerEvent } from './analyticsEvents';
import { featureFlags } from '../config/featureFlags';

function setFlag(on: boolean): void {
  (featureFlags as unknown as { analyticsEventsEnabled: boolean }).analyticsEventsEnabled = on;
}

const flush = () => new Promise((r) => setImmediate(r));

describe('recordServerEvent', () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue([]);
    setFlag(true);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a no-op when analytics is disabled', () => {
    setFlag(false);
    recordServerEvent('guest_created', { username: 'x' }, 'u1');
    expect(console.log).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('persists event name, user_id, and JSON properties when enabled', () => {
    recordServerEvent('game_finished', { won: true, turn_count: 12 }, 'user-uuid');
    expect(console.log).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO analytics_events');
    expect(params[0]).toBe('game_finished');
    expect(params[1]).toBe('user-uuid');
    expect(JSON.parse(params[2] as string)).toEqual({ won: true, turn_count: 12 });
  });

  it('records null user_id when none is supplied (game-level events)', () => {
    recordServerEvent('game_started', { human_count: 1 });
    expect((queryMock.mock.calls[0] as [string, unknown[]])[1][1]).toBeNull();
  });

  it('never throws into the caller when the DB write fails (fire-and-forget)', async () => {
    queryMock.mockRejectedValueOnce(new Error('db down'));
    expect(() => recordServerEvent('user_login', {}, 'u2')).not.toThrow();
    await flush();
    expect(console.warn).toHaveBeenCalled();
  });
});
