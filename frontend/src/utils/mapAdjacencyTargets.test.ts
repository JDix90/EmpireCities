import { describe, expect, it } from 'vitest';
import {
  computePhaseAdjacencyTargets,
  listNeighborTargets,
  computeValidSources,
  computeFortifyReachable,
  listDirectAttackSources,
  canAttackFrom,
  listBorderingOwned,
  type MapConnection,
} from './mapAdjacencyTargets';
import type { GameState } from '../store/gameStore';

function miniState(phase: GameState['phase']): GameState {
  return {
    phase,
    territories: {
      rome: { territory_id: 'rome', owner_id: 'p1', unit_count: 5 },
      milan: { territory_id: 'milan', owner_id: 'p2', unit_count: 3 },
      turin: { territory_id: 'turin', owner_id: 'p1', unit_count: 4 },
    },
    players: [
      { player_id: 'p1', username: 'Human', color: '#f00', player_index: 0, is_ai: false },
      { player_id: 'p2', username: 'AI', color: '#00f', player_index: 1, is_ai: true },
    ],
  } as unknown as GameState;
}

const connections = [
  { from: 'rome', to: 'milan', type: 'land' as const },
  { from: 'rome', to: 'turin', type: 'land' as const },
];

describe('computePhaseAdjacencyTargets', () => {
  it('returns enemy neighbors during attack phase', () => {
    const targets = computePhaseAdjacencyTargets(miniState('attack'), connections, {
      attackSource: 'rome',
    });
    expect(targets.has('milan')).toBe(true);
    expect(targets.has('turin')).toBe(false);
  });

  it('returns friendly neighbors during fortify phase', () => {
    const targets = computePhaseAdjacencyTargets(miniState('fortify'), connections, {
      attackSource: 'rome',
    });
    expect(targets.has('turin')).toBe(true);
    expect(targets.has('milan')).toBe(false);
  });

  it('excludes neutral (unowned) neighbors from attack by default', () => {
    const state = miniState('attack');
    (state.territories as Record<string, unknown>).frontier = {
      territory_id: 'frontier',
      owner_id: null,
      unit_count: 3,
    };
    const conns = [...connections, { from: 'rome', to: 'frontier', type: 'land' as const }];
    const targets = computePhaseAdjacencyTargets(state, conns, { attackSource: 'rome' });
    expect(targets.has('frontier')).toBe(false);
  });

  it('allows attacking neutral frontier neighbors in era-advancement games', () => {
    // Growth spawns neutral frontiers; the backend lets you capture them, so a
    // bordering frontier must be offered as an attack target (issue: unreachable).
    const state = miniState('attack');
    (state as unknown as { settings: { era_advancement_enabled: boolean } }).settings = {
      era_advancement_enabled: true,
    };
    (state.territories as Record<string, unknown>).frontier = {
      territory_id: 'frontier',
      owner_id: null,
      unit_count: 3,
    };
    const conns = [...connections, { from: 'rome', to: 'frontier', type: 'land' as const }];
    const targets = computePhaseAdjacencyTargets(state, conns, { attackSource: 'rome' });
    expect(targets.has('frontier')).toBe(true);
    expect(targets.has('milan')).toBe(true); // enemy still attackable
    expect(targets.has('turin')).toBe(false); // own territory still excluded
  });

  it('offers an ORBIT-connected neutral (the Moon) as an attack target even without era advancement', () => {
    // Standalone Space Age: the backend allows conquering the neutral Moon once the
    // attacker has orbit access, but the quick-list previously hid it. Off-world
    // neutrals are reached via `orbit` connections, so they must be admitted.
    const state = miniState('attack'); // no settings → era advancement off
    (state.territories as Record<string, unknown>).moon = {
      territory_id: 'moon',
      owner_id: null,
      unit_count: 4,
    };
    const conns = [...connections, { from: 'rome', to: 'moon', type: 'orbit' as const }];
    const targets = computePhaseAdjacencyTargets(state, conns, { attackSource: 'rome' });
    expect(targets.has('moon')).toBe(true);
  });

  it('drops the orbit-connected Moon on the globe (per-world territoryFilter)', () => {
    // On the globe the caller scopes to the active world; the cross-world Moon
    // endpoint is filtered out, so it only surfaces in the unfiltered quick-list.
    const state = miniState('attack');
    (state.territories as Record<string, unknown>).moon = {
      territory_id: 'moon',
      owner_id: null,
      unit_count: 4,
    };
    const conns = [...connections, { from: 'rome', to: 'moon', type: 'orbit' as const }];
    const targets = computePhaseAdjacencyTargets(state, conns, {
      attackSource: 'rome',
      territoryFilter: (id) => id !== 'moon', // active world excludes the Moon
    });
    expect(targets.has('moon')).toBe(false);
  });
});

