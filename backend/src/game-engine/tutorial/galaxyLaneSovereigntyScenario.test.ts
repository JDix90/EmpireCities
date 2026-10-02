import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap, GameState } from '../../types';
import { advanceToNextPlayer, checkVictory, initializeGameState } from '../state/gameStateManager';
import { applyAuthoredScenario } from '../scenarios/applyAuthoredScenario';
import { applyTutorialModuleBoost } from './applyTutorialModuleBoost';
import {
  GALAXY_LANE_SOVEREIGNTY_SCENARIO,
  GALAXY_LANE_SOVEREIGNTY_WINNING_LANE,
} from './galaxyLaneSovereigntyScenario';
import { galaxyTutorialGameSpec } from './galaxyTutorialGames';
import { GALAXY_LANE_SOVEREIGNTY_GRANT_TECH_POINTS } from './tutorialGrants';
import {
  authoredOrbitLanes,
  corridorsNeededFor,
  countCorridors,
  roundsNeededFor,
} from '../victory/laneSovereignty';
import { laneStateFor } from '../state/moonAccess';
import { GALAXY_MODE_LANE_SOURCE } from '../state/galaxyRing';
import { GALAXY_AGE_TECH_TREE } from '../eras/galaxyage';
import { getFactionById } from '../eras';
import { alternativeVictoriesLive } from '../victory/openingRound';

/**
 * The lesson promises a specific position — four corridors held, a fifth one
 * capture away — and `applyAuthoredScenario` deliberately skips ids it cannot
 * find, so a renamed gateway would land a first-time player on a board whose
 * cards point at nothing, with nothing failing. These tests build the game
 * exactly as `POST /games/tutorial/start` does (the real map, the spec's seats
 * and settings, the Colonies deal, then the scenario and the grant) and pin
 * the position and the win that follow.
 */
const AUTHORED = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_galaxy.json'), 'utf-8'),
) as GameMap;

const HUMAN = 'user_human';
const { from: SOURCE, to: TARGET } = GALAXY_LANE_SOVEREIGNTY_WINNING_LANE;

function lessonGame(): { state: GameState; map: GameMap; aiIds: string[] } {
  const map = JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
  const spec = galaxyTutorialGameSpec('galaxy_lane_sovereignty');
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
  const state = initializeGameState('t_gls', spec.eraId, map, players as never, spec.settings as never, {
    forceStartingPlayerIndex: 0,
  });
  const aiIds = players.filter((p) => p.is_ai).map((p) => p.player_id);
  applyAuthoredScenario(state, map, state.settings.authored_scenario, HUMAN, aiIds[0] ?? null);
  applyTutorialModuleBoost(state);
  return { state, map, aiIds };
}

/** One full round: the human's hand-off and every AI seat's, back to the human. */
function playRound(state: GameState, map: GameMap): void {
  const seats = state.players.length;
  for (let i = 0; i < seats; i++) {
    state.phase = 'fortify';
    advanceToNextPlayer(state, map);
  }
  expect(state.players[state.current_player_index]?.player_id).toBe(HUMAN);
}

