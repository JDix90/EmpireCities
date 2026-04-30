import { describe, it, expect } from 'vitest';
import { selectAiBuildingPlacement, selectAiTechResearch, computeAiTurn } from '../aiBot';
import type { GameState, PlayerState, TerritoryState, GameSettings, GameMap } from '../../../types';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeSettings(overrides?: Partial<GameSettings>): GameSettings {
  return {
    fog_of_war: false,
    victory_type: 'domination',
    allowed_victory_conditions: ['domination'],
    turn_timer_seconds: 0,
    initial_unit_count: 3,
    card_set_escalating: true,
    diplomacy_enabled: false,
    economy_enabled: true,
    tech_trees_enabled: false,
    ...overrides,
  };
}

function makePlayer(id: string, idx: number, extras?: Partial<PlayerState>): PlayerState {
  return {
    player_id: id,
    player_index: idx,
    username: `Player${idx}`,
    color: '#000',
    is_ai: true,
    is_eliminated: false,
    territory_count: 0,
    cards: [],
    mmr: 1000,
    capital_territory_id: null,
    secret_mission: null,
    special_resource: 10,
    tech_points: 0,
    unlocked_techs: [],
    ...extras,
  };
}

function makeTerritory(id: string, owner: string | null, units: number, extras?: Partial<TerritoryState>): TerritoryState {
  return { territory_id: id, owner_id: owner, unit_count: units, unit_type: 'infantry', buildings: [], ...extras };
}

function makeState(overrides?: Partial<GameState>): GameState {
  return {
    game_id: 'test-game',
    era: 'ancient',
    map_id: 'test_map',
    phase: 'draft',
    current_player_index: 0,
    turn_number: 1,
    players: [makePlayer('p1', 0), makePlayer('p2', 1)],
    territories: {
      t1: makeTerritory('t1', 'p1', 3),
      t2: makeTerritory('t2', 'p1', 2),
      t3: makeTerritory('t3', 'p2', 5),
    },
    card_deck: [],
    card_set_redemption_count: 0,
    diplomacy: [],
    settings: makeSettings(),
    draft_units_remaining: 5,
    turn_started_at: Date.now(),
    win_probability_history: [],
    ...overrides,
  };
}

/** Minimal map for adjacency: t1—t2—t3 */
function makeMap(): GameMap {
  return {
    map_id: 'test_map',
    name: 'Test',
    territories: [
      { territory_id: 't1', name: 'T1', center_x: 0, center_y: 0, region_id: 'r1', svg_path: '' },
      { territory_id: 't2', name: 'T2', center_x: 10, center_y: 0, region_id: 'r1', svg_path: '' },
      { territory_id: 't3', name: 'T3', center_x: 20, center_y: 0, region_id: 'r1', svg_path: '' },
    ],
    connections: [
      { from: 't1', to: 't2' },
      { from: 't2', to: 't3' },
    ],
    regions: [],
    canvas_width: 800,
    canvas_height: 600,
  };
}

// ── selectAiBuildingPlacement ────────────────────────────────────────────────

