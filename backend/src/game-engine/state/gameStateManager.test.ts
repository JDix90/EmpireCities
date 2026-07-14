import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  autoPlaceDraftUnits,
  advancePhaseOnTimeout,
  advanceToNextPlayer,
  checkVictory,
  redeemCardSet,
  findRedeemableCardIds,
  drawCard,
  calculateContinentBonuses,
  initializeGameState,
} from './gameStateManager';
import { calculateReinforcements } from '../combat/combatResolver';
import { projectMapToEraFloor } from '../eraAdvancement/territoryUnlock';
import type { GameState, PlayerState, TerritoryState, GameSettings, TerritoryCard, GameMap } from '../../types';

function makeSettings(overrides?: Partial<GameSettings>): GameSettings {
  return {
    fog_of_war: false,
    victory_type: 'domination',
    allowed_victory_conditions: ['domination'],
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
    capital_territory_id: null,
    secret_mission: null,
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
    expect(placed.total).toBe(5);
    expect(placed.placements).toHaveLength(2);
    expect(state.draft_units_remaining).toBe(0);
    // t1 and t2 owned by p1, sorted: t1, t2. 5 units → t1 gets 3, t2 gets 2
    expect(state.territories.t1.unit_count).toBe(3 + 3);
    expect(state.territories.t2.unit_count).toBe(2 + 2);
  });

  it('returns 0 when not in draft phase', () => {
    const state = makeState({ phase: 'attack', draft_units_remaining: 5 });
    expect(autoPlaceDraftUnits(state).total).toBe(0);
    expect(state.draft_units_remaining).toBe(5);
  });

  it('returns 0 when draft_units_remaining is 0', () => {
    const state = makeState({ draft_units_remaining: 0 });
    expect(autoPlaceDraftUnits(state).total).toBe(0);
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

  it('respects the per-territory stability deploy cap (critical → 1)', () => {
    const state = makeState({
      draft_units_remaining: 5,
      settings: makeSettings({ stability_enabled: true }),
      territories: {
        t1: { ...makeTerritory('t1', 'p1', 2), stability: 20 }, // < 30 → cap 1
      },
    });
    const res = autoPlaceDraftUnits(state);
    expect(res.total).toBe(1);
    expect(state.territories.t1.unit_count).toBe(3);
    // Units that couldn't be placed under the cap remain for the caller to clear.
    expect(state.draft_units_remaining).toBe(4);
    expect(state.draft_placements_this_turn?.t1).toBe(1);
  });

  it('distributes across territories up to each stability cap then stops', () => {
    const state = makeState({
      draft_units_remaining: 10,
      settings: makeSettings({ stability_enabled: true }),
      territories: {
        t1: { ...makeTerritory('t1', 'p1', 1), stability: 40 }, // 30-49 → cap 3
        t2: { ...makeTerritory('t2', 'p1', 1), stability: 40 }, // 30-49 → cap 3
      },
    });
    const res = autoPlaceDraftUnits(state);
    expect(res.total).toBe(6); // 3 + 3
    expect(state.draft_units_remaining).toBe(4);
  });

  it('ignores caps entirely when stability is disabled', () => {
    const state = makeState({
      draft_units_remaining: 5,
      settings: makeSettings({ stability_enabled: false }),
      territories: {
        t1: { ...makeTerritory('t1', 'p1', 2), stability: 10 },
      },
    });
    const res = autoPlaceDraftUnits(state);
    expect(res.total).toBe(5);
    expect(state.draft_units_remaining).toBe(0);
  });
});

// ── advancePhaseOnTimeout ─────────────────────────────────────────────────────