describe('the Lane Sovereignty lesson board', () => {
  const board = GALAXY_LANE_SOVEREIGNTY_SCENARIO.starting_board ?? {};
  const ids = new Set(AUTHORED.territories.map((t) => t.territory_id));

  it('names only systems that exist on the galaxy board', () => {
    for (const id of Object.keys(board)) expect(ids.has(id), id).toBe(true);
    expect(ids.has(SOURCE)).toBe(true);
    expect(ids.has(TARGET)).toBe(true);
  });

  it('deals the seats the scenario was written for: Navigators, then Custodians, then the Forge', () => {
    const spec = galaxyTutorialGameSpec('galaxy_lane_sovereignty');
    expect(spec.mapId).toBe('era_galaxy');
    expect(spec.eraId).toBe('galaxy_age');
    expect(spec.seats.map((s) => [s.faction_id, s.is_ai])).toEqual([
      ['helion_navigators', false],
      ['void_custodians', true],
      ['forge_syndicate', true],
    ]);
    // `owner: 'ai'` resolves to the FIRST AI seat, which must be the one whose
    // gateway the lesson's capture takes.
    expect(board[TARGET]?.owner).toBe('ai');
    for (const seat of spec.seats.filter((s) => s.is_ai)) expect(seat.ai_difficulty).toBe('tutorial');
  });

  it('opens on the Colonies board, Sol neutral and the ring gaps bridged', () => {
    const { state, map } = lessonGame();
    expect(state.players).toHaveLength(3);
    expect(state.galaxy_mode).toMatchObject({ id: 'colonies', neutral_worlds: ['sol'] });
    const bridges = map.connections.filter((c) => c.source === GALAXY_MODE_LANE_SOURCE);
    expect(bridges).toHaveLength(2);
    // Sol is a colony except for the two beachheads the scenario lands there.
    for (const t of Object.values(state.territories)) {
      if (t.world_id !== 'sol') continue;
      if (t.territory_id === 'sol_guinea' || t.territory_id === 'sol_pacific_rim') {
        expect(t.owner_id).toBe(HUMAN);
      } else {
        expect(t.owner_id, t.territory_id).toBeNull();
      }
    }
  });

  it('holds four corridors and needs the fifth, across the lane the cards name', () => {
    const { state, map } = lessonGame();
    expect(corridorsNeededFor(map)).toBe(5);
    expect(countCorridors(state, map, HUMAN)).toBe(4);
    // The winning lane is one of the eight charted lanes, and the human holds
    // its near end only.
    const lane = authoredOrbitLanes(map).find(
      (c) => (c.from === SOURCE && c.to === TARGET) || (c.from === TARGET && c.to === SOURCE),
    );
    expect(lane).toBeDefined();
    expect(laneStateFor(state, SOURCE, TARGET, HUMAN)).toBe('open');
    expect(state.territories[SOURCE]?.owner_id).toBe(HUMAN);
    expect(state.territories[TARGET]?.owner_id).toBe('ai_1');
    // And the four it holds are the lanes out of its home world: both Sol
    // ends and both Rust ends.
    const held = authoredOrbitLanes(map).filter(
      (c) => state.territories[c.from]?.owner_id === HUMAN && state.territories[c.to]?.owner_id === HUMAN,
    );
    expect(held.map((c) => [c.from, c.to].sort().join('|')).sort()).toEqual([
      'rust_anvil_basin|verdan_photic_crown',
      'rust_crucible_deep|verdan_sulphur_drift',
      'sol_guinea|verdan_chlorophage_span',
      'sol_pacific_rim|verdan_greenfire_vault',
    ]);
  });

  it('makes the capture a formality, not a roll', () => {
    const { state } = lessonGame();
    const attackers = state.territories[SOURCE]!.unit_count - 1; // one always stays behind
    const defenders = state.territories[TARGET]!.unit_count;
    // Lane attacks roll at most 3 dice (with Lane Charts), and the Custodians
    // defend a lane with an extra die; a four-to-one margin wins through that
    // in practice, with "Attack until captured" doing the pressing.
    expect(getFactionById('galaxy_age', 'void_custodians')?.lane_defense_bonus).toBe(1);
    expect(attackers).toBeGreaterThanOrEqual(4 * defenders);
    // The attack stack sits on Rust, out of Verdan's storms, and no Verdan tile
    // is stacked high enough for the storms to touch it before the lesson ends.
    expect(state.territories[SOURCE]!.world_id).toBe('rust');
    for (const t of Object.values(state.territories)) {
      if (t.world_id === 'verdan') expect(t.unit_count, t.territory_id).toBeLessThanOrEqual(12);
    }
  });

  it('grants exactly Lane Charts, the third die across a lane', () => {
    const { state } = lessonGame();
    const human = state.players.find((p) => p.player_id === HUMAN)!;
    const laneCharts = GALAXY_AGE_TECH_TREE.find((n) => n.tech_id === 'ga_hyperspace_chart')!;
    expect(laneCharts.tier).toBe(1);
    expect(human.tech_points).toBe(GALAXY_LANE_SOVEREIGNTY_GRANT_TECH_POINTS);
    expect(human.tech_points).toBe(laneCharts.cost);
    // Enough for Lane Charts; not enough for Lane Charts and anything else.
    const cheapestOther = Math.min(
      ...GALAXY_AGE_TECH_TREE.filter((n) => n.tech_id !== laneCharts.tech_id).map((n) => n.cost),
    );
    expect(human.tech_points!).toBeLessThan(laneCharts.cost + cheapestOther);
  });

  it('wins by Lane Sovereignty at the third turn start after the capture, and not before', () => {
    const { state, map } = lessonGame();
    expect(roundsNeededFor(state)).toBe(3);
    expect(state.turn_number).toBe(1);
    expect(checkVictory(state, map)).toBeNull();

    // The winning move, as the capture would leave the board.
    state.territories[TARGET]!.owner_id = HUMAN;
    state.territories[TARGET]!.unit_count = 3;
    expect(countCorridors(state, map, HUMAN)).toBe(5);
    // Still nothing: the streak is banked at the holder's own turn start.
    expect(checkVictory(state, map)).toBeNull();

    const human = () => state.players.find((p) => p.player_id === HUMAN)!;
    playRound(state, map);
    expect(state.turn_number).toBe(2);
    expect(alternativeVictoriesLive(state)).toBe(true);
    expect(human().lane_sovereignty_streak).toBe(1);
    expect(checkVictory(state, map)).toBeNull();

    playRound(state, map);
    expect(human().lane_sovereignty_streak).toBe(2);
    expect(checkVictory(state, map)).toBeNull();

    playRound(state, map);
    expect(human().lane_sovereignty_streak).toBe(3);
    expect(checkVictory(state, map)).toEqual({ winnerIds: [HUMAN], condition: 'lane_sovereignty' });
  });

  it('counts the charted lanes only — the colony bridge the capture also completes adds nothing', () => {
    const { state, map } = lessonGame();
    state.territories[TARGET]!.owner_id = HUMAN;
    // The three-seat bridge from Verdan to Nexus lands on the very gateway the
    // lesson takes, so the human now holds both of its ends too.
    const bridge = map.connections.find(
      (c) => c.source === GALAXY_MODE_LANE_SOURCE && [c.from, c.to].includes(TARGET),
    );
    expect(bridge).toBeDefined();
    expect(state.territories[bridge!.from]?.owner_id).toBe(HUMAN);
    expect(state.territories[bridge!.to]?.owner_id).toBe(HUMAN);
    expect(countCorridors(state, map, HUMAN)).toBe(5);
  });

  it('is unrated and plays for the galaxy\'s own win', () => {
    const { state } = lessonGame();
    expect(state.settings.tutorial).toBe(true);
    expect(state.settings.tutorial_lesson_module).toBe('galaxy_lane_sovereignty');
    expect(state.settings.allowed_victory_conditions).toContain('lane_sovereignty');
  });
});