describe('computeFortifyReachable', () => {
  it('walks a multi-hop chain of the owner\'s territories (mirrors backend pathExists)', () => {
    const state = miniState('fortify');
    // rome(p1) — turin(p1) — venice(p1): venice is 2 hops from rome, all p1.
    (state.territories as Record<string, unknown>).venice = {
      territory_id: 'venice', owner_id: 'p1', unit_count: 2,
    };
    const conns = [...connections, { from: 'turin', to: 'venice', type: 'land' as const }];
    const reachable = computeFortifyReachable(state, conns, 'rome', 'p1');
    expect(reachable.has('turin')).toBe(true);
    expect(reachable.has('venice')).toBe(true); // multi-hop through turin
    expect(reachable.has('milan')).toBe(false); // enemy blocks the path
    expect(reachable.has('rome')).toBe(false);  // excludes the source itself
  });

  it('stops at enemy territories — no path through non-owned land', () => {
    const state = miniState('fortify');
    // rome(p1) — milan(p2) — genoa(p1): genoa is unreachable (milan is enemy).
    (state.territories as Record<string, unknown>).genoa = {
      territory_id: 'genoa', owner_id: 'p1', unit_count: 3,
    };
    const conns = [...connections, { from: 'milan', to: 'genoa', type: 'land' as const }];
    const reachable = computeFortifyReachable(state, conns, 'rome', 'p1');
    expect(reachable.has('turin')).toBe(true);
    expect(reachable.has('genoa')).toBe(false);
  });
});

describe('computeValidSources', () => {
  it('attack: owns ≥2 units and borders an enemy', () => {
    const sources = computeValidSources(miniState('attack'), connections, 'p1');
    expect(sources.has('rome')).toBe(true);  // borders milan (p2)
    expect(sources.has('turin')).toBe(false); // only borders rome (own) — no enemy
    expect(sources.has('milan')).toBe(false); // not the viewer's
  });

  it('fortify: owns ≥2 units and can reach another owned territory', () => {
    const sources = computeValidSources(miniState('fortify'), connections, 'p1');
    expect(sources.has('rome')).toBe(true);  // reaches turin
    expect(sources.has('turin')).toBe(true); // reaches rome
    expect(sources.has('milan')).toBe(false);
  });

  it('excludes single-unit territories (nothing to move / attack with)', () => {
    const state = miniState('attack');
    (state.territories as Record<string, { unit_count: number }>).rome.unit_count = 1;
    const sources = computeValidSources(state, connections, 'p1');
    expect(sources.has('rome')).toBe(false);
  });

  it('is empty outside attack/fortify phases', () => {
    expect(computeValidSources(miniState('draft'), connections, 'p1').size).toBe(0);
    expect(computeValidSources(miniState('territory_select'), connections, 'p1').size).toBe(0);
  });

  it('is empty without a viewer id', () => {
    expect(computeValidSources(miniState('attack'), connections, null).size).toBe(0);
  });

  it('attack: counts era-advancement neutral frontiers as attackable', () => {
    const state = miniState('attack');
    (state as unknown as { settings: { era_advancement_enabled: boolean } }).settings = {
      era_advancement_enabled: true,
    };
    // turin(p1) now borders a neutral frontier → becomes a valid attack source.
    (state.territories as Record<string, unknown>).frontier = {
      territory_id: 'frontier', owner_id: null, unit_count: 2,
    };
    const conns = [...connections, { from: 'turin', to: 'frontier', type: 'land' as const }];
    const sources = computeValidSources(state, conns, 'p1');
    expect(sources.has('turin')).toBe(true);
  });

  it('respects the world territoryFilter (galaxy scoping)', () => {
    const state = miniState('fortify');
    (state.territories as Record<string, unknown>).offworld = {
      territory_id: 'offworld', owner_id: 'p1', unit_count: 4,
    };
    const conns = [...connections, { from: 'rome', to: 'offworld', type: 'orbit' as const }];
    // Filter to the home world only → offworld is excluded as a source, and rome's
    // only in-world friendly reach (turin) still keeps rome valid.
    const homeOnly = (id: string) => id !== 'offworld';
    const sources = computeValidSources(state, conns, 'p1', { territoryFilter: homeOnly });
    expect(sources.has('offworld')).toBe(false);
    expect(sources.has('rome')).toBe(true);
  });
});

