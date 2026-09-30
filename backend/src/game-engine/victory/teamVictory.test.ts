/**
 * A team game is judged side by side (victory/teamVictory.ts):
 *   • the last side standing wins, its eliminated members with it;
 *   • domination and the threshold count the side's territories together;
 *   • the capital reading needs every living capital in the side's hands;
 *   • a member's Lane Sovereignty streak, counted on corridors an ally helps
 *     hold, wins for the side;
 *   • every human's side out, or the turn cap, credits the leading side;
 *   • two sides through at once: the side on the move;
 *   • the last human resigning concedes for their side.
 * A free-for-all game never reaches any of this.
 */
import { describe, it, expect } from 'vitest';
import type { GameMap, GameState, GameTeam, VictoryType } from '../../types';
import { checkVictory } from '../state/gameStateManager';
import { checkTeamVictory, concededTeamWinners, sidesOf, sideTerritoryCount } from './teamVictory';
import { countCorridors, LANE_SOVEREIGNTY_ROUNDS_BY_SIDES, roundsNeededFor, tickLaneSovereignty } from './laneSovereignty';

const MAP = { territories: [], connections: [], regions: [] } as unknown as GameMap;

const TEAMS: GameTeam[] = [
  { team_id: 'team_1', name: 'Sol & Rust', player_ids: ['a1', 'a2'] },
  { team_id: 'team_2', name: 'Verdan & Nexus', player_ids: ['b1', 'b2'] },
];

interface Seat {
  player_id: string;
  is_ai?: boolean;
  is_eliminated?: boolean;
  territory_count?: number;
  extra_units?: number;
}

/** Seats in the order given (a1, b1, a2, b2 alternate), each owning its count of one-unit territories. */
function teamGame(
  seats: Seat[],
  opts: { conditions?: VictoryType[]; threshold?: number; maxTurns?: number; turn?: number; current?: number; teams?: GameTeam[] } = {},
): GameState {
  const territories: Record<string, unknown> = {};
  let n = 0;
  for (const seat of seats) {
    for (let i = 0; i < (seat.territory_count ?? 0); i++, n++) {
      territories[`t${n}`] = {
        territory_id: `t${n}`,
        owner_id: seat.player_id,
        unit_count: 1 + (i === 0 ? seat.extra_units ?? 0 : 0),
      };
    }
  }
  return {
    phase: 'attack',
    turn_number: opts.turn ?? 12,
    current_player_index: opts.current ?? 0,
    starting_player_index: 0,
    settings: {
      allowed_victory_conditions: opts.conditions ?? ['domination'],
      victory_threshold: opts.threshold,
      max_turns: opts.maxTurns,
    },
    diplomacy: [],
    territories,
    teams: opts.teams ?? TEAMS,
    players: seats.map((seat, i) => ({
      player_id: seat.player_id,
      player_index: i,
      username: seat.player_id,
      is_ai: seat.is_ai ?? false,
      is_eliminated: seat.is_eliminated ?? false,
      territory_count: seat.territory_count ?? 0,
    })),
  } as unknown as GameState;
}

const SEATS = (counts: [number, number, number, number], over: Partial<Record<string, Seat>> = {}): Seat[] =>
  (['a1', 'b1', 'a2', 'b2'] as const).map((id, i) => ({ player_id: id, territory_count: counts[i], ...over[id] }));

describe('sides', () => {
  it('are the teams in seat order, with anyone left out on their own', () => {
    const s = teamGame([...SEATS([1, 1, 1, 1]), { player_id: 'x', territory_count: 1 }]);
    expect(sidesOf(s)).toEqual([['a1', 'a2'], ['b1', 'b2'], ['x']]);
    expect(sideTerritoryCount(s, ['a1', 'a2'])).toBe(2);
  });
});