describe('selectAiBuildingPlacement', () => {
  it('returns null for easy difficulty', () => {
    const state = makeState();
    expect(selectAiBuildingPlacement(state, makeMap(), 'p1', 'easy')).toBeNull();
  });

  it('returns null for tutorial difficulty', () => {
    const state = makeState();
    expect(selectAiBuildingPlacement(state, makeMap(), 'p1', 'tutorial')).toBeNull();
  });

  it('returns null when economy_enabled is false', () => {
    const state = makeState({ settings: makeSettings({ economy_enabled: false }) });
    expect(selectAiBuildingPlacement(state, makeMap(), 'p1', 'medium')).toBeNull();
  });

  it('returns null when player owns no territories', () => {
    const state = makeState({
      territories: {
        t1: makeTerritory('t1', 'p2', 3),
        t2: makeTerritory('t2', 'p2', 3),
        t3: makeTerritory('t3', 'p2', 5),
      },
    });
    expect(selectAiBuildingPlacement(state, makeMap(), 'p1', 'medium')).toBeNull();
  });

  it('medium: builds production_1 on territory with fewest buildings', () => {
    // ancient era has tech for production_1 gated behind a tech node, but
    // since tech_trees_enabled=false, tech is always unlocked.
    const state = makeState({ settings: makeSettings({ economy_enabled: true, tech_trees_enabled: false }) });
    const result = selectAiBuildingPlacement(state, makeMap(), 'p1', 'medium');
    expect(result).not.toBeNull();
    expect(result?.buildingType).toBe('production_1');
    expect(['t1', 't2']).toContain(result?.territoryId);
  });

  it('medium: returns null when player cannot afford any building', () => {
    const state = makeState({
      players: [makePlayer('p1', 0, { special_resource: 0 }), makePlayer('p2', 1)],
    });
    expect(selectAiBuildingPlacement(state, makeMap(), 'p1', 'medium')).toBeNull();
  });

  it('hard: places defense_1 on most-threatened border territory first', () => {
    // t2 is adjacent to t3 (enemy with 5 units); t1 is not adjacent to enemies
    const state = makeState({
      players: [makePlayer('p1', 0, { special_resource: 20 }), makePlayer('p2', 1)],
    });
    const result = selectAiBuildingPlacement(state, makeMap(), 'p1', 'hard');
    // t2 is adjacent to enemy t3 — should get defense_1
    expect(result?.buildingType).toBe('defense_1');
    expect(result?.territoryId).toBe('t2');
  });

  it('hard: falls back to production when border territories already have defense', () => {
    const state = makeState({
      players: [makePlayer('p1', 0, { special_resource: 20 }), makePlayer('p2', 1)],
      territories: {
        t1: makeTerritory('t1', 'p1', 3),
        // t2 adjacent to enemy and already has defense_1
        t2: makeTerritory('t2', 'p1', 2, { buildings: ['defense_1'] }),
        t3: makeTerritory('t3', 'p2', 5),
      },
    });
    const result = selectAiBuildingPlacement(state, makeMap(), 'p1', 'hard');
    expect(result?.buildingType).toBe('production_1');
  });

  it('expert behaves identically to hard for strategic placement', () => {
    const state = makeState({
      players: [makePlayer('p1', 0, { special_resource: 20 }), makePlayer('p2', 1)],
    });
    const result = selectAiBuildingPlacement(state, makeMap(), 'p1', 'expert');
    expect(result?.buildingType).toBe('defense_1');
    expect(result?.territoryId).toBe('t2');
  });
});

// ── selectAiTechResearch ─────────────────────────────────────────────────────

describe('selectAiTechResearch', () => {
  it('returns null for easy difficulty', () => {
    const state = makeState({ settings: makeSettings({ tech_trees_enabled: true }) });
    expect(selectAiTechResearch(state, 'p1', 'easy')).toBeNull();
  });

  it('returns null for tutorial difficulty', () => {
    const state = makeState({ settings: makeSettings({ tech_trees_enabled: true }) });
    expect(selectAiTechResearch(state, 'p1', 'tutorial')).toBeNull();
  });

  it('returns null when tech_trees_enabled is false', () => {
    const state = makeState({
      players: [makePlayer('p1', 0, { tech_points: 100 }), makePlayer('p2', 1)],
      settings: makeSettings({ tech_trees_enabled: false }),
    });
    expect(selectAiTechResearch(state, 'p1', 'medium')).toBeNull();
  });

  it('returns null when player has insufficient tech_points', () => {
    const state = makeState({
      players: [makePlayer('p1', 0, { tech_points: 0 }), makePlayer('p2', 1)],
      settings: makeSettings({ tech_trees_enabled: true }),
    });
    expect(selectAiTechResearch(state, 'p1', 'medium')).toBeNull();
  });

  it('medium: returns cheapest affordable tech node', () => {
    // Ancient tier-1 nodes: ancient_granaries=3, ancient_iron_weapons=4, etc.
    const state = makeState({
      players: [makePlayer('p1', 0, { tech_points: 5 }), makePlayer('p2', 1)],
      settings: makeSettings({ tech_trees_enabled: true }),
    });
    const result = selectAiTechResearch(state, 'p1', 'medium');
    // cheapest tier-1 ancient node is ancient_granaries (cost: 3)
    expect(result).toBe('ancient_granaries');
  });

  it('medium: respects prerequisite — does not pick tier-2 if prerequisite missing', () => {
    // Give player enough points for tier-2 nodes but no prereqs
    const state = makeState({
      players: [makePlayer('p1', 0, { tech_points: 8, unlocked_techs: [] }), makePlayer('p2', 1)],
      settings: makeSettings({ tech_trees_enabled: true }),
    });
    const result = selectAiTechResearch(state, 'p1', 'medium');
    // Should pick a tier-1 node since all tier-2 need prereqs
    expect(result).not.toBeNull();
    // Cheapest is ancient_granaries (3)
    expect(result).toBe('ancient_granaries');
  });

  it('medium: skips already-unlocked techs', () => {
    const state = makeState({
      players: [
        makePlayer('p1', 0, { tech_points: 5, unlocked_techs: ['ancient_granaries'] }),
        makePlayer('p2', 1),
      ],
      settings: makeSettings({ tech_trees_enabled: true }),
    });
    const result = selectAiTechResearch(state, 'p1', 'medium');
    // ancient_granaries already unlocked; next cheapest tier-1 options are cost 4
    expect(result).not.toBe('ancient_granaries');
    expect(result).not.toBeNull();
  });

  it('hard: prefers attack techs in aggressive era (ancient)', () => {
    const state = makeState({
      era: 'ancient',
      players: [makePlayer('p1', 0, { tech_points: 10 }), makePlayer('p2', 1)],
      settings: makeSettings({ tech_trees_enabled: true }),
    });
    const result = selectAiTechResearch(state, 'p1', 'hard');
    // ancient_iron_weapons has attack_bonus:1 — should score highest in aggressive era
    expect(result).toBe('ancient_iron_weapons');
  });

  it('expert behaves same as hard for strategic tech selection', () => {
    const state = makeState({
      era: 'ancient',
      players: [makePlayer('p1', 0, { tech_points: 10 }), makePlayer('p2', 1)],
      settings: makeSettings({ tech_trees_enabled: true }),
    });
    expect(selectAiTechResearch(state, 'p1', 'expert')).toBe('ancient_iron_weapons');
  });
});

