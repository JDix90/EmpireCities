import { describe, it, expect } from 'vitest';
import type { GameState, MapConnection, PlayerState } from '../../types';
import { computeLandCombatModifiers, getMarchToSeaBonus, recordMarchToSeaResult } from './combatModifiers';

function basePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    player_id: 'p1',
    player_index: 0,
    username: 'Attacker',
    color: '#fff',
    is_ai: false,
    is_eliminated: false,
    territory_count: 5,
    cards: [],
    mmr: 1000,
    capital_territory_id: null,
    secret_mission: null,
    unlocked_techs: [],
    tech_points: 0,
    ...overrides,
  } as PlayerState;
}

function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    game_id: 'g1',
    era: 'discovery',
    map_id: 'era_discovery',
    phase: 'attack',
    turn_number: 1,
    current_player_index: 0,
    players: [basePlayer(), basePlayer({ player_id: 'p2', player_index: 1, username: 'Defender' })],
    territories: {},
    settings: {
      fog_of_war: false,
      turn_timer_seconds: 0,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: false,
      tech_trees_enabled: false,
      factions_enabled: false,
      economy_enabled: false,
      events_enabled: false,
      naval_enabled: false,
      stability_enabled: false,
    },
    ...overrides,
  } as GameState;
}

const seaConn: MapConnection = { from: 'a', to: 'b', type: 'sea' };
const landConn: MapConnection = { from: 'a', to: 'b', type: 'land' };

describe('computeLandCombatModifiers', () => {
  it('caps attacker dice at 2 on Discovery sea lanes', () => {
    const state = baseState({ era_modifiers: { sea_lanes: true } });
    const mods = computeLandCombatModifiers({
      state,
      fromId: 'a',
      toId: 'b',
      attackerId: 'p1',
      defenderId: 'p2',
      attackingUnits: 8, // would normally roll 3 dice
      defendingUnits: 3,
      connection: seaConn,
    });
    expect(mods.finalAttackerDiceOverride).toBe(2);
  });

  it('does not cap sea dice when the connection is land', () => {
    const state = baseState({ era_modifiers: { sea_lanes: true } });
    const mods = computeLandCombatModifiers({
      state,
      fromId: 'a',
      toId: 'b',
      attackerId: 'p1',
      defenderId: 'p2',
      attackingUnits: 8,
      defendingUnits: 3,
      connection: landConn,
    });
    // No structural override and no additive bonuses → resolveCombat uses its default cap.
    expect(mods.finalAttackerDiceOverride).toBeUndefined();
  });

  it('folds extra attack bonuses (e.g. blitzkrieg, march to the sea) into the override', () => {
    const state = baseState();
    const mods = computeLandCombatModifiers({
      state,
      fromId: 'a',
      toId: 'b',
      attackerId: 'p1',
      defenderId: 'p2',
      attackingUnits: 8,
      defendingUnits: 3,
      connection: landConn,
      extraAttackBonuses: { blitzkrieg: 1, march_to_sea: 1 },
    });
    // base 3 dice + 2 bonus
    expect(mods.finalAttackerDiceOverride).toBe(5);
    expect(mods.attackerBonusBreakdown.total).toBe(2);
  });

  it('raises the sea-lane dice cap to 3 for the Naval Charts faction (Portugal)', () => {
    const state = baseState({
      era_modifiers: { sea_lanes: true },
      settings: {
        fog_of_war: false, turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: true,
        diplomacy_enabled: false, tech_trees_enabled: false, factions_enabled: true,
        economy_enabled: false, events_enabled: false, naval_enabled: false, stability_enabled: false,
      },
      players: [
        basePlayer({ faction_id: 'portugal' }),
        basePlayer({ player_id: 'p2', player_index: 1, username: 'Defender' }),
      ],
    });
    const mods = computeLandCombatModifiers({
      state,
      fromId: 'a',
      toId: 'b',
      attackerId: 'p1',
      defenderId: 'p2',
      attackingUnits: 8,
      defendingUnits: 3,
      connection: seaConn,
    });
    expect(mods.finalAttackerDiceOverride).toBe(3);
  });

  it('janissaries defend with 3 dice regardless of a small garrison', () => {
    const state = baseState({
      settings: {
        fog_of_war: false, turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: true,
        diplomacy_enabled: false, tech_trees_enabled: false, factions_enabled: true,
        economy_enabled: false, events_enabled: false, naval_enabled: false, stability_enabled: false,
      },
      players: [
        basePlayer(),
        basePlayer({ player_id: 'p2', player_index: 1, username: 'Defender', faction_id: 'ottoman' }),
      ],
    });
    const mods = computeLandCombatModifiers({
      state,
      fromId: 'a',
      toId: 'b',
      attackerId: 'p1',
      defenderId: 'p2',
      attackingUnits: 5,
      defendingUnits: 1, // would normally roll only 1 die
      connection: landConn,
    });
    expect(mods.defenderDiceOverride).toBe(3);
  });

  it('adds defender dice from extra defense bonuses (truce break)', () => {
    const state = baseState();
    const mods = computeLandCombatModifiers({
      state,
      fromId: 'a',
      toId: 'b',
      attackerId: 'p1',
      defenderId: 'p2',
      attackingUnits: 4,
      defendingUnits: 3,
      connection: landConn,
      extraDefenseBonuses: { truce_break: 1 },
    });
    // base 2 defender dice + 1 truce-break
    expect(mods.defenderDiceOverride).toBe(3);
    expect(mods.defenderBonusBreakdown.truce_break).toBe(1);
  });
});

