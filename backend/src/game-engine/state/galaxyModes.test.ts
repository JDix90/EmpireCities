/**
 * Galactic Age board modes — Colonies at two and three seats.
 *
 * The cases that matter:
 *   • four seats keep the classic start, untouched: no mode, no extra lane;
 *   • below four, every seat still opens on its faction's whole home world, and
 *     the worlds nobody calls home open neutral and garrisoned — whichever
 *     worlds those are (neighbours or across the ring);
 *   • a Vault region keeps its authored garrison, on a colony or a home world;
 *   • three seats bridge the ring's two gaps for the whole game, with the lanes a
 *     Lane Surge would open, so the surge card leaves the deck;
 *   • without home worlds (factions off) there are no colonies at any count.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { EventCard, GameMap, GameSettings, GameState } from '../../types';
import { advanceToNextPlayer, initializeGameState } from './gameStateManager';
import {
  COLONY_GARRISONS,
  colonyLayout,
  factionReinforceBonus,
  resolveGalaxyHomeWorlds,
  syncGalaxyModeLanes,
} from './galaxyModes';
import { getPlayerReinforceBonus } from './techManager';
import { getFactionById } from '../eras';
import { GALAXY_MODE_LANE_SOURCE, neighbouringWorlds, ringGapLanes } from './galaxyRing';
import { applyLaneSurge, laneSurgeHasGap } from './laneWeather';
import { orbitLaneId } from './moonAccess';

// Every deck the round's draw is offered, so a test can see what was in it
// without depending on which card the CSPRNG picks.
const drawn = vi.hoisted(() => ({ decks: [] as EventCard[][] }));
vi.mock('../events/eventCardManager', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../events/eventCardManager')>();
  return {
    ...actual,
    drawRandomCard: (deck: EventCard[]) => {
      drawn.decks.push(deck);
      return undefined;
    },
  };
});

const AUTHORED = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_galaxy.json'), 'utf-8'),
) as GameMap;

const HOME: Record<string, string> = {
  stellar_mandate: 'sol',
  forge_syndicate: 'rust',
  helion_navigators: 'verdan',
  void_custodians: 'nexus_station',
};
const VAULT_RING = ['nexus_basin_mandate', 'nexus_echo_concourse', 'nexus_gate_threshold', 'nexus_harmonic_rim'];

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

function galaxyGame(
  factions: string[],
  overrides: Partial<GameSettings> = {},
): { state: GameState; map: GameMap } {
  const map = JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
  const players = factions.map((faction_id, i) => ({
    player_id: `p_${faction_id}`, player_index: i, username: faction_id, color: '#fff',
    is_ai: false, is_eliminated: false, mmr: 1000, faction_id,
  }));
  const state = initializeGameState('t_modes', 'galaxy_age', map, players as never, settings(overrides), {
    forceStartingPlayerIndex: 0,
  });
  return { state, map };
}

function tilesOn(state: GameState, world: string) {
  return Object.values(state.territories).filter((t) => t.world_id === world);
}

function gatewayIds(map: GameMap): Set<string> {
  const ids = new Set<string>();
  for (const c of map.connections) {
    if (c.type !== 'orbit' || c.source) continue;
    ids.add(c.from);
    ids.add(c.to);
  }
  return ids;
}

/** Every colony tile neutral at its garrison: gateway, interior, or the Vault ring's own. */
function expectColony(state: GameState, map: GameMap, world: string): void {
  const gateways = gatewayIds(map);
  const tiles = tilesOn(state, world);
  expect(tiles).toHaveLength(16);
  for (const t of tiles) {
    expect(t.owner_id).toBeNull();
    const expected = VAULT_RING.includes(t.territory_id)
      ? 6
      : gateways.has(t.territory_id) ? COLONY_GARRISONS.gateway : COLONY_GARRISONS.interior;
    expect(t.unit_count, t.territory_id).toBe(expected);
  }
}

function modeLanes(map: GameMap) {
  return map.connections.filter((c) => c.source === GALAXY_MODE_LANE_SOURCE);
}

describe('four seats', () => {
  it('keep the classic start: every world a home world, no mode, no extra lane', () => {
    const { state, map } = galaxyGame(['stellar_mandate', 'forge_syndicate', 'helion_navigators', 'void_custodians']);
    expect(state.galaxy_mode).toBeUndefined();
    expect(modeLanes(map)).toHaveLength(0);
    for (const p of state.players) {
      const world = HOME[p.faction_id!];
      const owned = Object.values(state.territories).filter((t) => t.owner_id === p.player_id);
      expect(owned.every((t) => t.world_id === world)).toBe(true);
    }
    // The Custodians hold all of Nexus but the Vault ring, as before.
    expect(state.players[3].territory_count).toBe(12);
  });
});

