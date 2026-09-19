/**
 * Which finished games move the win streak.
 *
 * The tutorial reaches `finalizeGame` like any other game, so before this it
 * incremented `users.win_streak` — and finishing it is a guaranteed win,
 * because the tutorial bot never attacks (`aiBot.ts`). That padded the
 * ten_streak / immortal_streak achievements and the win-gold multiplier, which
 * pays 2x at a streak of 10: replay the lesson ten times, then win one real
 * game at double gold.
 */
import { describe, it, expect, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { applyWinStreak } from './progressionService';

/** A pg client that records the statements it is given. */
function fakeClient(currentStreak: number) {
  const sql: string[] = [];
  const client = {
    query: vi.fn(async (text: string) => {
      sql.push(text);
      if (/^\s*SELECT/i.test(text)) return { rows: [{ win_streak: currentStreak }] };
      if (/win_streak = win_streak \+ 1/.test(text)) return { rows: [{ win_streak: currentStreak + 1 }] };
      return { rows: [] };
    }),
  } as unknown as PoolClient;
  return { client, sql, writes: () => sql.filter((s) => /^\s*UPDATE/i.test(s)) };
}

describe('applyWinStreak', () => {
  it('extends the streak on a win that counts', async () => {
    const { client, writes } = fakeClient(4);
    expect(await applyWinStreak(client, 'u1', { won: true, counts: true })).toBe(5);
    expect(writes()).toHaveLength(1);
  });

  it('breaks the streak on a loss that counts', async () => {
    const { client, writes } = fakeClient(4);
    expect(await applyWinStreak(client, 'u1', { won: false, counts: true })).toBe(0);
    expect(writes()[0]).toMatch(/win_streak = 0/);
  });

  it('leaves the streak untouched when the game does not count', async () => {
    const { client, writes } = fakeClient(4);
    // A finished tutorial: a guaranteed win that must not be banked.
    expect(await applyWinStreak(client, 'u1', { won: true, counts: false })).toBe(4);
    expect(writes()).toEqual([]);
  });

  it('does not wipe a real streak when an uncounted game is lost', async () => {
    const { client, writes } = fakeClient(7);
    // Abandoning the tutorial must not cost a streak earned in real games.
    expect(await applyWinStreak(client, 'u1', { won: false, counts: false })).toBe(7);
    expect(writes()).toEqual([]);
  });

  it('reads zero for a player who has never had a streak', async () => {
    const { client } = fakeClient(0);
    expect(await applyWinStreak(client, 'u1', { won: true, counts: false })).toBe(0);
  });
});
