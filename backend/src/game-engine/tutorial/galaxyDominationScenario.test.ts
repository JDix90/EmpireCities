import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap, GameState } from '../../types';
import { checkVictory, initializeGameState, syncTerritoryCounts } from '../state/gameStateManager';
import { applyAuthoredScenario } from '../scenarios/applyAuthoredScenario';
import { applyTutorialModuleBoost } from './applyTutorialModuleBoost';
import { GALAXY_DOMINATION_SCENARIO, GALAXY_DOMINATION_WINNING_ATTACK } from './galaxyDominationScenario';
import { galaxyTutorialGameSpec } from './galaxyTutorialGames';
import { executeLandAttack } from '../combat/executeLandAttack';
import { eliminatePlayer } from '../state/elimination';
import { alternativeVictoriesLive } from '../victory/openingRound';
import { getFactionById } from '../eras';

/**
 * The lesson tells the player that taking the Navigators' last system ends
 * the game on the spot as Last Commander Standing, in round 1, and that a
 * galaxy result never reads Total Domination. These tests build the game
 * exactly as `POST /games/tutorial/start` does, run the capture through the
 * engine with fixed dice, and pin all three.
 */
const AUTHORED = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_galaxy.json'), 'utf-8'),
) as GameMap;

const HUMAN = 'user_human';
const AI = 'ai_1';
const { from: SOURCE, to: TARGET } = GALAXY_DOMINATION_WINNING_ATTACK;

function lessonGame(): { state: GameState; map: GameMap } {
  const map = JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
  const spec = galaxyTutorialGameSpec('galaxy_domination');
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
  const state = initializeGameState('t_gdm', spec.eraId, map, players as never, spec.settings as never, {
    forceStartingPlayerIndex: 0,
  });
  applyAuthoredScenario(state, map, state.settings.authored_scenario, HUMAN, AI);
  applyTutorialModuleBoost(state);
  return { state, map };
}

const seat = (state: GameState, id: string) => state.players.find((p) => p.player_id === id)!;
const heldBy = (state: GameState, id: string | null) =>
  Object.values(state.territories).filter((t) => t.owner_id === id).length;

/** Dice in the order the resolver draws them: the attacker's, then the defender's. */
function diceFrom(rolls: number[]): () => number {
  let i = 0;
  return () => rolls[Math.min(i++, rolls.length - 1)]!;
}

describe('the Domination lesson board', () => {
  const board = GALAXY_DOMINATION_SCENARIO.starting_board ?? {};
  const ids = new Set(AUTHORED.territories.map((t) => t.territory_id));

  it('names only systems that exist, and plays for Domination alone', () => {
    for (const id of Object.keys(board)) expect(ids.has(id), id).toBe(true);
    const spec = galaxyTutorialGameSpec('galaxy_domination');
    expect(spec.seats.map((s) => [s.faction_id, s.is_ai])).toEqual([
      ['stellar_mandate', false],
      ['helion_navigators', true],
    ]);
    expect(spec.settings.allowed_victory_conditions).toEqual(['domination']);
  });

  it('leaves the Navigators one system, the human the rest of their world, and the colonies neutral', () => {
    const { state } = lessonGame();
    expect(Object.keys(state.territories).length).toBe(64);
    expect(seat(state, AI).territory_count).toBe(1);
    expect(state.territories[TARGET]?.owner_id).toBe(AI);
    const worldOf = new Map(AUTHORED.territories.map((t) => [t.territory_id, t.world_id]));
    const byWorld: Record<string, number> = {};
    for (const [id, t] of Object.entries(state.territories)) {
      if (t.owner_id === HUMAN) byWorld[worldOf.get(id)!] = (byWorld[worldOf.get(id)!] ?? 0) + 1;
    }
    expect(byWorld).toEqual({ sol: 16, verdan: 15 });
    expect(seat(state, HUMAN).territory_count).toBe(31);
    // Thirty-two colony garrisons the lesson says never need taking.
    expect(state.galaxy_mode).toMatchObject({ id: 'colonies', neutral_worlds: ['nexus_station', 'rust'] });
    expect(heldBy(state, null)).toBe(32);
  });

  it('puts the last system one ground attack from a stacked neighbour, as a formality', () => {
    const { state, map } = lessonGame();
    expect(state.territories[SOURCE]?.owner_id).toBe(HUMAN);
    const link = map.connections.find(
      (c) => (c.from === SOURCE && c.to === TARGET) || (c.from === TARGET && c.to === SOURCE),
    );
    expect(link).toBeDefined();
    expect(link?.type).not.toBe('orbit');
    expect(getFactionById('galaxy_age', 'helion_navigators')?.defense_bonus ?? 0).toBe(0);
    expect(state.territories[SOURCE]!.unit_count - 1).toBeGreaterThanOrEqual(3 * state.territories[TARGET]!.unit_count);
    expect(state.draft_units_remaining).toBeGreaterThan(0);
  });

  it('ends the game on the capture, in round 1, as last standing — not domination', () => {
    const { state, map } = lessonGame();
    expect(checkVictory(state, map)).toBeNull();
    expect(alternativeVictoriesLive(state)).toBe(false);

    // Three attacker dice against two: 6-6-6 over 1-1 takes both defenders in one exchange.
    const out = executeLandAttack(state, HUMAN, SOURCE, TARGET, { dieRoll: diceFrom([6, 6, 6, 1, 1]) });
    expect(out?.captured).toBe(true);
    expect(out?.defenderEliminated).toBe(true);
    expect(seat(state, AI).is_eliminated).toBe(true);
    expect(seat(state, AI).eliminated_by).toBe(HUMAN);
    syncTerritoryCounts(state);
    expect(state.turn_number).toBe(1);
    expect(checkVictory(state, map)).toEqual({ winnerIds: [HUMAN], condition: 'last_standing' });
    // The colonies are still nobody's: Domination's own count was never met.
    expect(heldBy(state, null)).toBe(32);
    expect(seat(state, HUMAN).territory_count).toBeLessThan(64);
  });

  it('never records Total Domination with a rival in the game: a board held entire reads last standing too', () => {
    const { state, map } = lessonGame();
    for (const t of Object.values(state.territories)) {
      t.owner_id = HUMAN;
      t.unit_count = Math.max(1, t.unit_count);
    }
    syncTerritoryCounts(state);
    expect(seat(state, HUMAN).territory_count).toBe(64);
    // The engine eliminates a seat as its last system falls (executeLandAttack).
    eliminatePlayer(seat(state, AI), HUMAN);
    expect(checkVictory(state, map)).toEqual({ winnerIds: [HUMAN], condition: 'last_standing' });
  });

  it('is unrated and plays for domination', () => {
    const { state } = lessonGame();
    expect(state.settings.tutorial).toBe(true);
    expect(state.settings.tutorial_lesson_module).toBe('galaxy_domination');
  });
});
