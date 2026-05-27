import { describe, it, expect } from 'vitest';
import {
  autoPlaceDraftUnits,
  advanceToNextPlayer,
  checkVictory,
  redeemCardSet,
  findRedeemableCardIds,
  initializeGameState,
} from './gameStateManager';
import { calculateReinforcements } from '../combat/combatResolver';
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

    const firstPlayer = state.players[0]!;
    const baseDraft = calculateReinforcements(firstPlayer.territory_count, 0, state.players.length);
    expect(state.phase).toBe('draft');
    expect(state.draft_units_remaining).toBe(baseDraft + 2);
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
  });

  it('assigns each Galactic Age faction its entire home world when four players pick the four lore factions', () => {
    const regions = [
      { region_id: 'stellar_core', name: 'Stellar Core', bonus: 5 },
      { region_id: 'verdant_expanse', name: 'Verdant Expanse', bonus: 4 },
      { region_id: 'industrial_rim', name: 'Industrial Rim', bonus: 4 },
      { region_id: 'station_corridor', name: 'Station Corridor', bonus: 3 },
    ];
    const territories = [
      { territory_id: 's1', name: 'S1', polygon: [], center_point: [0, 0], region_id: 'stellar_core', world_id: 'sol' },
      { territory_id: 's2', name: 'S2', polygon: [], center_point: [0, 0], region_id: 'stellar_core', world_id: 'sol' },
      { territory_id: 'v1', name: 'V1', polygon: [], center_point: [0, 0], region_id: 'verdant_expanse', world_id: 'verdan' },
      { territory_id: 'v2', name: 'V2', polygon: [], center_point: [0, 0], region_id: 'verdant_expanse', world_id: 'verdan' },
      { territory_id: 'r1', name: 'R1', polygon: [], center_point: [0, 0], region_id: 'industrial_rim', world_id: 'rust' },
      { territory_id: 'r2', name: 'R2', polygon: [], center_point: [0, 0], region_id: 'industrial_rim', world_id: 'rust' },
      { territory_id: 'n1', name: 'N1', polygon: [], center_point: [0, 0], region_id: 'station_corridor', world_id: 'nexus_station' },
      { territory_id: 'n2', name: 'N2', polygon: [], center_point: [0, 0], region_id: 'station_corridor', world_id: 'nexus_station' },
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
