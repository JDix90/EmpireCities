import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap, GameState } from '../../types';
import { advanceToNextPlayer, checkVictory, initializeGameState } from '../state/gameStateManager';
import { applyAuthoredScenario } from '../scenarios/applyAuthoredScenario';
import { applyTutorialModuleBoost } from './applyTutorialModuleBoost';
import {
  GALAXY_CAPITAL_HUMAN_CAPITAL,
  GALAXY_CAPITAL_RIVAL_CAPITAL,
  GALAXY_CAPITAL_SCENARIO,
  GALAXY_CAPITAL_WINNING_LANE,
} from './galaxyCapitalScenario';
import { galaxyTutorialGameSpec } from './galaxyTutorialGames';
import { authoredOrbitLanes } from '../victory/laneSovereignty';
import { orbitGatewayTerritoryIds } from '../state/moonAccess';
import { alternativeVictoriesLive } from '../victory/openingRound';
import { getFactionById } from '../eras';

/**
 * The lesson tells the player which two systems are the capitals, and the
 * engine, not the scenario, decides that. These tests build the game exactly
 * as `POST /games/tutorial/start` does and pin the capitals the deal fixes,
 * that both sit on gateways joined by the lane the cards name, and the turn
 * the win fires on — and that a lost capital blocks it.
 */
const AUTHORED = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_galaxy.json'), 'utf-8'),
) as GameMap;

const HUMAN = 'user_human';
const AI = 'ai_1';
const { from: SOURCE, to: TARGET } = GALAXY_CAPITAL_WINNING_LANE;

function lessonGame(): { state: GameState; map: GameMap } {
  const map = JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
  const spec = galaxyTutorialGameSpec('galaxy_capital');
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
  const state = initializeGameState('t_gcp', spec.eraId, map, players as never, spec.settings as never, {
    forceStartingPlayerIndex: 0,
  });
  applyAuthoredScenario(state, map, state.settings.authored_scenario, HUMAN, AI);
  applyTutorialModuleBoost(state);
  return { state, map };
}

const seat = (state: GameState, id: string) => state.players.find((p) => p.player_id === id)!;

describe('the Capital lesson board', () => {
  const board = GALAXY_CAPITAL_SCENARIO.starting_board ?? {};
  const ids = new Set(AUTHORED.territories.map((t) => t.territory_id));

  it('names only systems that exist, and seats the Mandate against the Navigators', () => {
    for (const id of Object.keys(board)) expect(ids.has(id), id).toBe(true);
    const spec = galaxyTutorialGameSpec('galaxy_capital');
    expect(spec.seats.map((s) => [s.faction_id, s.is_ai])).toEqual([
      ['stellar_mandate', false],
      ['helion_navigators', true],
    ]);
    expect(spec.settings.allowed_victory_conditions).toEqual(['domination', 'capital']);
  });

  it('gets the capitals the cards name from the deal, both on gateways, both with their seats', () => {
    const { state, map } = lessonGame();
    expect(seat(state, HUMAN).capital_territory_id).toBe(GALAXY_CAPITAL_HUMAN_CAPITAL);
    expect(seat(state, AI).capital_territory_id).toBe(GALAXY_CAPITAL_RIVAL_CAPITAL);
    expect(state.territories[GALAXY_CAPITAL_HUMAN_CAPITAL]?.owner_id).toBe(HUMAN);
    expect(state.territories[GALAXY_CAPITAL_RIVAL_CAPITAL]?.owner_id).toBe(AI);
    const gateways = orbitGatewayTerritoryIds(map);
    expect(gateways.has(GALAXY_CAPITAL_HUMAN_CAPITAL)).toBe(true);
    expect(gateways.has(GALAXY_CAPITAL_RIVAL_CAPITAL)).toBe(true);
    // The scenario never touches the capitals' assignment: it is the deal's.
    expect(board[GALAXY_CAPITAL_HUMAN_CAPITAL]).toBeUndefined();
  });

  it('puts the rival capital one lane crossing from a gateway the human holds, as a formality', () => {
    const { state, map } = lessonGame();
    expect(state.territories[SOURCE]?.owner_id).toBe(HUMAN);
    const authored = authoredOrbitLanes(map).some(
      (c) => (c.from === SOURCE && c.to === TARGET) || (c.from === TARGET && c.to === SOURCE),
    );
    expect(authored).toBe(true);
    // Two dice across a lane against a defender with no lane die (the
    // Navigators' kit has none): eight against two wins over a few rolls.
    expect(getFactionById('galaxy_age', 'helion_navigators')?.lane_defense_bonus ?? 0).toBe(0);
    expect(state.territories[SOURCE]!.unit_count - 1).toBeGreaterThanOrEqual(3 * state.territories[TARGET]!.unit_count);
  });

  it('wins by capital as round 2 opens once the rival capital is held, and not while its own is lost', () => {
    const { state, map } = lessonGame();
    expect(checkVictory(state, map)).toBeNull();

    state.territories[TARGET]!.owner_id = HUMAN;
    state.territories[TARGET]!.unit_count = 3;
    // Round 1 still: the capital reading waits for every seat to have had a turn.
    expect(alternativeVictoriesLive(state)).toBe(false);
    expect(checkVictory(state, map)).toBeNull();

    state.phase = 'fortify';
    advanceToNextPlayer(state, map); // the Navigators' turn
    expect(checkVictory(state, map)).toBeNull();
    state.phase = 'fortify';
    advanceToNextPlayer(state, map); // round 2 opens with the human
    expect(state.turn_number).toBe(2);
    expect(checkVictory(state, map)).toEqual({ winnerIds: [HUMAN], condition: 'capital' });

    // A lost capital blocks the win however many rival capitals are held.
    state.territories[GALAXY_CAPITAL_HUMAN_CAPITAL]!.owner_id = AI;
    expect(checkVictory(state, map)).toBeNull();
  });

  it('is unrated and plays for capitals', () => {
    const { state } = lessonGame();
    expect(state.settings.tutorial).toBe(true);
    expect(state.settings.tutorial_lesson_module).toBe('galaxy_capital');
  });
});
