/**
 * Galactic Age Schism — two houses to a world: every world at eight seats, and
 * at five to seven (the Partial Schism) one world per seat over four.
 *
 * The cases that matter:
 *   • the authored halves partition the committed map: every world's tiles but
 *     the Vault ring, two connected halves of one size, two gateways each;
 *   • eight seats deal every faction exactly twice, keeping picks while a
 *     faction has a seat left, and nothing else changes how factions are dealt;
 *   • five to seven seats deal exactly one world per seat over four to two
 *     seats and every other world to one: picks stand where they fit, a world
 *     nobody picked splits before one a seat picked alone;
 *   • each house opens on its half and nothing else; a house alone on its world
 *     faces its other half unclaimed, neutral and garrisoned; an Allied side
 *     of one opens on its whole world as at four seats; the Vault ring stays
 *     neutral;
 *   • the Concord is an ordinary truce between each split world's two houses,
 *     for the rounds the game recorded, and Civil War opens none;
 *   • the Lane Crown pays only a house, for all four of its own world's gateways;
 *   • the Partial Schism's own numbers are recorded when the board is dealt,
 *     and drafted;
 *   • four seats, other eras and a scattered start deal no Schism.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { GameMap, GameSettings, GameState } from '../../types';
import { advanceToNextPlayer, initializeGameState } from './gameStateManager';
import {
  ALLIED_TUNING,
  dealSchismFactions,
  holdsLaneCrown,
  houseReinforceBonus,
  isSchismSeating,
  laneCrownBonus,
  normalizeHouseRelations,
  PARTIAL_SCHISM_HALVES,
  PARTIAL_SCHISM_TUNING,
  SCHISM_HALVES,
  SCHISM_TUNING,
  schismHalvesFor,
  schismHouseOf,
  schismLayout,
  schismOpeningBonus,
  schismRivalOf,
  schismSplitWorldCount,
  schismUnclaimedTiles,
  schismWholeWorldOf,
} from './galaxySchism';
import { gatewaysByWorld } from './galaxyRing';
import { activeTruceBetween } from './truces';
import { getPlayerReinforceBonus } from './techManager';
import { createSeededRng } from '../victory/missions';

const AUTHORED = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_galaxy.json'), 'utf-8'),
) as GameMap;

const FACTIONS = ['stellar_mandate', 'forge_syndicate', 'helion_navigators', 'void_custodians'];
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

function seats(factions: Array<string | null>) {
  return factions.map((faction_id, i) => ({
    player_id: `p${i}`, player_index: i, username: `P${i}`, color: '#fff',
    is_ai: false, is_eliminated: false, mmr: 1000, faction_id,
  }));
}

/** Eight seats, each faction twice (seat i and i + 4), halves by `forceHalves` when given. */
function schismGame(
  overrides: Partial<GameSettings> = {},
  forceHalves?: Record<string, 0 | 1>,
): { state: GameState; map: GameMap } {
  return startWith([...FACTIONS, ...FACTIONS], overrides, forceHalves);
}

/** A Galactic Age start with these picks in seat order, halves by `forceHalves` when given. */
function startWith(
  factions: Array<string | null>,
  overrides: Partial<GameSettings> = {},
  forceHalves?: Record<string, 0 | 1>,
): { state: GameState; map: GameMap } {
  const map = JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
  const state = initializeGameState('t_schism', 'galaxy_age', map, seats(factions) as never, settings(overrides), {
    forceStartingPlayerIndex: 0,
    ...(forceHalves ? { forceSchismHalves: forceHalves } : {}),
  });
  return { state, map };
}

/** Seats per faction, keyed and sorted by faction. */
function count(players: Array<{ faction_id?: string | null }>): Record<string, number> {
  const out = new Map<string, number>();
  for (const p of players) out.set(p.faction_id!, (out.get(p.faction_id!) ?? 0) + 1);
  return Object.fromEntries([...out.entries()].sort());
}

/** Five seats: the Mandate twice (p0 and p4), every other faction once. */
const FIVE = [...FACTIONS, 'stellar_mandate'];

/** Tiles on a lane: an unclaimed half's gateways, which open with the gateway garrison. */
const ON_LANE = new Set(AUTHORED.connections.filter((c) => c.type === 'orbit').flatMap((c) => [c.from, c.to]));

/** Put the Partial Schism's tables back after a test that patches them. */
function restorePartialTables(): () => void {
  const tuning = JSON.parse(JSON.stringify(PARTIAL_SCHISM_TUNING)) as typeof PARTIAL_SCHISM_TUNING;
  const halves = JSON.parse(JSON.stringify(PARTIAL_SCHISM_HALVES)) as typeof PARTIAL_SCHISM_HALVES;
  return () => {
    for (const n of Object.keys(tuning)) PARTIAL_SCHISM_TUNING[Number(n)] = JSON.parse(JSON.stringify(tuning[Number(n)]));
    for (const w of Object.keys(halves)) PARTIAL_SCHISM_HALVES[w] = JSON.parse(JSON.stringify(halves[w]));
  };
}

