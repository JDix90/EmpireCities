import { describe, it, expect } from 'vitest';
import type { PlayerState } from '../../types';
import { markAiTakeover, canReclaimSeat, applySeatReclaim } from './seatTakeover';

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

describe('seat takeover / reclaim transitions', () => {
  it('markAiTakeover flags a disconnected human as a reclaimable AI seat', () => {
    const p = human();
    markAiTakeover(p);
    expect(p.is_ai).toBe(true);
    expect(p.ai_takeover).toBe(true);
    expect(p.ai_difficulty).toBe('medium'); // defaulted
  });

  it('markAiTakeover preserves an existing AI difficulty', () => {
    const p = human({ ai_difficulty: 'hard' });
    markAiTakeover(p);
    expect(p.ai_difficulty).toBe('hard');
  });

  it('round-trips: a taken-over human can reclaim their seat', () => {
    const p = human();
    markAiTakeover(p);
    expect(canReclaimSeat(p)).toBe(true);
    expect(applySeatReclaim(p)).toBe(true);
    expect(p.is_ai).toBe(false);
    expect(p.ai_takeover).toBe(false);
    expect(canReclaimSeat(p)).toBe(false); // idempotent: nothing left to reclaim
    expect(applySeatReclaim(p)).toBe(false);
  });

  it('never reclaims an original AI seat (no takeover marker)', () => {
    const ai = human({ is_ai: true, ai_difficulty: 'expert' });
    expect(canReclaimSeat(ai)).toBe(false);
    expect(applySeatReclaim(ai)).toBe(false);
    expect(ai.is_ai).toBe(true); // untouched
  });

  it('never reclaims an eliminated seat even if it was taken over', () => {
    const p = human();
    markAiTakeover(p);
    p.is_eliminated = true;
    expect(canReclaimSeat(p)).toBe(false);
    expect(applySeatReclaim(p)).toBe(false);
    expect(p.is_ai).toBe(true);
  });
});
