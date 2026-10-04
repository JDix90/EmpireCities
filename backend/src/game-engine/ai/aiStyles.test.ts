/**
 * Commanders and their styles (ai_personalities_enabled): the draw that seats
 * them, and what each style shifts on its level.
 */
import { describe, it, expect } from 'vitest';
import { AI_COMMANDERS, AI_STYLES, drawAiCommanders, type AiStyle } from '@borderfall/shared';
import { AI_PROFILES, aiProfile, type AiProfile } from './aiProfiles';
import { aiDifficultyPlaysStyle } from '@borderfall/shared';
import { STYLE_SHIFTS, seatCommanders, styledLevel } from './aiStyles';

describe('the roster', () => {
  it('has thirty commanders, six of each usual style, each with another style it sometimes plays', () => {
    expect(AI_COMMANDERS).toHaveLength(30);
    expect(new Set(AI_COMMANDERS.map((c) => c.name)).size).toBe(30);
    for (const style of AI_STYLES) {
      expect(AI_COMMANDERS.filter((c) => c.style === style), style).toHaveLength(6);
    }
    for (const c of AI_COMMANDERS) expect(c.alt, c.name).not.toBe(c.style);
  });
});

describe('the draw', () => {
  it('is the same for the same game, and differs from game to game', () => {
    expect(drawAiCommanders('game-a', [1, 2, 3])).toEqual(drawAiCommanders('game-a', [1, 2, 3]));
    const tables = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(drawAiCommanders(`game-${i}`, [1, 2, 3]))));
    expect(tables.size).toBe(20);
  });

  it('seats different commanders with different styles, while the five last', () => {
    for (let g = 0; g < 500; g++) {
      const table = Object.values(drawAiCommanders(`g${g}`, [1, 2, 3, 4, 5]));
      expect(new Set(table.map((c) => c.name)).size).toBe(5);
      expect(new Set(table.map((c) => c.style)).size).toBe(5);
    }
    // Seven bots: every name still differs; styles repeat only past five.
    const seven = Object.values(drawAiCommanders('big', [1, 2, 3, 4, 5, 6, 7]));
    expect(new Set(seven.map((c) => c.name)).size).toBe(7);
    expect(new Set(seven.map((c) => c.style)).size).toBe(5);
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

  it('leave a seat with no style, and every level without goals, as its level plays', () => {
    expect(styledLevel('hard', undefined)).toBe('hard');
    expect(styledLevel('hard', null)).toBe('hard');
    for (const style of AI_STYLES) {
      expect(styledLevel('easy', style), style).toBe('easy');
      expect(styledLevel('tutorial', style), style).toBe('tutorial');
    }
  });

  it('shift only what each says, on top of the level\'s row', () => {
    const expected: Record<AiStyle, string[]> = {
      conqueror: ['pressStartOdds', 'pressContinueOdds', 'goalWeights'],
      raider: ['goalWeights'],
      expansionist: ['neutralExpansionBonus', 'goalWeights'],
      opportunist: ['preysOnWeak', 'goalWeights'],
      defender: ['pressStartOdds', 'pressContinueOdds', 'goalStaging'],
    };
    for (const level of ['medium', 'hard', 'expert'] as const) {
      for (const style of AI_STYLES) {
        const styled = aiProfile(styledLevel(level, style));
        expect(changed(AI_PROFILES[level], styled).sort(), `${level} ${style}`).toEqual([...expected[style]].sort());
        expect(styled.difficulty).toBe(level);
      }
    }
  });

  it('never leave odds outside 0 to 1, or a weight below 0', () => {
    for (const level of ['medium', 'hard', 'expert'] as const) {
      for (const style of AI_STYLES) {
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
