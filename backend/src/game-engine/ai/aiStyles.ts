/**
 * A commander's style (ai_personalities_enabled): how a bot plays, on top of
 * how well it plays.
 *
 * The level (ai/aiProfiles.ts) says how strong a bot is; a style says what
 * it wants. Each is a small shift of the settings the level already has: how
 * much it wants each goal (ai/aiIntent.ts), the odds it attacks at, which
 * rival it goes after. No style has code of its own, and each was tuned to
 * stay within five points of its level's win rate in the arena
 * (scripts/simAiArena.ts), so "Raider · Hard" is as hard as Hard.
 *
 *   conqueror     takes whole regions and presses every lead;
 *   raider        breaks rivals' regions and hunts the weak;
 *   opportunist   strikes whoever is weakest: hunts the rival holding the
 *                 fewest territories, whatever its size;
 *   defender      picks its fights: starts an attack on its odds alone, and
 *                 needs better ones.
 *
 * Each style was measured on what it promises, against a bot of its level
 * with none: the Opportunist on its captures from the weakest rival, the
 * Defender on how often it attacks and how often an attack takes its tile.
 * The Expansionist is drawn no more: Quick Match has no free land, and
 * nothing that made it spread wider early left it as strong as its level.
 * Its shift stays for games that already seated one.
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
  // Drawn no more; kept for a game that seated one before.
  expansionist: (p) => ({
    ...goals(p, 1.3, 1, 1),
    neutralExpansionBonus: p.neutralExpansionBonus + 1.5,
  }),
  // Expert plays its own goals well enough that the Medium and Hard pull cost
  // it seven points in the arena; it hunts more gently.
  opportunist: (p) => (p.difficulty === 'expert'
    ? { ...goals(p, 1, 1, 4), preysOnWeak: 0.25, huntsWeakest: true }
    : { ...goals(p, 1, 1, 6), preysOnWeak: 1, huntsWeakest: true }),
  defender: (p) => ({
    pressStartOdds: p.pressStartOdds + 0.05,
    startsOnOddsAlone: true,
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
