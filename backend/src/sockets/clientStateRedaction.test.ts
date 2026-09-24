import { describe, it, expect } from 'vitest';
import type { PlayerState, TerritoryState } from '../types';
import {
  redactPlayersForViewer,
  maskHiddenTerritories,
  redactSettingsForClient,
  redactReplaySnapshot,
  redactServerOnlyState,
} from './clientStateRedaction';
import type { GameState } from '../types';

function player(overrides: Partial<PlayerState>): PlayerState {
  return {
    player_id: 'p',
    is_eliminated: false,
    cards: [{ id: 'c1' }] as unknown as PlayerState['cards'],
    secret_mission: { id: 'm1' } as unknown as PlayerState['secret_mission'],
    ...overrides,
  } as PlayerState;
}

const alice = (): PlayerState => player({ player_id: 'alice' });
const bob = (): PlayerState => player({ player_id: 'bob' });

describe('redactPlayersForViewer', () => {
  it('empties every card hand for a spectator (viewerId null)', () => {
    const out = redactPlayersForViewer([alice(), bob()], null, 'attack');
    expect(out.every((p) => p.cards.length === 0)).toBe(true);
  });

  it("nulls other players' secret missions for a spectator mid-game", () => {
    const out = redactPlayersForViewer([alice(), bob()], null, 'attack');
    expect(out.every((p) => p.secret_mission === null)).toBe(true);
  });

  it('keeps the viewing player\'s own hand and mission, hides others\' missions', () => {
    const out = redactPlayersForViewer([alice(), bob()], 'alice', 'attack');
    const a = out.find((p) => p.player_id === 'alice')!;
    const b = out.find((p) => p.player_id === 'bob')!;
    expect(a.cards.length).toBe(1);
    expect(a.secret_mission).not.toBeNull();
    // The helper does not hide other players' cards for a player view — that is
    // the fog branch's job in buildClientState. Preserving this keeps existing
    // (non-spectator) behaviour exactly.
    expect(b.secret_mission).toBeNull();
  });

  it('reveals missions at game_over but still hides card hands from spectators', () => {
    const out = redactPlayersForViewer([alice(), bob()], null, 'game_over');
    expect(out.every((p) => p.secret_mission !== null)).toBe(true);
    expect(out.every((p) => p.cards.length === 0)).toBe(true);
  });

  it('does not mutate the input players', () => {
    const players = [alice(), bob()];
    redactPlayersForViewer(players, null, 'attack');
    expect(players.every((p) => p.cards.length === 1)).toBe(true);
    expect(players.every((p) => p.secret_mission !== null)).toBe(true);
  });
});

function territory(overrides: Partial<TerritoryState>): TerritoryState {
  return {
    territory_id: 't',
    owner_id: 'alice',
    unit_count: 7,
    naval_units: 2,
    buildings: ['fort'],
    stability: 5,
    population: 9,
    ...overrides,
  } as unknown as TerritoryState;
}

describe('maskHiddenTerritories', () => {
  const terrs = (): Record<string, TerritoryState> => ({
    t1: territory({ territory_id: 't1', owner_id: 'alice' }),
    t2: territory({ territory_id: 't2', owner_id: 'bob' }),
  });

  it('masks exact intel of non-visible territories but keeps owner_id (board control)', () => {
    const out = maskHiddenTerritories(terrs(), new Set(['t1']));
    // t1 visible → untouched
    expect(out.t1.unit_count).toBe(7);
    expect(out.t1.buildings).toEqual(['fort']);
    // t2 hidden → counts masked, ownership retained
    expect(out.t2.unit_count).toBe(-1);
    expect(out.t2.naval_units).toBeUndefined();
    expect(out.t2.buildings).toEqual([]);
    expect(out.t2.stability).toBeUndefined();
    expect(out.t2.population).toBeUndefined();
    expect(out.t2.owner_id).toBe('bob');
  });

  it('masks EVERY territory for a spectator (empty visible set)', () => {
    const out = maskHiddenTerritories(terrs(), new Set());
    expect(out.t1.unit_count).toBe(-1);
    expect(out.t2.unit_count).toBe(-1);
    // ownership still visible so spectators see who controls the board
    expect(out.t1.owner_id).toBe('alice');
    expect(out.t2.owner_id).toBe('bob');
  });

  it('does not mutate the input territories', () => {
    const input = terrs();
    maskHiddenTerritories(input, new Set());
    expect(input.t1.unit_count).toBe(7);
    expect(input.t2.buildings).toEqual(['fort']);
  });
});

