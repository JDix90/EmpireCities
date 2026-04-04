import { describe, it, expect } from 'vitest';
import {
  autoPlaceDraftUnits,
  advanceToNextPlayer,
  checkVictory,
  redeemCardSet,
  findRedeemableCardIds,
} from './gameStateManager';
import type { GameState, PlayerState, TerritoryState, GameSettings, TerritoryCard, GameMap } from '../../types';

function makeSettings(overrides?: Partial<GameSettings>): GameSettings {
  return {
    fog_of_war: false,
    victory_type: 'domination',
    turn_timer_seconds: 0,
    initial_unit_count: 3,
    card_set_escalating: true,
    diplomacy_enabled: false,
    ...overrides,
  };
}

function makePlayer(id: string, idx: number, extras?: Partial<PlayerState>): PlayerState {
  return {
    player_id: id,
    player_index: idx,
    username: `Player${idx}`,
    color: '#000',
    is_ai: false,
    is_eliminated: false,
    territory_count: 0,
    cards: [],
    mmr: 1000,
    ...extras,
  };
}

function makeTerritory(id: string, owner: string | null, units: number): TerritoryState {
  return { territory_id: id, owner_id: owner, unit_count: units, unit_type: 'infantry' };
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

// ── autoPlaceDraftUnits ──────────────────────────────────────────────────────

describe('autoPlaceDraftUnits', () => {
  it('distributes remaining draft units round-robin across owned territories (sorted by id)', () => {
    const state = makeState({ draft_units_remaining: 5 });
    const placed = autoPlaceDraftUnits(state);
    expect(placed).toBe(5);
    expect(state.draft_units_remaining).toBe(0);
    // t1 and t2 owned by p1, sorted: t1, t2. 5 units → t1 gets 3, t2 gets 2
    expect(state.territories.t1.unit_count).toBe(3 + 3);
    expect(state.territories.t2.unit_count).toBe(2 + 2);
  });

  it('returns 0 when not in draft phase', () => {
    const state = makeState({ phase: 'attack', draft_units_remaining: 5 });
    expect(autoPlaceDraftUnits(state)).toBe(0);
    expect(state.draft_units_remaining).toBe(5);
  });

  it('returns 0 when draft_units_remaining is 0', () => {
    const state = makeState({ draft_units_remaining: 0 });
    expect(autoPlaceDraftUnits(state)).toBe(0);
  });

  it('handles a single owned territory', () => {
    const state = makeState({
      draft_units_remaining: 4,
      territories: {
        t1: makeTerritory('t1', 'p1', 1),
        t2: makeTerritory('t2', 'p2', 5),
      },
    });
    autoPlaceDraftUnits(state);
    expect(state.territories.t1.unit_count).toBe(5);
    expect(state.draft_units_remaining).toBe(0);
  });
});

// ── redeemCardSet phase guard ────────────────────────────────────────────────

describe('redeemCardSet', () => {
  function stateWithCards(): GameState {
    const cards: TerritoryCard[] = [
      { card_id: 'c1', territory_id: 't1', symbol: 'infantry' },
      { card_id: 'c2', territory_id: 't2', symbol: 'cavalry' },
      { card_id: 'c3', territory_id: 't3', symbol: 'artillery' },
    ];
    return makeState({
      players: [makePlayer('p1', 0, { cards }), makePlayer('p2', 1)],
    });
  }

  it('succeeds in draft phase with valid card set', () => {
    const state = stateWithCards();
    const bonus = redeemCardSet(state, 'p1', ['c1', 'c2', 'c3']);
    expect(bonus).toBeGreaterThan(0);
    expect(state.players[0].cards).toHaveLength(0);
  });

  it('throws for non-existent player', () => {
    const state = stateWithCards();
    expect(() => redeemCardSet(state, 'nobody', ['c1', 'c2', 'c3'])).toThrow(/not found/i);
  });

  it('throws for wrong card count', () => {
    const state = stateWithCards();
    expect(() => redeemCardSet(state, 'p1', ['c1', 'c2'])).toThrow(/exactly 3/i);
  });

  it('bonus stacks with draft_units_remaining like the human socket path', () => {
    const state = stateWithCards();
    state.draft_units_remaining = 3;
    const ids = findRedeemableCardIds(state.players[0].cards)!;
    const bonus = redeemCardSet(state, 'p1', ids);
    state.draft_units_remaining += bonus;
    expect(state.draft_units_remaining).toBe(3 + bonus);
  });
});

// ── findRedeemableCardIds ───────────────────────────────────────────────────

describe('findRedeemableCardIds', () => {
  it('returns null when fewer than 3 cards', () => {
    expect(findRedeemableCardIds([])).toBeNull();
    expect(
      findRedeemableCardIds([
        { card_id: 'a', territory_id: 't1', symbol: 'infantry' },
        { card_id: 'b', territory_id: 't2', symbol: 'infantry' },
      ]),
    ).toBeNull();
  });

  it('finds three of a kind (deterministic order by card_id)', () => {
    const cards: TerritoryCard[] = [
      { card_id: 'z', territory_id: 't1', symbol: 'infantry' },
      { card_id: 'a', territory_id: 't2', symbol: 'infantry' },
      { card_id: 'm', territory_id: 't3', symbol: 'infantry' },
    ];
    expect(findRedeemableCardIds(cards)).toEqual(['a', 'm', 'z']);
  });

  it('finds one of each type', () => {
    const cards: TerritoryCard[] = [
      { card_id: 'c1', territory_id: 't1', symbol: 'infantry' },
      { card_id: 'c2', territory_id: 't2', symbol: 'cavalry' },
      { card_id: 'c3', territory_id: 't3', symbol: 'artillery' },
    ];
    expect(findRedeemableCardIds(cards)).toEqual(['c1', 'c2', 'c3']);
  });

  it('finds two matching + wild', () => {
    const cards: TerritoryCard[] = [
      { card_id: 'w', territory_id: null, symbol: 'wild' },
      { card_id: 'a', territory_id: 't1', symbol: 'infantry' },
      { card_id: 'b', territory_id: 't2', symbol: 'infantry' },
    ];
    expect(findRedeemableCardIds(cards)).toEqual(['a', 'b', 'w']);
  });

  it('returns null when no valid combination', () => {
    const cards: TerritoryCard[] = [
      { card_id: 'a', territory_id: 't1', symbol: 'infantry' },
      { card_id: 'b', territory_id: 't2', symbol: 'infantry' },
      { card_id: 'c', territory_id: 't3', symbol: 'cavalry' },
    ];
    expect(findRedeemableCardIds(cards)).toBeNull();
  });
});

// ── advanceToNextPlayer ──────────────────────────────────────────────────────

describe('advanceToNextPlayer', () => {
  const map: GameMap = {
    map_id: 'test_map',
    name: 'Test',
    territories: [
      { territory_id: 't1', name: 'T1', polygon: [], center_point: [0, 0], region_id: 'r1' },
      { territory_id: 't2', name: 'T2', polygon: [], center_point: [0, 0], region_id: 'r1' },
      { territory_id: 't3', name: 'T3', polygon: [], center_point: [0, 0], region_id: 'r1' },
    ],
    connections: [],
    regions: [{ region_id: 'r1', name: 'R1', bonus: 2 }],
  };

  it('advances to next non-eliminated player', () => {
    const state = makeState({
      players: [
        makePlayer('p1', 0),
        makePlayer('p2', 1, { is_eliminated: true }),
        makePlayer('p3', 2),
      ],
    });
    advanceToNextPlayer(state, map);
    expect(state.current_player_index).toBe(2);
    expect(state.phase).toBe('draft');
  });

  it('wraps around and increments turn number', () => {
    const state = makeState({
      current_player_index: 1,
      players: [makePlayer('p1', 0), makePlayer('p2', 1)],
    });
    advanceToNextPlayer(state, map);
    expect(state.current_player_index).toBe(0);
    expect(state.turn_number).toBe(2);
  });
});

// ── checkVictory ─────────────────────────────────────────────────────────────

describe('checkVictory', () => {
  it('returns winner when only one active player remains', () => {
    const state = makeState({
      players: [
        makePlayer('p1', 0, { territory_count: 3 }),
        makePlayer('p2', 1, { is_eliminated: true, territory_count: 0 }),
      ],
    });
    expect(checkVictory(state)).toBe('p1');
  });

  it('returns null when multiple players remain', () => {
    const state = makeState({
      players: [
        makePlayer('p1', 0, { territory_count: 2 }),
        makePlayer('p2', 1, { territory_count: 1 }),
      ],
    });
    expect(checkVictory(state)).toBeNull();
  });

  it('detects domination when one player owns all territories', () => {
    const state = makeState({
      players: [
        makePlayer('p1', 0, { territory_count: 3 }),
        makePlayer('p2', 1, { territory_count: 0 }),
      ],
    });
    expect(checkVictory(state)).toBe('p1');
  });
});
