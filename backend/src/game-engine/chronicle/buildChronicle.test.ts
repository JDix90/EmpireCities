import { describe, expect, it } from 'vitest';
import { buildChronicle, type ChronicleKind } from './buildChronicle';
import type { GameMap, GameState } from '../../types';

/**
 * A two-region map: Iberia (3) and Gaul (2), so "secures a whole region" is
 * reachable without hand-building thirty territories.
 */
const MAP = {
  territories: [
    { territory_id: 'ib1', name: 'Tarraco', region_id: 'iberia' },
    { territory_id: 'ib2', name: 'Baetica', region_id: 'iberia' },
    { territory_id: 'ib3', name: 'Lusitania', region_id: 'iberia' },
    { territory_id: 'ga1', name: 'Narbo', region_id: 'gaul' },
    { territory_id: 'ga2', name: 'Lutetia', region_id: 'gaul' },
  ],
  regions: [
    { region_id: 'iberia', name: 'Iberia', bonus: 3 },
    { region_id: 'gaul', name: 'Gaul', bonus: 2 },
  ],
  connections: [],
} as unknown as GameMap;

interface Seat {
  id: string;
  name: string;
  eliminated?: boolean;
  eraIndex?: number;
  capital?: string | null;
}

function snap(
  turn: number,
  owners: Record<string, string | null>,
  seats: Seat[],
  extra: Partial<GameState> = {},
): { turn_number: number; state: GameState } {
  return {
    turn_number: turn,
    state: {
      era: 'ancient',
      turn_number: turn,
      settings: { era_advancement_enabled: true, era_advancement_spine_id: 'classic' },
      era_spine: [{ era_id: 'ancient' }, { era_id: 'medieval' }, { era_id: 'discovery' }],
      territories: Object.fromEntries(
        Object.entries(owners).map(([tid, owner]) => [tid, { territory_id: tid, owner_id: owner, unit_count: 2 }]),
      ),
      players: seats.map((s, i) => ({
        player_id: s.id,
        player_index: i,
        username: s.name,
        color: ['#f00', '#00f', '#0f0'][i] ?? '#fff',
        is_ai: false,
        is_eliminated: s.eliminated ?? false,
        current_era_index: s.eraIndex ?? 0,
        capital_territory_id: s.capital === undefined ? null : s.capital,
        territory_count: Object.values(owners).filter((o) => o === s.id).length,
      })),
      ...extra,
    } as unknown as GameState,
  };
}

const kinds = (entries: { kind: ChronicleKind }[]) => entries.map((e) => e.kind);
const of = (entries: { kind: ChronicleKind }[], kind: ChronicleKind) => entries.filter((e) => e.kind === kind);

const RED: Seat = { id: 'red', name: 'Rome' };
const BLUE: Seat = { id: 'blue', name: 'Carthage' };

