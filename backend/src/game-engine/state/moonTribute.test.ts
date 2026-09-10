import { describe, it, expect } from 'vitest';
import type { GameState, PlayerState } from '../../types';
import {
  TRIBUTE_MIN_MOON_TILES,
  applyMoonTribute,
  clearTributeReceived,
  isMoonTributeEnabled,
  moonTributeLevier,
} from './moonTribute';

/**
 * Tribute (Space Age Moon Race §8) — the knob, not a phase.
 *
 * The mechanic is one line of design and three lines of restraint: it takes
 * from players holding NO lunar ground, it cannot push anyone negative, and a
 * single Moon tile buys you out. Those three are what keep it a price on
 * abstention rather than a punishment, and they are what these tests hold.
 */

const MOON = Array.from({ length: 9 }, (_, i) => `moon_${i}`);

function mkState(opts: {
  moonOwners?: (string | null)[];
  enabled?: boolean;
  techTrees?: boolean;
  techPoints?: Record<string, number>;
} = {}): GameState {
  const owners = opts.moonOwners ?? MOON.map(() => null);
  const tp = opts.techPoints ?? {};
  return {
    era: 'space_age',
    turn_number: 12,
    settings: {
      space_age_moon_tribute_enabled: opts.enabled !== false,
      tech_trees_enabled: opts.techTrees !== false,
    },
    territories: {
      ...Object.fromEntries(MOON.map((id, i) => [id, {
        territory_id: id, owner_id: owners[i], unit_count: 2, buildings: [],
      }])),
      // An Earth tile, so "holds territory" and "holds lunar ground" differ.
      earth_1: { territory_id: 'earth_1', owner_id: 'p2', unit_count: 5, buildings: [] },
    },
    players: [
      { player_id: 'p1', tech_points: tp.p1 ?? 10 },
      { player_id: 'p2', tech_points: tp.p2 ?? 10 },
      { player_id: 'p3', tech_points: tp.p3 ?? 10 },
    ] as unknown as PlayerState[],
  } as unknown as GameState;
}

/** p1 holds six of nine — the threshold exactly. */
const sixToP1 = () => mkState({
  moonOwners: [...Array(6).fill('p1'), null, null, null],
});

describe('who may levy', () => {
  it('a player holding the threshold', () => {
    expect(moonTributeLevier(sixToP1())).toBe('p1');
  });

  it('nobody at one tile short', () => {
    const state = mkState({ moonOwners: [...Array(TRIBUTE_MIN_MOON_TILES - 1).fill('p1'), null, null, null, null] });
    expect(moonTributeLevier(state)).toBeNull();
  });

  it('nobody on an empty or shared Moon', () => {
    expect(moonTributeLevier(mkState())).toBeNull();
    expect(moonTributeLevier(mkState({
      moonOwners: ['p1', 'p1', 'p1', 'p1', 'p2', 'p2', 'p2', 'p2', null],
    }))).toBeNull();
  });

  it('at most one player can ever qualify', () => {
    // Six of nine is over half by construction, so two leviers is arithmetically
    // impossible — which is why the transfer never has to pick between them.
    expect(TRIBUTE_MIN_MOON_TILES * 2).toBeGreaterThan(MOON.length);
  });
});

describe('who pays', () => {
  it('a player holding no lunar ground', () => {
    const state = sixToP1();
    expect(applyMoonTribute(state, 'p2')).toBe(1);
    expect(state.players.find((p) => p.player_id === 'p2')!.tech_points).toBe(9);
    expect(state.players.find((p) => p.player_id === 'p1')!.tech_points).toBe(11);
  });

  it('NOT a player holding a single tile — one tile buys you out', () => {
    // The rule that makes this a price on abstention rather than a punishment
    // for losing. A player who went to the Moon and was pushed back to one tile
    // is not an abstainer.
    const state = mkState({ moonOwners: [...Array(6).fill('p1'), 'p2', null, null] });
    expect(moonTributeLevier(state)).toBe('p1');
    expect(applyMoonTribute(state, 'p2')).toBe(0);
    expect(state.players.find((p) => p.player_id === 'p2')!.tech_points).toBe(10);
  });

  it('NOT the levier themselves', () => {
    expect(applyMoonTribute(sixToP1(), 'p1')).toBe(0);
  });

  it('never below zero — this is a levy, not a debt', () => {
    const state = mkState({
      moonOwners: [...Array(6).fill('p1'), null, null, null],
      techPoints: { p2: 0 },
    });
    expect(applyMoonTribute(state, 'p2')).toBe(0);
    expect(state.players.find((p) => p.player_id === 'p2')!.tech_points).toBe(0);
    expect(state.players.find((p) => p.player_id === 'p1')!.tech_points).toBe(10);
  });
});

describe('when it is live at all', () => {
  it('off by default', () => {
    expect(isMoonTributeEnabled(mkState({ enabled: false }))).toBe(false);
    expect(applyMoonTribute(mkState({
      moonOwners: [...Array(6).fill('p1'), null, null, null], enabled: false,
    }), 'p2')).toBe(0);
  });

  it('off without tech trees, whose points it moves', () => {
    // Moving a resource neither side can spend is noise dressed as a mechanic.
    const state = mkState({ moonOwners: [...Array(6).fill('p1'), null, null, null], techTrees: false });
    expect(isMoonTributeEnabled(state)).toBe(false);
    expect(applyMoonTribute(state, 'p2')).toBe(0);
  });
});

describe('what the payer and holder are shown', () => {
  it('records both sides so the levy is visible, not silent', () => {
    const state = sixToP1();
    applyMoonTribute(state, 'p2');
    applyMoonTribute(state, 'p3');
    expect(state.players.find((p) => p.player_id === 'p2')!.tribute_paid_this_turn).toBe(1);
    expect(state.players.find((p) => p.player_id === 'p3')!.tribute_paid_this_turn).toBe(1);
    // The holder's figure accumulates across the round, then resets on their turn.
    expect(state.players.find((p) => p.player_id === 'p1')!.tribute_received_this_turn).toBe(2);
    clearTributeReceived(state, 'p1');
    expect(state.players.find((p) => p.player_id === 'p1')!.tribute_received_this_turn).toBe(0);
  });

  it('clears a stale paid figure when the levy stops', () => {
    // Otherwise the HUD keeps showing a tribute the player is no longer paying.
    const state = sixToP1();
    applyMoonTribute(state, 'p2');
    expect(state.players.find((p) => p.player_id === 'p2')!.tribute_paid_this_turn).toBe(1);
    state.players.find((p) => p.player_id === 'p2')!.tech_points = 0;
    applyMoonTribute(state, 'p2');
    expect(state.players.find((p) => p.player_id === 'p2')!.tribute_paid_this_turn).toBe(0);
  });
});