/** A seeded `randomInt(min, max)`, max exclusive. */
function seededInt(seed: number): (min: number, max: number) => number {
  const rng = createSeededRng(seed);
  return (min, max) => min + Math.floor(rng() * (max - min));
}

function owned(state: GameState, playerId: string): string[] {
  return Object.values(state.territories).filter((t) => t.owner_id === playerId).map((t) => t.territory_id).sort();
}

describe('the authored halves', () => {
  const byId = new Map(AUTHORED.territories.map((t) => [t.territory_id, t]));
  const adjacent = new Map<string, Set<string>>();
  for (const c of AUTHORED.connections) {
    if (c.type === 'orbit') continue;
    for (const [a, b] of [[c.from, c.to], [c.to, c.from]] as const) {
      if (!adjacent.has(a)) adjacent.set(a, new Set());
      adjacent.get(a)!.add(b);
    }
  }
  const connected = (tiles: readonly string[]): boolean => {
    const inHalf = new Set(tiles);
    const seen = new Set([tiles[0]!]);
    const queue = [tiles[0]!];
    while (queue.length) {
      for (const next of adjacent.get(queue.pop()!) ?? []) {
        if (inHalf.has(next) && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return seen.size === inHalf.size;
  };
  const gateways = gatewaysByWorld(AUTHORED);

  it.each(Object.keys(HOME).map((f) => [HOME[f]!]))('split %s into two connected halves of one size, two gateways each', (world) => {
    const [a, b] = SCHISM_HALVES[world]!;
    const worldTiles = AUTHORED.territories
      .filter((t) => t.world_id === world && !VAULT_RING.includes(t.territory_id))
      .map((t) => t.territory_id)
      .sort();
    expect([...a.tiles, ...b.tiles].sort()).toEqual(worldTiles);
    expect(a.tiles.length).toBe(b.tiles.length);
    for (const half of [a, b]) {
      expect(half.tiles.every((id) => byId.get(id)?.world_id === world)).toBe(true);
      expect(connected(half.tiles)).toBe(true);
      expect(half.tiles.filter((id) => gateways.get(world)!.includes(id))).toHaveLength(2);
    }
    expect(a.house).not.toBe(b.house);
  });

  it('are what the engine deals on the committed map', () => {
    expect(schismHalvesFor(AUTHORED)).toBe(SCHISM_HALVES);
  });

  it('are refused on a map they do not partition', () => {
    const missingTile = { ...AUTHORED, territories: AUTHORED.territories.filter((t) => t.territory_id !== 'sol_guinea') };
    expect(schismHalvesFor(missingTile)).toBeNull();
    const extraTile = {
      ...AUTHORED,
      territories: [...AUTHORED.territories, { ...byId.get('sol_guinea')!, territory_id: 'sol_new_tile' }],
    };
    expect(schismHalvesFor(extraTile)).toBeNull();
  });
});

describe('dealing factions at eight seats', () => {
  const twiceEach = Object.fromEntries([...FACTIONS].sort().map((f) => [f, 2]));

  it('deals every faction exactly twice when nobody picks', () => {
    const players = seats(Array(8).fill(null));
    expect(dealSchismFactions('galaxy_age', AUTHORED, players, seededInt(7))).toBe(true);
    expect(count(players)).toEqual(twiceEach);
  });

  it('keeps two picks of a faction and moves a third', () => {
    const players = seats(['void_custodians', 'void_custodians', 'void_custodians', 'forge_syndicate', null, null, null, null]);
    const rng = (min: number, max: number) => Math.min(max - 1, min); // always the first candidate
    expect(dealSchismFactions('galaxy_age', AUTHORED, players, rng)).toBe(true);
    expect(count(players)).toEqual(twiceEach);
    expect(players.filter((p) => p.faction_id === 'void_custodians')).toHaveLength(2);
    expect(players[3]!.faction_id).toBe('forge_syndicate');
  });

  it('treats a pick from another era as no pick', () => {
    const players = seats(['roman_legion', ...Array(7).fill(null)]);
    dealSchismFactions('galaxy_age', AUTHORED, players, seededInt(3));
    expect(count(players)).toEqual(twiceEach);
  });

  it('deals nothing at another seat count, era or board', () => {
    expect(dealSchismFactions('galaxy_age', AUTHORED, seats(Array(4).fill(null)))).toBe(false);
    expect(dealSchismFactions('galaxy_age', AUTHORED, seats(Array(9).fill(null)))).toBe(false);
    expect(dealSchismFactions('space_age', AUTHORED, seats(Array(8).fill(null)))).toBe(false);
    expect(dealSchismFactions('galaxy_age', { ...AUTHORED, map_kind: 'standard' }, seats(Array(8).fill(null)))).toBe(false);
    expect([5, 6, 7, 8].every((n) => isSchismSeating('galaxy_age', AUTHORED, n))).toBe(true);
    expect([2, 3, 4, 9].some((n) => isSchismSeating('galaxy_age', AUTHORED, n))).toBe(false);
  });
});

describe('dealing factions at five to seven seats', () => {
  /** Seats per faction, smallest first: one to each whole world, two to each split one. */
  const shape = (players: Array<{ faction_id?: string | null }>) => Object.values(count(players)).sort();

  it('splits one world per seat over four', () => {
    expect([4, 5, 6, 7, 8].map(schismSplitWorldCount)).toEqual([0, 1, 2, 3, 4]);
  });

  it.each([5, 6, 7])('at %i seats deals every faction, splitting the worlds it must, when nobody picks', (n) => {
    for (let seed = 1; seed <= 6; seed++) {
      const players = seats(Array(n).fill(null));
      expect(dealSchismFactions('galaxy_age', AUTHORED, players, seededInt(seed))).toBe(true);
      expect(Object.keys(count(players))).toEqual([...FACTIONS].sort());
      expect(shape(players)).toEqual([...Array(8 - n).fill(1), ...Array(n - 4).fill(2)]);
    }
  });

  it('draws which worlds split when the picks leave it open', () => {
    const split = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const players = seats(Array(5).fill(null));
      dealSchismFactions('galaxy_age', AUTHORED, players, seededInt(seed));
      for (const [factionId, n] of Object.entries(count(players))) if (n === 2) split.add(factionId);
    }
    expect([...split].sort()).toEqual([...FACTIONS].sort());
  });

  it('keeps picks that fit: two seats on a faction split its world', () => {
    const players = seats(['void_custodians', null, 'void_custodians', null, null]);
    expect(dealSchismFactions('galaxy_age', AUTHORED, players, seededInt(3))).toBe(true);
    expect(count(players)).toEqual({ forge_syndicate: 1, helion_navigators: 1, stellar_mandate: 1, void_custodians: 2 });
    expect([players[0]!.faction_id, players[2]!.faction_id]).toEqual(['void_custodians', 'void_custodians']);
  });

  it('leaves a full set of picks as it is', () => {
    const picks = ['stellar_mandate', 'forge_syndicate', 'forge_syndicate', 'helion_navigators', 'void_custodians', 'helion_navigators'];
    const players = seats(picks);
    expect(dealSchismFactions('galaxy_age', AUTHORED, players, seededInt(9))).toBe(true);
    expect(players.map((p) => p.faction_id)).toEqual(picks);
  });

  it('keeps two of three picks of a faction and deals the third a world nobody picked', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const players = seats(['void_custodians', 'void_custodians', 'void_custodians', null, null]);
      dealSchismFactions('galaxy_age', AUTHORED, players, seededInt(seed));
      expect(count(players)).toEqual({ forge_syndicate: 1, helion_navigators: 1, stellar_mandate: 1, void_custodians: 2 });
    }
  });

  it('breaks up the pairs the seats have no room for, drawing which stands, and deals the seat that gives way elsewhere', () => {
    // Five seats split one world, and two factions were picked twice.
    const stood = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const players = seats(['stellar_mandate', 'stellar_mandate', 'forge_syndicate', 'forge_syndicate', null]);
      dealSchismFactions('galaxy_age', AUTHORED, players, seededInt(seed));
      const dealt = count(players);
      expect([dealt.stellar_mandate, dealt.forge_syndicate].sort()).toEqual([1, 2]);
      expect([dealt.helion_navigators, dealt.void_custodians]).toEqual([1, 1]);
      // Each of them still holds a seat that picked it.
      expect([players[0]!.faction_id, players[1]!.faction_id]).toContain('stellar_mandate');
      expect([players[2]!.faction_id, players[3]!.faction_id]).toContain('forge_syndicate');
      expect(['helion_navigators', 'void_custodians']).toContain(players[4]!.faction_id);
      stood.add(dealt.stellar_mandate === 2 ? 'stellar_mandate' : 'forge_syndicate');
    }
    expect([...stood].sort()).toEqual(['forge_syndicate', 'stellar_mandate']);
  });

  it('splits worlds nobody picked before one a seat picked alone', () => {
    // Six seats split two worlds; one seat picked the Mandate.
    for (let seed = 1; seed <= 12; seed++) {
      const players = seats(['stellar_mandate', null, null, null, null, null]);
      dealSchismFactions('galaxy_age', AUTHORED, players, seededInt(seed));
      expect(players[0]!.faction_id).toBe('stellar_mandate');
      expect(count(players).stellar_mandate).toBe(1);
      expect(shape(players)).toEqual([1, 1, 2, 2]);
    }
  });

  it('splits a world picked alone when every world was picked, keeping every pick', () => {
    // Seven seats split three worlds, and each faction has one pick.
    for (let seed = 1; seed <= 6; seed++) {
      const players = seats([...FACTIONS, null, null, null]);
      dealSchismFactions('galaxy_age', AUTHORED, players, seededInt(seed));
      expect(players.slice(0, 4).map((p) => p.faction_id)).toEqual(FACTIONS);
      expect(shape(players)).toEqual([1, 2, 2, 2]);
    }
  });
});

