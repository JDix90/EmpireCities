import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allianceTerritoryThreshold, assignSecretMissions, isMissionComplete } from './missions';
import { checkVictory, initializeGameState } from '../state/gameStateManager';
import { executeLandAttack } from '../combat/executeLandAttack';
import type { GameMap, GameState, PlayerState } from '../../types';

function mkPlayer(id: string, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    player_id: id, player_index: 0, username: id, color: '#fff', is_ai: false,
    is_eliminated: false, territory_count: 1, cards: [], mmr: 1000,
    capital_territory_id: null, secret_mission: null, ...overrides,
  } as PlayerState;
}

const miniMap: GameMap = {
  map_id: 'm',
  name: 'M',
  territories: [
    { territory_id: 'a', name: 'A', polygon: [], center_point: [0, 0], region_id: 'north' },
    { territory_id: 'b', name: 'B', polygon: [], center_point: [0, 0], region_id: 'north' },
    { territory_id: 'c', name: 'C', polygon: [], center_point: [0, 0], region_id: 'south' },
  ],
  connections: [],
  regions: [
    { region_id: 'north', name: 'N', bonus: 1 },
    { region_id: 'south', name: 'S', bonus: 1 },
  ],
};

function baseState(players: PlayerState[]): GameState {
  return {
    game_id: 'g',
    era: 'ancient',
    map_id: 'm',
    phase: 'attack',
    current_player_index: 0,
    // Missions and transcendence are judged from round 2 (victory/openingRound.ts).
    turn_number: 2,
    players,
    territories: {
      a: { territory_id: 'a', owner_id: 'p1', unit_count: 3, unit_type: 'infantry' },
      b: { territory_id: 'b', owner_id: 'p1', unit_count: 2, unit_type: 'infantry' },
      c: { territory_id: 'c', owner_id: 'p2', unit_count: 3, unit_type: 'infantry' },
    },
    card_deck: [],
    card_set_redemption_count: 0,
    diplomacy: [],
    settings: {
      fog_of_war: false,
      allowed_victory_conditions: ['secret_mission'],
      turn_timer_seconds: 0,
      initial_unit_count: 3,
      card_set_escalating: true,
      diplomacy_enabled: false,
    },
    draft_units_remaining: 0,
    turn_started_at: Date.now(),
  };
}

describe('isMissionComplete', () => {
  it('capture_territories when both owned', () => {
    const p: PlayerState = {
      player_id: 'p1',
      player_index: 0,
      username: 'a',
      color: '#fff',
      is_ai: false,
      is_eliminated: false,
      territory_count: 2,
      cards: [],
      mmr: 1000,
      capital_territory_id: null,
      secret_mission: { kind: 'capture_territories', territory_ids: ['a', 'b'] },
    };
    const state = baseState([p, { ...p, player_id: 'p2', player_index: 1, secret_mission: null }]);
    expect(isMissionComplete(state, miniMap, p)).toBe(true);
  });

  it('eliminate_player completes on the holder\'s own kill, and only on it', () => {
    const p1 = mkPlayer('p1', { secret_mission: { kind: 'eliminate_player', target_player_id: 'p2' } });
    const p2 = mkPlayer('p2', { player_index: 1, is_eliminated: true, territory_count: 0 });
    const state = baseState([p1, p2]);
    for (const [by, done] of [['p1', true], ['p3', false], [null, false], [undefined, false]] as const) {
      p2.eliminated_by = by;
      // Someone else's kill, a resignation or rebels (null), or a save from
      // before the eliminator was recorded (undefined): the mission fails.
      expect({ by, done: isMissionComplete(state, miniMap, p1) }).toEqual({ by, done });
    }
  });

  it('reach_era completes once the player hits the target era index', () => {
    const below = mkPlayer('p1', { current_era_index: 1, secret_mission: { kind: 'reach_era', era_index: 2, era_id: 'discovery' } });
    const state = baseState([below, mkPlayer('p2')]);
    expect(isMissionComplete(state, miniMap, below)).toBe(false);
    below.current_era_index = 2;
    expect(isMissionComplete(state, miniMap, below)).toBe(true);
  });
});

