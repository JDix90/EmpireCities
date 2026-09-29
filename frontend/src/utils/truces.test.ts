import { describe, it, expect } from 'vitest';
import type { GameState } from '../store/gameStore';
import { isHostileAbility, trucePartnerOwning } from './truces';

function state(diplomacy: GameState['diplomacy']): GameState {
  return {
    players: [
      { player_id: 'me', player_index: 0, username: 'Me' },
      { player_id: 'sam', player_index: 1, username: 'Sam' },
      { player_id: 'kai', player_index: 2, username: 'Kai' },
    ],
    territories: {
      mine: { territory_id: 'mine', owner_id: 'me', unit_count: 3 },
      sams: { territory_id: 'sams', owner_id: 'sam', unit_count: 3 },
      kais: { territory_id: 'kais', owner_id: 'kai', unit_count: 3 },
      open: { territory_id: 'open', owner_id: null, unit_count: 1 },
    },
    diplomacy,
  } as unknown as GameState;
}

const truce = (turns = 2) => [{ player_index_a: 1, player_index_b: 0, status: 'truce' as const, truce_turns_remaining: turns }];

describe('trucePartnerOwning', () => {
  it('names the partner who holds the target, whichever way the truce was recorded', () => {
    expect(trucePartnerOwning(state(truce()), 'me', 'sams')?.username).toBe('Sam');
  });

  it('asks nothing of your own ground, open ground, a rival without a truce, or a lapsed truce', () => {
    expect(trucePartnerOwning(state(truce()), 'me', 'mine')).toBeNull();
    expect(trucePartnerOwning(state(truce()), 'me', 'open')).toBeNull();
    expect(trucePartnerOwning(state(truce()), 'me', 'kais')).toBeNull();
    expect(trucePartnerOwning(state(truce(0)), 'me', 'sams')).toBeNull();
    expect(trucePartnerOwning(state(undefined), 'me', 'sams')).toBeNull();
  });
});

describe('isHostileAbility', () => {
  it('covers what is fired at an enemy: strikes, the bomb, a Drop Assault, faction strikes', () => {
    for (const id of ['atom_bomb', 'nuclear_strike', 'dyson_beam', 'drop_assault', 'longbowmen', 'privateer']) {
      expect({ id, hostile: isHostileAbility(id) }).toEqual({ id, hostile: true });
    }
  });

  it('leaves out buffs, recon and abilities used on your own ground', () => {
    for (const id of ['air_strike', 'spy_network', 'siege_assault', 'royal_decree', 'orbital_drop', 'unknown']) {
      expect({ id, hostile: isHostileAbility(id) }).toEqual({ id, hostile: false });
    }
  });
});