describe('the Schism layout', () => {
  it('gives each world its two halves, one to each of its houses, in seat order', () => {
    const players = seats([...FACTIONS, ...FACTIONS]);
    const mode = schismLayout('galaxy_age', AUTHORED, players, 'concord')!;
    expect(mode.houses.map((h) => h.player_id)).toEqual(players.map((p) => p.player_id));
    for (let i = 0; i < 4; i++) {
      const [a, b] = [mode.houses[i]!, mode.houses[i + 4]!];
      expect(a.world_id).toBe(HOME[FACTIONS[i]!]);
      expect(b.world_id).toBe(a.world_id);
      expect(a.half + b.half).toBe(1);
      expect(a.name).toBe(SCHISM_HALVES[a.world_id]![a.half].house);
    }
  });

  it('follows forced halves, and a seeded draw deals the same halves every time', () => {
    const players = seats([...FACTIONS, ...FACTIONS]);
    const forced = schismLayout('galaxy_age', AUTHORED, players, 'concord', { forceHalves: { p0: 1, p1: 0 } })!;
    expect(forced.houses[0]!.half).toBe(1);
    expect(forced.houses[4]!.half).toBe(0);
    expect(forced.houses[1]!.half).toBe(0);
    const once = schismLayout('galaxy_age', AUTHORED, players, 'concord', { rng: seededInt(11) });
    const again = schismLayout('galaxy_age', AUTHORED, players, 'concord', { rng: seededInt(11) });
    expect(once).toEqual(again);
  });

  it('records the Concord and Crown numbers it was dealt with, and every world\'s four gateways', () => {
    const mode = schismLayout('galaxy_age', AUTHORED, seats([...FACTIONS, ...FACTIONS]), 'concord')!;
    expect(mode.concord_rounds).toBe(SCHISM_TUNING.concordRounds);
    expect(mode.lane_crown_bonus).toBe(SCHISM_TUNING.laneCrownBonus);
    expect(Object.keys(mode.crown_gateways).sort()).toEqual(['nexus_station', 'rust', 'sol', 'verdan']);
    for (const list of Object.values(mode.crown_gateways)) expect(list).toHaveLength(4);
    const war = schismLayout('galaxy_age', AUTHORED, seats([...FACTIONS, ...FACTIONS]), 'civil_war')!;
    expect(war.concord_rounds).toBe(0);
  });

  it('is not dealt unless the seats are two to each world', () => {
    const lopsided = seats([...FACTIONS, 'stellar_mandate', 'stellar_mandate', 'forge_syndicate', 'helion_navigators']);
    expect(schismLayout('galaxy_age', AUTHORED, lopsided, 'concord')).toBeNull();
    expect(schismLayout('galaxy_age', AUTHORED, seats(FACTIONS), 'concord')).toBeNull();
  });

  it('has no whole worlds at eight seats', () => {
    const mode = schismLayout('galaxy_age', AUTHORED, seats([...FACTIONS, ...FACTIONS]), 'concord')!;
    expect(mode.whole_worlds).toBeUndefined();
    expect(mode.houses).toHaveLength(8);
  });

  it('reads anything but Civil War or Allied as the Concord', () => {
    expect(normalizeHouseRelations('civil_war')).toBe('civil_war');
    expect(normalizeHouseRelations('allied')).toBe('allied');
    for (const raw of ['concord', undefined, 'rivals', 7]) expect(normalizeHouseRelations(raw)).toBe('concord');
  });
});

