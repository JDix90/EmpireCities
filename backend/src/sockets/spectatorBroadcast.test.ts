import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Server } from 'socket.io';
import type { GameState } from '../types';
import {
  SPECTATOR_DELAY_MS,
  SPECTATOR_BROADCAST_MS,
  trackSpectator,
  untrackSpectator,
  hasSpectators,
  pushSpectatorState,
  getDelayedSpectatorState,
  queueSpectatorEvent,
  ensureSpectatorBroadcastLoop,
  clearSpectatorGame,
  resetSpectatorBroadcastForTests,
} from './spectatorBroadcast';

function fakeState(turn: number): GameState {
  return { turn_number: turn } as unknown as GameState;
}

function fakeIo() {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  return { io: { to } as unknown as Server, to, emit };
}

describe('spectatorBroadcast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    resetSpectatorBroadcastForTests();
    vi.useRealTimers();
  });

  describe('spectator tracking', () => {
    it('trackSpectator is true only for a newly tracked socket', () => {
      expect(trackSpectator('g1', 's1')).toBe(true);
      expect(trackSpectator('g1', 's1')).toBe(false);
      expect(trackSpectator('g1', 's2')).toBe(true);
      expect(hasSpectators('g1')).toBe(true);
    });

    it('untrackSpectator is true only for a socket that was tracked', () => {
      trackSpectator('g1', 's1');
      expect(untrackSpectator('g1', 's1')).toBe(true);
      expect(untrackSpectator('g1', 's1')).toBe(false);
      expect(untrackSpectator('g1', 'never-joined')).toBe(false);
      expect(hasSpectators('g1')).toBe(false);
    });
  });

  describe('delayed state buffer', () => {
    it('returns the newest snapshot older than the delay', () => {
      pushSpectatorState('g1', fakeState(1));
      vi.advanceTimersByTime(SPECTATOR_DELAY_MS + 1000);
      pushSpectatorState('g1', fakeState(2));

      const entry = getDelayedSpectatorState('g1');
      expect(entry?.state.turn_number).toBe(1);
      expect(entry?.seq).toBe(1);
    });

    it('falls back to the oldest snapshot when nothing has aged past the delay', () => {
      pushSpectatorState('g1', fakeState(1));
      vi.advanceTimersByTime(1000);
      pushSpectatorState('g1', fakeState(2));

      const entry = getDelayedSpectatorState('g1');
      expect(entry?.state.turn_number).toBe(1);
    });

    it('deep-clones snapshots so later mutation cannot time-travel the buffer', () => {
      const live = fakeState(1);
      pushSpectatorState('g1', live);
      (live as { turn_number: number }).turn_number = 99;

      expect(getDelayedSpectatorState('g1')?.state.turn_number).toBe(1);
    });

    it('returns null for an unknown or cleared game', () => {
      expect(getDelayedSpectatorState('nope')).toBeNull();
      pushSpectatorState('g1', fakeState(1));
      clearSpectatorGame('g1');
      expect(getDelayedSpectatorState('g1')).toBeNull();
    });
  });

  describe('broadcast loop', () => {
    it('emits a delayed state once per seq — no unchanged re-broadcasts', () => {
      const { io, emit } = fakeIo();
      trackSpectator('g1', 's1');
      pushSpectatorState('g1', fakeState(1));
      vi.advanceTimersByTime(SPECTATOR_DELAY_MS);

      ensureSpectatorBroadcastLoop(io, 'g1');
      vi.advanceTimersByTime(SPECTATOR_BROADCAST_MS * 3);

      const stateEmits = emit.mock.calls.filter(([event]) => event === 'game:state');
      expect(stateEmits).toHaveLength(1);
      expect(stateEmits[0][1]).toMatchObject({ turn_number: 1, _spectator_seq: 1 });
    });

    it('emits again when a newer snapshot ages past the delay', () => {
      const { io, emit } = fakeIo();
      trackSpectator('g1', 's1');
      pushSpectatorState('g1', fakeState(1));
      ensureSpectatorBroadcastLoop(io, 'g1');

      vi.advanceTimersByTime(SPECTATOR_DELAY_MS + SPECTATOR_BROADCAST_MS);
      pushSpectatorState('g1', fakeState(2));
      vi.advanceTimersByTime(SPECTATOR_DELAY_MS + SPECTATOR_BROADCAST_MS);

      const turns = emit.mock.calls
        .filter(([event]) => event === 'game:state')
        .map(([, payload]) => (payload as { turn_number: number }).turn_number);
      expect(turns).toEqual([1, 2]);
    });

    it('stops itself once the last spectator leaves', () => {
      const { io, emit } = fakeIo();
      trackSpectator('g1', 's1');
      pushSpectatorState('g1', fakeState(1));
      vi.advanceTimersByTime(SPECTATOR_DELAY_MS);
      ensureSpectatorBroadcastLoop(io, 'g1');

      untrackSpectator('g1', 's1');
      vi.advanceTimersByTime(SPECTATOR_BROADCAST_MS * 5);
      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe('delayed event queue', () => {
    it('delivers a queued event only after the spectator delay', () => {
      const { io, emit } = fakeIo();
      trackSpectator('g1', 's1');
      ensureSpectatorBroadcastLoop(io, 'g1');

      queueSpectatorEvent('g1', 'game:event_card', { card_id: 'c1' });
      vi.advanceTimersByTime(SPECTATOR_DELAY_MS - SPECTATOR_BROADCAST_MS);
      expect(emit.mock.calls.filter(([event]) => event === 'game:event_card')).toHaveLength(0);

      vi.advanceTimersByTime(SPECTATOR_BROADCAST_MS * 2);
      const cardEmits = emit.mock.calls.filter(([event]) => event === 'game:event_card');
      expect(cardEmits).toHaveLength(1);
      expect(cardEmits[0][1]).toEqual({ card_id: 'c1' });
    });

    it('drains events in queue order', () => {
      const { io, emit } = fakeIo();
      trackSpectator('g1', 's1');
      ensureSpectatorBroadcastLoop(io, 'g1');

      queueSpectatorEvent('g1', 'game:map_visual', { id: 'a' });
      queueSpectatorEvent('g1', 'game:strike_animation', { id: 'b' });
      vi.advanceTimersByTime(SPECTATOR_DELAY_MS + SPECTATOR_BROADCAST_MS);

      const events = emit.mock.calls.map(([event]) => event).filter((e) => e !== 'game:state');
      expect(events).toEqual(['game:map_visual', 'game:strike_animation']);
    });

    it('drops long-overdue events instead of burst-emitting them at a late joiner', () => {
      const { io, emit } = fakeIo();
      // Queued while nobody was watching (no loop running)…
      queueSpectatorEvent('g1', 'game:event_card', { card_id: 'stale' });
      vi.advanceTimersByTime(SPECTATOR_DELAY_MS * 3);

      // …then a spectator joins much later: the stale event must not fire.
      trackSpectator('g1', 's1');
      ensureSpectatorBroadcastLoop(io, 'g1');
      vi.advanceTimersByTime(SPECTATOR_BROADCAST_MS * 2);

      expect(emit.mock.calls.filter(([event]) => event === 'game:event_card')).toHaveLength(0);
    });
  });
});
