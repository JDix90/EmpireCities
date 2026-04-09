import { describe, it, expect } from 'vitest';
import { selectAiBuildingPlacement, selectAiTechResearch } from '../aiBot';
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
