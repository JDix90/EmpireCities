/**
 * Commanders and their styles (ai_personalities_enabled): the draw that seats
 * them, and what each style shifts on its level.
 */
import { describe, it, expect } from 'vitest';
import { AI_COMMANDERS, AI_STYLES, USUAL_STYLE_CHANCE, drawAiCommanders, type AiStyle } from '@borderfall/shared';
import { AI_PROFILES, aiProfile, type AiProfile } from './aiProfiles';
import { aiDifficultyPlaysStyle } from '@borderfall/shared';
import { STYLE_SHIFTS, seatCommanders, styledLevel } from './aiStyles';
import type { GameMap, GameState } from '../../types';
import { eraModifiersFor } from '../state/eraModifiers';
import { preyAttackBonus, weakestRivals } from './aiBot';
import { chooseIntent } from './aiIntent';
import { shouldStartPress } from './aiAttackGrind';
import { edgeCaptureOdds } from './aiEdgeOdds';

describe('the roster', () => {
  it('has thirty commanders over the four styles drawn, each with another style it sometimes plays', () => {
    expect(AI_STYLES).toEqual(['conqueror', 'raider', 'opportunist', 'defender']);
    expect(AI_COMMANDERS).toHaveLength(30);
    expect(new Set(AI_COMMANDERS.map((c) => c.name)).size).toBe(30);
    const usual = Object.fromEntries(AI_STYLES.map((s) => [s, AI_COMMANDERS.filter((c) => c.style === s).length]));
    const other = Object.fromEntries(AI_STYLES.map((s) => [s, AI_COMMANDERS.filter((c) => c.alt === s).length]));
    expect(usual).toEqual({ conqueror: 8, raider: 8, opportunist: 7, defender: 7 });
    expect(other).toEqual({ conqueror: 6, raider: 6, opportunist: 9, defender: 9 });
    for (const c of AI_COMMANDERS) {
      expect(c.alt, c.name).not.toBe(c.style);
      expect(AI_STYLES, c.name).toContain(c.style);
      expect(AI_STYLES, c.name).toContain(c.alt);
    }
  });

  it('seats every style at as many seats, with the usual style drawn three games in four', () => {
    for (const style of AI_STYLES) {
      const share = AI_COMMANDERS.reduce(
        (s, c) => s + (c.style === style ? USUAL_STYLE_CHANCE : 0) + (c.alt === style ? 1 - USUAL_STYLE_CHANCE : 0), 0,
      );
      expect(share, style).toBeCloseTo(AI_COMMANDERS.length / AI_STYLES.length);
    }
  });
});

describe('the draw', () => {
  it('is the same for the same game, and differs from game to game', () => {
    expect(drawAiCommanders('game-a', [1, 2, 3])).toEqual(drawAiCommanders('game-a', [1, 2, 3]));
    const tables = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(drawAiCommanders(`game-${i}`, [1, 2, 3]))));
    expect(tables.size).toBe(20);
  });

  it('seats different commanders with different styles, while the four last', () => {
    for (let g = 0; g < 500; g++) {
      const table = Object.values(drawAiCommanders(`g${g}`, [1, 2, 3, 4]));
      expect(new Set(table.map((c) => c.name)).size).toBe(4);
      expect(new Set(table.map((c) => c.style)).size).toBe(4);
    }
    // Seven bots: every name still differs; styles repeat only past four.
    const seven = Object.values(drawAiCommanders('big', [1, 2, 3, 4, 5, 6, 7]));
    expect(new Set(seven.map((c) => c.name)).size).toBe(7);
    expect(new Set(seven.map((c) => c.style)).size).toBe(4);
  });

  it('never draws the Expansionist', () => {
    for (let g = 0; g < 500; g++) {
      for (const c of Object.values(drawAiCommanders(`x${g}`, [1, 2, 3, 4, 5]))) expect(c.style).not.toBe('expansionist');
    }
  });

  it('plays a commander\'s usual style most of the time, and its other one otherwise', () => {
    let usual = 0;
    let other = 0;
    for (let g = 0; g < 2000; g++) {
      for (const c of Object.values(drawAiCommanders(`v${g}`, [1, 2, 3]))) {
        const row = AI_COMMANDERS.find((r) => r.name === c.name)!;
        if (c.style === row.style) usual += 1;
        else if (c.style === row.alt) other += 1;
      }
    }
    expect(usual + other).toBe(6000);
    expect(usual / 6000).toBeGreaterThan(0.6);
    expect(other / 6000).toBeGreaterThan(0.2);
  });

  it('leaves the seats drawn before alone when a bot is added after them', () => {
    const three = drawAiCommanders('lobby', [1, 2, 3]);
    const four = drawAiCommanders('lobby', [1, 2, 3, 4]);
    for (const seat of [1, 2, 3]) expect(four[seat]).toEqual(three[seat]);
  });
});

