import { describe, it, expect } from 'vitest';
import type { GameState, MapConnection, PlayerState } from '../../types';
import { computeLandCombatModifiers } from '../../game-engine/combat/combatModifiers';
import { getPlayerReinforceBonus } from '../../game-engine/state/techManager';
import {
  CAMPAIGN_PRESTIGE_DICE_MAX,
  CAMPAIGN_PRESTIGE_ROUNDS_MAX,
  CAMPAIGN_SPIRIT_REINFORCE_MAX,
  CAMPAIGN_SURVIVOR_DICE_MAX,
  campaignPrestigeDice,
  campaignPrestigeRounds,
  campaignRetryUnits,
  campaignStageLosses,
  CAMPAIGN_RETRY_UNITS_MAX,
  campaignSpiritReinforcements,
  campaignSurvivorDice,
} from '../../game-engine/campaign/carryLadder';
import { CAMPAIGN_PATH_LIST, allCampaignStages } from './campaignPaths';
import { initializeGameState } from '../../game-engine/state/gameStateManager';
import { normalizeGameSettings } from '../../game-engine/state/gameSettings';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameMap, GameSettings } from '../../types';

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
    expect(defenceCampaignBonus(state({ campaign_carry: { survivor_bonus: 2 } }), 'home')).toBe(1);
    expect(defenceCampaignBonus(state({ campaign_carry: { survivor_bonus: 4 } }), 'home')).toBe(2);
  });

  it('does nothing outside them, however much is banked', () => {
    expect(defenceCampaignBonus(state({ campaign_carry: { survivor_bonus: 8 } }), 'away')).toBe(0);
  });

  it(`stops at ${CAMPAIGN_SURVIVOR_DICE_MAX} dice however much is banked`, () => {
    expect(defenceCampaignBonus(state({ campaign_carry: { survivor_bonus: 8 } }), 'home'))
      .toBe(CAMPAIGN_SURVIVOR_DICE_MAX);
    expect(defenceCampaignBonus(state({ campaign_carry: { survivor_bonus: 80 } }), 'home'))
      .toBe(CAMPAIGN_SURVIVOR_DICE_MAX);
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
    expect(attackCampaignBonus(state({ campaign_prestige_bonus: 2 }, 1))).toBe(1);
    expect(attackCampaignBonus(state({ campaign_prestige_bonus: 6 }, 1))).toBe(2);
  });

  it(`stops at ${CAMPAIGN_PRESTIGE_DICE_MAX} dice however much is banked`, () => {
    expect(attackCampaignBonus(state({ campaign_prestige_bonus: 12 }, 1)))
      .toBe(CAMPAIGN_PRESTIGE_DICE_MAX);
  });

  it('runs out after its opening rounds, which are more the more is banked', () => {
    expect(attackCampaignBonus(state({ campaign_prestige_bonus: 2 }, 3))).toBe(1);
    expect(attackCampaignBonus(state({ campaign_prestige_bonus: 2 }, 4))).toBe(0);
    expect(attackCampaignBonus(state({ campaign_prestige_bonus: 10 }, CAMPAIGN_PRESTIGE_ROUNDS_MAX))).toBe(2);
    expect(attackCampaignBonus(state({ campaign_prestige_bonus: 10 }, CAMPAIGN_PRESTIGE_ROUNDS_MAX + 1))).toBe(0);
    expect(attackCampaignBonus(state({ campaign_prestige_bonus: 99 }, CAMPAIGN_PRESTIGE_ROUNDS_MAX + 1))).toBe(0);
  });

  it('does not leak into a game that is not a campaign', () => {
    expect(attackCampaignBonus(state({ is_campaign: false, campaign_prestige_bonus: 2 }, 1))).toBe(0);
  });
});

