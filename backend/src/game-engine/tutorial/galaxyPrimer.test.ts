import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap, GameState } from '../../types';
import { initializeGameState } from '../state/gameStateManager';
import { applyTutorialModuleBoost } from './applyTutorialModuleBoost';
import { galaxyTutorialGameSpec } from './galaxyTutorialGames';
import { GALAXY_THRESHOLD_LESSON_PERCENT } from './galaxyThresholdScenario';
import { ORBIT_GATED_DEFAULT_MAX_TURNS, ORBIT_GATED_DEFAULT_VICTORY_THRESHOLD } from '../../modules/games/createGameSettings';
import { COLONY_GARRISONS } from '../state/galaxyModes';
import { SCHISM_TUNING } from '../state/galaxySchism';
import { LANE_WEATHER_DURATION } from '../state/laneWeather';
import { JUMP_GATE_COST } from '../state/jumpGates';
import { GALAXY_LANE_BASE_ATTACK_DICE } from '../state/moonAccess';
import { authoredLanes } from '../state/galaxyRing';
import { vaultRegionGarrisons } from '../state/worldRules';
import { orbitGatewayTerritoryIds } from '../state/moonAccess';
import {
  LANE_SOVEREIGNTY_CORRIDORS_NEEDED,
  LANE_SOVEREIGNTY_ROUNDS,
  LANE_SOVEREIGNTY_ROUNDS_BY_SEATS,
  LANE_SOVEREIGNTY_ROUNDS_BY_SIDES,
} from '../victory/laneSovereignty';
import { getEraFactions, getFactionById } from '../eras';

/**
 * The primer is read on the classic four-seat board, and its cards quote
 * the engine's numbers. These tests build the game exactly as
 * `POST /games/tutorial/start` does and pin the board, then read the card
 * copy (the frontend's step list, as text) and pin every number on it to the
 * constant it came from, so a balance change fails here and not on a card.
 */
const AUTHORED = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_galaxy.json'), 'utf-8'),
) as GameMap;

const CARDS = readFileSync(
  join(__dirname, '../../../../frontend/src/tutorial/modules/galaxyPrimerSteps.ts'),
  'utf-8',
);

const HUMAN = 'user_human';

function lessonGame(): { state: GameState; map: GameMap } {
  const map = JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
  const spec = galaxyTutorialGameSpec('galaxy_primer');
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
  const state = initializeGameState('t_gpr', spec.eraId, map, players as never, spec.settings as never, {
    forceStartingPlayerIndex: 0,
  });
  applyTutorialModuleBoost(state);
  return { state, map };
}