describe('an eliminate mission when someone else gets there first', () => {
  it('wins for the player who took the last territory, and not for anyone else', () => {
    // p1 and p3 both hold "Eliminate p2". p3 takes p2's last territory.
    const map: GameMap = {
      ...miniMap,
      connections: [{ from: 'a', to: 'c', type: 'land' }],
    } as GameMap;
    const p1 = mkPlayer('p1', { secret_mission: { kind: 'eliminate_player', target_player_id: 'p2' } });
    const p2 = mkPlayer('p2', { player_index: 1 });
    const p3 = mkPlayer('p3', { player_index: 2, secret_mission: { kind: 'eliminate_player', target_player_id: 'p2' } });
    const state = baseState([p1, p2, p3]);
    state.territories = {
      a: { territory_id: 'a', owner_id: 'p3', unit_count: 10, unit_type: 'infantry' },
      b: { territory_id: 'b', owner_id: 'p1', unit_count: 3, unit_type: 'infantry' },
      c: { territory_id: 'c', owner_id: 'p2', unit_count: 1, unit_type: 'infantry' },
    };
    const rolls = [6, 6, 6, 1]; // p3's three dice, then p2's one
    expect(executeLandAttack(state, 'p3', 'a', 'c', { dieRoll: () => rolls.shift() ?? 1 })?.captured).toBe(true);
    expect(p2).toMatchObject({ is_eliminated: true, eliminated_by: 'p3' });
    expect(isMissionComplete(state, map, p1)).toBe(false);
    expect(checkVictory(state, map)).toEqual({ winnerIds: ['p3'], condition: 'secret_mission' });
  });
});

describe('assignSecretMissions — era missions', () => {
  it('assigns a reach_era objective when era advancement is on', () => {
    const state = baseState([mkPlayer('p1'), mkPlayer('p2')]);
    state.settings.era_advancement_enabled = true;
    assignSecretMissions(state, miniMap, () => 0.1); // roll < 0.25 → era branch
    expect(state.players[0].secret_mission?.kind).toBe('reach_era');
  });

  it('does not assign era missions in non-era games (RNG stream unchanged)', () => {
    const state = baseState([mkPlayer('p1'), mkPlayer('p2')]);
    assignSecretMissions(state, miniMap, () => 0.1);
    expect(state.players[0].secret_mission?.kind).not.toBe('reach_era');
  });
});

describe('assignSecretMissions — never a mission already won', () => {
  it('does not name a region its holder already holds whole', () => {
    // p1 holds all of north. The rolls take the region branch (0.9), a
    // one-region mission (0.1) and the first region in the pool (0): north.
    const rolls = [0.9, 0.1, 0];
    const state = baseState([mkPlayer('p1'), mkPlayer('p2')]);
    assignSecretMissions(state, miniMap, () => rolls.shift() ?? 0);
    for (const p of state.players) {
      expect({ player: p.player_id, won: isMissionComplete(state, miniMap, p) })
        .toEqual({ player: p.player_id, won: false });
    }
  });
});

describe('assignSecretMissions — orbit-gated targets excluded', () => {
  // A map with a Moon: moon tiles are behind the orbit-access ladder, so no
  // mission may target them or their region — that assignment would be wildly
  // unfair vs a rival whose mission is two ordinary tiles.
  const moonMap: GameMap = {
    ...miniMap,
    map_id: 'm_moon',
    territories: [
      ...miniMap.territories,
      { territory_id: 'moon_1', name: 'Moon 1', polygon: [], center_point: [0, 0], region_id: 'lunar', world_id: 'moon' },
      { territory_id: 'moon_2', name: 'Moon 2', polygon: [], center_point: [0, 0], region_id: 'lunar', world_id: 'moon' },
    ],
    regions: [...miniMap.regions, { region_id: 'lunar', name: 'Lunar', bonus: 6 }],
  } as GameMap;

  it('never targets moon territories or the all-gated lunar region', () => {
    // Sweep RNG values so every mission branch (capture / eliminate / regions) is hit.
    for (const roll of [0.05, 0.3, 0.5, 0.7, 0.9, 0.99]) {
      const state = baseState([mkPlayer('p1'), mkPlayer('p2')]);
      assignSecretMissions(state, moonMap, () => roll);
      for (const p of state.players) {
        const m = p.secret_mission;
        if (!m) continue;
        if (m.kind === 'capture_territories') {
          expect(m.territory_ids.some((t) => t.startsWith('moon_'))).toBe(false);
        }
        if (m.kind === 'control_regions') {
          expect(m.region_ids.includes('lunar')).toBe(false);
        }
      }
    }
  });
});

