/**
 * The bot in a team game (state/teams.ts):
 *   • it never plans an attack or Influence on an ally's ground, nor on
 *     another side's during the opening ceasefire (neutral ground stays open);
 *   • an ally's border is as quiet as its own, so it neither drafts onto one
 *     nor keeps units behind one, and never seals a lane against an ally.
 * Every case also runs as a free-for-all game, which must plan as it always did.
 */
import { describe, it, expect } from 'vitest';
import type { GameMap, GameState, GameTeam } from '../../types';
import { chooseEmergencySealLane, computeAiTurn } from './aiBot';

const AI = 'ai_0';
const ALLY = 'ai_1';
const ENEMY = 'ai_2';
const TEAMS: GameTeam[] = [
  { team_id: 'team_1', name: 'Us', player_ids: [AI, ALLY] },
  { team_id: 'team_2', name: 'Them', player_ids: [ENEMY] },
];

type Tile = [id: string, owner: string | null, units: number];

function map(tiles: Tile[], links: Array<[string, string, ('land' | 'orbit')?]>): GameMap {
  return {
    map_id: 'teams_fixture',
    name: 'Teams Fixture',
    territories: tiles.map(([territory_id]) => ({ territory_id, name: territory_id, polygon: [], center_point: [0, 0], region_id: 'r' })),
    connections: links.map(([from, to, type]) => ({ from, to, type: type ?? 'land' })),
    regions: [{ region_id: 'r', name: 'R', bonus: 0 }],
  } as unknown as GameMap;
}

function state(tiles: Tile[], opts: { teams?: boolean; turn?: number } = {}): GameState {
  const player = (player_id: string, player_index: number) => ({
    player_id, player_index, username: player_id, color: '#000', is_ai: true, is_eliminated: false,
    territory_count: tiles.filter(([, o]) => o === player_id).length, cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000,
  });
  return {
    game_id: 'g',
    era: 'cold_war',
    map_id: 'teams_fixture',
    phase: 'attack',
    turn_number: opts.turn ?? 5,
    current_player_index: 0,
    starting_player_index: 0,
    players: [player(AI, 0), player(ALLY, 1), player(ENEMY, 2)],
    territories: Object.fromEntries(tiles.map(([territory_id, owner_id, unit_count]) => [territory_id, { territory_id, owner_id, unit_count }])),
    settings: {},
    era_modifiers: { influence_spread: true, influence_range: 1 },
    diplomacy: [],
    card_deck: [],
    discard_pile: [],
    ...(opts.teams === false ? {} : { teams: TEAMS }),
  } as unknown as GameState;
}

const plan = (s: GameState, m: GameMap) => computeAiTurn(s, m, 'expert', { rng: () => 0 });
const targets = (s: GameState, m: GameMap) =>
  plan(s, m).filter((a) => a.type === 'attack').map((a) => (a.from === '__influence__' ? `influence:${a.to}` : a.to));

describe('the bot picks its targets', () => {
  const tiles: Tile[] = [['home', AI, 9], ['friend', ALLY, 1], ['foe', ENEMY, 1]];
  const m = map(tiles, [['home', 'friend'], ['home', 'foe']]);

  it("never an ally's ground, by attack or Influence", () => {
    const planned = targets(state(tiles), m);
    expect(planned).not.toContain('friend');
    expect(planned).not.toContain('influence:friend');
    expect(planned).toContain('foe');
  });

  it("goes for the weak neighbour either way in a free-for-all game", () => {
    expect(targets(state(tiles, { teams: false }), m)).toContain('friend');
  });

  it("nothing on another side during the opening ceasefire, but neutral ground stays open", () => {
    const withNeutral: Tile[] = [...tiles, ['wild', null, 1]];
    const m2 = map(withNeutral, [['home', 'friend'], ['home', 'foe'], ['home', 'wild']]);
    const planned = targets(state(withNeutral, { turn: 1 }), m2);
    expect(planned).not.toContain('foe');
    expect(planned).not.toContain('influence:foe');
    expect(planned).toContain('wild');
    expect(targets(state(withNeutral, { turn: 2 }), m2)).toContain('foe');
  });
});

describe("an ally's border is as quiet as the bot's own", () => {
  it('drafts onto the tile facing the enemy, not the one facing an ally', () => {
    // A thin tile beside a big allied stack looks most threatened to a bot
    // that counts the ally as an enemy.
    const tiles: Tile[] = [['front', AI, 5], ['thin', AI, 1], ['friend', ALLY, 20], ['foe', ENEMY, 4]];
    const m = map(tiles, [['front', 'foe'], ['thin', 'friend'], ['front', 'thin']]);
    const draftTo = (s: GameState) => plan(s, m).find((a) => a.type === 'draft')?.to;
    expect(draftTo(state(tiles))).toBe('front');
    expect(draftTo(state(tiles, { teams: false }))).toBe('thin');
  });

  it('moves units from behind an ally up to a front', () => {
    const tiles: Tile[] = [['rear', AI, 9], ['front', AI, 1], ['friend', ALLY, 3], ['foe', ENEMY, 30]];
    const m = map(tiles, [['rear', 'friend'], ['rear', 'front'], ['front', 'foe']]);
    const fortify = (s: GameState) => plan(s, m).find((a) => a.type === 'fortify');
    expect(fortify(state(tiles))).toMatchObject({ from: 'rear', to: 'front' });
    // Counted as a border, the rear held its units.
    expect(fortify(state(tiles, { teams: false }))).toBeUndefined();
  });

  it('never seals a lane against an ally', () => {
    const tiles: Tile[] = [['gate', AI, 1], ['their_gate', ALLY, 12]];
    const m = map(tiles, [['gate', 'their_gate', 'orbit']]);
    expect(chooseEmergencySealLane(state(tiles), m, AI)).toBeNull();
    expect(chooseEmergencySealLane(state(tiles, { teams: false }), m, AI)).toEqual({ from: 'gate', to: 'their_gate' });
  });
});
