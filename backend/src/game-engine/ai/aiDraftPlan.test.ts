/**
 * Reinforcements placed with a purpose (ai_planned_reinforcements_enabled):
 * the draft is split by marginal value once the turn's true count is known,
 * over at most the level's number of tiles, and attacks are chosen again on
 * the board it makes; Hard and Expert also after every capture.
 */
import { describe, it, expect } from 'vitest';
import type { AiDifficulty, GameMap, GameState } from '../../types';
import { eraModifiersFor } from '../state/eraModifiers';
import { computeAiTurn } from './aiBot';
import { allocateDraft } from './aiDraftPlan';
import { AI_PROFILES } from './aiProfiles';
import { aiPressExchangeCeiling } from './aiAttackGrind';
import { headlessAiTurnHooks, planAiTurn, playAiTurn, type AiTurnPlan } from './runAiTurn';

const AI = 'ai_0';
const RIVAL = 'rival';

/**
 *   home ─ a ─ x        `a` borders the rival's thin `x` (and `x2` behind it),
 *     │                 `b` borders the rival's big stack `y`,
 *     b ─ y             `home` borders nothing but the bot's own.
 *   x ─ x2
 */
function map(): GameMap {
  const ids = ['home', 'a', 'b', 'x', 'x2', 'y'];
  return {
    map_id: 'draft',
    name: 'Draft',
    territories: ids.map((id) => ({ territory_id: id, name: id, polygon: [], center_point: [0, 0], region_id: 'r' })),
    connections: [
      { from: 'home', to: 'a', type: 'land' },
      { from: 'home', to: 'b', type: 'land' },
      { from: 'a', to: 'x', type: 'land' },
      { from: 'x', to: 'x2', type: 'land' },
      { from: 'b', to: 'y', type: 'land' },
    ],
    regions: [{ region_id: 'r', name: 'R', bonus: 0 }],
  } as unknown as GameMap;
}

function board(units: Partial<Record<'home' | 'a' | 'b' | 'x' | 'x2' | 'y', number>>, difficulty: AiDifficulty = 'medium'): GameState {
  const owners: Record<string, string> = { home: AI, a: AI, b: AI, x: RIVAL, x2: RIVAL, y: RIVAL };
  const defaults = { home: 5, a: 3, b: 3, x: 2, x2: 2, y: 12 };
  const all = { ...defaults, ...units };
  return {
    game_id: 'g',
    era: 'ww2',
    map_id: 'draft',
    phase: 'draft',
    turn_number: 5,
    current_player_index: 0,
    players: [
      { player_id: AI, player_index: 0, username: 'AI', color: '#000', is_ai: true, ai_difficulty: difficulty, is_eliminated: false, territory_count: 3, cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000 },
      { player_id: RIVAL, player_index: 1, username: 'R', color: '#fff', is_ai: false, is_eliminated: false, territory_count: 3, cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000 },
    ],
    territories: Object.fromEntries(Object.entries(all).map(([id, n]) => [
      id, { territory_id: id, owner_id: owners[id], unit_count: n },
    ])),
    settings: {},
    era_modifiers: eraModifiersFor('ww2'),
    diplomacy: [],
    card_deck: [],
    discard_pile: [],
    draft_units_remaining: 0,
  } as unknown as GameState;
}

const total = (placements: Array<{ units: number }>) => placements.reduce((s, p) => s + p.units, 0);

describe('where the draft goes', () => {
  it('places every unit, and none on a tile that borders nothing', () => {
    for (const d of ['hard', 'expert'] as AiDifficulty[]) {
      const placements = allocateDraft(board({}), map(), AI, 9, d);
      expect(total(placements), d).toBe(9);
      expect(placements.map((p) => p.to), d).not.toContain('home');
    }
  });

  it('spreads over no more tiles than the level allows', () => {
    const s = board({ y: 9, b: 2 });
    expect(allocateDraft(s, map(), AI, 12, { ...AI_PROFILES.hard, draftTiles: 1 })).toHaveLength(1);
    expect(allocateDraft(s, map(), AI, 12, { ...AI_PROFILES.expert, draftTiles: 3 }).length).toBeLessThanOrEqual(3);
  });

  it('keeps the plan\'s single tile below expert', () => {
    // The turn never splits their draft; called directly, it uses one tile.
    for (const d of ['easy', 'medium', 'hard'] as AiDifficulty[]) expect(AI_PROFILES[d].draftTiles, d).toBe(0);
    expect(allocateDraft(board({}), map(), AI, 9, 'medium')).toHaveLength(1);
  });

  it('stages an attack on a thin target when nothing threatens the bot', () => {
    // The big stack is gone: `b` faces nothing, `a` faces a two-unit tile.
    const s = board({ y: 1 });
    expect(allocateDraft(s, map(), AI, 6, 'hard')[0]!.to).toBe('a');
  });

  it('shores up the tile a big stack can take, when there is nothing to gain by attacking', () => {
    // `x` and `x2` are out of reach: twenty defenders each.
    const s = board({ x: 20, x2: 20, y: 9, b: 2 });
    expect(allocateDraft(s, map(), AI, 6, 'hard')[0]!.to).toBe('b');
  });

  it('splits between the two when both matter', () => {
    const placements = allocateDraft(board({ y: 9, b: 2 }), map(), AI, 12, 'expert');
    expect(placements.map((p) => p.to).sort()).toEqual(['a', 'b']);
    expect(total(placements)).toBe(12);
  });

  it('respects the stability cap on a tile', () => {
    const s = board({ y: 1 });
    s.settings.stability_enabled = true;
    // Low stability caps what one tile can take in a turn.
    for (const id of ['home', 'a', 'b']) s.territories[id]!.stability = 10;
    const placements = allocateDraft(s, map(), AI, 12, 'expert');
    for (const p of placements) expect(p.units).toBeLessThanOrEqual(12);
    expect(placements.length).toBeGreaterThan(1);
  });

  it('places nothing for no units', () => {
    expect(allocateDraft(board({}), map(), AI, 0, 'hard')).toEqual([]);
  });
});

