import { describe, it, expect } from 'vitest';
import type { PlayerState, TerritoryState } from '../types';
import { redactPlayersForViewer, maskHiddenTerritories } from './clientStateRedaction';

function player(overrides: Partial<PlayerState>): PlayerState {
  return {
    player_id: 'p',
    is_eliminated: false,
    cards: [{ id: 'c1' }] as unknown as PlayerState['cards'],
    secret_mission: { id: 'm1' } as unknown as PlayerState['secret_mission'],
    ...overrides,
  } as PlayerState;
}

const alice = (): PlayerState => player({ player_id: 'alice' });
const bob = (): PlayerState => player({ player_id: 'bob' });

describe('redactPlayersForViewer', () => {
  it('empties every card hand for a spectator (viewerId null)', () => {
    const out = redactPlayersForViewer([alice(), bob()], null, 'attack');
    expect(out.every((p) => p.cards.length === 0)).toBe(true);
  });

  it("nulls other players' secret missions for a spectator mid-game", () => {
    const out = redactPlayersForViewer([alice(), bob()], null, 'attack');
    expect(out.every((p) => p.secret_mission === null)).toBe(true);
  });

  it('keeps the viewing player\'s own hand and mission, hides others\' missions', () => {
    const out = redactPlayersForViewer([alice(), bob()], 'alice', 'attack');
    const a = out.find((p) => p.player_id === 'alice')!;
    const b = out.find((p) => p.player_id === 'bob')!;
    expect(a.cards.length).toBe(1);
    expect(a.secret_mission).not.toBeNull();
    // The helper does not hide other players' cards for a player view — that is
    // the fog branch's job in buildClientState. Preserving this keeps existing
    // (non-spectator) behaviour exactly.
    expect(b.secret_mission).toBeNull();
  });

  it('reveals missions at game_over but still hides card hands from spectators', () => {
    const out = redactPlayersForViewer([alice(), bob()], null, 'game_over');
    expect(out.every((p) => p.secret_mission !== null)).toBe(true);
    expect(out.every((p) => p.cards.length === 0)).toBe(true);
  });

  it('does not mutate the input players', () => {
    const players = [alice(), bob()];
    redactPlayersForViewer(players, null, 'attack');
    expect(players.every((p) => p.cards.length === 1)).toBe(true);
    expect(players.every((p) => p.secret_mission !== null)).toBe(true);
  });
});

function territory(overrides: Partial<TerritoryState>): TerritoryState {
  return {
    territory_id: 't',
    owner_id: 'alice',
    unit_count: 7,
    naval_units: 2,
    buildings: ['fort'],
    production_bonus: 3,
    stability: 5,
    population: 9,
    ...overrides,
  } as unknown as TerritoryState;
}

describe('maskHiddenTerritories', () => {
  const terrs = (): Record<string, TerritoryState> => ({
    t1: territory({ territory_id: 't1', owner_id: 'alice' }),
    t2: territory({ territory_id: 't2', owner_id: 'bob' }),
  });

  it('masks exact intel of non-visible territories but keeps owner_id (board control)', () => {
    const out = maskHiddenTerritories(terrs(), new Set(['t1']));
    // t1 visible → untouched
    expect(out.t1.unit_count).toBe(7);
    expect(out.t1.buildings).toEqual(['fort']);
    // t2 hidden → counts masked, ownership retained
    expect(out.t2.unit_count).toBe(-1);
    expect(out.t2.naval_units).toBeUndefined();
    expect(out.t2.buildings).toEqual([]);
    expect(out.t2.stability).toBeUndefined();
    expect(out.t2.population).toBeUndefined();
    expect(out.t2.owner_id).toBe('bob');
  });

  it('masks EVERY territory for a spectator (empty visible set)', () => {
    const out = maskHiddenTerritories(terrs(), new Set());
    expect(out.t1.unit_count).toBe(-1);
    expect(out.t2.unit_count).toBe(-1);
    // ownership still visible so spectators see who controls the board
    expect(out.t1.owner_id).toBe('alice');
    expect(out.t2.owner_id).toBe('bob');
  });

  it('does not mutate the input territories', () => {
    const input = terrs();
    maskHiddenTerritories(input, new Set());
    expect(input.t1.unit_count).toBe(7);
    expect(input.t2.buildings).toEqual(['fort']);
  });
});
