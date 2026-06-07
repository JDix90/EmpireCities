import { describe, it, expect } from 'vitest';
import type { CombatResult, GameState, PlayerState, TerritoryState } from '../../types';
import { consumeDefenderPreCombatCharges, applyDefenderPostCombatReactions } from './defenderReactions';

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    player_id: 'd1',
    player_index: 1,
    username: 'Defender',
    color: '#000',
    is_ai: false,
    is_eliminated: false,
    territory_count: 3,
    cards: [],
    mmr: 1000,
    capital_territory_id: null,
    secret_mission: null,
    ...overrides,
  } as PlayerState;
}

function state(defender: PlayerState, era: GameState['era']): GameState {
  return {
    game_id: 'g1',
    era,
    map_id: `era_${era}`,
    phase: 'attack',
    turn_number: 1,
    current_player_index: 0,
    players: [defender],
    territories: {},
    settings: {
      fog_of_war: false, turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: true,
      diplomacy_enabled: false, tech_trees_enabled: false, factions_enabled: true,
      economy_enabled: false, events_enabled: false, naval_enabled: false, stability_enabled: false,
    },
  } as GameState;
}

function terr(overrides: Partial<TerritoryState> = {}): TerritoryState {
  return { territory_id: 't', owner_id: 'd1', unit_count: 5, unit_type: 'infantry', ...overrides } as TerritoryState;
}

function combat(overrides: Partial<CombatResult> = {}): CombatResult {
  return { attacker_losses: 0, defender_losses: 0, territory_captured: false, ...overrides } as CombatResult;
}

describe('consumeDefenderPreCombatCharges', () => {
  it('greek_fire burns 1 attacker once per turn', () => {
    const d = player({ faction_id: 'byzantine' });
    const s = state(d, 'medieval');
    const first = consumeDefenderPreCombatCharges(s, 'd1');
    expect(first.greekFirePreDamage).toBe(1);
    expect(d.defensive_charge_used_this_turn).toBe(true);
    // Second attack this turn: no charge left.
    const second = consumeDefenderPreCombatCharges(s, 'd1');
    expect(second.greekFirePreDamage).toBe(0);
  });

  it('great_wall grants +2 defender dice once per turn', () => {
    const d = player({ faction_id: 'ming_china' });
    const s = state(d, 'discovery');
    const first = consumeDefenderPreCombatCharges(s, 'd1');
    expect(first.greatWallDefenseDice).toBe(2);
    const second = consumeDefenderPreCombatCharges(s, 'd1');
    expect(second.greatWallDefenseDice).toBe(0);
  });

  it('returns no charge for unrelated factions', () => {
    const d = player({ faction_id: 'rome' });
    const s = state(d, 'ancient');
    const r = consumeDefenderPreCombatCharges(s, 'd1');
    expect(r.greekFirePreDamage).toBe(0);
    expect(r.greatWallDefenseDice).toBe(0);
  });
});

describe('applyDefenderPostCombatReactions', () => {
  it('parting_shot kills 1 extra attacker on capture', () => {
    const d = player({ faction_id: 'parthia' });
    const s = state(d, 'ancient');
    const from = terr({ territory_id: 'a', owner_id: 'atk', unit_count: 4 });
    const to = terr({ territory_id: 'b', owner_id: 'd1', unit_count: 0 });
    const result = combat({ territory_captured: true, attacker_losses: 1 });
    applyDefenderPostCombatReactions({ state: s, defenderId: 'd1', fromTerritory: from, toTerritory: to, result });
    expect(from.unit_count).toBe(3);
    expect(result.attacker_losses).toBe(2);
  });

  it('parting_shot does nothing when the attack failed', () => {
    const d = player({ faction_id: 'parthia' });
    const s = state(d, 'ancient');
    const from = terr({ territory_id: 'a', owner_id: 'atk', unit_count: 4 });
    const to = terr({ territory_id: 'b', owner_id: 'd1', unit_count: 2 });
    const result = combat({ territory_captured: false, attacker_losses: 1 });
    applyDefenderPostCombatReactions({ state: s, defenderId: 'd1', fromTerritory: from, toTerritory: to, result });
    expect(from.unit_count).toBe(4);
  });

  it('nuclear_deterrence adds +3 attacker losses on the first capital assault, once per game', () => {
    const d = player({ faction_id: 'uk_cw', capital_territory_id: 'cap' });
    const s = state(d, 'coldwar');
    const from = terr({ territory_id: 'a', owner_id: 'atk', unit_count: 8 });
    const to = terr({ territory_id: 'cap', owner_id: 'd1', unit_count: 3 });
    const result = combat({ attacker_losses: 1 });
    applyDefenderPostCombatReactions({ state: s, defenderId: 'd1', fromTerritory: from, toTerritory: to, result });
    expect(from.unit_count).toBe(5);
    expect(result.attacker_losses).toBe(4);
    expect(d.used_game_abilities).toContain('nuclear_deterrence');
    // Second assault: no further toll.
    const result2 = combat({ attacker_losses: 1 });
    applyDefenderPostCombatReactions({ state: s, defenderId: 'd1', fromTerritory: from, toTerritory: to, result: result2 });
    expect(result2.attacker_losses).toBe(1);
  });

  it('bourbon_resistance negates the first capture of the capital, once per game', () => {
    const d = player({ faction_id: 'kingdom_naples', capital_territory_id: 'cap' });
    const s = state(d, 'risorgimento');
    const from = terr({ territory_id: 'a', owner_id: 'atk', unit_count: 8 });
    const to = terr({ territory_id: 'cap', owner_id: 'd1', unit_count: 0 });
    const result = combat({ territory_captured: true });
    applyDefenderPostCombatReactions({ state: s, defenderId: 'd1', fromTerritory: from, toTerritory: to, result });
    expect(result.territory_captured).toBe(false);
    expect(to.unit_count).toBeGreaterThanOrEqual(1);
    expect(d.used_game_abilities).toContain('bourbon_resistance');
  });
});
