/**
 * The Galactic Age report's analytics: win rates per seat against the seat's
 * fair share (1 / sides, as the balance sim reads them), with Wilson intervals,
 * and the game-level tallies. Pure: built from recorded games, no database.
 */
import { describe, it, expect } from 'vitest';
import type { GalaxySeatRole } from '../../game-engine/state/galaxyResults';
import { buildGalaxyAnalytics, wilsonInterval, type GalaxyReportGame, type GalaxyReportSeat } from './galaxyReport';

let nextGame = 0;

function seat(over: Partial<GalaxyReportSeat> & { seat: number }): GalaxyReportSeat {
  return {
    user_id: null, username: null, is_ai: false, ai_difficulty: null, faction_id: null, world_id: null,
    house: null, role: 'home' as GalaxySeatRole, side: null, reinforce_bonus: null, won: false,
    eliminated: false, resigned: false, territories: 0,
    ...over,
  };
}

function game(over: Partial<GalaxyReportGame> & { seat_results: GalaxyReportSeat[] }): GalaxyReportGame {
  nextGame += 1;
  return {
    game_id: `g${nextGame}`, finished_at: '2026-10-01T12:00:00.000Z', started_at: null, ended_at: null,
    seats: over.seat_results.length, mode: 'home_worlds', relations: null, board: null,
    victory: 'threshold', turns: 30, first_seat: null, humans: 0,
    ...over,
  };
}

const FACTIONS = ['stellar_mandate', 'forge_syndicate', 'helion_navigators', 'void_custodians'];

/** A four-seat free-for-all won by the seat at `winner`, seats in FACTIONS order. */
function fourSeat(winner: number, over: Partial<GalaxyReportGame> = {}): GalaxyReportGame {
  return game({
    seat_results: FACTIONS.map((faction_id, i) => seat({ seat: i, faction_id, won: i === winner })),
    ...over,
  });
}

describe('wilsonInterval', () => {
  it('matches the textbook interval, and stays inside 0–1', () => {
    const [lo, hi] = wilsonInterval(5, 10);
    expect(lo).toBeCloseTo(0.2366, 4);
    expect(hi).toBeCloseTo(0.7634, 4);
    const [zlo, zhi] = wilsonInterval(0, 10);
    expect(zlo).toBe(0);
    expect(zhi).toBeCloseTo(0.2775, 4);
    expect(wilsonInterval(10, 10)[1]).toBe(1);
    expect(wilsonInterval(0, 0)).toEqual([0, 0]);
  });
});