describe('redactSettingsForClient', () => {
  it('strips the daily dice seed and the game seed, keeps every rule, and leaves the original intact', () => {
    const settings = {
      fog_of_war: false,
      seed: 4242,
      daily_challenge_date: '2026-09-14',
      daily_challenge_spec: { archetype: 'military_capture', title: 'Solferino', dice_queue_seed: 99, par_turns: 2 },
    };
    const out = redactSettingsForClient(settings);
    expect(out.seed).toBeUndefined();
    expect((out.daily_challenge_spec as Record<string, unknown>).dice_queue_seed).toBeUndefined();
    expect(out.daily_challenge_spec).toMatchObject({ archetype: 'military_capture', title: 'Solferino', par_turns: 2 });
    expect(out.fog_of_war).toBe(false);
    expect(out.daily_challenge_date).toBe('2026-09-14');
    // The authoritative settings are not mutated.
    expect(settings.seed).toBe(4242);
    expect(settings.daily_challenge_spec.dice_queue_seed).toBe(99);
  });

  it('is a no-op shape-wise for a game with no daily spec', () => {
    const out = redactSettingsForClient({ fog_of_war: true, turn_timer_seconds: 90 });
    expect(out).toEqual({ fog_of_war: true, turn_timer_seconds: 90 });
  });
});

describe('redactSettingsForClient — a Daily v2 day', () => {
  const v2 = {
    version: 2,
    theme: 'cut the supply line',
    plan: { steps: [{ kind: 'draft', to: 'gaul', when: 'objective_ai' }] },
    plan_prose: ['While it holds the objective, it reinforces Gaul.'],
    decisions_target: 2,
    verdicts: 'before_dice',
    intent: 'arrows',
    solution: { equity: 0.7, obvious_equity: 0.4, near_best: 1, decisions: [{ turn: 1 }, { turn: 2 }], line: [], nodes: 100 },
  };

  it('strips the answer key and the dice seed, keeps the theme, the plan in words and the decision count', () => {
    const out = redactSettingsForClient({
      daily_challenge_spec: { archetype: 'military_capture', dice_queue_seed: 7, v2 },
    } as unknown as { daily_challenge_spec: Record<string, unknown> });
    const spec = out.daily_challenge_spec as Record<string, unknown>;
    expect(spec.dice_queue_seed).toBeUndefined();
    const pub = spec.v2 as Record<string, unknown>;
    expect(pub.solution).toBeUndefined();
    expect(pub.theme).toBe('cut the supply line');
    expect(pub.plan_prose).toEqual(v2.plan_prose);
    expect(pub.decisions).toBe(2);
    // An arrows day carries the raw plan for the intent arrows.
    expect(pub.plan).toEqual(v2.plan);
  });

  it('withholds the raw plan on a prose day', () => {
    const out = redactSettingsForClient({
      daily_challenge_spec: { archetype: 'military_capture', v2: { ...v2, intent: 'prose', verdicts: 'silent' } },
    } as unknown as { daily_challenge_spec: Record<string, unknown> });
    const pub = (out.daily_challenge_spec as Record<string, unknown>).v2 as Record<string, unknown>;
    expect(pub.plan).toBeUndefined();
    expect(pub.solution).toBeUndefined();
    expect(pub.plan_prose).toEqual(v2.plan_prose);
  });

  it('leaves a v1 day exactly as before', () => {
    const out = redactSettingsForClient({
      daily_challenge_spec: { archetype: 'economy_build', dice_queue_seed: 7, title: 't' },
    } as unknown as { daily_challenge_spec: Record<string, unknown> });
    expect(out.daily_challenge_spec).toEqual({ archetype: 'economy_build', title: 't' });
  });
});