describe('the Partial Schism layout', () => {
  afterEach(restorePartialTables());

  it('makes every seat a house: two on a split world, one alone on each other world, in seat order', () => {
    const mode = schismLayout('galaxy_age', AUTHORED, seats(FIVE), 'concord', { forceHalves: { p1: 0, p2: 1, p3: 0 } })!;
    expect(mode.houses.map((h) => [h.player_id, h.world_id])).toEqual([
      ['p0', 'sol'], ['p1', 'rust'], ['p2', 'verdan'], ['p3', 'nexus_station'], ['p4', 'sol'],
    ]);
    expect(mode.houses[0]!.half + mode.houses[4]!.half).toBe(1);
    expect(mode.houses.slice(1, 4).map((h) => [h.half, h.name])).toEqual([
      [0, SCHISM_HALVES.rust![0].house],
      [1, SCHISM_HALVES.verdan![1].house],
      [0, SCHISM_HALVES.nexus_station![0].house],
    ]);
    expect(mode.whole_worlds).toBeUndefined();
    expect(mode.unclaimed_garrison).toEqual(PARTIAL_SCHISM_TUNING[5]!.unclaimed);
    // The halves no house opened on are unclaimed.
    expect(schismUnclaimedTiles(mode).sort()).toEqual([
      ...SCHISM_HALVES.rust![1].tiles, ...SCHISM_HALVES.verdan![0].tiles, ...SCHISM_HALVES.nexus_station![1].tiles,
    ].sort());
    // Seven seats: three worlds split, one house alone wherever it sits.
    const seven = schismLayout('galaxy_age', AUTHORED, seats(['forge_syndicate', ...FACTIONS, 'void_custodians', 'stellar_mandate']), 'concord')!;
    expect(seven.houses.map((h) => h.player_id)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
    expect(schismUnclaimedTiles(seven)).toHaveLength(SCHISM_HALVES.verdan![0].tiles.length);
  });

  it('seats an Allied side of one on its whole world, with nothing unclaimed', () => {
    PARTIAL_SCHISM_TUNING[5]!.allied = { house: 0, whole: 0 };
    const mode = schismLayout('galaxy_age', AUTHORED, seats(FIVE), 'allied')!;
    expect(mode.houses.map((h) => h.player_id)).toEqual(['p0', 'p4']);
    expect(mode.whole_worlds).toEqual([
      { player_id: 'p1', world_id: 'rust' },
      { player_id: 'p2', world_id: 'verdan' },
      { player_id: 'p3', world_id: 'nexus_station' },
    ]);
    expect(mode.unclaimed_garrison).toBeUndefined();
    expect(schismUnclaimedTiles(mode)).toEqual([]);
  });

  it("records each half's partial number, with a rival or alone, in place of the eight-seat one", () => {
    Object.assign(PARTIAL_SCHISM_HALVES, {
      sol: { rival: [2, -1], alone: [5, 5] },
      rust: { rival: [5, 5], alone: [3, 1] },
      verdan: { rival: [0, 0], alone: [0, 0] },
    });
    const mode = schismLayout('galaxy_age', AUTHORED, seats(FIVE), 'concord', { forceHalves: { p0: 0, p1: 1, p2: 1 } })!;
    const bonusOf = (id: string) => mode.houses.find((h) => h.player_id === id)!.reinforce_bonus;
    expect([bonusOf('p0'), bonusOf('p4')]).toEqual([2, -1]);
    // A house alone on Rust's second half.
    expect(bonusOf('p1')).toBe(1);
    // Duskrim's +2 at eight seats is not the partial board's.
    expect(SCHISM_HALVES.verdan![1].reinforce_bonus).toBeGreaterThan(0);
    expect(bonusOf('p2')).toBeUndefined();
    // Nor are the halves' eight-seat openings.
    expect(schismOpeningBonus(mode.houses.find((h) => h.player_id === 'p3')!, 'concord', 5)).toBe(0);
    expect(schismOpeningBonus({ world_id: 'nexus_station', half: 1 }, 'concord', 8)).toBe(SCHISM_HALVES.nexus_station![1].opening_bonus);
  });

  it('records the Allied numbers on each house and each whole world', () => {
    PARTIAL_SCHISM_TUNING[5]!.allied = { house: 1, whole: 2 };
    const mode = schismLayout('galaxy_age', AUTHORED, seats(FIVE), 'allied')!;
    expect(mode.houses.map((h) => h.reinforce_bonus ?? 0)).toEqual([ALLIED_TUNING.sol!.reinforce + 1, ALLIED_TUNING.sol!.reinforce + 1]);
    expect(mode.whole_worlds!.map((w) => w.reinforce_bonus)).toEqual([2, 2, 2]);
  });

  it('records the garrison its unclaimed halves open with, by seat count', () => {
    PARTIAL_SCHISM_TUNING[6]!.unclaimed = { gateway: 7, interior: 9 };
    const mode = schismLayout('galaxy_age', AUTHORED, seats([...FIVE, 'void_custodians']), 'civil_war')!;
    expect(mode.unclaimed_garrison).toEqual({ gateway: 7, interior: 9 });
    expect(mode.concord_rounds).toBe(0);
  });

  it('keeps the Concord and the Crown numbers of the eight-seat board', () => {
    const mode = schismLayout('galaxy_age', AUTHORED, seats(FIVE), 'concord')!;
    expect(mode.concord_rounds).toBe(SCHISM_TUNING.concordRounds);
    expect(mode.lane_crown_bonus).toBe(SCHISM_TUNING.laneCrownBonus);
    expect(Object.keys(mode.crown_gateways).sort()).toEqual(['nexus_station', 'rust', 'sol', 'verdan']);
  });

  it('is not dealt unless every world has one seat or two', () => {
    const threeOnSol = seats(['stellar_mandate', 'stellar_mandate', 'stellar_mandate', 'forge_syndicate', 'helion_navigators']);
    expect(schismLayout('galaxy_age', AUTHORED, threeOnSol, 'concord')).toBeNull();
    const nexusEmpty = seats([...FACTIONS.slice(0, 3), ...FACTIONS.slice(0, 3)]);
    expect(schismLayout('galaxy_age', AUTHORED, nexusEmpty, 'concord')).toBeNull();
    expect(schismLayout('galaxy_age', AUTHORED, seats([...FACTIONS.slice(0, 4), null]), 'concord')).toBeNull();
  });
});

describe('an eight-seat game', () => {
  it('opens every house on its half alone, at the initial count plus its bonuses, with the Vault ring neutral', () => {
    const { state } = schismGame();
    const mode = state.galaxy_mode;
    expect(mode?.id).toBe('schism');
    if (mode?.id !== 'schism') return;
    for (const house of mode.houses) {
      const half = SCHISM_HALVES[house.world_id]![house.half];
      expect(owned(state, house.player_id)).toEqual([...half.tiles].sort());
      const vaultBonus = house.world_id === 'nexus_station' ? 1 : 0;
      for (const id of half.tiles) {
        expect(state.territories[id]!.unit_count).toBe(Math.max(1, 3 + vaultBonus + schismOpeningBonus(house)));
      }
    }
    for (const id of VAULT_RING) {
      expect(state.territories[id]).toMatchObject({ owner_id: null, unit_count: 6 });
    }
  });

  it('keeps the classic deal for everything a Schism does not touch: no extra lanes', () => {
    const { map } = schismGame();
    expect(map.connections.filter((c) => c.source)).toHaveLength(0);
  });

  it('opens the Concord between each world\'s two houses and nobody else', () => {
    const { state } = schismGame();
    for (const a of state.players) {
      for (const b of state.players) {
        if (a === b) continue;
        const sameWorld = schismHouseOf(state, a.player_id)!.world_id === schismHouseOf(state, b.player_id)!.world_id;
        expect(!!activeTruceBetween(state, a.player_id, b.player_id)).toBe(sameWorld);
      }
    }
    expect(schismRivalOf(state, 'p0')!.player_id).toBe('p4');
  });

  it('lets the Concord run out after its rounds, counting the first', () => {
    const { state, map } = schismGame();
    const rounds = state.galaxy_mode?.id === 'schism' ? state.galaxy_mode.concord_rounds : 0;
    expect(rounds).toBeGreaterThan(0);
    for (let round = 1; round <= rounds; round++) {
      expect(state.turn_number).toBe(round);
      expect(activeTruceBetween(state, 'p0', 'p4')).not.toBeNull();
      for (let i = 0; i < state.players.length; i++) advanceToNextPlayer(state, map);
    }
    expect(state.turn_number).toBe(rounds + 1);
    expect(activeTruceBetween(state, 'p0', 'p4')).toBeNull();
  });

  it('opens no truce in Civil War, and remembers the choice', () => {
    const { state } = schismGame({ galaxy_house_relations: 'civil_war' });
    expect(state.galaxy_mode?.id === 'schism' && state.galaxy_mode.relations).toBe('civil_war');
    expect(state.settings.galaxy_house_relations).toBe('civil_war');
    expect(state.players.some((a) => state.players.some((b) => a !== b && activeTruceBetween(state, a.player_id, b.player_id)))).toBe(false);
  });

  it('deals every faction twice when the seats pick nothing', () => {
    const map = JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
    const state = initializeGameState('t_schism_random', 'galaxy_age', map, seats(Array(8).fill(null)) as never, settings(), {
      forceStartingPlayerIndex: 0,
    });
    expect(state.galaxy_mode?.id).toBe('schism');
    const perFaction = new Map<string, number>();
    for (const p of state.players) perFaction.set(p.faction_id!, (perFaction.get(p.faction_id!) ?? 0) + 1);
    expect([...perFaction.values()]).toEqual([2, 2, 2, 2]);
  });
});

describe("a house's own reinforcement bonus", () => {
  /** Deal with Sol's halves given these bonuses, then put the authored table back. */
  function dealWithSolBonuses(bonuses: [number, number]): GameState {
    const saved = SCHISM_HALVES.sol!;
    const table = SCHISM_HALVES as Record<string, unknown>;
    table.sol = [
      { ...saved[0], reinforce_bonus: bonuses[0] },
      { ...saved[1], reinforce_bonus: bonuses[1] },
    ];
    try {
      return schismGame({}, { p0: 0 }).state;
    } finally {
      table.sol = saved;
    }
  }

  it('is recorded on the house when the board is dealt, and drafted every turn', () => {
    const state = dealWithSolBonuses([2, 0]);
    expect(schismHouseOf(state, 'p0')?.reinforce_bonus).toBe(2);
    expect(schismHouseOf(state, 'p4')?.reinforce_bonus).toBeUndefined();
    expect(houseReinforceBonus(state, 'p0')).toBe(2);
    expect(houseReinforceBonus(state, 'p4')).toBe(0);
    const plain = dealWithSolBonuses([0, 0]);
    expect(getPlayerReinforceBonus(state, 'p0') - getPlayerReinforceBonus(plain, 'p0')).toBe(2);
    expect(getPlayerReinforceBonus(state, 'p4')).toBe(getPlayerReinforceBonus(plain, 'p4'));
  });

  it('pays what the game was dealt, not today\'s table', () => {
    const state = dealWithSolBonuses([3, 0]);
    // The table is back to its authored values here; the dealt game keeps its 3.
    expect(houseReinforceBonus(state, 'p0')).toBe(3);
  });

  it('is nothing off a Schism board', () => {
    const map = JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
    const state = initializeGameState('t_classic_bonus', 'galaxy_age', map, seats(FACTIONS) as never, settings(), {
      forceStartingPlayerIndex: 0,
    });
    expect(houseReinforceBonus(state, 'p0')).toBe(0);
  });
});

describe('the Lane Crown', () => {
  it('is worn with all four of the house\'s own world\'s gateways, and pays in the draft', () => {
    // p0 is the Stellar Mandate on half 0; p4 its rival on half 1.
    const { state, map } = schismGame({}, { p0: 0 });
    const mode = state.galaxy_mode;
    if (mode?.id !== 'schism') throw new Error('no Schism');
    const solGateways = mode.crown_gateways.sol!;
    expect(holdsLaneCrown(state, 'p0')).toBe(false);
    const before = getPlayerReinforceBonus(state, 'p0');
    for (const id of solGateways) state.territories[id]!.owner_id = 'p0';
    expect(holdsLaneCrown(state, 'p0')).toBe(true);
    expect(laneCrownBonus(state, 'p0')).toBe(mode.lane_crown_bonus);
    expect(getPlayerReinforceBonus(state, 'p0')).toBe(before + mode.lane_crown_bonus);
    // Lose one and the Crown goes with it.
    state.territories[solGateways[0]!]!.owner_id = 'p4';
    expect(holdsLaneCrown(state, 'p0')).toBe(false);
    expect(getPlayerReinforceBonus(state, 'p0')).toBe(before);
    void map;
  });

  it('pays nothing for another world\'s gateways', () => {
    const { state } = schismGame();
    const mode = state.galaxy_mode;
    if (mode?.id !== 'schism') throw new Error('no Schism');
    for (const id of mode.crown_gateways.rust!) state.territories[id]!.owner_id = 'p0';
    expect(holdsLaneCrown(state, 'p0')).toBe(false);
    expect(laneCrownBonus(state, 'p0')).toBe(0);
  });

  it('pays the bonus the game recorded, not today\'s constant', () => {
    const { state } = schismGame();
    const mode = state.galaxy_mode;
    if (mode?.id !== 'schism') throw new Error('no Schism');
    for (const id of mode.crown_gateways.sol!) state.territories[id]!.owner_id = 'p0';
    const saved = SCHISM_TUNING.laneCrownBonus;
    SCHISM_TUNING.laneCrownBonus = saved + 5;
    try {
      expect(laneCrownBonus(state, 'p0')).toBe(mode.lane_crown_bonus);
    } finally {
      SCHISM_TUNING.laneCrownBonus = saved;
    }
  });

  it('exists only on a Schism board', () => {
    const map = JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
    const state = initializeGameState('t_classic', 'galaxy_age', map, seats(FACTIONS) as never, settings(), {
      forceStartingPlayerIndex: 0,
    });
    for (const id of gatewaysByWorld(map).get('sol')!) state.territories[id]!.owner_id = 'p0';
    expect(holdsLaneCrown(state, 'p0')).toBe(false);
    expect(laneCrownBonus(state, 'p0')).toBe(0);
  });
});

describe('a five-to-seven-seat game (the Partial Schism)', () => {
  afterEach(restorePartialTables());

  it.each([
    [5, FIVE],
    [6, [...FIVE, 'void_custodians']],
    [7, [...FIVE, 'void_custodians', 'forge_syndicate']],
  ])('at %i seats opens every house on its half, each unclaimed half neutral and garrisoned, the Vault ring neutral', (n, factions) => {
    PARTIAL_SCHISM_TUNING[n]!.unclaimed = { gateway: 7, interior: 9 };
    const { state } = startWith(factions);
    const mode = state.galaxy_mode;
    expect(mode?.id).toBe('schism');
    if (mode?.id !== 'schism') return;
    expect(mode.houses).toHaveLength(n);
    expect(mode.whole_worlds).toBeUndefined();
    for (const house of mode.houses) {
      const half = SCHISM_HALVES[house.world_id]![house.half];
      expect(owned(state, house.player_id)).toEqual([...half.tiles].sort());
      const vaultBonus = house.world_id === 'nexus_station' ? 1 : 0;
      for (const id of half.tiles) {
        expect(state.territories[id]!.unit_count).toBe(3 + vaultBonus + schismOpeningBonus(house, 'concord', n));
      }
    }
    const unclaimed = schismUnclaimedTiles(mode);
    expect(new Set(unclaimed.map((id) => state.territories[id]!.world_id)).size).toBe(8 - n);
    for (const id of unclaimed) {
      expect(state.territories[id]).toMatchObject({ owner_id: null, unit_count: ON_LANE.has(id) ? 7 : 9 });
    }
    for (const id of VAULT_RING) {
      expect(state.territories[id]).toMatchObject({ owner_id: null, unit_count: 6 });
    }
    const unowned = Object.values(state.territories).filter((t) => !t.owner_id).map((t) => t.territory_id).sort();
    expect(unowned).toEqual([...VAULT_RING, ...unclaimed].sort());
    for (const p of state.players) expect(p.territory_count).toBe(owned(state, p.player_id).length);
  });

  it('opens an Allied side of one on its whole world, as the four-seat start does', () => {
    const four = startWith(FACTIONS).state;
    const { state } = startWith(FIVE, { galaxy_house_relations: 'allied' });
    for (const id of ['p1', 'p2', 'p3']) {
      expect(schismWholeWorldOf(state, id)).not.toBeNull();
      expect(owned(state, id)).toEqual(owned(four, id));
      for (const t of owned(four, id)) expect(state.territories[t]!.unit_count).toBe(four.territories[t]!.unit_count);
    }
  });

  it.each([5, 6, 7])('deals a partial board at %i seats when nobody picks', (n) => {
    const { state } = startWith(Array(n).fill(null));
    const mode = state.galaxy_mode;
    expect(mode?.id).toBe('schism');
    if (mode?.id !== 'schism') return;
    expect(mode.houses).toHaveLength(n);
    const unowned = Object.values(state.territories).filter((t) => !t.owner_id).map((t) => t.territory_id).sort();
    expect(unowned).toEqual([...VAULT_RING, ...schismUnclaimedTiles(mode)].sort());
  });

  it("opens the Concord between the split world's houses and nobody else", () => {
    const { state } = startWith(FIVE);
    const houses = ['p0', 'p4'];
    for (const a of state.players) {
      for (const b of state.players) {
        if (a === b) continue;
        const both = houses.includes(a.player_id) && houses.includes(b.player_id);
        expect(!!activeTruceBetween(state, a.player_id, b.player_id)).toBe(both);
      }
    }
    expect(schismRivalOf(state, 'p0')!.player_id).toBe('p4');
    expect(schismRivalOf(state, 'p1')).toBeNull();
    expect(schismHouseOf(state, 'p1')).toMatchObject({ player_id: 'p1', world_id: 'rust' });
    expect(schismWholeWorldOf(state, 'p1')).toBeNull();
  });

  it("crowns a house alone on its world once it holds its unclaimed half's gateways too", () => {
    const { state } = startWith(FIVE, {}, { p1: 0 });
    const mode = state.galaxy_mode;
    if (mode?.id !== 'schism') throw new Error('no Schism');
    const rust = mode.crown_gateways.rust!;
    expect(rust.filter((id) => state.territories[id]!.owner_id === 'p1')).toHaveLength(2);
    expect(rust.filter((id) => state.territories[id]!.owner_id === null)).toHaveLength(2);
    expect(holdsLaneCrown(state, 'p1')).toBe(false);
    for (const id of rust) state.territories[id]!.owner_id = 'p1';
    expect(laneCrownBonus(state, 'p1')).toBe(mode.lane_crown_bonus);
  });

  it("drafts each house's partial number every turn, whatever the table says later", () => {
    PARTIAL_SCHISM_HALVES.rust = { rival: [0, 0], alone: [2, 2] };
    const { state } = startWith(FIVE, {}, { p1: 0 });
    PARTIAL_SCHISM_HALVES.rust = { rival: [0, 0], alone: [0, 0] };
    const plain = startWith(FIVE, {}, { p1: 0 }).state;
    expect(houseReinforceBonus(state, 'p1')).toBe(2);
    expect(houseReinforceBonus(plain, 'p1')).toBe(0);
    expect(getPlayerReinforceBonus(state, 'p1') - getPlayerReinforceBonus(plain, 'p1')).toBe(2);
  });

  it("drafts an Allied whole world's number every turn", () => {
    PARTIAL_SCHISM_TUNING[5]!.allied = { house: 0, whole: 2 };
    const { state } = startWith(FIVE, { galaxy_house_relations: 'allied' });
    PARTIAL_SCHISM_TUNING[5]!.allied = { house: 0, whole: 0 };
    const plain = startWith(FIVE, { galaxy_house_relations: 'allied' }).state;
    expect(houseReinforceBonus(state, 'p1')).toBe(2);
    expect(getPlayerReinforceBonus(state, 'p1') - getPlayerReinforceBonus(plain, 'p1')).toBe(2);
  });
});

describe('no Schism', () => {
  it('at four seats, with the classic start untouched', () => {
    const map = JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
    const state = initializeGameState('t_four', 'galaxy_age', map, seats(FACTIONS) as never, settings(), {
      forceStartingPlayerIndex: 0,
    });
    expect(state.galaxy_mode).toBeUndefined();
    expect(state.diplomacy.every((d) => d.status === 'neutral')).toBe(true);
  });

  it('with Home Worlds off: five seats get the scattered start and no houses', () => {
    const map = JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
    const state = initializeGameState('t_scatter5', 'galaxy_age', map, seats(Array(5).fill(null)) as never, settings({
      factions_enabled: false,
    }), { forceStartingPlayerIndex: 0 });
    expect(state.galaxy_mode).toBeUndefined();
    expect(state.diplomacy.every((d) => d.status === 'neutral')).toBe(true);
  });

  it('with Home Worlds off: eight seats get the scattered start and no houses', () => {
    const map = JSON.parse(JSON.stringify(AUTHORED)) as GameMap;
    const state = initializeGameState('t_scatter', 'galaxy_age', map, seats(Array(8).fill(null)) as never, settings({
      factions_enabled: false,
    }), { forceStartingPlayerIndex: 0 });
    expect(state.galaxy_mode).toBeUndefined();
    expect(state.players.every((p) => !p.faction_id)).toBe(true);
    expect(state.diplomacy.every((d) => d.status === 'neutral')).toBe(true);
  });

  it('in another era at eight seats: factions dealt one apiece as before', () => {
    const map = JSON.parse(readFileSync(join(__dirname, '../../../../database/maps/era_ww2.json'), 'utf-8')) as GameMap;
    const state = initializeGameState('t_ww2', 'ww2', map, seats(Array(8).fill(null)) as never, settings(), {
      forceStartingPlayerIndex: 0,
    });
    expect(state.galaxy_mode).toBeUndefined();
    const dealt = state.players.map((p) => p.faction_id).filter(Boolean);
    expect(new Set(dealt).size).toBe(dealt.length);
  });
});
