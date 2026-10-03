import { describe, it, expect } from 'vitest';
import type { GameMap, GameState } from '../../types';
import { computeAiTurn, SIEGE_BUILDING_BONUS, SIEGE_GROUND_BONUS } from './aiBot';
import { dailySiegeTarget } from '../daily/dailySiege';

/**
 * The siege posture of a daily build or research day (daily/dailySiege.ts):
 * the bot's job is to break the player before the goal lands, so every attack
 * on their ground scores higher, and one that would raze a building higher
 * still. Measured before it existed: the shipped bot never touched a defended
 * site on any such day, because nothing it was winning the game by was there.
 */

const AI = 'ai_1';
const HUMAN = 'p1';

/** One AI territory with a land border to two human tiles: a thin one and a built one. */
function frontMap(): GameMap {
  return {
    map_id: 'siege_fixture',
    name: 'Siege Fixture',
    territories: [
      { territory_id: 'fort', name: 'Fort', polygon: [], center_point: [0, 0], region_id: 'r' },
      { territory_id: 'field', name: 'Field', polygon: [], center_point: [0, 0], region_id: 'r' },
      { territory_id: 'works', name: 'Works', polygon: [], center_point: [0, 0], region_id: 'r' },
    ],
    connections: [
      { from: 'fort', to: 'field', type: 'land' },
      { from: 'fort', to: 'works', type: 'land' },
    ],
    regions: [{ region_id: 'r', name: 'R', bonus: 0 }],
  } as unknown as GameMap;
}

function frontState(opts: { aiUnits: number; daily?: boolean }): GameState {
  return {
    game_id: 'g',
    era: 'ancient',
    map_id: 'siege_fixture',
    phase: 'attack',
    turn_number: 3,
    current_player_index: 0,
    players: [
      { player_id: AI, player_index: 0, username: 'AI', color: '#000', is_ai: true, is_eliminated: false, territory_count: 1, cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000 },
      // territory_count 6: the front below is not the whole empire, and six keeps
      // the finisher bonus at zero so the test isolates the siege weights.
      { player_id: HUMAN, player_index: 1, username: 'P', color: '#fff', is_ai: false, is_eliminated: false, territory_count: 6, cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000 },
    ],
    territories: {
      fort: { territory_id: 'fort', owner_id: AI, unit_count: opts.aiUnits },
      // The field is the thinner target; the works holds the building.
      field: { territory_id: 'field', owner_id: HUMAN, unit_count: 10 },
      works: { territory_id: 'works', owner_id: HUMAN, unit_count: 12, buildings: ['production_1'] },
    },
    settings: {
      economy_enabled: true,
      ...(opts.daily ? { daily_challenge_spec: { archetype: 'economy_build', building_type: 'production_2', title: 't', intro: 'i', goal: 'g' } } : {}),
    },
    era_modifiers: {},
    diplomacy: [],
    card_deck: [],
    discard_pile: [],
  } as unknown as GameState;
}

const attacks = (plan: ReturnType<typeof computeAiTurn>) => plan.filter((a) => a.type === 'attack');

describe('dailySiegeTarget', () => {
  it('names the human seat on a build or research day, and nobody otherwise', () => {
    expect(dailySiegeTarget(frontState({ aiUnits: 6, daily: true }))).toEqual({ targetPlayerId: HUMAN });
    expect(dailySiegeTarget(frontState({ aiUnits: 6 }))).toBeUndefined();
    const capture = frontState({ aiUnits: 6, daily: true });
    (capture.settings as { daily_challenge_spec: { archetype: string } }).daily_challenge_spec.archetype = 'military_capture';
    expect(dailySiegeTarget(capture)).toBeUndefined();
  });
});

describe('the siege posture', () => {
  it('weights the ground, and the building above it', () => {
    expect(SIEGE_GROUND_BONUS).toBeGreaterThan(0);
    expect(SIEGE_BUILDING_BONUS).toBeGreaterThan(SIEGE_GROUND_BONUS);
  });

  it('attacks a front the unaided bot would leave alone', () => {
    // Seven against ten and twelve: P(capture) 0.19 and 0.11, well under the
    // third the plain planner (expert: no jitter) needs, so it plans nothing.
    // Under siege the ground bonus alone clears the threshold.
    const plain = computeAiTurn(frontState({ aiUnits: 7 }), frontMap(), 'expert', { captureOddsScoring: true, rng: () => 0 });
    expect(attacks(plain)).toHaveLength(0);
    const besieging = computeAiTurn(frontState({ aiUnits: 7 }), frontMap(), 'expert', {
      captureOddsScoring: true, rng: () => 0, siege: { targetPlayerId: HUMAN },
    });
    expect(attacks(besieging).length).toBeGreaterThan(0);
  });

  it('goes for the building before the thinner tile beside it', () => {
    // Fourteen: the thinner field is the better fight (P 0.79 against 0.66),
    // and the building bonus still puts the works first.
    const besieging = computeAiTurn(frontState({ aiUnits: 14 }), frontMap(), 'expert', {
      captureOddsScoring: true, rng: () => 0, siege: { targetPlayerId: HUMAN },
    });
    const planned = attacks(besieging);
    expect(planned.length).toBeGreaterThan(0);
    expect(planned[0].to).toBe('works');
  });
});
