/**
 * Jump Gates — the lanes players build.
 *
 * The cases that matter:
 *   • one gate per world per player, and a gate needs a world;
 *   • a pair on DIFFERENT worlds opens a lane, recorded at build time so it
 *     survives the capture of one end (the building is the lane, not the owner);
 *   • the lane dies with either building (an atom bomb clears buildings);
 *   • it carries no attack — `executeLandAttack` refuses it;
 *   • the Forge Syndicate builds them at half price, and Rust Belt's own halved
 *     build costs stack on top;
 *   • Lane Sovereignty ignores them (covered in victory/laneSovereignty.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap, GameSettings, GameState } from '../../types';
import { initializeGameState } from './gameStateManager';
import { applyBuild, validateBuild, resolveBuildCostFor } from './economyManager';
import { executeLandAttack } from '../combat/executeLandAttack';
import {
  JUMP_GATE_COST,
  isJumpGateOnlyEdge,
  jumpGateLaneConnections,
  jumpGatePartners,
  playerGateTerritoryIds,
  playerHasGateOnWorld,
  recordJumpGateLinks,
  syncJumpGateLanes,
} from './jumpGates';

const AUTHORED = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_galaxy.json'), 'utf-8'),
) as GameMap;

const FACTIONS = ['stellar_mandate', 'forge_syndicate', 'helion_navigators', 'void_custodians'] as const;
const SEAT = ['p_sol', 'p_rust', 'p_verdan', 'p_nexus'] as const;

function settings(overrides: Partial<GameSettings> = {}): GameSettings {
  return {
    fog_of_war: false, turn_timer_seconds: 0, initial_unit_count: 3, card_set_escalating: false,
    diplomacy_enabled: false, factions_enabled: true, naval_enabled: false, events_enabled: false,
    economy_enabled: true, tech_trees_enabled: true, stability_enabled: false,
    era_advancement_enabled: false, galaxy_corridors_enabled: true,
    allowed_victory_conditions: ['domination'], victory_type: 'domination', max_turns: 90,
    ...overrides,
  } as unknown as GameSettings;
}

function freshGalaxy(overrides: Partial<GameSettings> = {}): { state: GameState; map: GameMap } {
  const map = JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
  const players = SEAT.map((id, i) => ({
    player_id: id, player_index: i, username: id, color: '#fff',
    is_ai: false, is_eliminated: false, mmr: 1000, faction_id: FACTIONS[i],
  }));
  const state = initializeGameState('t_gate', 'galaxy_age', map, players as never, settings(overrides), {
    forceStartingPlayerIndex: 0,
  });
  for (const p of state.players) p.special_resource = 200;
  return { state, map };
}

/** Two tiles on different worlds, both held by `playerId` after this runs. */
function grant(state: GameState, playerId: string, ...territoryIds: string[]): void {
  for (const tid of territoryIds) state.territories[tid].owner_id = playerId;
}

const SOL = 'sol_columbia';
const RUST = 'rust_cinderworks';
const RUST2 = 'rust_oxide_flats';
const VERDAN = 'verdan_spore_reach';

describe('building a Jump Gate', () => {
  it('costs 12 production, and half that for the Forge Syndicate', () => {
    const { state } = freshGalaxy();
    expect(JUMP_GATE_COST).toBe(12);
    // Sol has no build-cost modifier, so the Mandate pays the list price.
    expect(resolveBuildCostFor(state, 'p_sol', 'sol', 'jump_gate', JUMP_GATE_COST)).toBe(12);
    // The Syndicate halves it; Rust Belt's own halved build costs stack.
    expect(resolveBuildCostFor(state, 'p_rust', 'sol', 'jump_gate', JUMP_GATE_COST)).toBe(6);
    expect(resolveBuildCostFor(state, 'p_rust', 'rust', 'jump_gate', JUMP_GATE_COST)).toBe(3);
    // Nobody else gets the discount, and it applies to gates only.
    expect(resolveBuildCostFor(state, 'p_nexus', 'sol', 'jump_gate', JUMP_GATE_COST)).toBe(12);
    expect(resolveBuildCostFor(state, 'p_rust', 'sol', 'production_1', 3)).toBe(3);
  });

  it('allows one per world per player', () => {
    const { state } = freshGalaxy();
    grant(state, 'p_rust', RUST, RUST2);
    expect(validateBuild(state, 'p_rust', RUST, 'jump_gate').valid).toBe(true);
    applyBuild(state, 'p_rust', RUST, 'jump_gate');
    expect(playerHasGateOnWorld(state, 'p_rust', 'rust')).toBe(true);
    const second = validateBuild(state, 'p_rust', RUST2, 'jump_gate');
    expect(second.valid).toBe(false);
    expect(second.error).toMatch(/already hold a Jump Gate on this world/);
  });

  it('refuses a territory with no world', () => {
    const { state } = freshGalaxy();
    state.territories[SOL].world_id = undefined;
    grant(state, 'p_sol', SOL);
    expect(validateBuild(state, 'p_sol', SOL, 'jump_gate').error).toMatch(/multi-world map/);
  });
});