describe('listNeighborTargets — hyperspace (orbit) targets', () => {
  it('flags cross-world orbit targets, names the destination world, and leaves land targets plain', () => {
    const state = miniState('attack');
    (state.territories as Record<string, unknown>).verdan_aurora = {
      territory_id: 'verdan_aurora',
      owner_id: 'p2',
      unit_count: 2,
    };
    const conns = [
      { from: 'rome', to: 'milan', type: 'land' as const },
      { from: 'rome', to: 'verdan_aurora', type: 'orbit' as const },
    ];
    const names = new Map([
      ['milan', 'Milan'],
      ['verdan_aurora', 'Aurora'],
    ]);

    const rows = listNeighborTargets(state, conns, 'rome', names, {
      attackSource: 'rome',
      worldNameOf: (id) => (id === 'verdan_aurora' ? 'Verdan Reach' : undefined),
    });

    const orbitRow = rows.find((r) => r.territoryId === 'verdan_aurora');
    const landRow = rows.find((r) => r.territoryId === 'milan');
    expect(orbitRow?.isOrbit).toBe(true);
    expect(orbitRow?.targetWorldName).toBe('Verdan Reach');
    expect(landRow?.isOrbit).toBe(false);
    expect(landRow?.targetWorldName).toBeUndefined();
  });
});

