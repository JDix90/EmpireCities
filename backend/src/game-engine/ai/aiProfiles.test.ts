/**
 * The difficulty table (aiProfiles.ts) holds the values the per-difficulty
 * constants and branches held before it, and a profile passed where a
 * difficulty goes plays exactly as that difficulty does. The arena
 * (scripts/simAiArena.ts) seats bots by profile, so the second half is what
 * makes its measurements the live bot's.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { AiDifficulty, GameMap, GameSettings, GameState } from '../../types';
import { initializeGameState } from '../state/gameStateManager';
import { createSeededRng } from '../victory/missions';
import { computeAiTurn, selectAiBuildingPlacement, selectAiTechResearch } from './aiBot';
import { aiAttackExchangeBudget, shouldPressDecidedGame } from './aiAttackGrind';
import { aiFiresLanePowers } from './aiLanePowers';
import { aiResearchesTech } from './aiTechBudget';
import { AI_PROFILES, aiProfile, gameAiDifficulty, keepsTodaysBots, seatAiDifficulty, type AiProfile } from './aiProfiles';
import { aiFallbackPlan } from './runAiWithTimeout';
import { syntheticAiOpponent } from '../rating/ratingService';

const LEVELS: AiDifficulty[] = ['tutorial', 'easy', 'medium', 'hard', 'expert'];

describe('AI_PROFILES holds the values the constants and branches held', () => {
  // One row per setting, in LEVELS order: tutorial, easy, medium, hard, expert.
  const TODAY: { [K in keyof AiProfile]?: AiProfile[K][] } = {
    passive: [true, false, false, false, false],
    planBudgetMs: [750, 1_000, 1_500, 3_000, 5_000],
    timeoutFallback: ['tutorial', 'easy', 'medium', 'medium', 'medium'],
    noise: [0.9, 0.35, 0.15, 0.05, 0],
    attackCap: [8, 2, 4, 8, 8],
    exchangeBudget: [0, 2, 4, 8, 8],
    takesLongShots: [false, true, false, false, false],
    finisher: [false, false, true, true, true],
    decidedPress: [false, false, true, true, true],
    neutralExpansionBonus: [1, 1.5, 2, 2.5, 3],
    vulnerabilityBonus: [4, 1, 2, 4, 4],
    influence: [false, false, true, true, true],
    // New with ai_odds_press_enabled, read only with it on (tuned in the arena).
    pressStartOdds: [0.75, 0.75, 0.65, 0.4, 0.35],
    pressContinueOdds: [0.6, 0.6, 0.5, 0.35, 0.35],
    pressExchangeCeiling: [3, 3, 12, 40, 40],
    // New with ai_planned_reinforcements_enabled, read only with it on.
    draftTiles: [0, 0, 0, 0, 3],
    replansAfterDraft: [false, false, true, true, true],
    replansAfterCapture: [false, false, false, true, true],
    // New with ai_ending_play_enabled, read only with it on.
    leaderPressure: [0, 0, 1, 2, 0],
    racesEnding: [false, false, true, true, true],
    // New with ai_resignation_enabled, read only with it on.
    resignsWhenBeaten: [false, true, true, true, true],
    build: ['none', 'gate_only', 'greedy', 'threat', 'threat'],
    research: ['none', 'gate_only', 'cheapest', 'strategic', 'strategic'],
    doctrinesPerTurn: [0, 0, 1, 2, 2],
    forwardDoctrine: [false, false, false, true, true],
    lanePowers: [false, false, true, true, true],
    pursuesBomb: [false, false, false, true, true],
    advanceThreshold: [Number.POSITIVE_INFINITY, 12, 6, 4, 3],
    advancesEarly: [false, false, false, false, true],
    dawdles: [false, true, false, false, false],
    territoryPick: ['random', 'random', 'random', 'cluster', 'cluster_by_region'],
    ratingOffset: [-400, -200, 0, 150, 300],
  };

  it('pins every setting of every level', () => {
    for (const [setting, values] of Object.entries(TODAY)) {
      LEVELS.forEach((level, i) => {
        expect({ level, setting, value: AI_PROFILES[level][setting as keyof AiProfile] })
          .toEqual({ level, setting, value: values![i] });
      });
    }
    // A setting added to the table gets a row here.
    expect(Object.keys(AI_PROFILES.medium).filter((k) => k !== 'difficulty').sort())
      .toEqual(Object.keys(TODAY).sort());
    for (const level of LEVELS) expect(AI_PROFILES[level].difficulty).toBe(level);
  });

  it('feeds the readers that used to hold the values', () => {
    expect(LEVELS.map((d) => aiAttackExchangeBudget(d, false))).toEqual([0, 2, 4, 8, 8]);
    expect(LEVELS.map((d) => aiAttackExchangeBudget(d, true))).toEqual([0, 4, 8, 16, 16]);
    expect(LEVELS.map((d) => aiFiresLanePowers(d))).toEqual([false, false, true, true, true]);
    const initial = syntheticAiOpponent('medium').mu;
    expect(LEVELS.map((d) => syntheticAiOpponent(d).mu - initial)).toEqual([-400, -200, 0, 150, 300]);
  });
});

describe('aiProfile', () => {
  it('reads a difficulty row, and passes a profile through as it is', () => {
    expect(aiProfile('hard')).toBe(AI_PROFILES.hard);
    const custom: AiProfile = { ...AI_PROFILES.hard, attackCap: 3 };
    expect(aiProfile(custom)).toBe(custom);
  });

  it('plays medium for a value that is not a difficulty', () => {
    expect(aiProfile('impossible')).toBe(AI_PROFILES.medium);
    expect(aiProfile('constructor')).toBe(AI_PROFILES.medium);
    expect(syntheticAiOpponent('impossible').mu).toBe(syntheticAiOpponent('medium').mu);
  });
});

const MAP = JSON.parse(
  readFileSync(join(__dirname, '../../../../database/maps/era_ancient.json'), 'utf-8'),
) as GameMap;

/** Full Game's rules, so the build and research branches have something to decide. */
function fullGame(): GameState {
  const players = [0, 1, 2, 3].map((i) => ({
    player_id: `bot_${i}`,
    player_index: i,
    username: `Bot ${i}`,
    color: ['#e74c3c', '#3498db', '#2ecc71', '#f39c12'][i]!,
    is_ai: true,
    is_eliminated: false,
    mmr: 1000,
  }));
  const state = initializeGameState('profiles', 'ancient', MAP, players, {
    fog_of_war: false,
    turn_timer_seconds: 0,
    initial_unit_count: 3,
    card_set_escalating: true,
    diplomacy_enabled: false,
    economy_enabled: true,
    tech_trees_enabled: true,
    stability_enabled: true,
    naval_enabled: true,
    era_advancement_enabled: true,
    era_advancement_preset: 'standard',
    allowed_victory_conditions: ['domination'],
    victory_type: 'domination',
    max_turns: 150,
  } as GameSettings, { forceStartingPlayerIndex: 0 });
  // Money in hand, so building and research are real choices.
  for (const p of state.players) {
    p.special_resource = 40;
    p.tech_points = 40;
  }
  return state;
}

