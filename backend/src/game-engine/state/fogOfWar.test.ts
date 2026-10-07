/**
 * What a seat may see under fog of war (state/fogOfWar.ts): the rule the
 * live game's `game:state` reads, and the board a bot chooses its targets on.
 */
import { describe, it, expect } from 'vitest';
import type { GameMap, GameState } from '../../types';
import { HIDDEN_UNITS, fogAdjacency, fogVisibleTerritoryIds, seatView, seenUnits } from './fogOfWar';

// A chain a–b–c–d: the bot holds a, so it sees a and b and nothing past them.
const MAP = {
  map_id: 'fog-fixture',
  territories: ['a', 'b', 'c', 'd'].map((id) => ({ territory_id: id, region_id: 'r' })),
  connections: [
    { from: 'a', to: 'b', type: 'land' },
    { from: 'b', to: 'c', type: 'land' },
    { from: 'c', to: 'd', type: 'sea' },
  ],
  regions: [{ region_id: 'r', bonus: 1 }],
} as unknown as GameMap;

function board(fog = true): GameState {
  const tile = (id: string, owner: string | null, units: number) => ({
    territory_id: id, owner_id: owner, unit_count: units, buildings: ['production_1'], stability: 60,
  });
  return {
    game_id: 'g',
    phase: 'attack',
    settings: { fog_of_war: fog },
    territories: {
      a: tile('a', 'bot', 4),
      b: tile('b', 'rival', 2),
      c: tile('c', 'rival', 9),
      d: tile('d', 'ally', 1),
    },
    players: [
      { player_id: 'bot', cards: [{ card_id: 'k1' }], secret_mission: { id: 'm-bot' } },
      { player_id: 'rival', cards: [{ card_id: 'k2' }, { card_id: 'k3' }], secret_mission: { id: 'm-rival' } },
      { player_id: 'ally', cards: [{ card_id: 'k4' }], secret_mission: null },
    ],
  } as unknown as GameState;
}

describe('what a seat may see', () => {
  it('is its own ground and everything bordering it', () => {
    expect([...fogVisibleTerritoryIds(board(), 'bot', fogAdjacency(MAP))].sort()).toEqual(['a', 'b']);
    // Without the map's graph, only its own ground.
    expect([...fogVisibleTerritoryIds(board(), 'bot', undefined)]).toEqual(['a']);
  });

  it('is shared with an ally in a team game, across sea edges too', () => {
    const s = board();
    s.teams = [{ team_id: 't', player_ids: ['bot', 'ally'] }] as never;
    expect([...fogVisibleTerritoryIds(s, 'bot', fogAdjacency(MAP))].sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('the board as a seat sees it', () => {
  it('is the state itself without fog', () => {
    const s = board(false);
    expect(seatView(s, MAP, 'bot')).toBe(s);
  });

  it('masks what fog hides and keeps what it shows', () => {
    const view = seatView(board(), MAP, 'bot');
    expect(view.territories.b).toMatchObject({ owner_id: 'rival', unit_count: 2, buildings: ['production_1'] });
    expect(view.territories.c).toMatchObject({ owner_id: 'rival', unit_count: -1, buildings: [], stability: undefined });
    expect(view.territories.d).toMatchObject({ owner_id: 'ally', unit_count: -1 });
  });

  it('holds only its own hand and its own mission', () => {
    const view = seatView(board(), MAP, 'bot');
    expect(view.players.map((p) => p.cards.length)).toEqual([1, 0, 0]);
    expect(view.players.map((p) => p.secret_mission)).toEqual([{ id: 'm-bot' }, null, null]);
  });

  it('never changes the state it is built from', () => {
    const s = board();
    const before = JSON.parse(JSON.stringify(s));
    seatView(s, MAP, 'bot');
    expect(s).toEqual(before);
  });

  it('follows the board: a capture shows what lies past it', () => {
    const s = board();
    s.territories.b!.owner_id = 'bot';
    expect(seatView(s, MAP, 'bot').territories.c!.unit_count).toBe(9);
  });

  it('follows the map: a lane opened during the game shows the tile across it', () => {
    const s = board();
    // Lanes open by replacing `map.connections` (a Launch Pad, a Jump Gate, a Surge Projector).
    const opened = { ...MAP, connections: [...MAP.connections, { from: 'a', to: 'd', type: 'orbit' }] } as GameMap;
    expect(seatView(s, opened, 'bot').territories.d!.unit_count).toBe(1);
  });
});

describe('a garrison the seat cannot see', () => {
  it('counts as a few units, not none and not its true size', () => {
    expect(HIDDEN_UNITS).toBe(3);
    expect(seenUnits({ unit_count: -1 })).toBe(HIDDEN_UNITS);
    expect(seenUnits({ unit_count: 0 })).toBe(0);
    expect(seenUnits({ unit_count: 12 })).toBe(12);
  });
});