describe('Colonies at two seats', () => {
  it('opens the two worlds nobody calls home as neutral colonies — across the ring', () => {
    const { state, map } = galaxyGame(['stellar_mandate', 'forge_syndicate']);
    expect(state.galaxy_mode).toEqual({ id: 'colonies', neutral_worlds: ['nexus_station', 'verdan'] });
    // Sol and Rust face each other across the ring: both colonies lie between.
    expect(neighbouringWorlds(map).has('rust::sol')).toBe(false);
    for (const p of state.players) {
      const home = tilesOn(state, HOME[p.faction_id!]);
      expect(home.every((t) => t.owner_id === p.player_id && t.unit_count === 3)).toBe(true);
      expect(p.territory_count).toBe(16);
    }
    expectColony(state, map, 'verdan');
    expectColony(state, map, 'nexus_station');
    // Two seats bridge nothing: the gaps stay for a Lane Surge to open.
    expect(modeLanes(map)).toHaveLength(0);
    expect(laneSurgeHasGap(map)).toBe(true);
  });

  it('works for neighbours too: each home world gets a colony behind it', () => {
    const { state, map } = galaxyGame(['helion_navigators', 'stellar_mandate']);
    expect(state.galaxy_mode?.neutral_worlds).toEqual(['nexus_station', 'rust']);
    expect(neighbouringWorlds(map).has('sol::verdan')).toBe(true);
    expectColony(state, map, 'rust');
    expectColony(state, map, 'nexus_station');
  });

  it('leaves a seated Custodian their Vault ring to take, and pays them for it as on four seats', () => {
    const { state, map } = galaxyGame(['void_custodians', 'forge_syndicate']);
    expect(state.galaxy_mode?.neutral_worlds).toEqual(['sol', 'verdan']);
    const nexus = tilesOn(state, 'nexus_station');
    for (const t of nexus) {
      if (VAULT_RING.includes(t.territory_id)) {
        expect(t.owner_id).toBeNull();
        expect(t.unit_count).toBe(6);
      } else {
        expect(t.owner_id).toBe('p_void_custodians');
        expect(t.unit_count).toBe(4); // initial 3 + the Vault's home bonus
      }
    }
    expectColony(state, map, 'sol');
  });
});

describe('Colonies at three seats', () => {
  it('opens the fourth world as a colony and bridges both gaps in the ring for good', () => {
    const { state, map } = galaxyGame(['stellar_mandate', 'forge_syndicate', 'helion_navigators']);
    expectColony(state, map, 'nexus_station');
    const gaps = ringGapLanes(map);
    expect(gaps.map((l) => orbitLaneId(l.from, l.to)).sort()).toEqual([
      orbitLaneId('nexus_antenna_spire', 'verdan_chlorophage_span'),
      orbitLaneId('rust_anvil_basin', 'sol_amazonia'),
    ].sort());
    expect(state.galaxy_mode).toEqual({ id: 'colonies', neutral_worlds: ['nexus_station'], lanes: gaps });
    // Projected onto the map copy as orbit lanes, and idempotent from there.
    const lanes = modeLanes(map);
    expect(lanes.map((c) => orbitLaneId(c.from, c.to)).sort()).toEqual(gaps.map((l) => orbitLaneId(l.from, l.to)).sort());
    expect(lanes.every((c) => c.type === 'orbit')).toBe(true);
    expect(syncGalaxyModeLanes(map, state)).toBe(false);
  });

  it('lets every home world reach every other and the colony', () => {
    const { map } = galaxyGame(['stellar_mandate', 'forge_syndicate', 'void_custodians']);
    const byId = new Map(map.territories.map((t) => [t.territory_id, t.world_id]));
    const joined = new Set<string>();
    for (const c of map.connections) {
      if (c.type !== 'orbit') continue;
      const [a, b] = [byId.get(c.from)!, byId.get(c.to)!].sort();
      if (a !== b) joined.add(`${a}::${b}`);
    }
    // Four worlds, six pairs: the ring's four plus the two bridges.
    expect(joined.size).toBe(6);
  });

  it('leaves a Lane Surge nothing to open, so the round\'s draw drops the card', () => {
    const { state, map } = galaxyGame(['stellar_mandate', 'forge_syndicate', 'helion_navigators'], {
      events_enabled: true,
    });
    expect(laneSurgeHasGap(map)).toBe(false);
    expect(applyLaneSurge(state, map)).toEqual({});
    drawn.decks.length = 0;
    state.current_player_index = state.players.length - 1;
    advanceToNextPlayer(state, map); // wraps the round: the draw happens here
    expect(drawn.decks).toHaveLength(1);
    const deck = drawn.decks[0]!;
    expect(deck.length).toBeGreaterThan(0);
    expect(deck.some((c) => c.effect?.type === 'lane_surge')).toBe(false);
    expect(deck.some((c) => c.effect?.type === 'lane_closure')).toBe(true);
  });

  it('keeps the card in every deck that still has a gap to bridge', () => {
    for (const factions of [
      ['stellar_mandate', 'forge_syndicate'],
      ['stellar_mandate', 'forge_syndicate', 'helion_navigators', 'void_custodians'],
    ]) {
      const { state, map } = galaxyGame(factions, { events_enabled: true });
      drawn.decks.length = 0;
      state.current_player_index = state.players.length - 1;
      advanceToNextPlayer(state, map);
      expect(drawn.decks[0]!.some((c) => c.effect?.type === 'lane_surge')).toBe(true);
    }
  });

  it('regains its bridges on a map copy rebuilt from the authored file', () => {
    const { state } = galaxyGame(['stellar_mandate', 'forge_syndicate', 'helion_navigators']);
    const rebuilt = JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
    const before = rebuilt.connections;
    expect(syncGalaxyModeLanes(rebuilt, state)).toBe(true);
    // Replaced, not mutated: adjacency caches key on the array's identity.
    expect(rebuilt.connections).not.toBe(before);
    expect(modeLanes(rebuilt)).toHaveLength(2);
  });
});