// ── Naval AI behavior ────────────────────────────────────────────────────────
//
// Coverage for the AI's port-building + sea-attack gating that the user
// reported as missing: when `naval_enabled` is on, the AI must build ports
// to accumulate fleets, and must not waste its attack budget on sea-lane
// targets it can't actually traverse.

/** Map with two coastal landmasses connected by a sea lane: t1 (mainland)
 *  and t3 (island). t1—t2 land connection; t2—t3 sea connection. */
function makeNavalMap(): GameMap {
  return {
    map_id: 'naval_map',
    name: 'Naval',
    territories: [
      { territory_id: 't1', name: 'T1', center_x: 0,  center_y: 0, region_id: 'r1', svg_path: '' },
      { territory_id: 't2', name: 'T2', center_x: 10, center_y: 0, region_id: 'r1', svg_path: '' },
      { territory_id: 't3', name: 'T3', center_x: 30, center_y: 0, region_id: 'r2', svg_path: '' },
    ],
    connections: [
      { from: 't1', to: 't2', type: 'land' },
      { from: 't2', to: 't3', type: 'sea' },
    ],
    regions: [],
    canvas_width: 800,
    canvas_height: 600,
  // @ts-expect-error — test helper uses simplified MapTerritory/MapConnection shape
  } as GameMap;
}

describe('selectAiBuildingPlacement (naval)', () => {
  it('builds a port on a coastal territory with sea-adjacent enemy when naval_enabled', () => {
    // p1 owns t1 (interior) and t2 (coastal); p2 owns t3 (island, sea-adjacent to t2).
    const state = makeState({
      players: [makePlayer('p1', 0, { special_resource: 20 }), makePlayer('p2', 1)],
      settings: makeSettings({ economy_enabled: true, naval_enabled: true }),
      territories: {
        t1: makeTerritory('t1', 'p1', 5),
        t2: makeTerritory('t2', 'p1', 4, { naval_units: 0 }),
        t3: makeTerritory('t3', 'p2', 3, { naval_units: 0 }),
      },
    });
    const result = selectAiBuildingPlacement(state, makeNavalMap(), 'p1', 'medium');
    expect(result).not.toBeNull();
    expect(result!.buildingType).toBe('port');
    expect(result!.territoryId).toBe('t2');
  });

  it('does not build a port when naval_enabled is off (regression: no behavior change)', () => {
    const state = makeState({
      players: [makePlayer('p1', 0, { special_resource: 20 }), makePlayer('p2', 1)],
      settings: makeSettings({ economy_enabled: true, naval_enabled: false }),
      territories: {
        t1: makeTerritory('t1', 'p1', 5),
        t2: makeTerritory('t2', 'p1', 4, { naval_units: 0 }),
        t3: makeTerritory('t3', 'p2', 3, { naval_units: 0 }),
      },
    });
    const result = selectAiBuildingPlacement(state, makeNavalMap(), 'p1', 'medium');
    // Falls through to production_1 priority on t1/t2 — never picks 'port'.
    expect(result?.buildingType).not.toBe('port');
  });

  it('does not build a port when no enemy is reachable by sea', () => {
    // p1 owns all three territories; t3 is friendly so no sea-adjacent enemy.
    const state = makeState({
      players: [makePlayer('p1', 0, { special_resource: 20 }), makePlayer('p2', 1)],
      settings: makeSettings({ economy_enabled: true, naval_enabled: true }),
      territories: {
        t1: makeTerritory('t1', 'p1', 5),
        t2: makeTerritory('t2', 'p1', 4, { naval_units: 0 }),
        t3: makeTerritory('t3', 'p1', 3, { naval_units: 0 }),
      },
    });
    const result = selectAiBuildingPlacement(state, makeNavalMap(), 'p1', 'medium');
    expect(result?.buildingType).not.toBe('port');
  });

  it('hard: upgrades existing port to naval_base before adding a second port', () => {
    // p1 already has a port on t2; should upgrade to naval_base for double income.
    const state = makeState({
      players: [makePlayer('p1', 0, { special_resource: 30 }), makePlayer('p2', 1)],
      settings: makeSettings({ economy_enabled: true, naval_enabled: true }),
      territories: {
        t1: makeTerritory('t1', 'p1', 5),
        t2: makeTerritory('t2', 'p1', 4, { naval_units: 1, buildings: ['port'] }),
        t3: makeTerritory('t3', 'p2', 3, { naval_units: 0 }),
      },
    });
    const result = selectAiBuildingPlacement(state, makeNavalMap(), 'p1', 'hard');
    expect(result?.buildingType).toBe('naval_base');
    expect(result?.territoryId).toBe('t2');
  });
});

