import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap, GameState } from '../../types';
import { advanceToNextPlayer, checkVictory, initializeGameState } from '../state/gameStateManager';
import { applyAuthoredScenario } from '../scenarios/applyAuthoredScenario';
import { applyTutorialModuleBoost } from './applyTutorialModuleBoost';
import {
  GALAXY_TRANSCENDENCE_LAUNCH_PAD_SYSTEM,
  GALAXY_TRANSCENDENCE_RESEARCH_PATH,
  GALAXY_TRANSCENDENCE_SCENARIO,
} from './galaxyTranscendenceScenario';
import { galaxyTutorialGameSpec } from './galaxyTutorialGames';
import { GALAXY_TRANSCENDENCE_GRANT_GOLD, GALAXY_TRANSCENDENCE_GRANT_TECH_POINTS } from './tutorialGrants';
import { applyResearch, validateResearch } from '../state/techManager';
import { applyBuild, validateBuild } from '../state/economyManager';
import { getMoonAccessState, resolveOrbitAccessModeForPlayer } from '../state/moonAccess';
import { canAdvanceEra, executeAdvanceEra } from '../eraAdvancement/advanceEra';
import { getEffectiveMilestoneGate, getMaxEraIndex } from '../eraAdvancement/spines';
import { unlockTerritoriesForFloor } from '../eraAdvancement/territoryUnlock';
import { resolvePlayerEraId } from '../eraAdvancement/constants';
import { isBuildingTechUnlocked } from '../eraAdvancement/buildingHeritage';
import { getWonderForPlayer } from '../state/wonderManager';
import { alternativeVictoriesLive } from '../victory/openingRound';
import { GALAXY_AGE_WONDER } from '../eras/galaxyage';

/**
 * The lesson promises one specific climb — research, two Workshops, the
 * advance, the Hyperlane Anchor, the win — on a board whose deal places the
 * Pioneers' Launch Pad. These tests build the game exactly as
 * `POST /games/tutorial/start` does and then play that climb through the real
 * engine, so a change to the Space Age tree, the spine's gate, the advance
 * cost or the deal fails here rather than in a first session.
 */
const AUTHORED = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_ascension_galaxy.json'), 'utf-8'),
) as GameMap;

const HUMAN = 'user_human';
const AI = 'ai_1';

function lessonGame(): { state: GameState; map: GameMap } {
  const map = JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
  const spec = galaxyTutorialGameSpec('galaxy_transcendence');
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
  const state = initializeGameState('t_gtr', spec.eraId, map, players as never, spec.settings as never, {
    forceStartingPlayerIndex: 0,
  });
  applyAuthoredScenario(state, map, state.settings.authored_scenario, HUMAN, AI);
  applyTutorialModuleBoost(state);
  return { state, map };
}

const human = (state: GameState) => state.players.find((p) => p.player_id === HUMAN)!;

function research(state: GameState, techId: string): void {
  const check = validateResearch(state, HUMAN, techId);
  expect(check.valid, `${techId}: ${check.error ?? ''}`).toBe(true);
  applyResearch(state, HUMAN, check.node!);
}

function build(state: GameState, territoryId: string, building: 'production_1' | 'wonder_hyperlane_anchor'): void {
  const check = validateBuild(state, HUMAN, territoryId, building, isBuildingTechUnlocked(state, HUMAN, building));
  expect(check.valid, `${building} on ${territoryId}: ${check.error ?? ''}`).toBe(true);
  applyBuild(state, HUMAN, territoryId, building);
}