describe('when there are no colonies', () => {
  it('deals the whole galaxy round-robin without home worlds, at any seat count', () => {
    const { state, map } = galaxyGame(['stellar_mandate', 'forge_syndicate'], { factions_enabled: false });
    expect(state.galaxy_mode).toBeUndefined();
    expect(modeLanes(map)).toHaveLength(0);
    // Everything but the Vault ring is dealt: 60 tiles, 30 each.
    expect(state.players.map((p) => p.territory_count)).toEqual([30, 30]);
  });

  it('only resolves home worlds for the Galactic Age on its galaxy board, at two to four seats', () => {
    const seat = (faction_id: string | null) => ({ faction_id });
    const two = [seat('stellar_mandate'), seat('forge_syndicate')];
    expect(resolveGalaxyHomeWorlds('galaxy_age', AUTHORED, two)).toEqual(['sol', 'rust']);
    expect(resolveGalaxyHomeWorlds('space_age', AUTHORED, two)).toBeNull();
    expect(resolveGalaxyHomeWorlds('galaxy_age', { ...AUTHORED, map_kind: undefined } as GameMap, two)).toBeNull();
    expect(resolveGalaxyHomeWorlds('galaxy_age', AUTHORED, [seat('stellar_mandate')])).toBeNull();
    expect(resolveGalaxyHomeWorlds('galaxy_age', AUTHORED, [...two, seat('helion_navigators'), seat('void_custodians'), seat('stellar_mandate')])).toBeNull();
    expect(resolveGalaxyHomeWorlds('galaxy_age', AUTHORED, [seat('stellar_mandate'), seat(null)])).toBeNull();
    expect(resolveGalaxyHomeWorlds('galaxy_age', AUTHORED, [seat('stellar_mandate'), seat('stellar_mandate')])).toBeNull();
  });

  it('has no layout for four home worlds', () => {
    expect(colonyLayout(AUTHORED, ['sol', 'rust', 'verdan', 'nexus_station'])).toBeNull();
  });
});

describe("the Navigators' duel bonus", () => {
  // Their +2 was set at four seats, where the second point pays for Sol's
  // Cradle; in a two-player Colonies game it made them the strongest duellist.
  it('drafts +1 in a two-player Colonies game, from the opening draft on', () => {
    const { state } = galaxyGame(['helion_navigators', 'stellar_mandate']);
    expect(getPlayerReinforceBonus(state, 'p_helion_navigators')).toBe(1);
    // Seat 0 opens: 16 tiles (5) + Verdan's regions (14, a third at two seats: 4) + the bonus.
    expect(state.draft_units_remaining).toBe(5 + 4 + 1);
  });

  it('keeps +2 at three and four seats, and every other kit keeps its own', () => {
    for (const factions of [
      ['helion_navigators', 'stellar_mandate', 'forge_syndicate'],
      ['helion_navigators', 'stellar_mandate', 'forge_syndicate', 'void_custodians'],
    ]) {
      const { state } = galaxyGame(factions);
      expect(getPlayerReinforceBonus(state, 'p_helion_navigators')).toBe(2);
    }
    const duel = galaxyGame(['forge_syndicate', 'void_custodians']).state;
    expect(getPlayerReinforceBonus(duel, 'p_forge_syndicate')).toBe(2);
    expect(getPlayerReinforceBonus(duel, 'p_void_custodians')).toBe(0);
  });

  it('reads the kit anywhere but the Colonies board', () => {
    const navigators = getFactionById('galaxy_age', 'helion_navigators')!;
    const noMode = { players: [{}, {}], galaxy_mode: undefined } as unknown as GameState;
    expect(factionReinforceBonus(noMode, navigators)).toBe(2);
    const colonies = { players: [{}, {}], galaxy_mode: { id: 'colonies', neutral_worlds: [] } } as unknown as GameState;
    expect(factionReinforceBonus(colonies, navigators)).toBe(1);
    expect(factionReinforceBonus(colonies, { reinforce_bonus: 3 })).toBe(3);
  });
});