describe('computeAiTurn (naval sea-attack gating)', () => {
  it('does not plan sea-lane attacks when source has 0 fleets', () => {
    // p1 owns t2 (coastal) with units but 0 fleets; p2 owns t3 (sea-adjacent).
    // The AI must NOT plan an attack t2→t3 because the runtime would skip it
    // and the AI would silently waste its attack budget.
    const state = makeState({
      players: [makePlayer('p1', 0), makePlayer('p2', 1)],
      settings: makeSettings({ naval_enabled: true, economy_enabled: false }),
      territories: {
        t1: makeTerritory('t1', 'p1', 3),
        t2: makeTerritory('t2', 'p1', 8, { naval_units: 0 }),
        t3: makeTerritory('t3', 'p2', 2, { naval_units: 0 }),
      },
    });
    const actions = computeAiTurn(state, makeNavalMap(), 'medium');
    const seaAttackPlanned = actions.some(
      (a) => a.type === 'attack' && a.from === 't2' && a.to === 't3',
    );
    expect(seaAttackPlanned).toBe(false);
  });

  it('plans a sea-lane attack when source has at least one fleet', () => {
    const state = makeState({
      players: [makePlayer('p1', 0), makePlayer('p2', 1)],
      settings: makeSettings({ naval_enabled: true, economy_enabled: false }),
      territories: {
        t1: makeTerritory('t1', 'p1', 3),
        t2: makeTerritory('t2', 'p1', 8, { naval_units: 1, buildings: ['port'] }),
        t3: makeTerritory('t3', 'p2', 2, { naval_units: 0 }),
      },
    });
    const actions = computeAiTurn(state, makeNavalMap(), 'medium');
    const seaAttackPlanned = actions.some(
      (a) => a.type === 'attack' && a.from === 't2' && a.to === 't3',
    );
    expect(seaAttackPlanned).toBe(true);
  });

  it('caps planned sea-lane attacks at the available fleet count from a single source', () => {
    // Two enemy targets sea-connected to t2 but only 1 fleet available.
    const map: GameMap = {
      map_id: 'naval_dual',
      name: 'NavalDual',
      territories: [
        { territory_id: 't1', name: 'T1', center_x: 0, center_y: 0, region_id: 'r1', svg_path: '' },
        { territory_id: 't2', name: 'T2', center_x: 10, center_y: 0, region_id: 'r1', svg_path: '' },
        { territory_id: 't3', name: 'T3', center_x: 30, center_y: 0, region_id: 'r2', svg_path: '' },
        { territory_id: 't4', name: 'T4', center_x: 30, center_y: 20, region_id: 'r2', svg_path: '' },
      ],
      connections: [
        { from: 't1', to: 't2', type: 'land' },
        { from: 't2', to: 't3', type: 'sea' },
        { from: 't2', to: 't4', type: 'sea' },
      ],
      regions: [],
      canvas_width: 800,
      canvas_height: 600,
    // @ts-expect-error — test helper uses simplified MapTerritory shape
    } as GameMap;

    const state = makeState({
      players: [makePlayer('p1', 0), makePlayer('p2', 1)],
      settings: makeSettings({ naval_enabled: true, economy_enabled: false }),
      territories: {
        t1: makeTerritory('t1', 'p1', 3),
        t2: makeTerritory('t2', 'p1', 12, { naval_units: 1, buildings: ['port'] }),
        t3: makeTerritory('t3', 'p2', 1, { naval_units: 0 }),
        t4: makeTerritory('t4', 'p2', 1, { naval_units: 0 }),
      },
    });
    const actions = computeAiTurn(state, map, 'medium');
    const seaAttacksFromT2 = actions.filter(
      (a) => a.type === 'attack' && a.from === 't2' && (a.to === 't3' || a.to === 't4'),
    );
    expect(seaAttacksFromT2.length).toBeLessThanOrEqual(1);
  });
});