describe('a profile in place of its difficulty plays the same turn', () => {
  it('plans, builds and researches identically', () => {
    for (const level of LEVELS) {
      const byName = fullGame();
      const byProfile = structuredClone(byName);
      const pid = byName.players[0]!.player_id;
      const options = { captureOddsScoring: true, decidedGamePress: false };
      // The tutorial turn picks its draft tile from the engine's own random
      // draw, not the seeded jitter, so only that tile may differ.
      const unseeded = (actions: ReturnType<typeof computeAiTurn>) =>
        level === 'tutorial' ? actions.map(({ to: _to, ...rest }) => rest) : actions;
      expect(unseeded(computeAiTurn(byProfile, MAP, { ...AI_PROFILES[level] }, { ...options, rng: createSeededRng(7) })))
        .toEqual(unseeded(computeAiTurn(byName, MAP, level, { ...options, rng: createSeededRng(7) })));
      expect(selectAiBuildingPlacement(byProfile, MAP, pid, { ...AI_PROFILES[level] }))
        .toEqual(selectAiBuildingPlacement(byName, MAP, pid, level));
      expect(selectAiTechResearch(byProfile, pid, { ...AI_PROFILES[level] }))
        .toEqual(selectAiTechResearch(byName, pid, level));
      expect(aiResearchesTech(byProfile, { ...AI_PROFILES[level] })).toBe(aiResearchesTech(byName, level));
      expect(shouldPressDecidedGame(byProfile, pid, { ...AI_PROFILES[level] }))
        .toBe(shouldPressDecidedGame(byName, pid, level));
    }
  });
});

