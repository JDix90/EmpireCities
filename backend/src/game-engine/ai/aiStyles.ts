/**
 * A commander's style (ai_personalities_enabled): how a bot plays, on top of
 * how well it plays.
 *
 * The level (ai/aiProfiles.ts) says how strong a bot is; a style says what
 * it wants. Each is a small shift of the settings the level already has: how
 * much it wants each goal (ai/aiIntent.ts), the odds it attacks at, what free
 * land is worth to it. No style has code of its own, and each was tuned to
 * stay within five points of its level's win rate and game length in the
 * arena (scripts/simAiArena.ts), so "Raider · Hard" is as hard as Hard.
 *
 *   conqueror     takes whole regions and presses every lead;
 *   raider        breaks rivals' regions and hunts the weak;
 *   expansionist  grabs free land and new regions early;
 *   opportunist   strikes whoever is weakest;
 *   defender      holds its borders and attacks only at good odds.
 *
 * Which commander sits at a seat, and the style it plays this game, is drawn
 * when the game is made (@borderfall/shared drawAiCommanders).
 */
import { aiCommanderName, aiDifficultyPlaysStyle, drawAiCommanders, type AiStyle } from '@borderfall/shared';
import { aiProfile, type AiLevel, type AiProfile } from './aiProfiles';

export type { AiStyle };

type Shift = (p: Readonly<AiProfile>) => Partial<AiProfile>;

const goals = (p: Readonly<AiProfile>, take: number, brk: number, hunt: number) => ({
  goalWeights: {
    take_region: p.goalWeights.take_region * take,
    break_region: p.goalWeights.break_region * brk,
    hunt: p.goalWeights.hunt * hunt,
  },
});

/** What each style shifts on its level's row. ⚠ balance: each is measured against its level. */
export const STYLE_SHIFTS: Readonly<Record<AiStyle, Shift>> = {
  conqueror: (p) => ({
    ...goals(p, 2, 0.6, 1),
    pressStartOdds: p.pressStartOdds - 0.05,
    pressContinueOdds: p.pressContinueOdds - 0.05,
  }),
  raider: (p) => ({
    ...goals(p, 1, 1.4, 2.5),
  }),
  expansionist: (p) => ({
    ...goals(p, 1.3, 1, 1),
    neutralExpansionBonus: p.neutralExpansionBonus + 1.5,
  }),
  opportunist: (p) => ({
    ...goals(p, 1, 1, 2),
    preysOnWeak: 1,
  }),
  defender: (p) => ({
    goalStaging: 0.5,
    pressStartOdds: p.pressStartOdds + 0.05,
    pressContinueOdds: p.pressContinueOdds + 0.05,
  }),
};

/**
 * The level a seat plays: its level's row, shifted by its style. A level
 * with no goals (the tutorial bot, Easy) plays its row as it is, as does a
 * seat with no style.
 */
export function styledLevel(level: AiLevel, style: AiStyle | null | undefined): AiLevel {
  if (!style) return level;
  const base = aiProfile(level);
  if (base.passive || base.intentBonus <= 0) return level;
  return { ...base, ...STYLE_SHIFTS[style](base) };
}

/**
 * Who sits at each bot seat of a game as it starts: the commander's name, and
 * the style it plays at Medium and up. Empty for a game made without
 * commanders (`ai_personalities` baked at create), whose bots keep the names
 * they had. The draw is the lobby's (@borderfall/shared drawAiCommanders).
 */
export function seatCommanders(
  gameId: string,
  settings: { ai_personalities?: boolean } | null | undefined,
  seats: ReadonlyArray<{ player_index: number; is_ai: boolean; ai_difficulty: string | null }>,
): Record<number, { username: string; ai_style?: AiStyle }> {
  if (settings?.ai_personalities !== true) return {};
  const bots = seats.filter((s) => s.is_ai);
  const drawn = drawAiCommanders(gameId, bots.map((s) => s.player_index));
  const out: Record<number, { username: string; ai_style?: AiStyle }> = {};
  for (const s of bots) {
    const c = drawn[s.player_index];
    if (!c) continue;
    out[s.player_index] = {
      username: aiCommanderName(c),
      ...(aiDifficultyPlaysStyle(s.ai_difficulty) ? { ai_style: c.style } : {}),
    };
  }
  return out;
}
