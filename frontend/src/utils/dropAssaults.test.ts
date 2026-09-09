import { describe, it, expect } from 'vitest';
import type { GameState } from '../store/gameStore';
import { dropAssaultsTargeting, incomingDropAssaultsAgainst } from './dropAssaults';

/**
 * The marker is the counterplay. A Drop Assault is balanced by the defender
 * getting a full round to reinforce the tile, which only works if the tile is
 * visibly marked — so these pin who sees what.
 */

const state = (over: Partial<GameState> = {}): GameState => ({
  players: [
    { player_id: 'me', username: 'Me' },
    { player_id: 'rival', username: 'Rival' },
  ],
  territories: {
    mine: { territory_id: 'mine', owner_id: 'me', unit_count: 2 },
    theirs: { territory_id: 'theirs', owner_id: 'rival', unit_count: 4 },
  },
  drop_assaults: [],
  ...over,
} as unknown as GameState);

const assault = (owner: string, target: string) =>
  ({ owner_id: owner, target_id: target, declared_turn: 4, units: 3 });

describe('the marker on a targeted tile', () => {
  it('is visible on the tile itself, whoever is looking', () => {
    const s = state({ drop_assaults: [assault('rival', 'mine')] } as Partial<GameState>);
    expect(dropAssaultsTargeting(s, 'mine')).toHaveLength(1);
  });

  it('does not mark tiles nobody aimed at', () => {
    const s = state({ drop_assaults: [assault('rival', 'mine')] } as Partial<GameState>);
    expect(dropAssaultsTargeting(s, 'theirs')).toEqual([]);
  });

  it('copes with a game that has no drops at all', () => {
    expect(dropAssaultsTargeting(state(), 'mine')).toEqual([]);
    expect(dropAssaultsTargeting(null, 'mine')).toEqual([]);
  });
});

describe('the standing alert for the player under threat', () => {
  it('names who declared it', () => {
    const s = state({ drop_assaults: [assault('rival', 'mine')] } as Partial<GameState>);
    const incoming = incomingDropAssaultsAgainst(s, 'me');
    expect(incoming).toHaveLength(1);
    expect(incoming[0].declaredBy).toBe('Rival');
  });

  it('does not warn you about your own drop', () => {
    // It is aimed at someone else's ground and it is yours; an alert would be
    // telling the attacker they are under attack.
    const s = state({ drop_assaults: [assault('me', 'theirs')] } as Partial<GameState>);
    expect(incomingDropAssaultsAgainst(s, 'me')).toEqual([]);
  });

  it('stops warning once the marked tile is no longer yours', () => {
    // The drop still lands; it just is not this player's problem any more.
    const s = state({ drop_assaults: [assault('rival', 'theirs')] } as Partial<GameState>);
    expect(incomingDropAssaultsAgainst(s, 'me')).toEqual([]);
  });
});
