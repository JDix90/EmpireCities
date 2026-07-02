import { describe, it, expect } from 'vitest';
import type { GameMap, GameState, PlayerState } from '../../types';
import type { EraTransition } from './eraLineage';
import {
  assignSeeds,
  transformBoardToEra,
  executeBoardTransform,
  neutralGarrisonForEra,
  seedGarrisonForEra,
} from './boardTransform';

function player(id: string, eliminated = false): PlayerState {
  return { player_id: id, player_index: 0, username: id, color: '#000', is_ai: false, is_eliminated: eliminated } as PlayerState;
}
function terr(id: string, owner: string | null, units: number) {
  return { territory_id: id, owner_id: owner, unit_count: units, unit_type: 'infantry', region_id: 'r' };
}
function state(players: PlayerState[], territories: Record<string, ReturnType<typeof terr>>): GameState {
  return { game_id: 'g', map_id: 'era_ancient', players, territories, settings: {} } as unknown as GameState;
}

// Lineage: A→{X}, B→{Y}, C→{X(primary),Z}. (so B and C contend for nothing; A & C contend for X)
const transition: EraTransition = {
  from_map: 'era_ancient',
  to_map: 'era_medieval',
  lineage: {
    a1: [{ to: 'X', overlap: 1, target_overlap: 1, primary: true }],
    b1: [{ to: 'Y', overlap: 1, target_overlap: 1, primary: true }],
    c1: [{ to: 'X', overlap: 0.9, target_overlap: 0.9, primary: true }, { to: 'Z', overlap: 0.5, target_overlap: 0.5 }],
  },
  no_successor: [],
  new_land: ['W'],
};

function nextMap(): GameMap {
  return {
    map_id: 'era_medieval',
    name: 'Med',
    territories: [
      { territory_id: 'X', name: 'X', polygon: [[0, 0]], center_point: [0, 0], region_id: 'r1' },
      { territory_id: 'Y', name: 'Y', polygon: [[0, 0]], center_point: [0, 0], region_id: 'r1' },
      { territory_id: 'Z', name: 'Z', polygon: [[0, 0]], center_point: [0, 0], region_id: 'r2' },
      { territory_id: 'W', name: 'W', polygon: [[0, 0]], center_point: [0, 0], region_id: 'r2' },
    ],
    connections: [],
    regions: [],
  } as unknown as GameMap;
}
const ALL = new Set(['X', 'Y', 'Z', 'W']);

describe('assignSeeds', () => {
  it('the stronger empire claims its successor first; the contender falls to its next successor', () => {
    // C is stronger (10) than A (3); both want X. C takes X, A's only successor X is gone → A falls back.
    const s = state([player('a'), player('c')], {
      a1: terr('a1', 'a', 3),
      c1: terr('c1', 'c', 10),
    });
    const seeds = assignSeeds(s, transition, ALL);
    expect(seeds.get('c')).toBe('X'); // strongest picks its primary
    // A's only successor (X) is taken → A keeps a foothold via fallback, never nothing.
    expect(seeds.has('a')).toBe(true);
    expect(seeds.get('a')).not.toBe('X');
    expect(new Set(seeds.values()).size).toBe(2); // no double-claim
  });

  it('a player whose successors are all taken still gets an unclaimed foothold', () => {
    // Two players both map only to X. Stronger gets X; weaker gets a fallback territory.
    const s = state([player('a'), player('c')], {
      a1: terr('a1', 'a', 5),
      c1: terr('c1', 'c', 5), // tie → deterministic by id: 'a' < 'c', so 'a' picks first
    });
    const seeds = assignSeeds(s, transition, ALL);
    expect(seeds.size).toBe(2);
    expect(new Set(seeds.values()).size).toBe(2);
    for (const v of seeds.values()) expect(ALL.has(v)).toBe(true);
  });

  it('eliminated players and players holding no ground get no seed', () => {
    const s = state([player('a'), player('b', true)], {
      a1: terr('a1', 'a', 4),
      b1: terr('b1', null, 0), // b owns nothing
    });
    const seeds = assignSeeds(s, transition, ALL);
    expect(seeds.has('a')).toBe(true);
    expect(seeds.has('b')).toBe(false);
  });

  it('never seeds an orbit-gated target — the player lands on an accessible tile instead', () => {
    // A's primary successor X is gated (think lunar_outpost_mod → a Moon tile):
    // seeding there would strand them with no orbit access on arrival.
    const s = state([player('a')], { a1: terr('a1', 'a', 4) });
    const seeds = assignSeeds(s, transition, ALL, new Set(['X']));
    expect(seeds.has('a')).toBe(true);
    expect(seeds.get('a')).not.toBe('X');
  });
});

