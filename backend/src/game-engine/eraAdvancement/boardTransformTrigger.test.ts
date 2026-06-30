import { describe, it, expect, vi } from 'vitest';
import type { GameMap, GameState, PlayerState } from '../../types';
import { getEraTransition } from './eraLineage';
import { transformBoardOnAdvance } from './boardTransformTrigger';

// Use the real committed lineage: ancient 'britannia' → medieval 'england'.
const T = getEraTransition('ancient')!;
const ENGLAND = T.lineage.britannia.find((e) => e.primary)!.to;

function player(id: string, eraIndex: number): PlayerState {
  return { player_id: id, player_index: 0, username: id, color: '#000', is_ai: false, is_eliminated: false, current_era_index: eraIndex } as PlayerState;
}
function baseState(overrides: Partial<GameState> = {}): GameState {
  return {
    game_id: 'g',
    map_id: 'era_ancient',
    era: 'ancient',
    players: [player('a', 0)],
    territories: { britannia: { territory_id: 'britannia', owner_id: 'a', unit_count: 5, unit_type: 'infantry', region_id: 'r' } },
    board_era_index: 0,
    era_spine: [{ era_id: 'ancient' }, { era_id: 'medieval' }, { era_id: 'discovery' }],
    settings: { era_advancement_board_transform: true, victory_type: 'domination' },
    card_deck: [],
    ...overrides,
  } as unknown as GameState;
}
const ancientMap = { map_id: 'era_ancient', territories: [], regions: [] } as unknown as GameMap;
function medievalMap(): GameMap {
  return {
    map_id: 'era_medieval', name: 'Med',
    territories: [ENGLAND, 'france', 'iberia'].map((id) => ({ territory_id: id, name: id, polygon: [[0, 0]], center_point: [0, 0], region_id: 'r' })),
    connections: [], regions: [],
  } as unknown as GameMap;
}

describe('transformBoardOnAdvance', () => {
  it('no-ops when the board-transform flag is off', async () => {
    const s = baseState({ settings: { era_advancement_board_transform: false } as GameState['settings'] });
    s.players[0].current_era_index = 1;
    const resolve = vi.fn();
    expect(await transformBoardOnAdvance(s, ancientMap, resolve, () => 0.5)).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('no-ops when the global era floor has not passed the board era', async () => {
    const s = baseState(); // player at era 0, board at 0
    const resolve = vi.fn();
    expect(await transformBoardOnAdvance(s, ancientMap, resolve, () => 0.5)).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  it('transforms the board onto the next era and seeds the player when the floor rises', async () => {
    const s = baseState();
    s.players[0].current_era_index = 1; // floor → 1
    const resolve = vi.fn(async (id: string) => (id === 'era_medieval' ? medievalMap() : null));

    const out = await transformBoardOnAdvance(s, ancientMap, resolve, () => 0.5);

    expect(out).not.toBeNull();
    expect(out!.map.map_id).toBe('era_medieval');
    expect(out!.summaries).toHaveLength(1);
    expect(s.map_id).toBe('era_medieval');
    expect(s.board_era_index).toBe(1);
    // britannia's owner ('a') is seeded onto britannia's lineage successor.
    expect(s.territories[ENGLAND].owner_id).toBe('a');
    // the rest of the medieval board is neutral.
    expect(s.territories.france.owner_id).toBeNull();
  });

  it('leaves the board untouched if the arriving map cannot be resolved', async () => {
    const s = baseState();
    s.players[0].current_era_index = 1;
    const resolve = vi.fn(async () => null);
    expect(await transformBoardOnAdvance(s, ancientMap, resolve, () => 0.5)).toBeNull();
    expect(s.map_id).toBe('era_ancient'); // unchanged
  });
});