describe('buildChronicle', () => {
  it('opens the history and dates it in the era it is played in', () => {
    const c = buildChronicle(
      [snap(1, { ib1: 'red', ib2: 'blue', ib3: null, ga1: null, ga2: null }, [RED, BLUE])],
      MAP,
    );
    expect(c.entries[0].kind).toBe('opening');
    expect(c.entries[0].date).toBe('200'); // Ancient World (200 AD)
    expect(c.turnCount).toBe(1);
  });

  it('narrates a whole region falling to one commander', () => {
    // The beat the Chronicle exists for: "Rome secures Iberia", not "Rome took
    // Lusitania on turn 4".
    const c = buildChronicle(
      [
        snap(1, { ib1: 'red', ib2: 'red', ib3: 'blue', ga1: 'blue', ga2: 'blue' }, [RED, BLUE]),
        snap(4, { ib1: 'red', ib2: 'red', ib3: 'red', ga1: 'blue', ga2: 'blue' }, [RED, BLUE]),
      ],
      MAP,
    );
    const secured = of(c.entries, 'region_secured');
    expect(secured).toHaveLength(1);
    expect(secured[0].headline).toBe('Rome secures Iberia');
    expect(secured[0].playerName).toBe('Rome');
    expect(secured[0].turn).toBe(4);
  });

  it('tells each region once, not on every turn it is still held', () => {
    const held = { ib1: 'red', ib2: 'red', ib3: 'red', ga1: 'blue', ga2: 'blue' };
    const c = buildChronicle(
      [
        snap(1, { ...held, ib3: 'blue' }, [RED, BLUE]),
        snap(4, held, [RED, BLUE]),
        snap(5, held, [RED, BLUE]),
        snap(6, held, [RED, BLUE]),
      ],
      MAP,
    );
    expect(of(c.entries, 'region_secured')).toHaveLength(1);
  });

  it('marks the first territory to change hands, once', () => {
    const c = buildChronicle(
      [
        snap(1, { ib1: 'red', ib2: 'blue', ib3: 'blue', ga1: 'blue', ga2: 'blue' }, [RED, BLUE]),
        snap(2, { ib1: 'red', ib2: 'red', ib3: 'blue', ga1: 'blue', ga2: 'blue' }, [RED, BLUE]),
        snap(3, { ib1: 'red', ib2: 'red', ib3: 'red', ga1: 'blue', ga2: 'blue' }, [RED, BLUE]),
      ],
      MAP,
    );
    const blood = of(c.entries, 'first_blood');
    expect(blood).toHaveLength(1);
    expect(blood[0].turn).toBe(2);
  });

  it('records a capital falling, and names both sides of it', () => {
    const red = { ...RED, capital: 'ib1' };
    const c = buildChronicle(
      [
        snap(1, { ib1: 'red', ib2: 'blue', ib3: null, ga1: null, ga2: null }, [red, BLUE]),
        snap(6, { ib1: 'blue', ib2: 'blue', ib3: null, ga1: null, ga2: null }, [red, BLUE]),
      ],
      MAP,
    );
    const fell = of(c.entries, 'capital_fell');
    expect(fell).toHaveLength(1);
    expect(fell[0].headline).toContain("Rome's capital falls at Tarraco");
    expect(fell[0].detail).toContain('Carthage takes the seat');
  });

  it('calls out the first commander into a new age', () => {
    // The wedge: reaching the next era ahead of the field is the thing the
    // Chronicle should make legible, and it re-dates the entry to that era.
    const c = buildChronicle(
      [
        snap(1, { ib1: 'red', ib2: 'blue', ib3: null, ga1: null, ga2: null }, [RED, BLUE]),
        snap(9, { ib1: 'red', ib2: 'blue', ib3: null, ga1: null, ga2: null }, [{ ...RED, eraIndex: 1 }, BLUE]),
      ],
      MAP,
    );
    const era = of(c.entries, 'era_advanced');
    expect(era).toHaveLength(1);
    expect(era[0].headline).toBe('Rome reaches the Medieval Era first');
    expect(era[0].date).toBe('1248'); // dated in the era arrived in, not the one left
  });

  it('drops "first" once someone else has already been there', () => {
    const c = buildChronicle(
      [
        snap(1, { ib1: 'red', ib2: 'blue', ib3: null, ga1: null, ga2: null }, [RED, BLUE]),
        snap(9, { ib1: 'red', ib2: 'blue', ib3: null, ga1: null, ga2: null }, [{ ...RED, eraIndex: 1 }, BLUE]),
        snap(14, { ib1: 'red', ib2: 'blue', ib3: null, ga1: null, ga2: null }, [
          { ...RED, eraIndex: 1 },
          { ...BLUE, eraIndex: 1 },
        ]),
      ],
      MAP,
    );
    const era = of(c.entries, 'era_advanced');
    expect(era).toHaveLength(2);
    expect(era[0].headline).toContain('first');
    expect(era[1].headline).toBe('Carthage reaches the Medieval Era');
  });

  it('records an elimination once', () => {
    const c = buildChronicle(
      [
        snap(1, { ib1: 'red', ib2: 'blue', ib3: null, ga1: null, ga2: null }, [RED, BLUE]),
        snap(7, { ib1: 'red', ib2: 'red', ib3: null, ga1: null, ga2: null }, [RED, { ...BLUE, eliminated: true }]),
        snap(8, { ib1: 'red', ib2: 'red', ib3: null, ga1: null, ga2: null }, [RED, { ...BLUE, eliminated: true }]),
      ],
      MAP,
    );
    const out = of(c.entries, 'elimination');
    expect(out).toHaveLength(1);
    expect(out[0].headline).toBe('Carthage is driven from the map');
    expect(out[0].turn).toBe(7);
  });

  it('names the turn the odds broke, and ignores noise', () => {
    const swing = [
      { step: 0, turn: 2, probabilities: { red: 0.5, blue: 0.5 } },
      { step: 1, turn: 5, probabilities: { red: 0.9, blue: 0.1 } },
    ];
    const withSwing = buildChronicle(
      [
        snap(1, { ib1: 'red', ib2: 'blue', ib3: null, ga1: null, ga2: null }, [RED, BLUE]),
        snap(5, { ib1: 'red', ib2: 'blue', ib3: null, ga1: null, ga2: null }, [RED, BLUE], {
          win_probability_history: swing,
        } as Partial<GameState>),
      ],
      MAP,
    );
    const decisive = of(withSwing.entries, 'decisive_turn');
    expect(decisive).toHaveLength(1);
    expect(decisive[0].turn).toBe(5);
    expect(decisive[0].detail).toContain('40 points');

    const noise = [
      { step: 0, turn: 2, probabilities: { red: 0.5, blue: 0.5 } },
      { step: 1, turn: 5, probabilities: { red: 0.55, blue: 0.45 } },
    ];
    const withNoise = buildChronicle(
      [
        snap(1, { ib1: 'red', ib2: 'blue', ib3: null, ga1: null, ga2: null }, [RED, BLUE]),
        snap(5, { ib1: 'red', ib2: 'blue', ib3: null, ga1: null, ga2: null }, [RED, BLUE], {
          win_probability_history: noise,
        } as Partial<GameState>),
      ],
      MAP,
    );
    expect(of(withNoise.entries, 'decisive_turn')).toHaveLength(0);
  });

  it('closes on the winner and what won it', () => {
    const c = buildChronicle(
      [
        snap(1, { ib1: 'red', ib2: 'blue', ib3: null, ga1: null, ga2: null }, [RED, BLUE]),
        snap(12, { ib1: 'red', ib2: 'red', ib3: 'red', ga1: 'red', ga2: 'red' }, [RED, { ...BLUE, eliminated: true }], {
          winner_id: 'red',
          victory_condition: 'domination',
        } as Partial<GameState>),
      ],
      MAP,
    );
    const end = c.entries[c.entries.length - 1];
    expect(end.kind).toBe('conclusion');
    expect(end.headline).toBe('Rome stands alone');
    expect(end.detail).toContain('one banner');
  });

  it('reads cause before effect inside a single turn', () => {
    const red = { ...RED, capital: 'ib1' };
    const c = buildChronicle(
      [
        snap(1, { ib1: 'red', ib2: 'red', ib3: 'blue', ga1: 'blue', ga2: 'blue' }, [red, BLUE]),
        snap(9, { ib1: 'blue', ib2: 'blue', ib3: 'blue', ga1: 'blue', ga2: 'blue' }, [
          red,
          { ...BLUE, eraIndex: 1 },
        ], { winner_id: 'blue', victory_condition: 'domination' } as Partial<GameState>),
      ],
      MAP,
    );
    const turn9 = kinds(c.entries.filter((e) => e.turn === 9));
    expect(turn9.indexOf('era_advanced')).toBeLessThan(turn9.indexOf('region_secured'));
    expect(turn9.indexOf('region_secured')).toBeLessThan(turn9.indexOf('capital_fell'));
    expect(turn9[turn9.length - 1]).toBe('conclusion');
  });

  it('survives a game with nothing in it', () => {
    expect(buildChronicle([], MAP).entries).toEqual([]);
  });
});
