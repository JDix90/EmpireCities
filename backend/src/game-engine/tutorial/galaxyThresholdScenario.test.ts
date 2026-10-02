import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap, GameState } from '../../types';
import { advanceToNextPlayer, checkVictory, initializeGameState } from '../state/gameStateManager';
import { applyAuthoredScenario } from '../scenarios/applyAuthoredScenario';
import { applyTutorialModuleBoost } from './applyTutorialModuleBoost';
import {
  GALAXY_THRESHOLD_LESSON_PERCENT,
  GALAXY_THRESHOLD_SCENARIO,
  GALAXY_THRESHOLD_WINNING_ATTACK,
} from './galaxyThresholdScenario';
import { galaxyTutorialGameSpec } from './galaxyTutorialGames';
import { ORBIT_GATED_DEFAULT_VICTORY_THRESHOLD } from '../../modules/games/createGameSettings';
import { alternativeVictoriesLive } from '../victory/openingRound';
import { getFactionById } from '../eras';

/**
 * The lesson tells the player the meter reads 38 of 39 and that one ground
 * capture wins. These tests build the game exactly as `POST /games/tutorial/start`
 * does and pin the count, the need (the engine's own `ceil`), the ground
 * adjacency the cards point at, the odds, and the turn the win fires on.
 */
const AUTHORED = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_galaxy.json'), 'utf-8'),
) as GameMap;

const HUMAN = 'user_human';
const AI = 'ai_1';
const { from: SOURCE, to: TARGET } = GALAXY_THRESHOLD_WINNING_ATTACK;

function lessonGame(): { state: GameState; map: GameMap } {
  const map = JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
  const spec = galaxyTutorialGameSpec('galaxy_threshold');
  const players = spec.seats.map((seat, i) => ({
    player_id: seat.is_ai ? `ai_${i}` : HUMAN,
    player_index: i,
    username: seat.is_ai ? `AI ${i}` : 'Human',
    color: '#fff',
    is_ai: seat.is_ai,
    ai_difficulty: seat.ai_difficulty,
    is_eliminated: false,
    mmr: 1000,
    faction_id: seat.faction_id ?? undefined,
  }));
  const state = initializeGameState('t_gth', spec.eraId, map, players as never, spec.settings as never, {
    forceStartingPlayerIndex: 0,
  });
  applyAuthoredScenario(state, map, state.settings.authored_scenario, HUMAN, AI);
  applyTutorialModuleBoost(state);
  return { state, map };
}

const seat = (state: GameState, id: string) => state.players.find((p) => p.player_id === id)!;
const heldBy = (state: GameState, id: string | null) =>
  Object.values(state.territories).filter((t) => t.owner_id === id).length;

describe('the Territory Threshold lesson board', () => {
  const board = GALAXY_THRESHOLD_SCENARIO.starting_board ?? {};
  const ids = new Set(AUTHORED.territories.map((t) => t.territory_id));

  it('names only systems that exist, and plays the galaxy default threshold with no capitals dealt', () => {
    for (const id of Object.keys(board)) expect(ids.has(id), id).toBe(true);
    const spec = galaxyTutorialGameSpec('galaxy_threshold');
    expect(spec.seats.map((s) => [s.faction_id, s.is_ai])).toEqual([
      ['stellar_mandate', false],
      ['helion_navigators', true],
    ]);
    expect(spec.settings.allowed_victory_conditions).toEqual(['domination', 'threshold']);
    // The lesson teaches the number a galaxy lobby opens with.
    expect(GALAXY_THRESHOLD_LESSON_PERCENT).toBe(ORBIT_GATED_DEFAULT_VICTORY_THRESHOLD);
    expect(spec.settings.victory_threshold).toBe(GALAXY_THRESHOLD_LESSON_PERCENT);
    const { state } = lessonGame();
    expect(seat(state, HUMAN).capital_territory_id ?? null).toBeNull();
  });

  it('opens one system short of the threshold, with the colonies counted in the denominator', () => {
    const { state } = lessonGame();
    const total = Object.keys(state.territories).length;
    expect(total).toBe(64);
    // The engine's own expression (checkVictory): integer ceil, not float maths.
    const need = Math.ceil((total * GALAXY_THRESHOLD_LESSON_PERCENT) / 100);
    expect(need).toBe(39);
    expect(seat(state, HUMAN).territory_count).toBe(need - 1);
    expect(heldBy(state, HUMAN)).toBe(need - 1);
    // Sol as dealt, Nexus Station whole, the six-system Verdan beachhead.
    const worldOf = new Map(AUTHORED.territories.map((t) => [t.territory_id, t.world_id]));
    const byWorld: Record<string, number> = {};
    for (const [id, t] of Object.entries(state.territories)) {
      if (t.owner_id === HUMAN) byWorld[worldOf.get(id)!] = (byWorld[worldOf.get(id)!] ?? 0) + 1;
    }
    expect(byWorld).toEqual({ sol: 16, nexus_station: 16, verdan: 6 });
    // The Rust Belt is a neutral colony — and still counts against the player.
    expect(state.galaxy_mode).toMatchObject({ id: 'colonies', neutral_worlds: ['nexus_station', 'rust'] });
    expect(heldBy(state, null)).toBe(16);
    for (const [id, t] of Object.entries(state.territories)) {
      if (worldOf.get(id) === 'rust') expect(t.owner_id, id).toBeNull();
    }
  });

  it('puts the 39th system one ground attack from a stacked beachhead, as a formality', () => {
    const { state, map } = lessonGame();
    expect(state.territories[SOURCE]?.owner_id).toBe(HUMAN);
    expect(state.territories[TARGET]?.owner_id).toBe(AI);
    const link = map.connections.find(
      (c) => (c.from === SOURCE && c.to === TARGET) || (c.from === TARGET && c.to === SOURCE),
    );
    // By ground, not across a lane: the full 3 attack dice, no lane cap.
    expect(link).toBeDefined();
    expect(link?.type).not.toBe('orbit');
    expect(getFactionById('galaxy_age', 'helion_navigators')?.defense_bonus ?? 0).toBe(0);
    expect(state.territories[SOURCE]!.unit_count - 1).toBeGreaterThanOrEqual(3 * state.territories[TARGET]!.unit_count);
    // The opening draft lands on top of that; the cards say to place it there.
    expect(state.draft_units_remaining).toBeGreaterThan(0);
  });

  it('wins by threshold as round 2 opens once the 39th system is held, and not before', () => {
    const { state, map } = lessonGame();
    expect(checkVictory(state, map)).toBeNull();

    state.territories[TARGET]!.owner_id = HUMAN;
    state.territories[TARGET]!.unit_count = 3;
    seat(state, HUMAN).territory_count += 1;
    seat(state, AI).territory_count -= 1;
    // Round 1 still: the threshold reading waits for every seat to have had a turn.
    expect(alternativeVictoriesLive(state)).toBe(false);
    expect(checkVictory(state, map)).toBeNull();

    state.phase = 'fortify';
    advanceToNextPlayer(state, map); // the Navigators' turn
    expect(checkVictory(state, map)).toBeNull();
    state.phase = 'fortify';
    advanceToNextPlayer(state, map); // round 2 opens with the human
    expect(state.turn_number).toBe(2);
    expect(checkVictory(state, map)).toEqual({ winnerIds: [HUMAN], condition: 'threshold' });
  });

  it('is unrated and plays for the threshold', () => {
    const { state } = lessonGame();
    expect(state.settings.tutorial).toBe(true);
    expect(state.settings.tutorial_lesson_module).toBe('galaxy_threshold');
  });
});