describe('transformBoardToEra', () => {
  it('recomposes the board: seeds owned + garrisoned, everything else neutral, map swapped', () => {
    const s = state([player('a'), player('b')], {
      a1: terr('a1', 'a', 6),
      b1: terr('b1', 'b', 4),
    });
    const summary = transformBoardToEra(s, nextMap(), 1, transition, ALL);

    expect(s.map_id).toBe('era_medieval');
    expect(Object.keys(s.territories).sort()).toEqual(['W', 'X', 'Y', 'Z']);
    // a→X, b→Y (their primaries, no contention).
    expect(s.territories.X.owner_id).toBe('a');
    expect(s.territories.Y.owner_id).toBe('b');
    expect(s.territories.X.unit_count).toBe(seedGarrisonForEra(1));
    // Non-seed targets are neutral with the era garrison.
    expect(s.territories.Z.owner_id).toBeNull();
    expect(s.territories.W.owner_id).toBeNull();
    expect(s.territories.Z.unit_count).toBe(neutralGarrisonForEra(1));
    expect(summary.neutral).toBe(2);
    expect(summary.total).toBe(4);
    expect(summary.seeds).toHaveLength(2);
  });

  it('respects inPlayTargets — territories outside the set are not added', () => {
    const s = state([player('a')], { a1: terr('a1', 'a', 6) });
    const summary = transformBoardToEra(s, nextMap(), 2, transition, new Set(['X', 'Y']));
    expect(Object.keys(s.territories).sort()).toEqual(['X', 'Y']);
    expect(summary.total).toBe(2);
  });
});

describe('executeBoardTransform — full recomposition + invariant fixups', () => {
  function fullState(): GameState {
    const s = state(
      [player('a'), player('b')],
      { a1: terr('a1', 'a', 6), b1: terr('b1', 'b', 4) },
    );
    s.settings = { victory_type: 'domination' } as GameState['settings'];
    s.board_era_index = 0;
    s.era = 'ancient' as GameState['era'];
    s.card_deck = [{ card_id: 'old1', territory_id: 'a1', symbol: 'infantry' }];
    s.discard_pile = [{ card_id: 'old2', territory_id: 'b1', symbol: 'cavalry' }];
    s.draft_placements_this_turn = { a1: 3 };
    s.blitzkrieg_active = true;
    s.blitzkrieg_bonus_source_id = 'a1';
    s.blitzkrieg_bonus_attacks_remaining = 2;
    s.players[0].capital_territory_id = 'a1';
    s.players[0].march_to_sea_last_capture_id = 'a1';
    s.players[0].territory_count = 1;
    s.players[1].territory_count = 1;
    return s;
  }

  it('leaves every survivor with their seed (no false elimination) and syncs counts/capitals', () => {
    const s = fullState();
    executeBoardTransform(s, nextMap(), 1, transition, ALL, () => 0.42);

    expect(s.territories.X.owner_id).toBe('a'); // a's seed
    expect(s.territories.Y.owner_id).toBe('b'); // b's seed
    expect(s.players[0].territory_count).toBe(1);
    expect(s.players[1].territory_count).toBe(1);
    expect(s.players[0].is_eliminated).toBe(false);
    expect(s.players[1].is_eliminated).toBe(false);
    // capital reassigned to the seed (the only territory each player owns)
    expect(s.players[0].capital_territory_id).toBe('X');
    expect(s.players[1].capital_territory_id).toBe('Y');
  });

  it('rebuilds cards for the new board and clears the orphaned discard pile', () => {
    const s = fullState();
    executeBoardTransform(s, nextMap(), 1, transition, ALL, () => 0.42);
    const newIds = new Set(Object.keys(s.territories));
    // every drawable card references a current-board territory (or wild)
    for (const c of s.card_deck) expect(c.territory_id === null || newIds.has(c.territory_id)).toBe(true);
    expect(s.card_deck.some((c) => c.territory_id === 'a1')).toBe(false); // old territory gone from deck
    expect(s.discard_pile).toEqual([]);
  });

  it('clears per-turn transients that reference now-gone territories', () => {
    const s = fullState();
    executeBoardTransform(s, nextMap(), 1, transition, ALL, () => 0.42);
    expect(s.draft_placements_this_turn).toEqual({});
    expect(s.blitzkrieg_active).toBe(false);
    expect(s.blitzkrieg_bonus_source_id).toBeNull();
    expect(s.blitzkrieg_bonus_attacks_remaining).toBe(0);
    expect(s.players[0].march_to_sea_last_capture_id).toBeNull();
  });

  it('updates board-era bookkeeping and the game-wide era', () => {
    const s = fullState();
    const res = executeBoardTransform(s, nextMap(), 1, transition, ALL, () => 0.42);
    expect(s.map_id).toBe('era_medieval');
    expect(s.board_era_index).toBe(1);
    expect(s.map_era_floor).toBe(1);
    expect(s.era).toBe('medieval');
    expect(res.from_era_index).toBe(0);
  });

  it('regenerates secret missions onto valid new-board ids when that victory mode is on', () => {
    const s = fullState();
    s.settings = { victory_type: 'secret_mission' } as GameState['settings'];
    s.players[0].secret_mission = { kind: 'capture_territories', territory_ids: ['a1', 'b1'] }; // both now gone
    executeBoardTransform(s, nextMap(), 1, transition, ALL, () => 0.42);
    const m = s.players[0].secret_mission;
    const newIds = new Set(Object.keys(s.territories));
    if (m?.kind === 'capture_territories') {
      for (const tid of m.territory_ids) expect(newIds.has(tid)).toBe(true);
    }
    // whatever kind it regenerated to, it must not reference the deleted territories
    expect(JSON.stringify(m)).not.toContain('a1');
  });
});

describe('garrison scaling', () => {
  it('neutral garrison scales with era and caps at 8; seed garrison floors at 3', () => {
    expect(neutralGarrisonForEra(1)).toBe(3);
    expect(neutralGarrisonForEra(5)).toBe(7);
    expect(neutralGarrisonForEra(99)).toBe(8);
    expect(seedGarrisonForEra(0)).toBe(3); // floor
    expect(seedGarrisonForEra(99)).toBe(8); // cap
  });
});