describe('win rates against the fair share', () => {
  it('reads a free-for-all seat against 1 / seats', () => {
    const a = buildGalaxyAnalytics([fourSeat(0), fourSeat(0), fourSeat(2), fourSeat(3)]);
    const sol = a.factions.find((f) => f.key === 'stellar_mandate')!;
    expect(sol).toMatchObject({ seats: 4, wins: 2, expected: 1, rate: 0.5, expected_rate: 0.25 });
    expect(sol.low).toBeLessThan(0.5);
    expect(sol.high).toBeGreaterThan(0.5);
    expect(a.factions.find((f) => f.key === 'forge_syndicate')).toMatchObject({ wins: 0, rate: 0 });
  });

  it('reads a team seat against 1 / sides: a side of two and a side of one share alike', () => {
    // Five seats Allied: Sol a side of two (seats 0 and 3), the others sides of one.
    const allied = game({
      mode: 'partial_schism', relations: 'allied', board: 'sol',
      seat_results: [
        seat({ seat: 0, faction_id: 'stellar_mandate', role: 'ally', side: 'sol', house: 'Western Mandate', won: true }),
        seat({ seat: 1, faction_id: 'forge_syndicate', role: 'whole', side: 'rust' }),
        seat({ seat: 2, faction_id: 'helion_navigators', role: 'whole', side: 'verdan' }),
        seat({ seat: 3, faction_id: 'stellar_mandate', role: 'ally', side: 'sol', house: 'Eastern Mandate', won: true }),
        seat({ seat: 4, faction_id: 'void_custodians', role: 'whole', side: 'nexus_station' }),
      ],
    });
    const a = buildGalaxyAnalytics([allied]);
    expect(a.roles.find((r) => r.key === 'ally')).toMatchObject({ seats: 2, wins: 2, expected: 0.5, expected_rate: 0.25 });
    expect(a.roles.find((r) => r.key === 'whole')).toMatchObject({ seats: 3, wins: 0, expected: 0.75 });
    expect(a.factions.find((f) => f.key === 'stellar_mandate')).toMatchObject({ seats: 2, wins: 2, expected_rate: 0.25 });

    const twoVtwo = game({
      mode: '2v2',
      seat_results: FACTIONS.map((faction_id, i) => seat({ seat: i, faction_id, side: i % 2 ? 'b' : 'a', won: i % 2 === 0 })),
    });
    expect(buildGalaxyAnalytics([twoVtwo]).factions.every((f) => f.expected_rate === 0.5)).toBe(true);
  });

  it('keeps each Schism house apart by its role, and orders roles and factions', () => {
    const concord = game({
      mode: 'partial_schism', relations: 'concord', board: 'sol', seats: 5,
      seat_results: [
        seat({ seat: 0, faction_id: 'stellar_mandate', role: 'rival', house: 'Western Mandate', won: true }),
        seat({ seat: 1, faction_id: 'forge_syndicate', role: 'alone', house: 'Tharsis Syndicate' }),
        seat({ seat: 2, faction_id: 'helion_navigators', role: 'alone', house: 'Dawnrim Navigators' }),
        seat({ seat: 3, faction_id: 'stellar_mandate', role: 'rival', house: 'Eastern Mandate' }),
        seat({ seat: 4, faction_id: 'void_custodians', role: 'alone', house: 'Ward Custodians' }),
      ],
    });
    const a = buildGalaxyAnalytics([concord, fourSeat(1)]);
    expect(a.roles.map((r) => r.key)).toEqual(['home', 'rival', 'alone']);
    expect(a.factions.map((f) => f.key)).toEqual(['stellar_mandate', 'helion_navigators', 'forge_syndicate', 'void_custodians']);
    const western = a.houses.find((h) => h.house === 'Western Mandate')!;
    expect(western).toMatchObject({ role: 'rival', seats: 1, wins: 1, expected_rate: 0.2 });
    expect(a.houses).toHaveLength(5);
  });

  it('splits humans from each AI difficulty, humans first', () => {
    const g = game({
      seat_results: [
        seat({ seat: 0, faction_id: FACTIONS[0], won: true }),
        seat({ seat: 1, faction_id: FACTIONS[1], is_ai: true, ai_difficulty: 'expert' }),
        seat({ seat: 2, faction_id: FACTIONS[2], is_ai: true, ai_difficulty: 'easy' }),
        seat({ seat: 3, faction_id: FACTIONS[3], is_ai: true, ai_difficulty: 'expert' }),
      ],
    });
    const a = buildGalaxyAnalytics([g]);
    expect(a.players.map((p) => [p.key, p.seats, p.wins])).toEqual([
      ['human', 1, 1],
      ['ai:easy', 1, 0],
      ['ai:expert', 2, 0],
    ]);
  });

  it('reads the first seat against its share', () => {
    const a = buildGalaxyAnalytics([
      fourSeat(2, { first_seat: 2 }),
      fourSeat(0, { first_seat: 1 }),
      fourSeat(3),
    ]);
    expect(a.first_seat).toMatchObject({ seats: 2, wins: 1, expected: 0.5, rate: 0.5 });
    expect(buildGalaxyAnalytics([fourSeat(0)]).first_seat).toBeNull();
  });
});

describe('game-level tallies', () => {
  it('counts decisive endings, lengths, endings, modes and days', () => {
    const games = [
      fourSeat(0, { victory: 'lane_sovereignty', turns: 20, finished_at: '2026-10-01T09:00:00.000Z',
        started_at: '2026-10-01T08:00:00.000Z', ended_at: '2026-10-01T08:30:00.000Z' }),
      fourSeat(1, { victory: 'turn_limit', turns: 90, finished_at: '2026-10-02T09:00:00.000Z',
        started_at: '2026-10-02T08:00:00.000Z', ended_at: '2026-10-02T09:00:00.000Z' }),
      fourSeat(2, { victory: 'lane_sovereignty', turns: 25, finished_at: '2026-10-02T10:00:00.000Z' }),
      fourSeat(3, { victory: 'resignation', turns: 10, mode: 'scattered', finished_at: '2026-10-02T11:00:00.000Z' }),
    ];
    const a = buildGalaxyAnalytics(games);
    expect(a).toMatchObject({ games: 4, decisive: 2, avg_turns: 36.25, median_minutes: 45 });
    expect(a.endings).toEqual([
      { victory: 'lane_sovereignty', games: 2 },
      { victory: 'resignation', games: 1 },
      { victory: 'turn_limit', games: 1 },
    ]);
    expect(a.modes).toEqual([
      { mode: 'home_worlds', seats: 4, relations: null, games: 3, avg_turns: 45 },
      { mode: 'scattered', seats: 4, relations: null, games: 1, avg_turns: 10 },
    ]);
    expect(a.by_day).toEqual([{ day: '2026-10-01', games: 1 }, { day: '2026-10-02', games: 3 }]);
  });

  it('reads nothing from no games', () => {
    expect(buildGalaxyAnalytics([])).toMatchObject({
      games: 0, decisive: 0, avg_turns: null, median_minutes: null, factions: [], first_seat: null, by_day: [],
    });
  });
});