describe('redactReplaySnapshot', () => {
  /** A stored snapshot of a live Daily v2 run, as `game_states.state_json` holds it. */
  function snapshot(): GameState {
    return {
      phase: 'attack',
      turn_number: 1,
      card_deck: [{ card_id: 'd1', territory_id: 'a', symbol: 'infantry' }],
      mission_seed_salt: 'salt',
      puzzle_dice_queue: [6, 5, 4, 3, 2, 1],
      puzzle_decisions: [{ turn: 1, loss: 12.5, grade: 'inaccuracy' }],
      puzzle_turn_open: { turn: 1, key: 'k', units: [3], draft_left: 3 },
      players: [
        { player_id: 'p1', is_ai: false, secret_mission: { kind: 'capture_region', region_id: 'r' } },
        { player_id: 'ai_1', is_ai: true, secret_mission: null },
      ],
      settings: {
        fog_of_war: false,
        seed: 'top-secret-seed',
        daily_challenge_spec: {
          archetype: 'military_capture',
          dice_queue_seed: 7,
          v2: {
            version: 2, theme: 't', plan_prose: ['p'], decisions_target: 2, intent: 'arrows', plan: { steps: [] },
            solution: { equity: 0.7, decisions: [{ turn: 1 }, { turn: 2 }], line: [] },
          },
        },
      },
    } as unknown as GameState;
  }

  it("withholds the day's secrets a live daily keeps from its player", () => {
    const out = redactReplaySnapshot(snapshot());
    const settings = out.settings as unknown as Record<string, unknown>;
    const spec = settings.daily_challenge_spec as Record<string, unknown>;
    expect((spec.v2 as Record<string, unknown>).solution).toBeUndefined();
    expect((spec.v2 as Record<string, unknown>).decisions).toBe(2);
    expect(spec.dice_queue_seed).toBeUndefined();
    expect(settings.seed).toBeUndefined();
    expect(settings.fog_of_war).toBe(false);
    expect(JSON.stringify(out)).not.toContain('solution');
  });

  it('withholds the dice stream and a v2 run\'s grading mid-game, as the live game does', () => {
    const json = JSON.stringify(redactReplaySnapshot(snapshot()));
    expect(json).not.toContain('puzzle_dice_queue');
    expect(json).not.toContain('puzzle_decisions');
    expect(json).not.toContain('puzzle_turn_open');
  });

  it('still withholds the deck, the mission salt and every secret mission', () => {
    const out = redactReplaySnapshot(snapshot());
    expect('card_deck' in out).toBe(false);
    expect(JSON.stringify(out)).not.toContain('mission_seed_salt');
    expect(out.players.every((p) => p.secret_mission === null)).toBe(true);
  });

  it('never mutates the stored snapshot', () => {
    const input = snapshot();
    const before = JSON.stringify(input);
    redactReplaySnapshot(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('redactServerOnlyState', () => {
  function daily(phase: string): GameState {
    return {
      phase,
      turn_number: 2,
      card_deck: [{ card_id: 'd1', territory_id: 'a', symbol: 'infantry' }],
      mission_seed_salt: 'salt',
      puzzle_dice_queue: [6, 5, 4, 3, 2, 1],
      puzzle_decisions: [{ turn: 1, loss: 12.5, grade: 'inaccuracy' }],
      puzzle_turn_open: { turn: 2, key: 'k', units: [3], draft_left: 3 },
      territories: { a: { territory_id: 'a', owner_id: 'p1', unit_count: 4, unit_type: 'infantry' } },
      players: [{ player_id: 'p1', is_ai: false, cards: [{ card_id: 'c1' }], secret_mission: null }],
      settings: { fog_of_war: false, seed: 'top-secret-seed', daily_challenge_spec: { archetype: 'domination', dice_queue_seed: 7 } },
    } as unknown as GameState;
  }

  it("keeps a daily's dice stream, seeds and salt on the server", () => {
    const json = JSON.stringify(redactServerOnlyState(daily('attack')));
    for (const secret of ['puzzle_dice_queue', 'mission_seed_salt', 'dice_queue_seed', 'top-secret-seed', 'puzzle_turn_open']) {
      expect(json).not.toContain(secret);
    }
  });

  it("holds a v2 run's graded decisions until the game is over", () => {
    expect(redactServerOnlyState(daily('attack')).puzzle_decisions).toBeUndefined();
    expect(redactServerOnlyState(daily('game_over')).puzzle_decisions).toEqual([{ turn: 1, loss: 12.5, grade: 'inaccuracy' }]);
  });

  it('leaves the viewer-scoped fields to the caller and the board untouched', () => {
    const out = redactServerOnlyState(daily('attack'));
    // Hands, missions and the deck are the caller's to redact per viewer.
    expect(out.players[0].cards).toHaveLength(1);
    expect(out.card_deck).toHaveLength(1);
    expect(out.territories.a.unit_count).toBe(4);
    expect((out.settings as unknown as Record<string, unknown>).fog_of_war).toBe(false);
  });

  it('never mutates the authoritative state', () => {
    const input = daily('attack');
    const before = JSON.stringify(input);
    redactServerOnlyState(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

