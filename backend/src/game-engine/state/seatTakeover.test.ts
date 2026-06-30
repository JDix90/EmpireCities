import { describe, it, expect } from 'vitest';
import type { PlayerState } from '../../types';
import {
  AWAY_AI_GRACE_MS,
  markPlayerAway,
  canReclaimSeat,
  applySeatReclaim,
  awayAiShouldPlay,
} from './seatTakeover';

function human(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    player_id: 'u1',
    player_index: 0,
    username: 'Alice',
    color: '#f00',
    is_ai: false,
    is_eliminated: false,
    territory_count: 5,
    cards: [],
    mmr: 1000,
    ...overrides,
  } as PlayerState;
}

describe('away seat transitions', () => {
  it('markPlayerAway flags a disconnected human without converting to AI', () => {
    const p = human();
    expect(markPlayerAway(p, 1000)).toBe(true);
    expect(p.is_away).toBe(true);
    expect(p.away_since).toBe(1000);
    expect(p.is_ai).toBe(false); // never converted — still a human
  });

  it('markPlayerAway is a no-op for AI, eliminated, or already-away seats', () => {
    const ai = human({ is_ai: true });
    expect(markPlayerAway(ai, 1)).toBe(false);
    const dead = human({ is_eliminated: true });
    expect(markPlayerAway(dead, 1)).toBe(false);
    const already = human({ is_away: true, away_since: 5 });
    expect(markPlayerAway(already, 99)).toBe(false);
    expect(already.away_since).toBe(5); // unchanged
  });

  it('round-trips: an away human reclaims their seat on return', () => {
    const p = human();
    markPlayerAway(p, 1000);
    expect(canReclaimSeat(p)).toBe(true);
    expect(applySeatReclaim(p)).toBe(true);
    expect(p.is_away).toBe(false);
    expect(p.away_since).toBeNull();
    expect(canReclaimSeat(p)).toBe(false);
    expect(applySeatReclaim(p)).toBe(false); // idempotent
  });

  it('never reclaims an original AI seat (not away)', () => {
    const ai = human({ is_ai: true, ai_difficulty: 'expert' });
    expect(canReclaimSeat(ai)).toBe(false);
    expect(applySeatReclaim(ai)).toBe(false);
    expect(ai.is_ai).toBe(true);
  });

  describe('awayAiShouldPlay', () => {
    it('waits out the reconnect window, then lets the AI play', () => {
      const p = human();
      markPlayerAway(p, 1000);
      const during = awayAiShouldPlay(p, 1000 + AWAY_AI_GRACE_MS - 1);
      expect(during.play).toBe(false);
      expect(during.remainingMs).toBe(1);
      const after = awayAiShouldPlay(p, 1000 + AWAY_AI_GRACE_MS);
      expect(after.play).toBe(true);
      expect(after.remainingMs).toBe(0);
    });

    it('returns false for a present (not-away) seat', () => {
      expect(awayAiShouldPlay(human(), 999999).play).toBe(false);
    });

    it('treats a missing away_since as "now" (full window remaining)', () => {
      const p = human({ is_away: true, away_since: null });
      const r = awayAiShouldPlay(p, 5000);
      expect(r.play).toBe(false);
      expect(r.remainingMs).toBe(AWAY_AI_GRACE_MS);
    });
  });
});
