import { describe, it, expect } from 'vitest';
import type { GameState, MapConnection, PlayerState } from '../../types';
import {
  CAMPAIGN_PRESTIGE_DICE_CAP,
  CAMPAIGN_PRESTIGE_TURNS,
  CAMPAIGN_SURVIVOR_DICE_CAP,
  computeLandCombatModifiers,
} from '../../game-engine/combat/combatModifiers';
import {
  CAMPAIGN_SPIRIT_PER_REINFORCEMENT,
  CAMPAIGN_SPIRIT_REINFORCE_CAP,
  getPlayerReinforceBonus,
} from '../../game-engine/state/techManager';

/**
 * The three path carries, at the point where they reach a die or a unit.
 *
 * Every one of them used to be written into `temporary_modifiers`, which
 * combat reads only when `events_enabled` — a setting no campaign stage turns
 * on. So a player could bank a Survivor Bonus of 8 across five eras and it
 * would never once change a roll. These tests exist because that shipped, and
 * because the carries are the only thing separating one path from another.
 */

const LAND: MapConnection = { from: 'home', to: 'away', type: 'land' };

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    player_id: 'human',
    player_index: 0,
    username: 'Player',
    color: '#fff',
    is_ai: false,
    is_eliminated: false,
    territory_count: 6,
    cards: [],
    mmr: 1000,
    capital_territory_id: null,
    secret_mission: null,
    unlocked_techs: [],
    tech_points: 0,
    ...overrides,
  } as PlayerState;
}

function state(settings: Record<string, unknown> = {}, turn = 1): GameState {
  return {
    game_id: 'g',
    era: 'ancient',
    map_id: 'era_ancient',
    phase: 'attack',
    turn_number: turn,
    current_player_index: 0,
    players: [
      player({ faction_id: 'germanic_tribes' }),
      player({ player_id: 'ai', player_index: 1, username: 'AI', is_ai: true, faction_id: 'rome' }),
    ],
    territories: {
      // `germanic` is a germanic_tribes home region; `roman_west` is not.
      home: { territory_id: 'home', owner_id: 'human', unit_count: 4, region_id: 'germanic', buildings: [] },
      away: { territory_id: 'away', owner_id: 'human', unit_count: 4, region_id: 'roman_west', buildings: [] },
      attacker: { territory_id: 'attacker', owner_id: 'ai', unit_count: 9, region_id: 'roman_west', buildings: [] },
    },
    settings: {
      fog_of_war: false,
      turn_timer_seconds: 0,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: false,
      tech_trees_enabled: false,
      factions_enabled: true,
      economy_enabled: false,
      events_enabled: false,
      naval_enabled: false,
      stability_enabled: false,
      is_campaign: true,
      ...settings,
    },
  } as unknown as GameState;
}

function defenceCampaignBonus(s: GameState, toId: string): number {
  return computeLandCombatModifiers({
    state: s,
    fromId: 'attacker',
    toId,
    attackerId: 'ai',
    defenderId: 'human',
    attackingUnits: 8,
    defendingUnits: 4,
    connection: LAND,
  }).defenderBonusBreakdown.campaign;
}

function attackCampaignBonus(s: GameState): number {
  return computeLandCombatModifiers({
    state: s,
    fromId: 'home',
    toId: 'attacker',
    attackerId: 'human',
    defenderId: 'ai',
    attackingUnits: 4,
    defendingUnits: 9,
    connection: LAND,
  }).attackerBonusBreakdown.campaign;
}

describe('Survivor Bonus (The Last Defenders)', () => {
  it('adds defence dice in the defender faction home regions', () => {
    expect(defenceCampaignBonus(state({ campaign_carry: { survivor_bonus: 2 } }), 'home')).toBe(2);
  });

  it('does nothing outside them, however much is banked', () => {
    expect(defenceCampaignBonus(state({ campaign_carry: { survivor_bonus: 8 } }), 'away')).toBe(0);
  });

  it(`stops at ${CAMPAIGN_SURVIVOR_DICE_CAP} dice however much is banked`, () => {
    expect(defenceCampaignBonus(state({ campaign_carry: { survivor_bonus: 8 } }), 'home'))
      .toBe(CAMPAIGN_SURVIVOR_DICE_CAP);
  });

  it('does not leak into a game that is not a campaign', () => {
    const s = state({ is_campaign: false, campaign_carry: { survivor_bonus: 2 } });
    expect(defenceCampaignBonus(s, 'home')).toBe(0);
  });

  it('is the human seat\'s, not the AI\'s', () => {
    const s = state({ campaign_carry: { survivor_bonus: 2 } });
    s.players[0]!.is_ai = true;
    expect(defenceCampaignBonus(s, 'home')).toBe(0);
  });
});

describe('Prestige (Blood & Empire)', () => {
  it('adds attack dice on the opening turns', () => {
    expect(attackCampaignBonus(state({ campaign_prestige_bonus: 2 }, 1))).toBe(2);
  });

  it(`stops at ${CAMPAIGN_PRESTIGE_DICE_CAP} dice however much is banked`, () => {
    expect(attackCampaignBonus(state({ campaign_prestige_bonus: 12 }, 1)))
      .toBe(CAMPAIGN_PRESTIGE_DICE_CAP);
  });

  it(`runs out after turn ${CAMPAIGN_PRESTIGE_TURNS}`, () => {
    expect(attackCampaignBonus(state({ campaign_prestige_bonus: 2 }, CAMPAIGN_PRESTIGE_TURNS))).toBe(2);
    expect(attackCampaignBonus(state({ campaign_prestige_bonus: 2 }, CAMPAIGN_PRESTIGE_TURNS + 1))).toBe(0);
  });

  it('does not leak into a game that is not a campaign', () => {
    expect(attackCampaignBonus(state({ is_campaign: false, campaign_prestige_bonus: 2 }, 1))).toBe(0);
  });
});

describe('Revolutionary Spirit (The Revolutionary Flame)', () => {
  it(`pays one reinforcement per ${CAMPAIGN_SPIRIT_PER_REINFORCEMENT} points banked`, () => {
    expect(getPlayerReinforceBonus(state({ campaign_carry: { revolutionary_spirit: 1 } }), 'human')).toBe(0);
    expect(getPlayerReinforceBonus(state({ campaign_carry: { revolutionary_spirit: 2 } }), 'human')).toBe(1);
  });

  it(`stops at ${CAMPAIGN_SPIRIT_REINFORCE_CAP} however much is banked`, () => {
    expect(getPlayerReinforceBonus(state({ campaign_carry: { revolutionary_spirit: 10 } }), 'human'))
      .toBe(CAMPAIGN_SPIRIT_REINFORCE_CAP);
  });

  it('does not leak into a game that is not a campaign', () => {
    const s = state({ is_campaign: false, campaign_carry: { revolutionary_spirit: 10 } });
    expect(getPlayerReinforceBonus(s, 'human')).toBe(0);
  });

  it('is the human seat\'s, not the AI\'s', () => {
    // Rome carries a faction reinforce passive of its own, so compare the
    // seat against itself rather than against zero.
    const withCarry = getPlayerReinforceBonus(state({ campaign_carry: { revolutionary_spirit: 10 } }), 'ai');
    const without = getPlayerReinforceBonus(state(), 'ai');
    expect(withCarry).toBe(without);
  });
});