describe('a changed profile changes the bot', () => {
  it('reads each setting from the profile it is given', () => {
    const state = fullGame();
    const attacks = (profile: AiProfile): number =>
      computeAiTurn(structuredClone(state), MAP, profile, { rng: createSeededRng(3) })
        .filter((a) => a.type === 'attack' && a.from !== '__influence__').length;

    // The board is dealt at random, so the uncapped count varies; the cap holds on any.
    expect(attacks({ ...AI_PROFILES.expert, attackCap: 1 })).toBe(Math.min(1, attacks(AI_PROFILES.expert)));
    expect(aiAttackExchangeBudget({ ...AI_PROFILES.medium, exchangeBudget: 7 }, true)).toBe(14);

    // Passive is the tutorial turn: a draft and three phase ends.
    const passive = computeAiTurn(state, MAP, { ...AI_PROFILES.expert, passive: true });
    expect(passive.map((a) => a.type)).toEqual(['draft', 'end_phase', 'end_phase', 'end_phase']);

    expect(selectAiBuildingPlacement(state, MAP, 'bot_0', { ...AI_PROFILES.expert, build: 'none' })).toBeNull();
    expect(selectAiTechResearch(state, 'bot_0', { ...AI_PROFILES.expert, research: 'none' })).toBeNull();
  });
});

describe('the level an away seat plays', () => {
  const bot = (ai_difficulty: AiDifficulty) => ({ is_ai: true, ai_difficulty });
  const human = { is_ai: false, ai_difficulty: null };

  it("is the game's bot level, the highest of its bots", () => {
    expect(seatAiDifficulty([human, bot('easy'), bot('easy')], human)).toBe('easy');
    expect(seatAiDifficulty([human, bot('easy'), bot('hard')], human)).toBe('hard');
    expect(seatAiDifficulty([human, bot('expert')], human)).toBe('expert');
  });

  it('is medium in a game with no bots, as before', () => {
    expect(seatAiDifficulty([human, { ...human }], human)).toBe('medium');
  });

  it("leaves a bot's own level alone", () => {
    expect(seatAiDifficulty([bot('easy'), bot('expert')], bot('easy'))).toBe('easy');
  });

  it('agrees with the end-of-game summary', () => {
    expect(gameAiDifficulty([human, bot('medium'), bot('tutorial')])).toBe('medium');
    expect(gameAiDifficulty([human])).toBeNull();
  });
});

describe('the plan that stands in when planning overruns', () => {
  it("is the level's own, capped at medium", () => {
    const s = fullGame();
    const plan = (d: AiDifficulty | AiProfile) => aiFallbackPlan(structuredClone(s), MAP, d, { rng: createSeededRng(5) });
    const at = (d: AiDifficulty) => computeAiTurn(structuredClone(s), MAP, d, { rng: createSeededRng(5) });
    expect(plan('easy')).toEqual(at('easy'));
    expect(plan('medium')).toEqual(at('medium'));
    expect(plan('hard')).toEqual(at('medium'));
    expect(plan('expert')).toEqual(at('medium'));
    // Never easy's two-attack plan with long shots, which every level used to get.
    const attacks = plan('expert').filter((a) => a.type === 'attack' && a.from !== '__influence__');
    expect(attacks.length).toBeLessThanOrEqual(AI_PROFILES.medium.attackCap);
  });
});

describe('keepsTodaysBots', () => {
  it('holds daily challenges and campaign stages to today\'s bots, and nothing else', () => {
    expect(keepsTodaysBots({ daily_challenge_date: '2026-10-04' })).toBe(true);
    expect(keepsTodaysBots({ is_campaign: true })).toBe(true);
    expect(keepsTodaysBots({})).toBe(false);
    expect(keepsTodaysBots({ is_campaign: false })).toBe(false);
  });
});