function plan(difficulty: AiDifficulty, s: GameState, m: GameMap): Promise<AiTurnPlan> {
  return planAiTurn(s, m, s.players[0]!, difficulty, {
    captureOddsScoring: true, attackGrind: true, decidedGamePress: false, oddsPress: true, plannedDraft: true,
  }, {
    planningState: () => s,
    plan: async (st, mp, d, o) => computeAiTurn(st, mp, d, { ...o, rng: () => 0.5 }),
    rng: () => 0.5,
  });
}

describe('the turn', () => {
  it('chooses again only with both flags on, and never in a daily or a campaign stage', async () => {
    const s = board({});
    const m = map();
    const flags = { captureOddsScoring: true, attackGrind: true, decidedGamePress: false };
    const hooks = { planningState: () => s, plan: async (st: GameState, mp: GameMap, d: AiDifficulty) => computeAiTurn(st, mp, d) };
    expect((await planAiTurn(s, m, s.players[0]!, 'hard', { ...flags, oddsPress: true, plannedDraft: true }, hooks)).replan).toBeDefined();
    expect((await planAiTurn(s, m, s.players[0]!, 'hard', { ...flags, oddsPress: false, plannedDraft: true }, hooks)).replan).toBeUndefined();
    expect((await planAiTurn(s, m, s.players[0]!, 'hard', { ...flags, oddsPress: true, plannedDraft: false }, hooks)).replan).toBeUndefined();
    s.settings.is_campaign = true;
    expect((await planAiTurn(s, m, s.players[0]!, 'hard', { ...flags, oddsPress: true, plannedDraft: true }, hooks)).replan).toBeUndefined();
    s.settings.is_campaign = false;
    s.settings.daily_challenge_date = '2026-10-04';
    expect((await planAiTurn(s, m, s.players[0]!, 'hard', { ...flags, oddsPress: true, plannedDraft: true }, hooks)).replan).toBeUndefined();
  });

  it('splits the count the turn really has, and attacks with what it placed', async () => {
    // `a` holds a single unit: before the draft it can attack nothing, so the
    // plan made at the start of the turn has no attack from it.
    const s = board({ a: 1, x: 3, y: 1 }, 'expert');
    const m = map();
    s.draft_units_remaining = 3;
    const p = await plan('expert', s, m);
    expect(p.actions.some((a) => a.type === 'attack' && a.from === 'a')).toBe(false);
    // The turn's steps before the draft (a card set, a faction ability) can
    // raise the count after the plan was made.
    s.draft_units_remaining = 8;
    const fights: string[] = [];
    const hooks = { ...headlessAiTurnHooks(s, m), emit: (event: string, payload: unknown) => {
      if (event === 'game:combat_result') fights.push((payload as { fromId: string }).fromId);
    } };
    await playAiTurn(s, m, s.players[0]!, 'expert', p, 'draft', hooks);
    const placed = p.actions.filter((a) => a.type === 'draft');
    expect(placed.reduce((n, a) => n + (a.units ?? 0), 0)).toBe(8);
    expect(placed.map((a) => a.to)).toContain('a');
    expect(fights).toContain('a');
  });

  it('at hard, follows a capture with the attack it opened', async () => {
    // Taking `x` puts the bot next to `x2`, which no plan made before it could see.
    const s = board({ a: 14, x: 1, x2: 1, y: 1 });
    const m = map();
    s.draft_units_remaining = 0;
    s.phase = 'attack';
    const p = await plan('hard', s, m);
    const fights: string[] = [];
    const hooks = { ...headlessAiTurnHooks(s, m), emit: (event: string, payload: unknown) => {
      if (event === 'game:combat_result') fights.push(`${(payload as { fromId: string }).fromId}>${(payload as { toId: string }).toId}`);
    } };
    expect(p.attackBudget.left).toBe(aiPressExchangeCeiling('hard', false));
    await playAiTurn(s, m, s.players[0]!, 'hard', p, 'attack', hooks);
    expect(fights).toContain('a>x');
    expect(fights).toContain('x>x2');
  });

  it('at medium, does not', async () => {
    const s = board({ a: 14, x: 1, x2: 1, y: 1 });
    const m = map();
    s.phase = 'attack';
    const p = await plan('medium', s, m);
    const fights: string[] = [];
    const hooks = { ...headlessAiTurnHooks(s, m), emit: (event: string, payload: unknown) => {
      if (event === 'game:combat_result') fights.push(`${(payload as { fromId: string }).fromId}>${(payload as { toId: string }).toId}`);
    } };
    await playAiTurn(s, m, s.players[0]!, 'medium', p, 'attack', hooks);
    expect(fights).toContain('a>x');
    expect(fights).not.toContain('x>x2');
  });
});