describe('Revolutionary Spirit (The Revolutionary Flame)', () => {
  it('pays a reinforcement from the second point banked, and another every four after', () => {
    expect(getPlayerReinforceBonus(state({ campaign_carry: { revolutionary_spirit: 1 } }), 'human')).toBe(0);
    expect(getPlayerReinforceBonus(state({ campaign_carry: { revolutionary_spirit: 2 } }), 'human')).toBe(1);
    expect(getPlayerReinforceBonus(state({ campaign_carry: { revolutionary_spirit: 6 } }), 'human')).toBe(2);
  });

  it(`stops at ${CAMPAIGN_SPIRIT_REINFORCE_MAX} however much is banked`, () => {
    expect(getPlayerReinforceBonus(state({ campaign_carry: { revolutionary_spirit: 10 } }), 'human'))
      .toBe(CAMPAIGN_SPIRIT_REINFORCE_MAX);
    expect(getPlayerReinforceBonus(state({ campaign_carry: { revolutionary_spirit: 100 } }), 'human'))
      .toBe(CAMPAIGN_SPIRIT_REINFORCE_MAX);
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

/**
 * A carry is a ladder: what a path's signature stat is worth going into each
 * of its six stages, for a campaign that has won every stage before it. The
 * flat caps these replaced were reached after one win, so winning an era
 * changed nothing in the next four.
 */
describe('the carry ladders across a path', () => {
  const worth = {
    prestige_bonus: (n: number) => campaignPrestigeDice(n) * 10 + campaignPrestigeRounds(n),
    survivor_bonus: (n: number) => campaignSurvivorDice(n),
    revolutionary_spirit: (n: number) => campaignSpiritReinforcements(n),
  };
  const caps = { prestige_bonus: Infinity, survivor_bonus: 8, revolutionary_spirit: 10 };

  for (const path of CAMPAIGN_PATH_LIST) {
    it(`${path.path_id}: never steps down, steps up at least twice, and ends at the top rung`, () => {
      const key = path.signature_carry_key;
      let banked = path.initial_carry[key] ?? 0;
      const rungs: number[] = [];
      for (let stage = 0; stage < path.eras.length; stage++) {
        rungs.push(worth[key](banked));
        banked = Math.min(caps[key], banked + (path.eras[stage]!.carry_on_win[key] ?? 0));
      }
      for (let i = 1; i < rungs.length; i++) expect(rungs[i]!).toBeGreaterThanOrEqual(rungs[i - 1]!);
      expect(new Set(rungs).size).toBeGreaterThanOrEqual(3);
      expect(rungs[rungs.length - 1]).toBe(worth[key](1_000));
      // A path that opens holding its carry opens on the bottom rung, not the top.
      if (rungs[0]! > 0) expect(rungs[0]).toBeLessThan(rungs[rungs.length - 1]!);
    });
  }

  it('pays every side of a path the same carry for a win', () => {
    const byStage = new Map<string, string>();
    for (const { path, index, stage } of allCampaignStages()) {
      const id = `${path.path_id}:${index}`;
      const paid = JSON.stringify(stage.carry_on_win);
      expect(byStage.get(id) ?? paid).toBe(paid);
      byStage.set(id, paid);
    }
  });

  it('is worth nothing with nothing banked, and reads a stored number that is not one as nothing', () => {
    for (const none of [0, -3, null, undefined, Number.NaN]) {
      expect(campaignPrestigeDice(none)).toBe(0);
      expect(campaignPrestigeRounds(none)).toBe(0);
      expect(campaignSurvivorDice(none)).toBe(0);
      expect(campaignSpiritReinforcements(none)).toBe(0);
    }
  });
});

describe('trying a stage again', () => {
  it('adds two starting units for each loss of the stage, to a ceiling', () => {
    expect([0, 1, 2, 3, 4, 40].map((n) => campaignRetryUnits(n))).toEqual([0, 2, 4, 6, 6, 6]);
    expect(campaignRetryUnits(null)).toBe(0);
    expect(campaignRetryUnits(3)).toBe(CAMPAIGN_RETRY_UNITS_MAX);
  });

  it('reads a stage\'s losses from the campaign\'s narrative, and no other stage\'s', () => {
    const narrative = { era_1_losses: '2', era_1_outcome: 'lost', era_2_losses: 'many' };
    expect(campaignStageLosses(narrative, 1)).toBe(2);
    expect(campaignStageLosses(narrative, 0)).toBe(0);
    expect(campaignStageLosses(narrative, 2)).toBe(0);
    expect(campaignStageLosses(null, 1)).toBe(0);
  });

  const map = JSON.parse(readFileSync(join(__dirname, '../../../../database/maps/era_ancient.json'), 'utf-8')) as GameMap;
  const deal = (settings: Record<string, unknown>) => {
    const players = ['rome', 'parthia', 'han'].map((faction_id, i) => ({
      player_id: i === 0 ? 'human' : `ai_${i}`, player_index: i, username: `P${i}`, color: '#3498db', is_ai: i > 0, is_eliminated: false, mmr: 1000, faction_id,
    }));
    const dealt = initializeGameState(
      'retry-deal', 'ancient', map, players as never,
      normalizeGameSettings({ factions_enabled: true, ...settings } as unknown as GameSettings),
      { forceStartingPlayerIndex: 0 },
    );
    const units = (id: string) => Object.values(dealt.territories).filter((t) => t.owner_id === id).reduce((n, t) => n + t.unit_count, 0);
    const held = (id: string) => Object.entries(dealt.territories).filter(([, t]) => t.owner_id === id).map(([tid, t]) => `${tid}:${t.unit_count}`);
    return { units, held };
  };

  it('opens the attempt with exactly those units more, on the player\'s thinnest ground, and nobody else\'s', () => {
    const plain = deal({ is_campaign: true });
    const again = deal({ is_campaign: true, campaign_retry_units: 4 });
    expect(again.units('human') - plain.units('human')).toBe(4);
    expect(again.units('ai_1')).toBe(plain.units('ai_1'));
    expect(again.units('ai_2')).toBe(plain.units('ai_2'));
    // The same territories: units are added, nothing is re-dealt.
    expect(again.held('human').map((h) => h.split(':')[0])).toEqual(plain.held('human').map((h) => h.split(':')[0]));
  });

  it('is a campaign stage\'s alone, and never more than the ceiling', () => {
    expect(deal({ campaign_retry_units: 4 }).units('human')).toBe(deal({}).units('human'));
    expect(normalizeGameSettings({ campaign_retry_units: 40 } as unknown as GameSettings).campaign_retry_units).toBe(CAMPAIGN_RETRY_UNITS_MAX);
    for (const bad of [0, -2, 1.5, '4', null]) {
      expect(normalizeGameSettings({ campaign_retry_units: bad } as unknown as GameSettings).campaign_retry_units).toBeUndefined();
    }
  });
});