describe('styles', () => {
  const changed = (base: AiProfile, styled: AiProfile) =>
    (Object.keys(base) as Array<keyof AiProfile>).filter((k) => JSON.stringify(base[k]) !== JSON.stringify(styled[k]));

  const ALL_STYLES: readonly AiStyle[] = [...AI_STYLES, 'expansionist'];

  it('leave a seat with no style, and every level without goals, as its level plays', () => {
    expect(styledLevel('hard', undefined)).toBe('hard');
    expect(styledLevel('hard', null)).toBe('hard');
    for (const style of ALL_STYLES) {
      expect(styledLevel('easy', style), style).toBe('easy');
      expect(styledLevel('tutorial', style), style).toBe('tutorial');
    }
  });

  it('shift only what each says, on top of the level\'s row', () => {
    const expected: Record<AiStyle, string[]> = {
      conqueror: ['goalWeights', 'goalStaging'],
      raider: ['goalWeights'],
      // A game that seated one before still plays it.
      expansionist: ['neutralExpansionBonus', 'goalWeights'],
      opportunist: ['preysOnWeak', 'huntsWeakest', 'goalWeights'],
      defender: ['pressStartOdds', 'startsOnOddsAlone'],
    };
    for (const level of ['medium', 'hard', 'expert'] as const) {
      for (const style of ALL_STYLES) {
        const styled = aiProfile(styledLevel(level, style));
        expect(changed(AI_PROFILES[level], styled).sort(), `${level} ${style}`).toEqual([...expected[style]].sort());
        expect(styled.difficulty).toBe(level);
      }
    }
  });

  it('make the Conqueror want regions, with its goals pulling its draft half as hard', () => {
    for (const level of ['medium', 'hard', 'expert'] as const) {
      const p = aiProfile(styledLevel(level, 'conqueror'));
      expect(p.goalWeights).toEqual({ take_region: 2, break_region: 0.6, hunt: 1 });
      expect(p.goalStaging).toBe(0.5);
      expect([p.pressStartOdds, p.pressContinueOdds]).toEqual([AI_PROFILES[level].pressStartOdds, AI_PROFILES[level].pressContinueOdds]);
    }
  });

  it('make the Opportunist hunt the weakest rival, more gently at Expert', () => {
    const at = (level: 'medium' | 'hard' | 'expert') => aiProfile(styledLevel(level, 'opportunist'));
    for (const level of ['medium', 'hard'] as const) {
      expect(at(level)).toMatchObject({ preysOnWeak: 1, huntsWeakest: true, goalWeights: { take_region: 1, break_region: 1, hunt: 6 } });
    }
    expect(at('expert')).toMatchObject({ preysOnWeak: 0.25, huntsWeakest: true, goalWeights: { take_region: 1, break_region: 1, hunt: 4 } });
  });

  it('make the Defender start on its odds alone, and need them 5 points better', () => {
    for (const level of ['medium', 'hard', 'expert'] as const) {
      const p = aiProfile(styledLevel(level, 'defender'));
      expect(p.startsOnOddsAlone).toBe(true);
      expect(p.pressStartOdds).toBeCloseTo(AI_PROFILES[level].pressStartOdds + 0.05);
      expect(p.pressContinueOdds).toBe(AI_PROFILES[level].pressContinueOdds);
    }
  });

  it('never leave odds outside 0 to 1, or a weight below 0', () => {
    for (const level of ['medium', 'hard', 'expert'] as const) {
      for (const style of ALL_STYLES) {
        const p = { ...AI_PROFILES[level], ...STYLE_SHIFTS[style](AI_PROFILES[level]) };
        for (const odds of [p.pressStartOdds, p.pressContinueOdds]) {
          expect(odds).toBeGreaterThan(0);
          expect(odds).toBeLessThan(1);
        }
        for (const w of Object.values(p.goalWeights)) expect(w).toBeGreaterThanOrEqual(0);
        expect(p.goalStaging).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('the commanders a game seats as it starts', () => {
  const seats = [
    { player_index: 0, is_ai: false, ai_difficulty: null },
    { player_index: 1, is_ai: true, ai_difficulty: 'hard' },
    { player_index: 2, is_ai: true, ai_difficulty: 'easy' },
    { player_index: 3, is_ai: true, ai_difficulty: 'expert' },
  ];

  it('are none for a game made without them', () => {
    expect(seatCommanders('g1', {}, seats)).toEqual({});
    expect(seatCommanders('g1', null, seats)).toEqual({});
  });

  it('are the lobby\'s draw: a name for every bot, a style from Medium up, nothing for a player', () => {
    const drawn = drawAiCommanders('g1', [1, 2, 3]);
    expect(seatCommanders('g1', { ai_personalities: true }, seats)).toEqual({
      1: { username: `${drawn[1]!.name} (AI)`, ai_style: drawn[1]!.style },
      2: { username: `${drawn[2]!.name} (AI)` },
      3: { username: `${drawn[3]!.name} (AI)`, ai_style: drawn[3]!.style },
    });
  });

  it('give a style to exactly the levels that play toward goals', () => {
    for (const d of ['tutorial', 'easy', 'medium', 'hard', 'expert'] as const) {
      expect(aiDifficultyPlaysStyle(d), d).toBe(AI_PROFILES[d].intentBonus > 0);
    }
  });
});

/**
 * A line of tiles t0 … t11, each its own region worth nothing, so the only
 * goal on it is a hunt. The bot holds t0 and t1; the first rival t2 to t6
 * (five tiles, the weakest); the second t7 to t11 (five, or more when asked).
 */
function line(owners: Record<number, string | null> = {}, units: Record<number, number> = {}): { state: GameState; map: GameMap } {
  const ids = Array.from({ length: 12 }, (_, i) => `t${i}`);
  const owner = (i: number) => (i in owners ? owners[i]! : i < 2 ? 'ai' : i < 7 ? 'r1' : 'r2');
  const map = {
    map_id: 'line',
    name: 'Line',
    territories: ids.map((id) => ({ territory_id: id, name: id, polygon: [], center_point: [0, 0], region_id: id })),
    connections: ids.slice(1).map((id, i) => ({ from: ids[i]!, to: id, type: 'land' })),
    regions: ids.map((id) => ({ region_id: id, name: id, bonus: 0 })),
  } as unknown as GameMap;
  const count = (pid: string) => ids.filter((_, i) => owner(i) === pid).length;
  const seat = (player_id: string, player_index: number) => ({
    player_id, player_index, username: player_id, color: '#000', is_ai: true, ai_difficulty: 'hard',
    is_eliminated: count(player_id) === 0, territory_count: count(player_id),
    cards: [], unlocked_techs: [], ability_uses: {}, mmr: 1000,
  });
  const state = {
    game_id: 'g', era: 'ww2', map_id: 'line', phase: 'attack', turn_number: 5, current_player_index: 0,
    players: [seat('ai', 0), seat('r1', 1), seat('r2', 2)],
    territories: Object.fromEntries(ids.map((id, i) => [id, { territory_id: id, owner_id: owner(i), unit_count: units[i] ?? 3, region_id: id }])),
    settings: { allowed_victory_conditions: ['domination'], max_turns: 60 },
    era_modifiers: eraModifiersFor('ww2'),
    diplomacy: [], card_deck: [], discard_pile: [],
  } as unknown as GameState;
  return { state, map };
}

describe('what the styles change in play', () => {
  it('finds the weakest rivals: the fewest territories, ties all, never itself or the eliminated', () => {
    expect(weakestRivals(line().state, 'ai')).toEqual(new Set(['r1', 'r2']));
    expect(weakestRivals(line({ 7: 'r1' }).state, 'ai')).toEqual(new Set(['r2']));
    const { state } = line({ 7: 'r1' });
    state.players[2]!.is_eliminated = true;
    expect(weakestRivals(state, 'ai')).toEqual(new Set(['r1']));
  });

  it('prices a tile of the weakest rival at the Opportunist\'s weight, and nobody else\'s', () => {
    const { state } = line({ 7: 'r1' });
    const opportunist = aiProfile(styledLevel('hard', 'opportunist'));
    expect(preyAttackBonus(state, 'ai', 'r2', opportunist)).toBe(1);
    expect(preyAttackBonus(state, 'ai', 'r1', opportunist)).toBe(0);
    expect(preyAttackBonus(state, 'ai', null, opportunist)).toBe(0);
    expect(preyAttackBonus(state, 'ai', 'r2', AI_PROFILES.hard)).toBe(0);
  });

  it('hunts the weakest rival at any size only where the level huntsWeakest', () => {
    // The first rival holds five tiles, the second six: no rival is nearly out.
    const { state, map } = line({ 6: 'r2' });
    expect(chooseIntent(state, map, 'ai', 'hard')).toBeNull();
    expect(chooseIntent(state, map, 'ai', styledLevel('hard', 'opportunist'))).toMatchObject({ kind: 'hunt', target: 'r1' });
  });

  it('starts a long shot for what it is worth, unless it starts on its odds alone', () => {
    // Four on four: a poor chance of taking t2, but a valuable one.
    const { state, map } = line({}, { 1: 4, 2: 4 });
    const odds = edgeCaptureOdds(state, map, 'ai', 't1', 't2');
    expect(odds).toBeLessThan(AI_PROFILES.hard.pressStartOdds);
    expect(shouldStartPress(state, map, 'ai', 't1', 't2', 'hard', 3)).toBe(true);
    expect(shouldStartPress(state, map, 'ai', 't1', 't2', styledLevel('hard', 'defender'), 3)).toBe(false);
    // A sure thing it starts either way.
    const sure = line({}, { 1: 12, 2: 1 });
    expect(shouldStartPress(sure.state, sure.map, 'ai', 't1', 't2', styledLevel('hard', 'defender'))).toBe(true);
  });
});