describe('the lane a pair opens', () => {
  it('appears once the second gate is built, on a different world', () => {
    const { state, map } = freshGalaxy();
    grant(state, 'p_sol', SOL, RUST);

    applyBuild(state, 'p_sol', SOL, 'jump_gate');
    expect(state.jump_gate_links).toBeUndefined();
    expect(syncJumpGateLanes(map, state)).toBe(false);

    applyBuild(state, 'p_sol', RUST, 'jump_gate');
    expect(state.jump_gate_links).toEqual([{ a: RUST, b: SOL }]);
    expect(syncJumpGateLanes(map, state)).toBe(true);
    const lane = map.connections.find((c) => c.source === 'jump_gate')!;
    expect(lane.type).toBe('orbit');
    expect([lane.from, lane.to].sort()).toEqual([RUST, SOL].sort());
    expect(jumpGatePartners(state, SOL)).toEqual([RUST]);
    expect(playerGateTerritoryIds(state, 'p_sol')).toEqual([RUST, SOL].sort());
    // Idempotent.
    expect(syncJumpGateLanes(map, state)).toBe(false);
  });

  it('survives the capture of one end — the building is the lane, not the owner', () => {
    const { state, map } = freshGalaxy();
    grant(state, 'p_sol', SOL, RUST);
    applyBuild(state, 'p_sol', SOL, 'jump_gate');
    applyBuild(state, 'p_sol', RUST, 'jump_gate');
    syncJumpGateLanes(map, state);

    state.territories[RUST].owner_id = 'p_rust'; // the Syndicate takes it back
    expect(syncJumpGateLanes(map, state)).toBe(false);
    expect(jumpGateLaneConnections(state)).toHaveLength(1);
  });

  it('dies with either building, and takes its link with it', () => {
    const { state, map } = freshGalaxy();
    grant(state, 'p_sol', SOL, RUST);
    applyBuild(state, 'p_sol', SOL, 'jump_gate');
    applyBuild(state, 'p_sol', RUST, 'jump_gate');
    syncJumpGateLanes(map, state);

    state.territories[RUST].buildings = []; // an atom bomb clears buildings
    expect(syncJumpGateLanes(map, state)).toBe(true);
    expect(map.connections.some((c) => c.source === 'jump_gate')).toBe(false);
    expect(state.jump_gate_links).toBeUndefined();
  });

  it('never pairs two gates on the SAME world', () => {
    const { state } = freshGalaxy();
    grant(state, 'p_rust', RUST, RUST2);
    // Force past the one-per-world build rule to prove the pairing also refuses.
    state.territories[RUST].buildings = ['jump_gate'];
    state.territories[RUST2].buildings = ['jump_gate'];
    recordJumpGateLinks(state, 'p_rust', RUST2);
    expect(state.jump_gate_links).toBeUndefined();
  });

  it('pairs a third gate with both of the others', () => {
    const { state } = freshGalaxy();
    grant(state, 'p_sol', SOL, RUST, VERDAN);
    applyBuild(state, 'p_sol', SOL, 'jump_gate');
    applyBuild(state, 'p_sol', RUST, 'jump_gate');
    applyBuild(state, 'p_sol', VERDAN, 'jump_gate');
    expect(state.jump_gate_links).toHaveLength(3);
    expect(jumpGatePartners(state, VERDAN).sort()).toEqual([RUST, SOL].sort());
  });
});

describe('a gate lane carries no attack', () => {
  it('is refused by the resolver, while an authored lane is not', () => {
    const { state, map } = freshGalaxy();
    grant(state, 'p_sol', SOL, RUST);
    applyBuild(state, 'p_sol', SOL, 'jump_gate');
    applyBuild(state, 'p_sol', RUST, 'jump_gate');
    syncJumpGateLanes(map, state);
    expect(isJumpGateOnlyEdge(map, SOL, RUST)).toBe(true);

    // Hand the far end to a rival and arm the attack.
    state.territories[RUST].owner_id = 'p_rust';
    state.territories[SOL].unit_count = 20;
    state.territories[RUST].unit_count = 1;
    const gateLane = map.connections.find((c) => c.source === 'jump_gate')!;
    expect(executeLandAttack(state, 'p_sol', SOL, RUST, { connection: gateLane })).toBeNull();

    // The authored sol↔verdan lane still fights.
    const authored = map.connections.find(
      (c) => c.type === 'orbit' && !c.source && c.from === 'sol_guinea',
    )!;
    expect(isJumpGateOnlyEdge(map, authored.from, authored.to)).toBe(false);
    state.territories[authored.from].owner_id = 'p_sol';
    state.territories[authored.from].unit_count = 20;
    state.territories[authored.to].owner_id = 'p_verdan';
    state.territories[authored.to].unit_count = 1;
    expect(executeLandAttack(state, 'p_sol', authored.from, authored.to, { connection: authored })).not.toBeNull();
  });
});