describe('the last side standing', () => {
  it('wins together, its eliminated member included and listed last', () => {
    const s = teamGame(SEATS([0, 0, 5, 0], {
      a1: { player_id: 'a1', is_eliminated: true },
      b1: { player_id: 'b1', is_eliminated: true },
      b2: { player_id: 'b2', is_eliminated: true },
    }));
    expect(checkVictory(s, MAP)).toEqual({ winnerIds: ['a2', 'a1'], condition: 'last_standing' });
  });

  it('is not declared while both sides have a player in', () => {
    const s = teamGame(SEATS([0, 3, 5, 0], {
      a1: { player_id: 'a1', is_eliminated: true },
      b2: { player_id: 'b2', is_eliminated: true },
    }));
    expect(checkVictory(s, MAP)).toBeNull();
  });
});

describe('the side counts its territories together', () => {
  it('domination: every territory between the members', () => {
    const s = teamGame(SEATS([6, 0, 4, 0], {
      b1: { player_id: 'b1', is_ai: true },
      b2: { player_id: 'b2', is_ai: true },
    }));
    // The b side still has players in (0 tiles but not yet eliminated).
    expect(checkVictory(s, MAP)).toEqual({ winnerIds: ['a1', 'a2'], condition: 'domination' });
  });

  it('threshold: the share held between the members', () => {
    const conditions: VictoryType[] = ['threshold'];
    // 20 tiles; 75% needs 15. 8 + 7 does it; neither alone would.
    expect(checkVictory(teamGame(SEATS([8, 3, 7, 2]), { conditions, threshold: 75 }), MAP))
      .toEqual({ winnerIds: ['a1', 'a2'], condition: 'threshold' });
    expect(checkVictory(teamGame(SEATS([8, 4, 6, 2]), { conditions, threshold: 75 }), MAP)).toBeNull();
  });

  it("capital: every living capital in the side's hands", () => {
    const s = teamGame(SEATS([2, 1, 2, 1]), { conditions: ['capital'] });
    const capitals: Record<string, string> = { a1: 't0', b1: 't2', a2: 't3', b2: 't5' };
    for (const p of s.players) p.capital_territory_id = capitals[p.player_id]!;
    expect(checkVictory(s, MAP)).toBeNull();
    s.territories.t2!.owner_id = 'a1';
    s.territories.t5!.owner_id = 'a2';
    expect(checkVictory(s, MAP)).toEqual({ winnerIds: ['a1', 'a2'], condition: 'capital' });
  });
});

describe('Lane Sovereignty in a team game', () => {
  const lanes = (pairs: Array<[string, string]>) => ({
    territories: [], regions: [], connections: pairs.map(([from, to]) => ({ from, to, type: 'orbit' })),
  }) as unknown as GameMap;

  it('counts a corridor an ally holds one end of', () => {
    const s = teamGame(SEATS([2, 1, 2, 1]), { conditions: ['lane_sovereignty'] });
    // a1 holds t0 and t1, b1 t2, a2 t3 and t4: two lanes join the allies, one is a front.
    const map = lanes([['t0', 't3'], ['t1', 't4'], ['t0', 't2']]);
    expect(countCorridors(s, map, 'a1')).toBe(2);
    expect(countCorridors(s, map, 'a2')).toBe(2);
    expect(countCorridors(s, map, 'b1')).toBe(0);
    s.teams = undefined;
    expect(countCorridors(s, map, 'a1')).toBe(0);
  });

  it("wins for the side when a member's streak runs its rounds", () => {
    const pairs: Array<[string, string]> = [['t0', 't1'], ['t2', 't3'], ['t4', 't5'], ['t6', 't7'], ['t8', 't9']];
    const s = teamGame(SEATS([5, 1, 5, 1]), { conditions: ['lane_sovereignty'] });
    const map = lanes(pairs);
    // Five corridors held half by each ally.
    for (const [a, b] of pairs) {
      s.territories[a]!.owner_id = 'a1';
      s.territories[b]!.owner_id = 'a2';
    }
    expect(roundsNeededFor(s)).toBe(LANE_SOVEREIGNTY_ROUNDS_BY_SIDES[2]);
    for (let i = 0; i < roundsNeededFor(s) - 1; i++) tickLaneSovereignty(s, map, 'a2');
    expect(checkVictory(s, map)).toBeNull();
    tickLaneSovereignty(s, map, 'a2');
    expect(checkVictory(s, map)).toEqual({ winnerIds: ['a1', 'a2'], condition: 'lane_sovereignty' });
  });
});