describe('listDirectAttackSources', () => {
  const names = new Map([
    ['rome', 'Rome'],
    ['milan', 'Milan'],
    ['turin', 'Turin'],
    ['genoa', 'Genoa'],
  ]);

  /** p1 holds rome/turin/genoa; p2 holds milan. Every link touches milan. */
  function siegeState(overrides: Record<string, { owner_id: string | null; unit_count: number }> = {}): GameState {
    return {
      phase: 'attack',
      territories: {
        rome: { territory_id: 'rome', owner_id: 'p1', unit_count: 5 },
        turin: { territory_id: 'turin', owner_id: 'p1', unit_count: 9 },
        genoa: { territory_id: 'genoa', owner_id: 'p1', unit_count: 1 },
        milan: { territory_id: 'milan', owner_id: 'p2', unit_count: 3 },
        ...overrides,
      },
      players: [
        { player_id: 'p1', username: 'Human', color: '#f00', player_index: 0, is_ai: false },
        { player_id: 'p2', username: 'AI', color: '#00f', player_index: 1, is_ai: true },
      ],
    } as unknown as GameState;
  }

  const siegeConnections = [
    { from: 'rome', to: 'milan', type: 'land' as const },
    { from: 'milan', to: 'turin', type: 'sea' as const },
    { from: 'genoa', to: 'milan', type: 'land' as const },
  ];

  it('lists every bordering territory of mine that could strike, strongest first', () => {
    const rows = listDirectAttackSources(siegeState(), siegeConnections, 'milan', 'p1', names);
    // genoa is excluded: 1 unit can't attack (one must stay behind).
    expect(rows.map((r) => r.territoryId)).toEqual(['turin', 'rome']);
    expect(rows[0]).toMatchObject({ name: 'Turin', unitCount: 9, connectionType: 'sea' });
    expect(rows[1]).toMatchObject({ name: 'Rome', unitCount: 5, connectionType: 'land' });
  });

  it('reports the connection type in either direction (blitz eligibility reads it)', () => {
    // rome→milan is stored from-rome; milan→turin is stored from-milan. Both resolve.
    const rows = listDirectAttackSources(siegeState(), siegeConnections, 'milan', 'p1', names);
    expect(rows.find((r) => r.territoryId === 'rome')?.connectionType).toBe('land');
    expect(rows.find((r) => r.territoryId === 'turin')?.connectionType).toBe('sea');
  });

  it('offers nothing for a territory I already own', () => {
    expect(listDirectAttackSources(siegeState(), siegeConnections, 'rome', 'p1', names)).toEqual([]);
  });

  it('offers nothing outside the attack phase', () => {
    const fortifying = { ...siegeState(), phase: 'fortify' } as unknown as GameState;
    expect(listDirectAttackSources(fortifying, siegeConnections, 'milan', 'p1', names)).toEqual([]);
  });

  it('offers nothing without a viewer', () => {
    expect(listDirectAttackSources(siegeState(), siegeConnections, 'milan', null, names)).toEqual([]);
  });

  it('offers a capturable neutral frontier the same way, when the rules allow it', () => {
    const neutral = {
      ...siegeState({ milan: { owner_id: null, unit_count: 2 } }),
      settings: { era_advancement_enabled: true },
    } as unknown as GameState;
    const rows = listDirectAttackSources(neutral, siegeConnections, 'milan', 'p1', names);
    expect(rows.map((r) => r.territoryId)).toEqual(['turin', 'rome']);
  });

  it('does not offer a neutral the rules make untakeable', () => {
    // Same board, era advancement off and no orbit lane: computePhaseAdjacencyTargets
    // refuses the neutral, so this must too rather than offering a doomed click.
    const neutral = siegeState({ milan: { owner_id: null, unit_count: 2 } });
    expect(listDirectAttackSources(neutral, siegeConnections, 'milan', 'p1', names)).toEqual([]);
  });

  it('falls back to the territory id when no display name is known', () => {
    const rows = listDirectAttackSources(siegeState(), siegeConnections, 'milan', 'p1', new Map());
    expect(rows.map((r) => r.name)).toEqual(['turin', 'rome']);
  });
});

describe('canAttackFrom', () => {
  const state = {
    phase: 'attack',
    territories: {
      rome: { territory_id: 'rome', owner_id: 'p1', unit_count: 2 },
      genoa: { territory_id: 'genoa', owner_id: 'p1', unit_count: 1 },
      milan: { territory_id: 'milan', owner_id: 'p2', unit_count: 9 },
      ruins: { territory_id: 'ruins', owner_id: null, unit_count: 0 },
    },
    players: [],
  } as unknown as GameState;

  it('accepts my territory at the two-unit minimum', () => {
    expect(canAttackFrom(state, 'rome', 'p1')).toBe(true);
  });

  it('rejects a drained stack — one unit has to hold the ground', () => {
    expect(canAttackFrom(state, 'genoa', 'p1')).toBe(false);
  });

  it("rejects someone else's territory, however large", () => {
    expect(canAttackFrom(state, 'milan', 'p1')).toBe(false);
  });

  it('rejects unowned ground and unknown ids without throwing', () => {
    expect(canAttackFrom(state, 'ruins', 'p1')).toBe(false);
    expect(canAttackFrom(state, 'atlantis', 'p1')).toBe(false);
  });

  it('rejects when there is no viewer', () => {
    expect(canAttackFrom(state, 'rome', null)).toBe(false);
  });
});