describe('the Galactic Age primer board', () => {
  it('is the classic four-seat start, every faction on its whole home world, nothing authored', () => {
    const spec = galaxyTutorialGameSpec('galaxy_primer');
    expect(spec.seats.map((s) => s.faction_id)).toEqual([
      'stellar_mandate', 'helion_navigators', 'forge_syndicate', 'void_custodians',
    ]);
    expect(spec.settings.authored_scenario).toBeUndefined();
    const { state } = lessonGame();
    expect(state.galaxy_mode).toBeUndefined();
    expect(state.teams).toBeUndefined();
    const worldOf = new Map(AUTHORED.territories.map((t) => [t.territory_id, t.world_id]));
    // Nexus Station's Gate Ring is the Vault: it starts neutral, garrisoned,
    // held out of the Custodians' deal (worldRules.ts vaultRegionGarrisons).
    const vault = vaultRegionGarrisons(AUTHORED);
    expect(vault.size).toBe(4);
    for (const [id, garrison] of vault) {
      expect(state.territories[id]?.owner_id, id).toBeNull();
      expect(state.territories[id]?.unit_count, id).toBe(garrison);
      expect(garrison).toBe(6);
    }
    for (const p of state.players) {
      const worlds = new Set(
        Object.entries(state.territories).filter(([, t]) => t.owner_id === p.player_id).map(([id]) => worldOf.get(id)),
      );
      expect(p.territory_count, p.faction_id).toBe(p.faction_id === 'void_custodians' ? 16 - vault.size : 16);
      expect(worlds.size, p.faction_id).toBe(1);
    }
  });

  it('plays the galaxy lobby\'s own default victory list, so the Objectives panel has both meters', () => {
    const spec = galaxyTutorialGameSpec('galaxy_primer');
    expect(spec.settings.allowed_victory_conditions).toEqual(['domination', 'threshold', 'lane_sovereignty']);
    expect(spec.settings.victory_threshold).toBe(ORBIT_GATED_DEFAULT_VICTORY_THRESHOLD);
    expect(GALAXY_THRESHOLD_LESSON_PERCENT).toBe(ORBIT_GATED_DEFAULT_VICTORY_THRESHOLD);
    const { state } = lessonGame();
    expect(state.settings.tutorial).toBe(true);
    expect(state.settings.tutorial_lesson_module).toBe('galaxy_primer');
  });

  it('describes a board whose capitals would all fall on gateways, as the wins card says', () => {
    // A capital is the first of a seat's dealt systems by id (assignCapitals);
    // on the classic board a seat's deal is its whole world.
    const gateways = orbitGatewayTerritoryIds(AUTHORED);
    const firstByWorld = new Map<string, string>();
    for (const t of [...AUTHORED.territories].sort((a, b) => a.territory_id.localeCompare(b.territory_id))) {
      if (!firstByWorld.has(t.world_id!)) firstByWorld.set(t.world_id!, t.territory_id);
    }
    expect(firstByWorld.size).toBe(4);
    for (const [world, id] of firstByWorld) expect(gateways.has(id), `${world}: ${id}`).toBe(true);
    expect(CARDS).toContain('a gateway on every world');
  });

  it('quotes the engine\'s numbers on its cards', () => {
    expect(authoredLanes(AUTHORED).length).toBe(8);
    expect(AUTHORED.worlds?.length).toBe(4);
    expect(CARDS).toContain('**8 hyperspace lanes**');
    expect(GALAXY_LANE_BASE_ATTACK_DICE).toBe(2);
    expect(CARDS).toContain(`rolls only **${GALAXY_LANE_BASE_ATTACK_DICE} dice** (${GALAXY_LANE_BASE_ATTACK_DICE + 1} with **Lane Charts**)`);
    // Colonies.
    expect(CARDS).toContain(`${COLONY_GARRISONS.gateway} units on each gateway and ${COLONY_GARRISONS.interior} inland`);
    // The Schism.
    expect(CARDS).toContain(`a truce for the first ${SCHISM_TUNING.concordRounds} rounds`);
    expect(CARDS).toContain(`**Lane Crown**: +${SCHISM_TUNING.laneCrownBonus} units a turn`);
    // Lane weather, seals and gates.
    expect(LANE_WEATHER_DURATION).toBe(2);
    expect(CARDS).toContain('edit it for **two rounds**');
    expect(CARDS).toContain(`${JUMP_GATE_COST} production each`);
    expect(getFactionById('galaxy_age', 'forge_syndicate')?.jump_gate_cost_mult).toBe(0.5);
    expect(getFactionById('galaxy_age', 'void_custodians')?.lane_defense_bonus).toBe(1);
    expect(getFactionById('galaxy_age', 'helion_navigators')?.colony_reinforce_bonus?.[2]).toBe(1);
    // The wins.
    expect(CARDS).toContain(`hold ${LANE_SOVEREIGNTY_CORRIDORS_NEEDED} of the ${authoredLanes(AUTHORED).length} charted lanes`);
    expect(CARDS).toContain(`${LANE_SOVEREIGNTY_ROUNDS} turns running — ${LANE_SOVEREIGNTY_ROUNDS_BY_SEATS[2]} in a duel or a 2v2`);
    expect(LANE_SOVEREIGNTY_ROUNDS_BY_SIDES[2]).toBe(LANE_SOVEREIGNTY_ROUNDS_BY_SEATS[2]);
    const need = Math.ceil((AUTHORED.territories.length * ORBIT_GATED_DEFAULT_VICTORY_THRESHOLD) / 100);
    expect(CARDS).toContain(`${ORBIT_GATED_DEFAULT_VICTORY_THRESHOLD}% of ${AUTHORED.territories.length} is ${need}`);
    expect(CARDS).toContain(`${ORBIT_GATED_DEFAULT_MAX_TURNS}-turn limit`);
    // Every faction's ability, as the kit words it.
    for (const f of getEraFactions('galaxy_age')) {
      const [name, text] = f.ability_description!.split(': ');
      expect(CARDS, f.faction_id).toContain(`**${name}**`);
      expect(CARDS, f.faction_id).toContain(text!.replace(/\.$/, ''));
    }
  });
});