describe('assignSecretMissions — era-locked frontier targets (real era_space_age map)', () => {
  // era_space_age.json authors 8 tiles with `unlock_era_index` 1..5, and five
  // regions consist ONLY of them. With `space_age_frontiers_enabled` off those
  // tiles are never placed in `state.territories`, and mission completion reads
  // `state.territories[id]?.owner_id` — so a mission naming one of them (or one
  // of the frontier-only regions) was permanently unwinnable. Measured before
  // the fix: ~37% of capture_territories and ~48% of control_regions missions.
  const realMap = JSON.parse(
    readFileSync(join(__dirname, '../../../../database/maps/era_space_age.json'), 'utf8'),
  ) as GameMap;
  const frontierIds = new Set(
    realMap.territories.filter((t) => (t.unlock_era_index ?? 0) > 0).map((t) => t.territory_id),
  );
  const frontierOnlyRegions = [
    'pacific_frontier_2100',
    'polar_frontier_2100',
    'antarctic_2100',
    'atlantic_frontier_2100',
    'orbital_gateway_2100',
  ];

  function initSpaceAge(gameId: string, frontiersEnabled: boolean): GameState {
    return initializeGameState(
      gameId,
      'space_age',
      realMap,
      [0, 1, 2, 3].map((i) => ({
        player_id: `p${i + 1}`,
        player_index: i,
        username: `P${i + 1}`,
        color: '#abc',
        is_ai: i > 0,
        is_eliminated: false,
        mmr: 1000,
      })),
      {
        fog_of_war: false,
        victory_type: 'domination',
        allowed_victory_conditions: ['domination', 'secret_mission'],
        turn_timer_seconds: 0,
        initial_unit_count: 3,
        card_set_escalating: true,
        diplomacy_enabled: false,
        economy_enabled: true,
        tech_enabled: true,
        factions_enabled: false,
        space_age_frontiers_enabled: frontiersEnabled,
      },
    );
  }

  it('pins the map shape the regression depends on', () => {
    expect(frontierIds.size).toBe(8);
    for (const rid of frontierOnlyRegions) {
      const tiles = realMap.territories.filter((t) => t.region_id === rid);
      expect(tiles.length).toBeGreaterThan(0);
      expect(tiles.every((t) => frontierIds.has(t.territory_id))).toBe(true);
    }
  });

  it('flag off: every mission target exists on the live board (50 seeded games)', () => {
    let captureMissions = 0;
    let regionMissions = 0;
    for (let i = 0; i < 50; i++) {
      const state = initSpaceAge(`space-age-missions-${i}`, false);
      for (const tid of frontierIds) expect(state.territories[tid]).toBeUndefined();
      for (const p of state.players) {
        const m = p.secret_mission;
        if (!m) continue;
        if (m.kind === 'capture_territories') {
          captureMissions++;
          for (const tid of m.territory_ids) expect(state.territories[tid]).toBeDefined();
        }
        if (m.kind === 'control_regions') {
          regionMissions++;
          for (const rid of m.region_ids) expect(frontierOnlyRegions).not.toContain(rid);
        }
      }
    }
    // Guard against a vacuous pass if the RNG branch mix ever changes.
    expect(captureMissions).toBeGreaterThan(0);
    expect(regionMissions).toBeGreaterThan(0);
  });

  it('flag on: the full 63-tile board is seeded and frontier targets are allowed', () => {
    let sawFrontierTarget = false;
    for (let i = 0; i < 50; i++) {
      const state = initSpaceAge(`space-age-frontiers-${i}`, true);
      expect(Object.keys(state.territories).length).toBe(realMap.territories.length);
      expect(state.map_era_floor).toBe(5);
      for (const p of state.players) {
        const m = p.secret_mission;
        if (!m) continue;
        if (m.kind === 'capture_territories') {
          for (const tid of m.territory_ids) expect(state.territories[tid]).toBeDefined();
          if (m.territory_ids.some((tid) => frontierIds.has(tid))) sawFrontierTarget = true;
        }
        if (m.kind === 'control_regions' && m.region_ids.some((r) => frontierOnlyRegions.includes(r))) {
          sawFrontierTarget = true;
        }
      }
    }
    // Frontiers are now on the board, so they are legitimate targets again.
    expect(sawFrontierTarget).toBe(true);
  });
});