describe('the Transcendence lesson board', () => {
  const board = GALAXY_TRANSCENDENCE_SCENARIO.starting_board ?? {};
  const ids = new Set(AUTHORED.territories.map((t) => t.territory_id));

  it('names every Earth system and nothing else, so the opening never depends on the deal', () => {
    const earth = AUTHORED.territories.filter((t) => t.world_id === 'earth').map((t) => t.territory_id);
    expect(new Set(Object.keys(board))).toEqual(new Set(earth));
    for (const id of Object.keys(board)) expect(ids.has(id), id).toBe(true);
  });

  it('seats the Pioneers against the Federation on the Space to Stars board', () => {
    const spec = galaxyTutorialGameSpec('galaxy_transcendence');
    expect(spec.mapId).toBe('era_ascension_galaxy');
    expect(spec.eraId).toBe('space_age');
    expect(spec.seats.map((s) => [s.faction_id, s.is_ai])).toEqual([
      ['lunar_pioneers', false],
      ['terran_federation', true],
    ]);
    expect(spec.settings.era_advancement_spine_id).toBe('space_to_stars');
    expect(spec.settings.allowed_victory_conditions).toContain('transcendence');
  });

  it('opens on Earth and the Moon, with the far worlds off the board and the Moon neutral', () => {
    const { state, map } = lessonGame();
    expect(Object.keys(state.territories)).toHaveLength(63);
    for (const t of Object.values(state.territories)) {
      if (t.world_id === 'moon') {
        expect(t.owner_id).toBeNull();
        expect(t.unit_count).toBeGreaterThanOrEqual(4);
      }
    }
    expect(human(state).territory_count).toBe(6);
    expect(state.players.find((p) => p.player_id === AI)!.territory_count).toBe(48);
    expect(state.era_spine?.map((s) => s.era_id)).toEqual(['space_age', 'galaxy_age']);
    expect(getMaxEraIndex(state)).toBe(1);
    expect(map.territories.filter((t) => t.world_id !== 'earth' && t.world_id !== 'moon')).toHaveLength(48);
  });

  it('keeps the Pioneers\' Launch Pad where the deal placed it, with its lane, and nowhere else', () => {
    const { state, map } = lessonGame();
    const pads = Object.values(state.territories).filter((t) => t.buildings?.includes('launch_pad'));
    expect(pads.map((t) => [t.territory_id, t.owner_id])).toEqual([[GALAXY_TRANSCENDENCE_LAUNCH_PAD_SYSTEM, HUMAN]]);
    // The scenario must not have touched that tile's buildings: the deal's pad
    // is the one whose orbit lane init opened.
    expect(board[GALAXY_TRANSCENDENCE_LAUNCH_PAD_SYSTEM]?.buildings).toBeUndefined();
    const lane = map.connections.find((c) => c.source === 'launch_pad');
    expect(lane?.from).toBe(GALAXY_TRANSCENDENCE_LAUNCH_PAD_SYSTEM);
    expect(state.territories[lane!.to]?.world_id).toBe('moon');
  });

  it('gives the Pioneers the Space Program for free and everyone else the ladder', () => {
    const { state, map } = lessonGame();
    expect(getMoonAccessState(state, human(state)).allowed).toBe(true);
    expect(getMoonAccessState(state, state.players[1]!).allowed).toBe(false);
    expect(resolveOrbitAccessModeForPlayer(state, human(state), map, state.era)).toBe('space_age_moon');
  });

  it('grants what the cards say and no more', () => {
    const { state } = lessonGame();
    expect(human(state).tech_points).toBe(GALAXY_TRANSCENDENCE_GRANT_TECH_POINTS);
    expect(human(state).special_resource).toBe(GALAXY_TRANSCENDENCE_GRANT_GOLD);
    expect(getEffectiveMilestoneGate(state, HUMAN)).toEqual({
      min_tier1_techs: 2, min_tier2_techs: 2, min_tier3_techs: 1, min_buildings: 3,
    });
  });

  it('plays the climb the cards describe, and wins by Transcendence as round 2 opens', () => {
    const { state, map } = lessonGame();
    expect(canAdvanceEra(state, HUMAN).canAdvance).toBe(false);

    // Research, as the cards order it: Megacity Logistics first (the Workshop).
    for (const techId of GALAXY_TRANSCENDENCE_RESEARCH_PATH) research(state, techId);
    expect(human(state).tech_points).toBeGreaterThanOrEqual(0);

    // Two Workshops: with the Launch Pad, the gate's three buildings.
    build(state, 'oc_australia', 'production_1');
    build(state, 'oc_new_zealand', 'production_1');

    const gate = canAdvanceEra(state, HUMAN);
    expect(gate.canAdvance, gate.error ?? '').toBe(true);
    expect(gate.cost).toBeLessThanOrEqual(human(state).special_resource!);
    expect(executeAdvanceEra(state, HUMAN, map).success).toBe(true);

    // Arrival: the Galactic Age, the lineage faction, the far worlds for everyone.
    expect(resolvePlayerEraId(state, human(state))).toBe('galaxy_age');
    expect(human(state).faction_id).toBe('helion_navigators');
    expect(human(state).unlocked_techs).toEqual([]);
    expect(unlockTerritoriesForFloor(state, map)).toHaveLength(48);
    expect(resolveOrbitAccessModeForPlayer(state, human(state), map, state.era)).toBe('galaxy_hyperspace');
    expect(resolvePlayerEraId(state, state.players[1]!)).toBe('space_age');

    // The wonder on offer is now the Hyperlane Anchor, and it is affordable.
    expect(getWonderForPlayer(state, human(state))?.wonder_id).toBe(GALAXY_AGE_WONDER.wonder_id);
    expect(human(state).special_resource).toBeGreaterThanOrEqual(GALAXY_AGE_WONDER.cost);
    build(state, 'oc_australia', 'wonder_hyperlane_anchor');

    // Round 1 still: nothing fires until every seat has had a turn.
    expect(alternativeVictoriesLive(state)).toBe(false);
    expect(checkVictory(state, map)).toBeNull();
    state.phase = 'fortify';
    advanceToNextPlayer(state, map); // the AI's turn
    expect(checkVictory(state, map)).toBeNull();
    state.phase = 'fortify';
    advanceToNextPlayer(state, map); // back to the human: round 2
    expect(state.turn_number).toBe(2);
    expect(checkVictory(state, map)).toEqual({ winnerIds: [HUMAN], condition: 'transcendence' });
  });

  it('is unrated and plays for the climb\'s own win', () => {
    const { state } = lessonGame();
    expect(state.settings.tutorial).toBe(true);
    expect(state.settings.tutorial_lesson_module).toBe('galaxy_transcendence');
  });
});