describe('getMarchToSeaBonus', () => {
  it('returns 0 when the ability is not active', () => {
    expect(getMarchToSeaBonus(basePlayer(), 'a')).toBe(0);
  });

  it('grants +1 on the first hop from any owned territory', () => {
    const player = basePlayer({ march_to_sea_active: true, march_to_sea_hops_used: 0 });
    expect(getMarchToSeaBonus(player, 'anywhere')).toBe(1);
  });

  it('only continues the chain from the last captured territory', () => {
    const player = basePlayer({
      march_to_sea_active: true,
      march_to_sea_hops_used: 1,
      march_to_sea_last_capture_id: 'captured_1',
    });
    expect(getMarchToSeaBonus(player, 'captured_1')).toBe(1);
    expect(getMarchToSeaBonus(player, 'somewhere_else')).toBe(0);
  });

  it('stops granting the bonus after 3 hops', () => {
    const player = basePlayer({
      march_to_sea_active: true,
      march_to_sea_hops_used: 3,
      march_to_sea_last_capture_id: 'captured_3',
    });
    expect(getMarchToSeaBonus(player, 'captured_3')).toBe(0);
  });
});

describe('recordMarchToSeaResult + getMarchToSeaBonus chain', () => {
  it('grants the bonus on exactly 3 consecutive hops, then stops', () => {
    const player = basePlayer({ march_to_sea_active: true, march_to_sea_hops_used: 0 });

    // Hop 1: from any owned territory.
    expect(getMarchToSeaBonus(player, 'home')).toBe(1);
    recordMarchToSeaResult(player, true, 't1', true);
    expect(player.march_to_sea_hops_used).toBe(1);

    // Hop 2: must continue from the last capture.
    expect(getMarchToSeaBonus(player, 't1')).toBe(1);
    expect(getMarchToSeaBonus(player, 'elsewhere')).toBe(0);
    recordMarchToSeaResult(player, true, 't2', true);

    // Hop 3.
    expect(getMarchToSeaBonus(player, 't2')).toBe(1);
    recordMarchToSeaResult(player, true, 't3', true);
    expect(player.march_to_sea_hops_used).toBe(3);

    // 4th hop: no more bonus.
    expect(getMarchToSeaBonus(player, 't3')).toBe(0);
  });

  it('breaks the chain on a failed hop but does not consume a hop', () => {
    const player = basePlayer({
      march_to_sea_active: true,
      march_to_sea_hops_used: 1,
      march_to_sea_last_capture_id: 't1',
    });
    recordMarchToSeaResult(player, true, 't2', false); // attacked t1→t2, failed
    expect(player.march_to_sea_hops_used).toBe(1);
    expect(player.march_to_sea_last_capture_id).toBeNull();
    // A fresh chain may begin from any territory since hops remain.
    expect(getMarchToSeaBonus(player, 'anywhere')).toBe(1);
  });

  it('ignores results when the bonus was not applied', () => {
    const player = basePlayer({
      march_to_sea_active: true,
      march_to_sea_hops_used: 1,
      march_to_sea_last_capture_id: 't1',
    });
    recordMarchToSeaResult(player, false, 't9', true); // capture from a non-chain territory
    expect(player.march_to_sea_hops_used).toBe(1);
    expect(player.march_to_sea_last_capture_id).toBe('t1');
  });
});

describe('era advancement combat modifiers', () => {
  it('grants +1 attacker die per era gap (gap 1)', () => {
    const state = baseState({
      settings: {
        ...baseState().settings,
        era_advancement_enabled: true,
        era_advancement_combat_gap_dice: 1,
      },
      players: [
        basePlayer({ player_id: 'p1', current_era_index: 1 }),
        basePlayer({ player_id: 'p2', player_index: 1, current_era_index: 0 }),
      ],
    });
    const mods = computeLandCombatModifiers({
      state,
      fromId: 'a',
      toId: 'b',
      attackerId: 'p1',
      defenderId: 'p2',
      attackingUnits: 5,
      defendingUnits: 3,
      connection: landConn,
    });
    expect(mods.attackerBonusBreakdown.era_gap).toBe(1);
  });

  it('grants +2 attacker dice when gap is clamped at 2', () => {
    const state = baseState({
      settings: {
        ...baseState().settings,
        era_advancement_enabled: true,
        era_advancement_combat_gap_dice: 1,
      },
      players: [
        basePlayer({ player_id: 'p1', current_era_index: 3 }),
        basePlayer({ player_id: 'p2', player_index: 1, current_era_index: 0 }),
      ],
    });
    const mods = computeLandCombatModifiers({
      state,
      fromId: 'a',
      toId: 'b',
      attackerId: 'p1',
      defenderId: 'p2',
      attackingUnits: 6,
      defendingUnits: 3,
      connection: landConn,
    });
    expect(mods.attackerBonusBreakdown.era_gap).toBe(2);
  });

  it('applies vulnerability defense multiplier to advancing defender', () => {
    const state = baseState({
      settings: {
        ...baseState().settings,
        era_advancement_enabled: true,
        era_advancement_vuln_defense_mult: 0.75,
        tech_trees_enabled: true,
      },
      players: [
        basePlayer({ player_id: 'p1' }),
        basePlayer({
          player_id: 'p2',
          player_index: 1,
          era_transition_turns_remaining: 1,
        }),
      ],
    });
    const mods = computeLandCombatModifiers({
      state,
      fromId: 'a',
      toId: 'b',
      attackerId: 'p1',
      defenderId: 'p2',
      attackingUnits: 5,
      defendingUnits: 4,
      connection: landConn,
    });
    expect(mods.defenderDiceOverride).toBe(1);
    expect(mods.defenderBonusBreakdown.vulnerability).toBe(-1);
  });
});
