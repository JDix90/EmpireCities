/**
 * Shared types/constants for frontend + backend. Extend incrementally to reduce drift.
 */

export type GamePhase = 'territory_select' | 'draft' | 'attack' | 'fortify' | 'game_over';

export type ConnectionType = 'land' | 'sea' | 'orbit';

export interface MapConnectionEdge {
  from: string;
  to: string;
  type?: ConnectionType;
}

export {
  type MapKind,
  type OrbitAccessMode,
  type MapTerritoryWorldLike,
  type MapWorldDefinition,
  type WorldModifiers,
  inferWorldId,
} from './worldId';

/**
 * AI opponent display names. A hand-picked, multicultural roster of commander
 * personas instead of auto-numbered "AI Bot 3", so AI players read as
 * intentional, not lazily generated. The "(AI)" suffix keeps it honest —
 * players should always be able to tell a bot from a human. Shared so the
 * in-game roster (frontend) and the broadcast / lobby / live-games names
 * (backend) resolve to the SAME name for a given seat.
 */
const AI_PERSONAS = [
  'General Varro',
  'Marshal Okonkwo',
  'Admiral Chen',
  'Strategos Doukas',
  'Warlord Tamsin',
  'Commander Reyes',
  'Hetman Volkov',
  'Rani Aditi',
  'Jarl Sigrún',
  'Sultana Yasmin',
  'Praetor Galba',
  'Khan Ulan',
];

/** Stable display name for an AI player, derived from its seat (player_index). */
export function aiPlayerName(playerIndex: number): string {
  const n = AI_PERSONAS.length;
  const i = ((Math.trunc(playerIndex) % n) + n) % n; // safe for any int, incl. negatives
  return `${AI_PERSONAS[i]} (AI)`;
}

// ── Level / XP utilities ──────────────────────────────────────────────────

/** Level from cumulative XP (matches backend computeLevel). */
export function getLevel(xp: number): number {
  return Math.floor(Math.sqrt(xp / 250)) + 1;
}

/** Total XP needed to reach a given level. */
export function getXpForLevel(level: number): number {
  return (level - 1) * (level - 1) * 250;
}

/** Progress info for current level. */
export function getLevelProgress(xp: number): {
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progress: number;
} {
  const level = getLevel(xp);
  const currentLevelXp = getXpForLevel(level);
  const nextLevelXp = getXpForLevel(level + 1);
  const range = nextLevelXp - currentLevelXp;
  const progress = range > 0 ? (xp - currentLevelXp) / range : 0;
  return { level, currentLevelXp, nextLevelXp, progress: Math.min(1, Math.max(0, progress)) };
}

// ── Ranked tier utilities ─────────────────────────────────────────────────

export type RankedTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';

export interface TierInfo {
  tier: RankedTier;
  label: string;
  color: string;
  minMu: number;
}

const TIER_THRESHOLDS: TierInfo[] = [
  { tier: 'diamond',  label: 'Diamond',  color: '#B9F2FF', minMu: 1900 },
  { tier: 'platinum', label: 'Platinum', color: '#E5E4E2', minMu: 1700 },
  { tier: 'gold',     label: 'Gold',     color: '#FFD700', minMu: 1500 },
  { tier: 'silver',   label: 'Silver',   color: '#C0C0C0', minMu: 1300 },
  { tier: 'bronze',   label: 'Bronze',   color: '#CD7F32', minMu: 0 },
];

export function getTier(mu: number): TierInfo {
  return TIER_THRESHOLDS.find((t) => mu >= t.minMu) ?? TIER_THRESHOLDS[TIER_THRESHOLDS.length - 1]!;
}

// ── Cosmetic rarity ───────────────────────────────────────────────────────

export type CosmeticRarity = 'common' | 'uncommon' | 'rare' | 'legendary' | 'mythic';

export const RARITY_COLORS: Record<CosmeticRarity, string> = {
  common:    '#9CA3AF',
  uncommon:  '#22C55E',
  rare:      '#3B82F6',
  legendary: '#A855F7',
  mythic:    '#F97316',
};

// ── Onboarding quest definitions ──────────────────────────────────────────

export interface QuestDef {
  quest_id: string;
  title: string;
  description: string;
  reward_xp: number;
  reward_gold: number;
}

export const ONBOARDING_QUESTS: QuestDef[] = [
  { quest_id: 'first_win',      title: 'First Victory',      description: 'Win your first game',          reward_xp: 50,  reward_gold: 20 },
  { quest_id: 'first_building',  title: 'Master Builder',     description: 'Build your first building',    reward_xp: 0,   reward_gold: 30 },
  { quest_id: 'first_tech',      title: 'Age of Discovery',   description: 'Research a technology',        reward_xp: 0,   reward_gold: 30 },
  { quest_id: 'first_ranked',    title: 'Ranked Contender',   description: 'Enter a ranked match',         reward_xp: 0,   reward_gold: 50 },
  { quest_id: 'first_friend',    title: 'Allies',             description: 'Add a friend',                 reward_xp: 0,   reward_gold: 25 },
  { quest_id: 'first_async',     title: 'The Long Game',      description: 'Start a multi-day game against another player', reward_xp: 0, reward_gold: 50 },
];

/**
 * Quests completable in any order. The rest of ONBOARDING_QUESTS gate
 * sequentially; first_async must not, because the players it targets are
 * early in the chain when the async CTA is shown to them.
 */
export const NON_SEQUENTIAL_QUESTS = new Set(['first_async']);

// ── Daily login rewards ───────────────────────────────────────────────────

/**
 * Escalating gold for consecutive login days (index = login_streak - 1;
 * day 5+ stays at the last value). Day 2 is deliberately bigger than day 1 —
 * the visible jump is the "come back tomorrow" hook on the post-game screen
 * and the login calendar. Shared so backend awards and frontend teasers can
 * never drift apart.
 */
export const DAILY_LOGIN_REWARDS = [10, 15, 20, 25, 30] as const;

/** Gold for a given consecutive-login day count (1-based; clamps at the cap). */
export function dailyLoginRewardForStreak(loginStreak: number): number {
  const idx = Math.min(Math.max(loginStreak, 1), DAILY_LOGIN_REWARDS.length) - 1;
  return DAILY_LOGIN_REWARDS[idx]!;
}

// ── Streak freezes ────────────────────────────────────────────────────────

/**
 * A streak freeze bridges exactly one missed day of the daily play streak;
 * gaps of two or more days still reset. Priced between the 3-day (25g) and
 * 7-day (75g) streak milestones so a freeze is a real purchase but cheaper
 * than the streak it protects. The cap keeps streaks mortal.
 */
export const STREAK_FREEZE_PRICE_GOLD = 50;
export const STREAK_FREEZE_MAX_HELD = 2;
