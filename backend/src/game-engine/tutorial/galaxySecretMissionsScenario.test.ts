import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap, GameState } from '../../types';
import { advanceToNextPlayer, checkVictory, initializeGameState } from '../state/gameStateManager';
import { applyAuthoredScenario } from '../scenarios/applyAuthoredScenario';
import { applyTutorialModuleBoost } from './applyTutorialModuleBoost';
import {
  GALAXY_SECRET_MISSIONS_HUMAN_MISSION,
  GALAXY_SECRET_MISSIONS_LANES,
  GALAXY_SECRET_MISSIONS_SCENARIO,
  GALAXY_SECRET_MISSIONS_TARGETS,
} from './galaxySecretMissionsScenario';
import { galaxyTutorialGameSpec } from './galaxyTutorialGames';
import { allianceTerritoryThreshold, isMissionComplete } from '../victory/missions';
import { authoredOrbitLanes } from '../victory/laneSovereignty';
import { territoryRequiresOrbitAccessForClaim } from '../state/moonAccess';
import { alternativeVictoriesLive } from '../victory/openingRound';

/**
 * The lesson promises a known mission — own the two Sol gateways across the
 * Sol–Verdan lanes — on a board whose dealer would otherwise draw one from a
 * per-game salt. These tests build the game exactly as the start route does
 * and pin the mission, the crossings, the galaxy's own mission rules the cards
 * state, and the turn the win fires on.
 */
const AUTHORED = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_galaxy.json'), 'utf-8'),
) as GameMap;

const HUMAN = 'user_human';
const AI = 'ai_1';

function lessonGame(): { state: GameState; map: GameMap } {
  const map = JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
  const spec = galaxyTutorialGameSpec('galaxy_secret_missions');
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
  const state = initializeGameState('t_gsm', spec.eraId, map, players as never, spec.settings as never, {
    forceStartingPlayerIndex: 0,
  });
  applyAuthoredScenario(state, map, state.settings.authored_scenario, HUMAN, AI);
  applyTutorialModuleBoost(state);
  return { state, map };
}

const human = (state: GameState) => state.players.find((p) => p.player_id === HUMAN)!;

describe('the Secret Missions lesson board', () => {
  const board = GALAXY_SECRET_MISSIONS_SCENARIO.starting_board ?? {};
  const ids = new Set(AUTHORED.territories.map((t) => t.territory_id));

  it('names only systems that exist, and seats the Navigators against the Mandate', () => {
    for (const id of Object.keys(board)) expect(ids.has(id), id).toBe(true);
    const spec = galaxyTutorialGameSpec('galaxy_secret_missions');
    expect(spec.seats.map((s) => [s.faction_id, s.is_ai])).toEqual([
      ['helion_navigators', false],
      ['stellar_mandate', true],
    ]);
    expect(spec.settings.allowed_victory_conditions).toEqual(['domination', 'secret_mission']);
  });

  it('deals the human the mission the cards read out, and the Mandate what the galaxy lets it draw', () => {
    const { state } = lessonGame();
    expect(human(state).secret_mission).toEqual(GALAXY_SECRET_MISSIONS_HUMAN_MISSION);
    // The dealer never names orbit-gated ground, and here every world but
    // Sol is gated: a seat holding all of Sol has nothing left to capture or
    // control and draws an eliminate mission, whatever the salt.
    expect(state.players.find((p) => p.player_id === AI)!.secret_mission).toEqual({
      kind: 'eliminate_player',
      target_player_id: HUMAN,
    });
  });

  it('is the one world a mission can name: every other world is behind a hyperspace gate', () => {
    const { map } = lessonGame();
    for (const t of map.territories) {
      expect(territoryRequiresOrbitAccessForClaim(map, t.territory_id), t.territory_id).toBe(t.world_id !== 'sol');
    }
    for (const id of GALAXY_SECRET_MISSIONS_TARGETS) expect(territoryRequiresOrbitAccessForClaim(map, id)).toBe(false);
  });

  it('puts both named systems one lane crossing from a gateway the human holds', () => {
    const { state, map } = lessonGame();
    for (const { from, to } of GALAXY_SECRET_MISSIONS_LANES) {
      expect(state.territories[from]?.owner_id).toBe(HUMAN);
      expect(state.territories[to]?.owner_id).toBe(AI);
      const authored = authoredOrbitLanes(map).some(
        (c) => (c.from === from && c.to === to) || (c.from === to && c.to === from),
      );
      expect(authored, `${from} → ${to}`).toBe(true);
      // Eight against two across a 2-die lane, with no lane defence die on
      // the Mandate: a formality over a few rolls, not a coin flip.
      expect(state.territories[from]!.unit_count - 1).toBeGreaterThanOrEqual(3 * state.territories[to]!.unit_count);
    }
    expect(GALAXY_SECRET_MISSIONS_LANES.map((l) => l.to).sort()).toEqual([...GALAXY_SECRET_MISSIONS_TARGETS].sort());
  });

  it('wins by secret mission as round 2 opens once both systems are held, and not before', () => {
    const { state, map } = lessonGame();
    expect(isMissionComplete(state, map, human(state))).toBe(false);
    expect(checkVictory(state, map)).toBeNull();

    state.territories.sol_guinea!.owner_id = HUMAN;
    expect(isMissionComplete(state, map, human(state))).toBe(false);
    state.territories.sol_pacific_rim!.owner_id = HUMAN;
    expect(isMissionComplete(state, map, human(state))).toBe(true);
    // Round 1 still: the mission waits for every seat to have had a turn.
    expect(alternativeVictoriesLive(state)).toBe(false);
    expect(checkVictory(state, map)).toBeNull();

    state.phase = 'fortify';
    advanceToNextPlayer(state, map); // the Mandate's turn
    expect(checkVictory(state, map)).toBeNull();
    state.phase = 'fortify';
    advanceToNextPlayer(state, map); // round 2 opens with the human
    expect(state.turn_number).toBe(2);
    expect(checkVictory(state, map)).toEqual({ winnerIds: [HUMAN], condition: 'secret_mission' });
  });

  it('states the alliance bar the engine uses on the four-seat galaxy board', () => {
    // The card says "21 each": an even share of the 64 dealt systems plus 7%.
    const state = {
      players: [0, 1, 2, 3].map((i) => ({ player_id: `p${i}`, is_eliminated: false })),
      territories: Object.fromEntries(AUTHORED.territories.map((t) => [t.territory_id, { owner_id: 'p0' }])),
    } as unknown as GameState;
    expect(allianceTerritoryThreshold(state)).toBe(21);
  });

  it('is unrated and plays for missions', () => {
    const { state } = lessonGame();
    expect(state.settings.tutorial).toBe(true);
    expect(state.settings.tutorial_lesson_module).toBe('galaxy_secret_missions');
  });
});