describe('listBorderingOwned', () => {
  const state = {
    phase: 'attack',
    territories: {
      rome: { territory_id: 'rome', owner_id: 'p1', unit_count: 5 },
      genoa: { territory_id: 'genoa', owner_id: 'p1', unit_count: 1 },
      milan: { territory_id: 'milan', owner_id: 'p2', unit_count: 3 },
      turin: { territory_id: 'turin', owner_id: 'p2', unit_count: 3 },
    },
    players: [],
  } as unknown as GameState;
  const conns = [
    { from: 'rome', to: 'milan', type: 'land' as const },
    { from: 'genoa', to: 'milan', type: 'land' as const },
    { from: 'milan', to: 'turin', type: 'land' as const },
  ];

  it('counts thin stacks too — that is the point of it', () => {
    expect(listBorderingOwned(state, conns, 'milan', 'p1').sort()).toEqual(['genoa', 'rome']);
  });

  it('distinguishes "nothing borders it" from "what borders it is too thin"', () => {
    // turin borders only milan (p2's), so p1 has nothing next to it at all.
    expect(listBorderingOwned(state, conns, 'turin', 'p1')).toEqual([]);
  });

  it('never lists the same territory twice on a doubled connection', () => {
    const doubled = [...conns, { from: 'milan', to: 'rome', type: 'sea' as const }];
    expect(listBorderingOwned(state, doubled, 'milan', 'p1').sort()).toEqual(['genoa', 'rome']);
  });

  it('returns nothing without a viewer', () => {
    expect(listBorderingOwned(state, conns, 'milan', null)).toEqual([]);
  });
});

describe('computeFortifyReachable — orbit parity with the server', () => {
  /**
   * The server's fortify BFS refuses orbit lanes the player cannot cross, so a
   * client BFS that still walks them reports Moon tiles as reachable to a
   * player with no Launch Pad. Reachability drives the valid-source hint, and
   * is the natural basis for any destination highlighting, so a false positive
   * here is the UI promising a move the server will reject.
   */
  const spaceAge = {
    era: 'space_age',
    settings: {},
    territories: {
      na_east: { territory_id: 'na_east', owner_id: 'p1', unit_count: 9, buildings: [] },
      na_pad: { territory_id: 'na_pad', owner_id: 'p1', unit_count: 9, buildings: [] },
      moon_a: { territory_id: 'moon_a', owner_id: 'p1', unit_count: 9, buildings: [] },
      moon_b: { territory_id: 'moon_b', owner_id: 'p1', unit_count: 9, buildings: [] },
    },
    players: [{ player_id: 'p1', unlocked_techs: ['sa_lunar_expansion'], space_station_launched: true }],
  } as unknown as GameState;

  const conns = [
    { from: 'na_east', to: 'na_pad', type: 'land' as const },
    { from: 'na_pad', to: 'moon_a', type: 'orbit' as const },
    { from: 'moon_a', to: 'moon_b', type: 'land' as const },
  ];

  const noOrbit = (conn: { type?: string }) => conn.type !== 'orbit';

  it('walks the lane when the caller says the player may cross it', () => {
    const r = computeFortifyReachable(spaceAge, conns, 'na_east', 'p1', () => true, () => true);
    expect([...r].sort()).toEqual(['moon_a', 'moon_b', 'na_pad']);
  });

  it('stops at the lane when the player may not cross it', () => {
    const r = computeFortifyReachable(spaceAge, conns, 'na_east', 'p1', () => true, noOrbit);
    expect([...r]).toEqual(['na_pad']);
  });

  it('leaves interior movement on the far world alone', () => {
    // Stranded on the Moon is not frozen on the Moon: land edges still walk.
    const r = computeFortifyReachable(spaceAge, conns, 'moon_a', 'p1', () => true, noOrbit);
    expect([...r]).toEqual(['moon_b']);
  });

  it('drops a source whose only destinations were across a lane it cannot use', () => {
    const onlyLane = {
      ...spaceAge,
      phase: 'fortify',
      territories: {
        na_pad: { territory_id: 'na_pad', owner_id: 'p1', unit_count: 9, buildings: [] },
        moon_a: { territory_id: 'moon_a', owner_id: 'p1', unit_count: 9, buildings: [] },
      },
    } as unknown as GameState;
    const laneOnly = [{ from: 'na_pad', to: 'moon_a', type: 'orbit' as const }];

    expect(computeValidSources(onlyLane, laneOnly, 'p1').has('na_pad')).toBe(true);
    expect(
      computeValidSources(onlyLane, laneOnly, 'p1', { canTraverse: noOrbit }).has('na_pad'),
    ).toBe(false);
  });
});