describe('transcendence victory', () => {
  function transcendState(p1Era: number, wonderOwner: string | null): GameState {
    const state = baseState([mkPlayer('p1', { current_era_index: p1Era }), mkPlayer('p2', { current_era_index: 0 })]);
    state.settings.allowed_victory_conditions = ['transcendence'];
    state.settings.era_advancement_enabled = true;
    if (wonderOwner) state.territories.a.buildings = ['wonder_great_library'];
    state.territories.a.owner_id = wonderOwner ?? 'p1';
    return state;
  }

  it('wins when at the final era AND holding the wonder', () => {
    // poc spine → max era index 1; p1 at era 1 owns the wonder on territory a.
    expect(checkVictory(transcendState(1, 'p1'), miniMap)).toEqual({ winnerIds: ['p1'], condition: 'transcendence' });
  });

  it('does not win without the wonder', () => {
    expect(checkVictory(transcendState(1, null), miniMap)).toBeNull();
  });

  it('does not win before reaching the final era', () => {
    expect(checkVictory(transcendState(0, 'p1'), miniMap)).toBeNull();
  });
});

/**
 * Space Age lunar missions (Moon Race, Phase 5).
 *
 * The load-bearing property is NOT the missions themselves — two of the four
 * reuse existing kinds — but that the branch is invisible to every other game.
 * `assignSecretMissions` draws from one seeded stream, so an extra `rng()` call
 * in the wrong place silently re-rolls every mission on every map.
 */

const lunarMap: GameMap = {
  map_id: 'era_space_age',
  name: 'Space Age',
  territories: [
    { territory_id: 'na_launch_base', name: 'Launch Base', polygon: [], center_point: [0, 0], region_id: 'north_america_2100' },
    { territory_id: 'euro_spaceport', name: 'Spaceport', polygon: [], center_point: [0, 0], region_id: 'europe_2100' },
    ...['moon_polar_north', 'moon_polar_south', 'moon_mare_imbrium', 'moon_far_side_north'].map((id) => ({
      territory_id: id, name: id, polygon: [], center_point: [0, 0] as [number, number],
      region_id: 'lunar_surface', globe_id: 'moon',
    })),
  ],
  connections: [],
  regions: [
    { region_id: 'north_america_2100', name: 'NA', bonus: 2 },
    { region_id: 'europe_2100', name: 'EU', bonus: 2 },
    { region_id: 'lunar_surface', name: 'Lunar Surface', bonus: 6 },
  ],
} as unknown as GameMap;

function lunarState(players: PlayerState[], enabled: boolean, moonOwners: Record<string, string | null> = {}): GameState {
  const state = baseState(players);
  state.map_id = 'era_space_age';
  state.era = 'space_age';
  state.territories = {
    na_launch_base: { territory_id: 'na_launch_base', owner_id: 'p1', unit_count: 3, unit_type: 'infantry' },
    euro_spaceport: { territory_id: 'euro_spaceport', owner_id: 'p2', unit_count: 3, unit_type: 'infantry' },
  } as GameState['territories'];
  for (const t of lunarMap.territories.filter((x) => x.region_id === 'lunar_surface')) {
    state.territories[t.territory_id] = {
      territory_id: t.territory_id, owner_id: moonOwners[t.territory_id] ?? null,
      unit_count: 3, unit_type: 'infantry', region_id: 'lunar_surface', globe_id: 'moon',
    } as GameState['territories'][string];
  }
  state.settings.space_age_moon_missions_enabled = enabled;
  return state;
}