describe('a side credited without meeting a condition', () => {
  it('every human side out: the leading side, while a human side is in, nobody', () => {
    const ai = { is_ai: true };
    const humanSideOut = teamGame(SEATS([0, 9, 0, 6], {
      a1: { player_id: 'a1', is_eliminated: true },
      a2: { player_id: 'a2', is_eliminated: true },
      b1: { player_id: 'b1', ...ai },
      b2: { player_id: 'b2', ...ai },
    }).concat([{ player_id: 'c1', is_ai: true, territory_count: 10 }]), {
      teams: [...TEAMS, { team_id: 'team_3', name: 'Third', player_ids: ['c1'] }],
    });
    expect(checkVictory(humanSideOut, MAP)).toEqual({ winnerIds: ['b1', 'b2'], condition: 'humans_eliminated' });

    // An eliminated human whose AI ally plays on is still in the game.
    const allyPlaysOn = teamGame(SEATS([0, 9, 4, 6], {
      a1: { player_id: 'a1', is_eliminated: true },
      a2: { player_id: 'a2', ...ai },
      b1: { player_id: 'b1', ...ai },
      b2: { player_id: 'b2', ...ai },
    }));
    expect(checkVictory(allyPlaysOn, MAP)).toBeNull();
  });

  it('the turn cap: the side holding the most between them', () => {
    const s = teamGame(SEATS([2, 5, 6, 2]), { maxTurns: 10, turn: 11 });
    expect(checkVictory(s, MAP)).toEqual({ winnerIds: ['a1', 'a2'], condition: 'turn_limit' });
  });
});

describe('two sides through at once', () => {
  it('goes to the side on the move', () => {
    const s = teamGame(SEATS([4, 4, 4, 4]), { conditions: ['threshold'], threshold: 50, current: 1 });
    expect(checkTeamVictory(s, MAP)?.winnerIds).toEqual(['b1', 'b2']);
    s.current_player_index = 2;
    expect(checkTeamVictory(s, MAP)?.winnerIds).toEqual(['a1', 'a2']);
  });
});

describe('the last human resigning', () => {
  it('concedes for their side: the leading other side is credited', () => {
    const s = teamGame(SEATS([0, 4, 8, 3], {
      a1: { player_id: 'a1', is_eliminated: true },
      a2: { player_id: 'a2', is_ai: true },
      b1: { player_id: 'b1', is_ai: true },
      b2: { player_id: 'b2', is_ai: true },
    }));
    expect(concededTeamWinners(s, 'a1')).toEqual(['b1', 'b2']);
  });

  it('credits nobody when no other side is still playing', () => {
    const s = teamGame(SEATS([0, 0, 8, 0], {
      a1: { player_id: 'a1', is_eliminated: true },
      b1: { player_id: 'b1', is_eliminated: true },
      b2: { player_id: 'b2', is_eliminated: true },
    }));
    expect(concededTeamWinners(s, 'a1')).toBeNull();
  });
});

describe('a free-for-all game', () => {
  it('is judged player by player, as it always was', () => {
    const s = teamGame(SEATS([8, 3, 7, 2]), { conditions: ['threshold'], threshold: 75 });
    s.teams = undefined;
    expect(checkVictory(s, MAP)).toBeNull();
    s.teams = [];
    expect(checkVictory(s, MAP)).toBeNull();
  });
});