describe('computePhaseAdjacencyTargets — fortifyReachable', () => {
  /**
   * The map can light every territory a fortify could reach; the panel's picker
   * cannot, because that set is the size of the player's connected empire
   * (measured 25-37 rows on a mid-size board at 60% control). So the option is
   * opt-in, and these pin which caller gets which.
   */
  const chain = {
    phase: 'fortify',
    era: 'modern',
    settings: {},
    territories: {
      a: { territory_id: 'a', owner_id: 'p1', unit_count: 9 },
      b: { territory_id: 'b', owner_id: 'p1', unit_count: 9 },
      c: { territory_id: 'c', owner_id: 'p1', unit_count: 9 },
      d: { territory_id: 'd', owner_id: 'p2', unit_count: 9 },
    },
    players: [],
  } as unknown as GameState;
  const conns = [
    { from: 'a', to: 'b', type: 'land' as const },
    { from: 'b', to: 'c', type: 'land' as const },
    { from: 'c', to: 'd', type: 'land' as const },
  ];

  it('offers only direct neighbours by default — what the picker renders', () => {
    const t = computePhaseAdjacencyTargets(chain, conns, { attackSource: 'a' });
    expect([...t]).toEqual(['b']);
  });

  it('offers the whole connected chain when the caller asks — what the map draws', () => {
    const t = computePhaseAdjacencyTargets(chain, conns, { attackSource: 'a', fortifyReachable: true });
    expect([...t].sort()).toEqual(['b', 'c']);
  });

  it('still stops at territory it does not own', () => {
    const t = computePhaseAdjacencyTargets(chain, conns, { attackSource: 'a', fortifyReachable: true });
    expect(t.has('d')).toBe(false);
  });

  it('leaves the attack phase alone', () => {
    const attacking = { ...chain, phase: 'attack' } as unknown as GameState;
    const t = computePhaseAdjacencyTargets(attacking, conns, { attackSource: 'c', fortifyReachable: true });
    // Neighbours only, and only enemies — reachability is a fortify rule.
    expect([...t]).toEqual(['d']);
  });

  it('honours the per-edge rule, so an uncrossable lane is not lit', () => {
    const overLane = [
      { from: 'a', to: 'b', type: 'land' as const },
      { from: 'b', to: 'c', type: 'orbit' as const },
    ];
    const t = computePhaseAdjacencyTargets(chain, overLane, {
      attackSource: 'a',
      fortifyReachable: true,
      canTraverse: (conn) => conn.type !== 'orbit',
    });
    expect([...t]).toEqual(['b']);
  });

  it('keeps the picker neighbours-only even on a long chain', () => {
    // listNeighborTargets never passes the option, so the panel cannot
    // accidentally inherit the full set.
    const rows = listNeighborTargets(chain, conns, 'a', new Map([['b', 'Bee'], ['c', 'Cee']]));
    expect(rows.map((r) => r.territoryId)).toEqual(['b']);
  });
});

describe('a Jump Gate lane is not an attack target', () => {
  it('is skipped in the attack phase, while an authored lane is offered', () => {
    const state = {
      phase: 'attack',
      settings: {},
      players: [{ player_id: 'me' }, { player_id: 'rival' }],
      territories: {
        a: { owner_id: 'me', unit_count: 9 },
        b: { owner_id: 'rival', unit_count: 1 },
        c: { owner_id: 'rival', unit_count: 1 },
      },
    } as unknown as GameState;
    const connections: MapConnection[] = [
      { from: 'a', to: 'b', type: 'orbit' },
      { from: 'a', to: 'c', type: 'orbit', source: 'jump_gate' },
    ];
    const targets = computePhaseAdjacencyTargets(state, connections, { sourceTerritoryId: 'a' });
    expect([...targets]).toEqual(['b']);
  });
});