describe('lunar missions — completion', () => {
  const p1 = () => mkPlayer('p1');

  it('completes a foothold once the tile count is reached', () => {
    const player = p1();
    player.secret_mission = { kind: 'lunar_foothold', tiles: 3 };
    const two = lunarState([player], true, { moon_polar_north: 'p1', moon_polar_south: 'p1' });
    expect(isMissionComplete(two, lunarMap, player)).toBe(false);
    const three = lunarState([player], true, {
      moon_polar_north: 'p1', moon_polar_south: 'p1', moon_mare_imbrium: 'p1',
    });
    expect(isMissionComplete(three, lunarMap, player)).toBe(true);
  });

  it('completes a denial only while the holder is themselves on the Moon', () => {
    // Both halves matter. Without the first, the mission would be satisfied by
    // a rival who simply never went — which is not a denial, it is a wish.
    const player = p1();
    player.secret_mission = { kind: 'lunar_denial', target_player_id: 'p2' };
    const neither = lunarState([player, mkPlayer('p2')], true);
    expect(isMissionComplete(neither, lunarMap, player)).toBe(false);

    // One tile is not enough: at that bar the objective is really just "be
    // first to the Moon", which measured three times easier than any other
    // mission in the deck.
    const one = lunarState([player, mkPlayer('p2')], true, { moon_polar_north: 'p1' });
    expect(isMissionComplete(one, lunarMap, player)).toBe(false);

    const foothold = lunarState([player, mkPlayer('p2')], true, {
      moon_polar_north: 'p1', moon_polar_south: 'p1', moon_mare_imbrium: 'p1',
    });
    expect(isMissionComplete(foothold, lunarMap, player)).toBe(true);
  });

  it('fails a denial the moment the target lands', () => {
    const player = p1();
    player.secret_mission = { kind: 'lunar_denial', target_player_id: 'p2' };
    const shared = lunarState([player, mkPlayer('p2')], true, {
      moon_polar_north: 'p1', moon_polar_south: 'p1', moon_mare_imbrium: 'p1',
      moon_far_side_north: 'p2',
    });
    expect(isMissionComplete(shared, lunarMap, player)).toBe(false);
  });

  it('reads the whole-Moon objective through the existing region rule', () => {
    const player = p1();
    player.secret_mission = { kind: 'control_regions', region_ids: ['lunar_surface'] };
    const partial = lunarState([player], true, { moon_polar_north: 'p1', moon_polar_south: 'p1' });
    expect(isMissionComplete(partial, lunarMap, player)).toBe(false);
    const all = lunarState([player], true, Object.fromEntries(
      lunarMap.territories.filter((t) => t.region_id === 'lunar_surface').map((t) => [t.territory_id, 'p1']),
    ));
    expect(isMissionComplete(all, lunarMap, player)).toBe(true);
  });
});

