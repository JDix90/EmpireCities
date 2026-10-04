/**
 * The digest of a bot's turn (ai_intents_enabled): what it took, the regions
 * it completed or broke, who it knocked out, and the goal its level tells.
 */
import { describe, it, expect } from 'vitest';
import type { GameMap, GameState } from '../../types';
import { buildAiTurnDigest, snapshotForDigest } from './aiTurnDigest';

const AI = 'ai_0';
const YOU = 'you';
const R = 'r1';

/** west: w1, w2 · east: e1, e2 · south: s1. */
function map(): GameMap {
  const regionOf: Record<string, string> = { w1: 'west', w2: 'west', e1: 'east', e2: 'east', s1: 'south' };
  return {
    map_id: 'digest',
    name: 'Digest',
    territories: Object.entries(regionOf).map(([id, region_id]) => ({ territory_id: id, name: id, polygon: [], center_point: [0, 0], region_id })),
    connections: [],
    regions: [
      { region_id: 'west', name: 'The West', bonus: 2 },
      { region_id: 'east', name: 'The East', bonus: 2 },
      { region_id: 'south', name: 'The South', bonus: 1 },
    ],
  } as unknown as GameMap;
}

function board(owners: Record<string, string | null>): GameState {
  return {
    game_id: 'g',
    turn_number: 9,
    players: [AI, YOU, R].map((player_id, i) => ({
      player_id, player_index: i, username: player_id === YOU ? 'You' : player_id.toUpperCase(),
      is_ai: player_id !== YOU, is_eliminated: false, cards: [],
    })),
    territories: Object.fromEntries(Object.entries(owners).map(([id, owner_id]) => [id, { territory_id: id, owner_id, unit_count: 3 }])),
    settings: {},
  } as unknown as GameState;
}

/** Play `moves` (tile → new owner) on `start` and digest the bot's turn. */
function digestOf(start: Record<string, string | null>, moves: Record<string, string>, difficulty: 'medium' | 'expert' = 'medium') {
  const s = board(start);
  const before = snapshotForDigest(s);
  for (const [id, owner] of Object.entries(moves)) s.territories[id]!.owner_id = owner;
  return { s, digest: buildAiTurnDigest(before, s, map(), s.players[0]!, difficulty) };
}

describe('the digest of a bot\'s turn', () => {
  it('lists what it took, and from whom', () => {
    const { digest } = digestOf(
      { w1: AI, w2: null, e1: YOU, e2: YOU, s1: R },
      { w2: AI, e1: AI },
    );
    expect(digest).toMatchObject({ playerId: AI, turnNumber: 9 });
    expect(digest.taken).toEqual([
      { territoryId: 'w2', fromPlayerId: null },
      { territoryId: 'e1', fromPlayerId: YOU },
    ]);
  });

  it('names a region it completed, and a whole region of a rival\'s it broke', () => {
    const { digest } = digestOf(
      { w1: AI, w2: null, e1: YOU, e2: YOU, s1: R },
      { w2: AI, e1: AI },
    );
    expect(digest.regionsTaken).toEqual([{ regionId: 'west', name: 'The West' }]);
    expect(digest.regionsBroken).toEqual([{ regionId: 'east', name: 'The East', fromPlayerId: YOU }]);
  });

  it('takes no credit for a region already whole, or one it did not break into', () => {
    const { digest } = digestOf(
      { w1: AI, w2: AI, e1: YOU, e2: R, s1: R },
      { e1: AI },
    );
    expect(digest.regionsTaken).toEqual([]);
    // The east was never whole for anyone.
    expect(digest.regionsBroken).toEqual([]);
  });

  it('names who it knocked out', () => {
    const { s, digest: unused } = digestOf({ w1: AI, w2: AI, e1: YOU, e2: YOU, s1: R }, {});
    expect(unused.eliminated).toEqual([]);
    const before = snapshotForDigest(s);
    s.territories.s1!.owner_id = AI;
    s.players[2]!.is_eliminated = true;
    expect(buildAiTurnDigest(before, s, map(), s.players[0]!, 'medium').eliminated).toEqual([R]);
  });

  it('names the goal below Expert, and only what it did at Expert', () => {
    const start = { w1: AI, w2: null, e1: YOU, e2: YOU, s1: R };
    for (const [goal, name] of [
      [{ kind: 'take_region', target: 'west', since: 7 }, 'The West'],
      [{ kind: 'break_region', target: 'east', since: 7 }, 'The East'],
      [{ kind: 'hunt', target: YOU, since: 7 }, 'You'],
    ] as const) {
      const s = board(start);
      s.players[0]!.ai_intent = goal;
      const before = snapshotForDigest(s);
      expect(buildAiTurnDigest(before, s, map(), s.players[0]!, 'medium').goal).toEqual({ kind: goal.kind, target: goal.target, name });
      expect(buildAiTurnDigest(before, s, map(), s.players[0]!, 'expert').goal).toBeUndefined();
    }
  });

  it('reads only who holds what, never a garrison', () => {
    const { s, digest } = digestOf({ w1: AI, w2: null, e1: YOU, e2: YOU, s1: R }, { e1: AI });
    for (const t of Object.values(s.territories)) t.unit_count = 99;
    const before = snapshotForDigest(board({ w1: AI, w2: null, e1: YOU, e2: YOU, s1: R }));
    expect(buildAiTurnDigest(before, s, map(), s.players[0]!, 'medium')).toEqual(digest);
    expect(JSON.stringify(digest)).not.toContain('unit');
  });
});