describe('advancePhaseOnTimeout', () => {
  it('auto-places draft units and moves draft → attack for the same player', () => {
    const state = makeState({ phase: 'draft', draft_units_remaining: 5 });
    const result = advancePhaseOnTimeout(state);
    expect(result.kind).toBe('phase');
    if (result.kind === 'phase') {
      expect(result.newPhase).toBe('attack');
      expect(result.autoDraft.total).toBe(5);
    }
    expect(state.phase).toBe('attack');
    expect(state.draft_units_remaining).toBe(0);
    expect(state.current_player_index).toBe(0);
  });

  it('moves attack → fortify without ending the turn', () => {
    const state = makeState({ phase: 'attack' });
    const result = advancePhaseOnTimeout(state);
    expect(result.kind).toBe('phase');
    if (result.kind === 'phase') expect(result.newPhase).toBe('fortify');
    expect(state.phase).toBe('fortify');
    expect(state.current_player_index).toBe(0);
  });

  it('ends the turn from fortify, advancing to the next player in draft', () => {
    const state = makeState({ phase: 'fortify', current_player_index: 0 });
    const result = advancePhaseOnTimeout(state);
    expect(result.kind).toBe('turn');
    expect(state.current_player_index).toBe(1);
    expect(state.phase).toBe('draft');
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

  it('moves redeemed cards to the discard pile instead of destroying them', () => {
    const state = stateWithCards();
    redeemCardSet(state, 'p1', ['c1', 'c2', 'c3']);
    expect(state.discard_pile?.map((c) => c.card_id).sort()).toEqual(['c1', 'c2', 'c3']);
  });
});

// ── drawCard deck recycling ──────────────────────────────────────────────────

describe('drawCard', () => {
  it('draws the top card off the deck into the player hand', () => {
    const state = makeState({
      card_deck: [{ card_id: 'd1', territory_id: 't1', symbol: 'infantry' }],
    });
    drawCard(state, 'p1');
    expect(state.players[0].cards.map((c) => c.card_id)).toEqual(['d1']);
    expect(state.card_deck).toHaveLength(0);
  });

  it('no-ops when both the deck and discard pile are empty', () => {
    const state = makeState({ card_deck: [], discard_pile: [] });
    drawCard(state, 'p1');
    expect(state.players[0].cards).toHaveLength(0);
  });

  it('reshuffles the discard pile into the deck when the deck runs dry', () => {
    const state = makeState({
      card_deck: [],
      discard_pile: [
        { card_id: 'r1', territory_id: 't1', symbol: 'infantry' },
        { card_id: 'r2', territory_id: 't2', symbol: 'cavalry' },
      ],
    });
    drawCard(state, 'p1');
    // One card recycled into the player's hand; the rest stays in the (now) deck,
    // and the discard pile is emptied.
    expect(state.players[0].cards).toHaveLength(1);
    expect(state.card_deck).toHaveLength(1);
    expect(state.discard_pile).toHaveLength(0);
    const drawn = state.players[0].cards[0].card_id;
    expect(['r1', 'r2']).toContain(drawn);
  });

  it('keeps cards flowing across redeem → exhaust → redraw (the Era Advancement case)', () => {
    const cards: TerritoryCard[] = [
      { card_id: 'c1', territory_id: 't1', symbol: 'infantry' },
      { card_id: 'c2', territory_id: 't2', symbol: 'cavalry' },
      { card_id: 'c3', territory_id: 't3', symbol: 'artillery' },
    ];
    const state = makeState({
      players: [makePlayer('p1', 0, { cards: [...cards] }), makePlayer('p2', 1)],
      card_deck: [],
      discard_pile: [],
    });
    // Deck is empty (long game). Player redeems a set, then should still be able
    // to earn a card afterward because the redeemed cards recycle.
    redeemCardSet(state, 'p1', ['c1', 'c2', 'c3']);
    expect(state.card_deck).toHaveLength(0);
    expect(state.discard_pile).toHaveLength(3);
    drawCard(state, 'p1');
    expect(state.players[0].cards).toHaveLength(1);
  });
});

// ── calculateContinentBonuses (growing board) ───────────────────────────────

describe('calculateContinentBonuses', () => {
  function growthMap(): GameMap {
    return {
      map_id: 'growth',
      name: 'Growth',
      territories: [
        { territory_id: 'base', name: 'base', polygon: [[0, 0]], center_point: [0, 0], region_id: 'reg' },
        { territory_id: 'frontier', name: 'frontier', polygon: [[1, 0]], center_point: [1, 0], region_id: 'reg', unlock_era_index: 2 },
      ],
      connections: [],
      regions: [{ region_id: 'reg', name: 'Reg', bonus: 3 }],
    } as GameMap;
  }

  it('awards the bonus for the in-play part while a frontier member is still locked', () => {
    const state = makeState({ territories: { base: makeTerritory('base', 'p1', 1) } });
    expect(calculateContinentBonuses(state, growthMap(), 'p1')).toBe(3);
  });

  it('withholds the bonus once the frontier is in play but not yet owned', () => {
    const state = makeState({
      territories: {
        base: makeTerritory('base', 'p1', 1),
        frontier: makeTerritory('frontier', null, 4), // unlocked, neutral
      },
    });
    expect(calculateContinentBonuses(state, growthMap(), 'p1')).toBe(0);
    // ...and restores it once the frontier is conquered.
    state.territories.frontier.owner_id = 'p1';
    expect(calculateContinentBonuses(state, growthMap(), 'p1')).toBe(3);
  });

  it('does not award a vacuous bonus for an all-locked region (none in play)', () => {
    const map = growthMap();
    map.territories[0].unlock_era_index = 2; // make EVERY member locked
    const state = makeState({ territories: {} });
    expect(calculateContinentBonuses(state, map, 'p1')).toBe(0);
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

describe('initializeGameState faction distribution', () => {
  it('keeps multi-home factions geographically flavored without granting runaway territory counts', () => {
    const map: GameMap = {
      map_id: 'fair_faction_map',
      name: 'Fair Faction Map',
      territories: [
        { territory_id: 'wf1', name: 'WF1', polygon: [], center_point: [0, 0], region_id: 'western_front' },
        { territory_id: 'wf2', name: 'WF2', polygon: [], center_point: [0, 0], region_id: 'western_front' },
        { territory_id: 'wf3', name: 'WF3', polygon: [], center_point: [0, 0], region_id: 'western_front' },
        { territory_id: 'wf4', name: 'WF4', polygon: [], center_point: [0, 0], region_id: 'western_front' },
        { territory_id: 'na1', name: 'NA1', polygon: [], center_point: [0, 0], region_id: 'north_africa_th' },
        { territory_id: 'na2', name: 'NA2', polygon: [], center_point: [0, 0], region_id: 'north_africa_th' },
        { territory_id: 'na3', name: 'NA3', polygon: [], center_point: [0, 0], region_id: 'north_africa_th' },
        { territory_id: 'na4', name: 'NA4', polygon: [], center_point: [0, 0], region_id: 'north_africa_th' },
        { territory_id: 'ef1', name: 'EF1', polygon: [], center_point: [0, 0], region_id: 'eastern_front' },
        { territory_id: 'ef2', name: 'EF2', polygon: [], center_point: [0, 0], region_id: 'eastern_front' },
        { territory_id: 'ef3', name: 'EF3', polygon: [], center_point: [0, 0], region_id: 'eastern_front' },
        { territory_id: 'ef4', name: 'EF4', polygon: [], center_point: [0, 0], region_id: 'eastern_front' },
      ],
      connections: [
        { from: 'wf1', to: 'wf2', type: 'land' },
        { from: 'wf2', to: 'wf3', type: 'land' },
        { from: 'wf3', to: 'wf4', type: 'land' },
        { from: 'wf4', to: 'na1', type: 'land' },
        { from: 'na1', to: 'na2', type: 'land' },
        { from: 'na2', to: 'na3', type: 'land' },
        { from: 'na3', to: 'na4', type: 'land' },
        { from: 'na4', to: 'ef1', type: 'land' },
        { from: 'ef1', to: 'ef2', type: 'land' },
        { from: 'ef2', to: 'ef3', type: 'land' },
        { from: 'ef3', to: 'ef4', type: 'land' },
      ],
      regions: [
        { region_id: 'western_front', name: 'Western Front', bonus: 2 },
        { region_id: 'north_africa_th', name: 'North Africa', bonus: 2 },
        { region_id: 'eastern_front', name: 'Eastern Front', bonus: 2 },
      ],
    };

    const state = initializeGameState(
      'faction-balance-test',
      'ww2',
      map,
      [
        {
          player_id: 'p1',
          player_index: 0,
          username: 'UK Player',
          color: '#f00',
          is_ai: false,
          is_eliminated: false,
          mmr: 1000,
          faction_id: 'uk',
        },
        {
          player_id: 'p2',
          player_index: 1,
          username: 'USSR Player',
          color: '#00f',
          is_ai: false,
          is_eliminated: false,
          mmr: 1000,
          faction_id: 'soviet_union',
        },
      ],
      makeSettings({ factions_enabled: true }),
    );

    const counts = state.players.map((player) => player.territory_count);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);

    const territoriesByOwner = Object.values(state.territories).reduce<Record<string, string[]>>((acc, territory) => {
      const ownerId = territory.owner_id;
      if (!ownerId) return acc;
      acc[ownerId] = acc[ownerId] ?? [];
      acc[ownerId].push(territory.territory_id);
      return acc;
    }, {});

    const playerOneRegions = new Set((territoriesByOwner.p1 ?? []).map((territoryId) => map.territories.find((territory) => territory.territory_id === territoryId)?.region_id));
    const playerTwoRegions = new Set((territoriesByOwner.p2 ?? []).map((territoryId) => map.territories.find((territory) => territory.territory_id === territoryId)?.region_id));

    const playerOneOwnsWesternFront = ['wf1', 'wf2', 'wf3', 'wf4'].every((territoryId) => state.territories[territoryId].owner_id === 'p1');
    const playerOneOwnsNorthAfrica = ['na1', 'na2', 'na3', 'na4'].every((territoryId) => state.territories[territoryId].owner_id === 'p1');

    expect(playerOneRegions.has('western_front') || playerOneRegions.has('north_africa_th')).toBe(true);
    expect(playerTwoRegions.has('eastern_front')).toBe(true);
    expect(playerOneOwnsWesternFront && playerOneOwnsNorthAfrica).toBe(false);
  });

  it('applies faction reinforce bonus on the very first draft turn', () => {
    const map: GameMap = {
      map_id: 'first_draft_faction_bonus_map',
      name: 'First Draft Faction Bonus Map',
      territories: [
        { territory_id: 't1', name: 'T1', polygon: [], center_point: [0, 0], region_id: 'western_front' },
        { territory_id: 't2', name: 'T2', polygon: [], center_point: [0, 0], region_id: 'western_front' },
        { territory_id: 't3', name: 'T3', polygon: [], center_point: [0, 0], region_id: 'eastern_front' },
        { territory_id: 't4', name: 'T4', polygon: [], center_point: [0, 0], region_id: 'eastern_front' },
        { territory_id: 't5', name: 'T5', polygon: [], center_point: [0, 0], region_id: 'pacific_theatre' },
        { territory_id: 't6', name: 'T6', polygon: [], center_point: [0, 0], region_id: 'pacific_theatre' },
      ],
      connections: [],
      regions: [
        { region_id: 'western_front', name: 'Western Front', bonus: 0 },
        { region_id: 'eastern_front', name: 'Eastern Front', bonus: 0 },
        { region_id: 'pacific_theatre', name: 'Pacific Theatre', bonus: 0 },
      ],
    };

    const state = initializeGameState(
      'first-draft-faction-bonus',
      'ww2',
      map,
      [
        {
          player_id: 'p1',
          player_index: 0,
          username: 'USSR Player',
          color: '#f00',
          is_ai: false,
          is_eliminated: false,
          mmr: 1000,
          faction_id: 'soviet_union', // +2 reinforcements
        },
        {
          player_id: 'p2',
          player_index: 1,
          username: 'Germany Player',
          color: '#00f',
          is_ai: false,
          is_eliminated: false,
          mmr: 1000,
          faction_id: 'germany',
        },
      ],
      makeSettings({ factions_enabled: true }),
    );

    const starter = state.players[state.starting_player_index ?? 0]!;
    const baseDraft = calculateReinforcements(starter.territory_count, 0, state.players.length);
    const passiveBonus = starter.faction_id === 'soviet_union' ? 2 : 0;
    expect(state.phase).toBe('draft');
    expect(state.draft_units_remaining).toBe(baseDraft + passiveBonus);
  });

  describe('Space Age moon territory neutrality', () => {
    const earthRegion = { region_id: 'na', name: 'North America', bonus: 1 };
    const moonRegion = { region_id: 'lunar_surface', name: 'Lunar Surface', bonus: 8 };
    const spaceAgeMap: GameMap = {
      map_id: 'era_space_age',
      name: 'Space Age',
      territories: [
        { territory_id: 'earth_a', name: 'Earth A', polygon: [], center_point: [0, 0], region_id: 'na' },
        { territory_id: 'earth_b', name: 'Earth B', polygon: [], center_point: [0, 0], region_id: 'na' },
        { territory_id: 'earth_c', name: 'Earth C', polygon: [], center_point: [0, 0], region_id: 'na' },
        { territory_id: 'earth_d', name: 'Earth D', polygon: [], center_point: [0, 0], region_id: 'na' },
        { territory_id: 'moon_a', name: 'Moon A', polygon: [], center_point: [0, 0], region_id: 'lunar_surface', globe_id: 'moon' },
        { territory_id: 'moon_b', name: 'Moon B', polygon: [], center_point: [0, 0], region_id: 'lunar_surface', globe_id: 'moon' },
        { territory_id: 'moon_c', name: 'Moon C', polygon: [], center_point: [0, 0], region_id: 'lunar_surface', globe_id: 'moon' },
      ],
      connections: [
        { from: 'earth_a', to: 'earth_b', type: 'land' },
        { from: 'earth_b', to: 'earth_c', type: 'land' },
        { from: 'earth_c', to: 'earth_d', type: 'land' },
        { from: 'earth_a', to: 'moon_a', type: 'orbit' },
        { from: 'moon_a', to: 'moon_b', type: 'land' },
        { from: 'moon_b', to: 'moon_c', type: 'land' },
      ],
      regions: [earthRegion, moonRegion],
    };

    it('leaves moon territories neutral with a defending garrison even when no Lunar Pioneer is in the game', () => {
      const state = initializeGameState(
        'space-age-no-pioneer',
        'space_age',
        spaceAgeMap,
        [
          { player_id: 'p1', player_index: 0, username: 'A', color: '#f00', is_ai: false, is_eliminated: false, mmr: 1000 },
          { player_id: 'p2', player_index: 1, username: 'B', color: '#00f', is_ai: false, is_eliminated: false, mmr: 1000 },
        ],
        makeSettings({ factions_enabled: false }),
      );

      for (const moonId of ['moon_a', 'moon_b', 'moon_c']) {
        const t = state.territories[moonId]!;
        expect(t.owner_id, `${moonId} should be neutral`).toBeNull();
        expect(t.unit_count).toBeGreaterThan(0); // neutral garrison
      }
      // All Earth territories must end up owned (no neutral Earth slots leak through).
      for (const earthId of ['earth_a', 'earth_b', 'earth_c', 'earth_d']) {
        expect(state.territories[earthId]!.owner_id).not.toBeNull();
      }
    });

    it('keeps moon territories neutral even when a Lunar Pioneer faction is in play', () => {
      const state = initializeGameState(
        'space-age-with-pioneer',
        'space_age',
        spaceAgeMap,
        [
          {
            player_id: 'p1',
            player_index: 0,
            username: 'Pioneer',
            color: '#bdc3c7',
            is_ai: false,
            is_eliminated: false,
            mmr: 1000,
            faction_id: 'lunar_pioneers',
          },
          {
            player_id: 'p2',
            player_index: 1,
            username: 'Earther',
            color: '#3498db',
            is_ai: false,
            is_eliminated: false,
            mmr: 1000,
            faction_id: 'pacific_megacities',
          },
        ],
        makeSettings({ factions_enabled: true }),
      );

      for (const moonId of ['moon_a', 'moon_b', 'moon_c']) {
        const t = state.territories[moonId]!;
        expect(t.owner_id, `${moonId} should not be pre-claimed by Lunar Pioneers`).toBeNull();
        expect(t.unit_count).toBeGreaterThan(0);
      }
      // Lunar Pioneer player still gets their orbit-access perk so they can race for moon.
      const pioneer = state.players.find((p) => p.faction_id === 'lunar_pioneers');
      expect(pioneer?.space_station_launched).toBe(true);
    });

    it('does not crash or assign era-locked frontier territories when factions are enabled', () => {
      // Regression: the faction distribution path iterates the map view's
      // territory list; tiles held back by unlock_era_index have no state entry,
      // and writing an owner into one crashed game start on era_space_age.
      const mapWithFrontier: GameMap = {
        ...spaceAgeMap,
        territories: [
          ...spaceAgeMap.territories,
          { territory_id: 'frontier_locked', name: 'Frontier', polygon: [], center_point: [0, 0], region_id: 'na', unlock_era_index: 2 },
        ],
        connections: [
          ...spaceAgeMap.connections,
          { from: 'earth_d', to: 'frontier_locked', type: 'land' },
        ],
      };

      const state = initializeGameState(
        'space-age-frontier-factions',
        'space_age',
        mapWithFrontier,
        [
          { player_id: 'p1', player_index: 0, username: 'A', color: '#f00', is_ai: false, is_eliminated: false, mmr: 1000, faction_id: 'lunar_pioneers' },
          { player_id: 'p2', player_index: 1, username: 'B', color: '#00f', is_ai: false, is_eliminated: false, mmr: 1000, faction_id: 'pacific_megacities' },
        ],
        // Frontier seeding OFF (default): the frontier tile is held back entirely.
        makeSettings({ factions_enabled: true }),
      );

      expect(state.territories['frontier_locked']).toBeUndefined();
      for (const earthId of ['earth_a', 'earth_b', 'earth_c', 'earth_d']) {
        expect(state.territories[earthId]!.owner_id).not.toBeNull();
      }
    });

    it('seeds era-locked frontiers as neutral (never dealt) when space_age_frontiers_enabled', () => {
      const mapWithFrontier: GameMap = {
        ...spaceAgeMap,
        territories: [
          ...spaceAgeMap.territories,
          { territory_id: 'frontier_locked', name: 'Frontier', polygon: [], center_point: [0, 0], region_id: 'na', unlock_era_index: 2 },
        ],
        connections: [
          ...spaceAgeMap.connections,
          { from: 'earth_d', to: 'frontier_locked', type: 'land' },
        ],
      };

      const state = initializeGameState(
        'space-age-frontier-seeded',
        'space_age',
        mapWithFrontier,
        [
          { player_id: 'p1', player_index: 0, username: 'A', color: '#f00', is_ai: false, is_eliminated: false, mmr: 1000, faction_id: 'lunar_pioneers' },
          { player_id: 'p2', player_index: 1, username: 'B', color: '#00f', is_ai: false, is_eliminated: false, mmr: 1000, faction_id: 'pacific_megacities' },
        ],
        makeSettings({ factions_enabled: true, space_age_frontiers_enabled: true }),
      );

      // Frontier now exists, neutral and garrisoned, never dealt to a player.
      const frontier = state.territories['frontier_locked'];
      expect(frontier).toBeDefined();
      expect(frontier!.owner_id).toBeNull();
      expect(frontier!.unit_count).toBeGreaterThan(0);
      // Floor rose to include it, so map projection will emit it.
      expect(state.map_era_floor).toBe(2);
    });

    it('initializes the real era_space_age map with factions enabled (live crash repro)', () => {
      const realMap = JSON.parse(
        readFileSync(join(__dirname, '../../../../database/maps/era_space_age.json'), 'utf8'),
      ) as GameMap;
      const state = initializeGameState(
        'space-age-real-map-factions',
        'space_age',
        realMap,
        ['lunar_pioneers', 'terran_federation', 'climate_alliance', 'corporate_enclave'].map((faction_id, i) => ({
          player_id: `p${i + 1}`,
          player_index: i,
          username: `P${i + 1}`,
          color: '#abc',
          is_ai: i > 0,
          is_eliminated: false,
          mmr: 1000,
          faction_id,
        })),
        makeSettings({ factions_enabled: true }),
      );

      // Every owned territory must exist in state; era-locked frontier tiles must not spawn.
      const frontierIds = realMap.territories
        .filter((t) => (t.unlock_era_index ?? 0) > 0)
        .map((t) => t.territory_id);
      expect(frontierIds.length).toBeGreaterThan(0);
      for (const tid of frontierIds) expect(state.territories[tid]).toBeUndefined();
      const moonIds = realMap.territories.filter((t) => t.globe_id === 'moon').map((t) => t.territory_id);
      for (const tid of moonIds) expect(state.territories[tid]!.owner_id).toBeNull();
      const earthOwned = Object.values(state.territories).filter((t) => t.owner_id != null).length;
      expect(earthOwned).toBe(Object.keys(state.territories).length - moonIds.length);
    });

    it('seeds the full 63-tile board on the real era_space_age map when frontiers are enabled', () => {
      const realMap = JSON.parse(
        readFileSync(join(__dirname, '../../../../database/maps/era_space_age.json'), 'utf8'),
      ) as GameMap;
      const state = initializeGameState(
        'space-age-real-map-frontiers',
        'space_age',
        realMap,
        [
          { player_id: 'p1', player_index: 0, username: 'A', color: '#f00', is_ai: false, is_eliminated: false, mmr: 1000 },
          { player_id: 'p2', player_index: 1, username: 'B', color: '#00f', is_ai: true, is_eliminated: false, mmr: 1000 },
        ],
        makeSettings({ space_age_frontiers_enabled: true }),
      );

      const frontierIds = realMap.territories.filter((t) => (t.unlock_era_index ?? 0) > 0).map((t) => t.territory_id);
      const moonIds = realMap.territories.filter((t) => t.globe_id === 'moon').map((t) => t.territory_id);
      // Full authored board is in play (base 55 + 8 frontiers = 63).
      expect(Object.keys(state.territories).length).toBe(realMap.territories.length);
      expect(state.map_era_floor).toBe(5);
      // Every frontier present, neutral, never dealt.
      for (const tid of frontierIds) {
        expect(state.territories[tid]!.owner_id).toBeNull();
        expect(state.territories[tid]!.unit_count).toBeGreaterThan(0);
      }
      // The projected map the socket emits carries all 63 tiles at this floor.
      const projected = projectMapToEraFloor(realMap, state.map_era_floor ?? 0);
      expect(projected.territories.length).toBe(realMap.territories.length);
      // Moon stays neutral (its own access race), unaffected by frontier seeding.
      for (const tid of moonIds) expect(state.territories[tid]!.owner_id).toBeNull();
    });
  });

  it('assigns each Galactic Age faction its entire home world when four players pick the four lore factions', () => {
    // Each world is subdivided into several bonus regions; the homeworld deal
    // derives each faction's world from its home regions, so one sub-region
    // per world is enough here.
    const regions = [
      { region_id: 'sol_americas', name: 'Sol — Western Hemisphere', bonus: 3 },
      { region_id: 'verdan_sporefields', name: 'Verdan — Spore Fields', bonus: 3 },
      { region_id: 'rust_foundry_core', name: 'Rust — Foundry Core', bonus: 3 },
      { region_id: 'nexus_gate_ring', name: 'Nexus — Gate Ring', bonus: 3 },
    ];
    const territories = [
      { territory_id: 's1', name: 'S1', polygon: [], center_point: [0, 0], region_id: 'sol_americas', world_id: 'sol' },
      { territory_id: 's2', name: 'S2', polygon: [], center_point: [0, 0], region_id: 'sol_americas', world_id: 'sol' },
      { territory_id: 'v1', name: 'V1', polygon: [], center_point: [0, 0], region_id: 'verdan_sporefields', world_id: 'verdan' },
      { territory_id: 'v2', name: 'V2', polygon: [], center_point: [0, 0], region_id: 'verdan_sporefields', world_id: 'verdan' },
      { territory_id: 'r1', name: 'R1', polygon: [], center_point: [0, 0], region_id: 'rust_foundry_core', world_id: 'rust' },
      { territory_id: 'r2', name: 'R2', polygon: [], center_point: [0, 0], region_id: 'rust_foundry_core', world_id: 'rust' },
      { territory_id: 'n1', name: 'N1', polygon: [], center_point: [0, 0], region_id: 'nexus_gate_ring', world_id: 'nexus_station' },
      { territory_id: 'n2', name: 'N2', polygon: [], center_point: [0, 0], region_id: 'nexus_gate_ring', world_id: 'nexus_station' },
    ];
    const map: GameMap = {
      map_id: 'era_galaxy_test',
      name: 'Galaxy test',
      map_kind: 'galaxy',
      territories,
      connections: [],
      regions,
    };

    const state = initializeGameState(
      'galaxy-homeworld-test',
      'galaxy_age',
      map,
      [
        {
          player_id: 'p_mandate',
          player_index: 0,
          username: 'Mandate',
          color: '#e74c3c',
          is_ai: false,
          is_eliminated: false,
          mmr: 1000,
          faction_id: 'stellar_mandate',
        },
        {
          player_id: 'p_helion',
          player_index: 1,
          username: 'Helion',
          color: '#3498db',
          is_ai: false,
          is_eliminated: false,
          mmr: 1000,
          faction_id: 'helion_navigators',
        },
        {
          player_id: 'p_forge',
          player_index: 2,
          username: 'Forge',
          color: '#2ecc71',
          is_ai: false,
          is_eliminated: false,
          mmr: 1000,
          faction_id: 'forge_syndicate',
        },
        {
          player_id: 'p_void',
          player_index: 3,
          username: 'Void',
          color: '#f39c12',
          is_ai: false,
          is_eliminated: false,
          mmr: 1000,
          faction_id: 'void_custodians',
        },
      ],
      makeSettings({ factions_enabled: true, initial_unit_count: 3 }),
    );

    expect(state.territories.s1?.owner_id).toBe('p_mandate');
    expect(state.territories.s2?.owner_id).toBe('p_mandate');
    expect(state.territories.v1?.owner_id).toBe('p_helion');
    expect(state.territories.v2?.owner_id).toBe('p_helion');
    expect(state.territories.r1?.owner_id).toBe('p_forge');
    expect(state.territories.r2?.owner_id).toBe('p_forge');
    expect(state.territories.n1?.owner_id).toBe('p_void');
    expect(state.territories.n2?.owner_id).toBe('p_void');
    for (const tid of ['s1', 's2', 'v1', 'v2', 'r1', 'r2', 'n1', 'n2']) {
      expect(state.territories[tid]?.unit_count).toBe(3);
    }
  });

  it('keeps draft_units_remaining at 0 during territory selection even with factions enabled', () => {
    const map: GameMap = {
      map_id: 'territory_select_faction_bonus_map',
      name: 'Territory Select Faction Bonus Map',
      territories: [
        { territory_id: 't1', name: 'T1', polygon: [], center_point: [0, 0], region_id: 'western_front' },
        { territory_id: 't2', name: 'T2', polygon: [], center_point: [0, 0], region_id: 'eastern_front' },
      ],
      connections: [],
      regions: [
        { region_id: 'western_front', name: 'Western Front', bonus: 0 },
        { region_id: 'eastern_front', name: 'Eastern Front', bonus: 0 },
      ],
    };

    const state = initializeGameState(
      'territory-select-faction-bonus',
      'ww2',
      map,
      [
        {
          player_id: 'p1',
          player_index: 0,
          username: 'USSR Player',
          color: '#f00',
          is_ai: false,
          is_eliminated: false,
          mmr: 1000,
          faction_id: 'soviet_union',
        },
      ],
      makeSettings({ factions_enabled: true, territory_selection: true }),
    );

    expect(state.phase).toBe('territory_select');
    expect(state.draft_units_remaining).toBe(0);
  });
});

// ── checkVictory ─────────────────────────────────────────────────────────────

const victoryMap: GameMap = {
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

describe('checkVictory', () => {
  it('returns winner when only one active player remains', () => {
    const state = makeState({
      players: [
        makePlayer('p1', 0, { territory_count: 3 }),
        makePlayer('p2', 1, { is_eliminated: true, territory_count: 0 }),
      ],
    });
    expect(checkVictory(state, victoryMap)).toEqual({ winnerIds: ['p1'], condition: 'last_standing' });
  });

  it('returns null when multiple players remain', () => {
    const state = makeState({
      players: [
        makePlayer('p1', 0, { territory_count: 2 }),
        makePlayer('p2', 1, { territory_count: 1 }),
      ],
    });
    expect(checkVictory(state, victoryMap)).toBeNull();
  });

  it('detects domination when one player owns all territories', () => {
    const state = makeState({
      players: [
        makePlayer('p1', 0, { territory_count: 3 }),
        makePlayer('p2', 1, { territory_count: 0 }),
      ],
    });
    expect(checkVictory(state, victoryMap)).toEqual({ winnerIds: ['p1'], condition: 'domination' });
  });

  it('does not award domination when domination is disabled', () => {
    const state = makeState({
      settings: makeSettings({
        allowed_victory_conditions: ['capital'],
      }),
      players: [
        makePlayer('p1', 0, { territory_count: 3 }),
        makePlayer('p2', 1, { territory_count: 0 }),
      ],
    });
    expect(checkVictory(state, victoryMap)).toBeNull();
  });

  it('threshold victory when enabled', () => {
    const state = makeState({
      settings: makeSettings({
        allowed_victory_conditions: ['threshold'],
        victory_threshold: 50,
      }),
      players: [
        makePlayer('p1', 0, { territory_count: 2 }),
        makePlayer('p2', 1, { territory_count: 1 }),
      ],
    });
    expect(checkVictory(state, victoryMap)).toEqual({ winnerIds: ['p1'], condition: 'threshold' });
  });
});

describe('checkVictory turn cap (max_turns)', () => {
  it('is off by default — no winner past turn 150 without the setting', () => {
    const state = makeState({
      turn_number: 400,
      players: [
        makePlayer('p1', 0, { territory_count: 2 }),
        makePlayer('p2', 1, { territory_count: 1 }),
      ],
    });
    expect(checkVictory(state, victoryMap)).toBeNull();
  });

  it('awards turn_limit to the territory leader once the cap is exceeded', () => {
    const state = makeState({
      turn_number: 151,
      settings: makeSettings({ max_turns: 150 }),
      players: [
        makePlayer('p1', 0, { territory_count: 2 }),
        makePlayer('p2', 1, { territory_count: 1 }),
      ],
    });
    expect(checkVictory(state, victoryMap)).toEqual({ winnerIds: ['p1'], condition: 'turn_limit' });
  });

  it('does not trigger at exactly the cap turn', () => {
    const state = makeState({
      turn_number: 150,
      settings: makeSettings({ max_turns: 150 }),
      players: [
        makePlayer('p1', 0, { territory_count: 2 }),
        makePlayer('p2', 1, { territory_count: 1 }),
      ],
    });
    expect(checkVictory(state, victoryMap)).toBeNull();
  });

  it('breaks territory ties by total unit count', () => {
    const state = makeState({
      turn_number: 151,
      settings: makeSettings({ max_turns: 150 }),
      players: [
        makePlayer('p1', 0, { territory_count: 1 }),
        makePlayer('p2', 1, { territory_count: 1 }),
      ],
      territories: {
        t1: makeTerritory('t1', 'p1', 3),
        t2: makeTerritory('t2', 'p2', 9),
        t3: makeTerritory('t3', null, 1),
      },
    });
    expect(checkVictory(state, victoryMap)).toEqual({ winnerIds: ['p2'], condition: 'turn_limit' });
  });
});

describe('checkVictory turn cap precedence', () => {
  it('a real victory condition on the cap turn beats turn_limit', () => {
    const state = makeState({
      turn_number: 151,
      settings: makeSettings({ max_turns: 150 }),
      players: [
        makePlayer('p1', 0, { territory_count: 3 }),
        makePlayer('p2', 1, { territory_count: 0 }),
      ],
    });
    // p1 owns every territory → domination, not turn_limit.
    expect(checkVictory(state, victoryMap)).toEqual({ winnerIds: ['p1'], condition: 'domination' });
  });

  it('non-normalized max_turns values are ignored (treated as no cap)', () => {
    const state = makeState({
      turn_number: 9,
      settings: makeSettings({ max_turns: 2 as unknown as number }),
      players: [
        makePlayer('p1', 0, { territory_count: 2 }),
        makePlayer('p2', 1, { territory_count: 1 }),
      ],
    });
    // normalizeGameSettings floors max_turns at 10; a raw 2 must not end games.
    expect(checkVictory(state, victoryMap)).toBeNull();
  });
});

describe('era spine snapshot (board-transform mid-line starts)', () => {
  const spineMap: GameMap = {
    map_id: 'era_ww2',
    name: 'WW2',
    territories: [
      { territory_id: 'a', name: 'A', polygon: [], center_point: [0, 0], region_id: 'r' },
      { territory_id: 'b', name: 'B', polygon: [], center_point: [0, 0], region_id: 'r' },
      { territory_id: 'c', name: 'C', polygon: [], center_point: [0, 0], region_id: 'r' },
      { territory_id: 'd', name: 'D', polygon: [], center_point: [0, 0], region_id: 'r' },
    ],
    connections: [
      { from: 'a', to: 'b', type: 'land' },
      { from: 'b', to: 'c', type: 'land' },
      { from: 'c', to: 'd', type: 'land' },
    ],
    regions: [{ region_id: 'r', name: 'R', bonus: 0 }],
  };

  function initOn(era: GameState['era'], overrides?: Partial<GameSettings>) {
    return initializeGameState(
      `spine-${era}`,
      era,
      spineMap,
      [
        makePlayer('p1', 0),
        makePlayer('p2', 1),
      ],
      makeSettings({ era_advancement_enabled: true, factions_enabled: false, ...overrides }),
    );
  }

  it('anchors an ascension spine at the start era when board-transform is on', () => {
    const state = initOn('ww2', { era_advancement_board_transform: true });
    expect(state.era_spine?.map((s) => s.era_id)).toEqual(['ww2', 'coldwar', 'modern', 'space_age']);
    // First step (the start era) is spine index 0 — players begin there.
    expect(state.players.every((p) => p.current_era_index === 0)).toBe(true);
  });

  it('keeps the configured spine when board-transform is off', () => {
    const state = initOn('ww2', { era_advancement_board_transform: false, era_advancement_spine_id: 'classic' });
    expect(state.era_spine?.map((s) => s.era_id)).toEqual(
      ['ancient', 'medieval', 'discovery', 'ww2', 'coldwar', 'modern'],
    );
  });

  it('falls back to the configured spine for a start era off the ascension line', () => {
    // era_acw is not on the ascension line; transform-on should still yield the configured spine.
    const state = initOn('acw' as GameState['era'], {
      era_advancement_board_transform: true,
      era_advancement_spine_id: 'classic',
    });
    expect(state.era_spine?.[0].era_id).toBe('ancient');
  });

  it('leaves the spine undefined when era advancement is disabled', () => {
    const state = initOn('ww2', { era_advancement_enabled: false, era_advancement_board_transform: true });
    expect(state.era_spine).toBeUndefined();
  });
});