describe('lunar missions — assignment', () => {
  it('hands out a lunar objective on a Space Age board with the phase on', () => {
    const players = [mkPlayer('p1'), mkPlayer('p2')];
    const state = lunarState(players, true);
    assignSecretMissions(state, lunarMap, () => 0.1); // roll < 0.30 → lunar branch
    for (const p of players) {
      const m = p.secret_mission!;
      const isLunar = m.kind === 'lunar_foothold'
        || m.kind === 'lunar_denial'
        || (m.kind === 'control_regions' && m.region_ids.includes('lunar_surface'))
        || (m.kind === 'capture_territories' && m.territory_ids.every((id) => id.startsWith('moon_')));
      expect(isLunar, `${JSON.stringify(m)} is not lunar`).toBe(true);
    }
  });

  it('hands out nothing lunar while the phase is off', () => {
    const players = [mkPlayer('p1'), mkPlayer('p2')];
    const state = lunarState(players, false);
    assignSecretMissions(state, lunarMap, () => 0.1);
    for (const p of players) {
      expect(p.secret_mission!.kind).not.toBe('lunar_foothold');
      expect(p.secret_mission!.kind).not.toBe('lunar_denial');
    }
  });

  it('leaves the RNG stream of every other game byte-identical', () => {
    // The branch is gated on a setting no other game carries, exactly like the
    // era-advancement branch above it. A stray rng() draw here would silently
    // re-roll every mission on every map in the game.
    const seeded = () => {
      let i = 0;
      const seq = [0.05, 0.4, 0.61, 0.2, 0.9, 0.33, 0.5, 0.77, 0.12, 0.66];
      return () => seq[i++ % seq.length]!;
    };
    const withPhase = [mkPlayer('p1'), mkPlayer('p2'), mkPlayer('p3')];
    const withoutPhase = [mkPlayer('p1'), mkPlayer('p2'), mkPlayer('p3')];

    const a = baseState(withPhase);
    a.settings.space_age_moon_missions_enabled = true;   // on, but NOT a Space Age board
    assignSecretMissions(a, miniMap, seeded());
    const b = baseState(withoutPhase);
    assignSecretMissions(b, miniMap, seeded());

    expect(withPhase.map((p) => p.secret_mission)).toEqual(withoutPhase.map((p) => p.secret_mission));
  });

  it('draws no dice at all when the branch is not taken', () => {
    // The real risk: a Space Age game with the phase OFF, or a roll above the
    // lunar slot, must consume exactly the dice it always did. Comparing the
    // resulting missions is the strongest available check — an extra draw
    // anywhere would shift every mission after it.
    const seq = [0.55, 0.4, 0.61, 0.2, 0.9, 0.33, 0.5, 0.77, 0.12, 0.66];
    const run = (enabled: boolean) => {
      const players = [mkPlayer('p1'), mkPlayer('p2'), mkPlayer('p3')];
      const state = lunarState(players, enabled);
      let i = 0;
      assignSecretMissions(state, lunarMap, () => seq[i++ % seq.length]!);
      return players.map((p) => p.secret_mission);
    };
    // 0.55 is above the 0.30 lunar slot, so the branch must not fire and the
    // two runs must be indistinguishable.
    expect(run(true)).toEqual(run(false));
  });

  it('never offers a denial with nobody to deny', () => {
    const solo = [mkPlayer('p1')];
    const state = lunarState(solo, true);
    assignSecretMissions(state, lunarMap, () => 0.1);
    expect(solo[0].secret_mission!.kind).not.toBe('lunar_denial');
  });
});

describe('alliance missions', () => {
  // era_ww2 authors 42 tiles and holds 7 frontiers back for Era Advancement,
  // so a game deals 35.
  const ww2 = JSON.parse(
    readFileSync(join(__dirname, '../../../../database/maps/era_ww2.json'), 'utf8'),
  ) as GameMap;

  function initWw2(gameId: string, seats: number, humans: number): GameState {
    return initializeGameState(
      gameId,
      'ww2',
      ww2,
      Array.from({ length: seats }, (_, i) => ({
        player_id: `p${i + 1}`, player_index: i, username: `P${i + 1}`, color: '#abc',
        is_ai: i >= humans, is_eliminated: false, mmr: 1000,
      })),
      {
        fog_of_war: false,
        allowed_victory_conditions: ['secret_mission'],
        turn_timer_seconds: 0,
        initial_unit_count: 3,
        card_set_escalating: true,
        diplomacy_enabled: false,
      },
    );
  }

  /** A one-region board dealt `counts[i]` tiles to seat i, every seat human. */
  function dealtBoard(counts: number[], eliminated: string[] = []): { state: GameState; map: GameMap } {
    const total = counts.reduce((a, b) => a + b, 0);
    const map = {
      ...miniMap,
      territories: Array.from({ length: total }, (_, i) => ({
        territory_id: `t${i}`, name: `T${i}`, polygon: [], center_point: [0, 0], region_id: 'north',
      })),
    } as GameMap;
    const players = counts.map((n, i) => mkPlayer(`p${i + 1}`, {
      player_index: i, territory_count: n, is_eliminated: eliminated.includes(`p${i + 1}`),
    }));
    const state = baseState(players);
    state.territories = {};
    let t = 0;
    counts.forEach((n, i) => {
      for (let k = 0; k < n; k++, t++) {
        state.territories[`t${t}`] = { territory_id: `t${t}`, owner_id: `p${i + 1}`, unit_count: 1, unit_type: 'infantry' };
      }
    });
    return { state, map };
  }

  // A constant 0.1 takes the alliance branch (< 0.20) and pairs the first two
  // humans still seated.
  const allianceRoll = () => 0.1;
  const alliesOf = (state: GameState) =>
    state.players.filter((p) => p.secret_mission?.kind === 'alliance').map((p) => p.player_id);

  it('asks each ally for an even share of the tiles dealt, plus 7% of them', () => {
    // 35 dealt: 8.75 + 2.45 → 12 at 4 seats, 7 + 2.45 → 10 at 5, 5.83 + 2.45 → 9 at 6.
    expect([4, 5, 6].map((n) => allianceTerritoryThreshold(initWw2('ww2-threshold', n, 2)))).toEqual([12, 10, 9]);
  });

  it('is never won at the deal (100 seeded 4-seat WW2 games with two humans)', () => {
    let alliances = 0;
    for (let i = 0; i < 100; i++) {
      const state = initWw2(`ww2-alliance-${i}`, 4, 2);
      const allies = state.players.filter((p) => p.secret_mission?.kind === 'alliance');
      if (allies.length === 0) continue;
      alliances += 1;
      expect(allies.map((p) => p.is_ai)).toEqual([false, false]);
      expect(allies.map((p) => p.secret_mission)).toEqual([
        { kind: 'alliance', ally_player_id: allies[1]!.player_id, territory_threshold: 12 },
        { kind: 'alliance', ally_player_id: allies[0]!.player_id, territory_threshold: 12 },
      ]);
      expect({ game: i, victory: checkVictory(state, ww2) }).toEqual({ game: i, victory: null });
    }
    // Guard against a vacuous pass: about one game in six deals an alliance.
    expect(alliances).toBeGreaterThan(5);
  });

  it('pairs two allies neither of whom holds the threshold yet', () => {
    // 20 dealt at 4 seats: ceil(5 + 1.4) = 7 each.
    const { state, map } = dealtBoard([5, 5, 5, 5]);
    assignSecretMissions(state, map, allianceRoll);
    expect(alliesOf(state)).toEqual(['p1', 'p2']);
    expect(state.players[0]!.secret_mission).toEqual({ kind: 'alliance', ally_player_id: 'p2', territory_threshold: 7 });
  });

  it('is never dealt half-won: an ally already at the threshold keeps an ordinary mission', () => {
    const { state, map } = dealtBoard([8, 4, 4, 4]);
    assignSecretMissions(state, map, allianceRoll);
    expect(alliesOf(state)).toEqual([]);
    expect(state.players.map((p) => p.secret_mission?.kind)).not.toContain(undefined);
  });

  it('never pairs a player who resigned during the draft, nor counts their seat', () => {
    // p1 resigned: their tiles went neutral. 20 dealt among the 4 still seated.
    const { state, map } = dealtBoard([0, 5, 5, 5, 5], ['p1']);
    assignSecretMissions(state, map, allianceRoll);
    expect(alliesOf(state)).toEqual(['p2', 'p3']);
    expect(state.players[1]!.secret_mission).toEqual({ kind: 'alliance', ally_player_id: 'p3', territory_threshold: 7 });
  });

  it('needs four players still seated', () => {
    // Holdings the half-won guard cannot mask: were p1's seat counted, p1 and
    // p2 would both be short of the threshold and paired.
    const { state, map } = dealtBoard([0, 2, 8, 8], ['p1']);
    assignSecretMissions(state, map, allianceRoll);
    expect(alliesOf(state)).toEqual([]);
  });
});
